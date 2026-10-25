const { isolatedElectronArgs } = require('../helpers/electron-fixture')
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const electron = require('electron')

async function runPipeline(t, args = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-pipe-'))
  const home = path.join(directory, 'home')
  await fs.mkdir(home)
  let child, timedOut = false
  const kill = () => {
    if (!child?.pid) return
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', timeout: 5000 })
      else process.kill(-child.pid, 'SIGKILL')
    } catch (error) { if (error.code !== 'ESRCH' && process.platform !== 'win32') throw error }
  }
  t.after(async () => { if (child?.exitCode === null && child?.signalCode === null) kill(); await fs.rm(directory, { recursive: true, force: true }) })
  child = spawn(electron, isolatedElectronArgs([path.resolve(__dirname, '../agent-task-pipeline.cjs'), ...args]), {
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TMPDIR: directory, TEMP: directory, TMP: directory,
      ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
      ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {}),
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } : {}) },
  })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-32768) })
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-32768) })
  const timer = setTimeout(() => { timedOut = true; kill() }, 20000)
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once('close', (code, signal) => resolve({ code, signal }))
    child.once('error', reject)
  }).finally(() => clearTimeout(timer))
  assert.equal(timedOut, false, 'The owned Electron process group required the outer deadline')
  assert.equal(signal, null, 'The pipeline must close normally without a termination signal')
  const report = stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } }).findLast(value => typeof value.passed === 'boolean')
  assert(report, JSON.stringify({ code, stdout, stderr }))
  assert.equal(path.dirname(report.directory), await fs.realpath(directory), 'Only private test state may be removed')
  await fs.rm(report.directory, { recursive: true, force: true })
  assert.deepEqual((await fs.readdir(directory)).filter(name => name.startsWith('odk-child-flow-')), [], 'The pipeline must release its private state directory')
  return { code, report, stderr }
}

test('actual saved-child activity crosses the complete offline pipeline', { timeout: 30000 }, async t => {
  const { code, report, stderr } = await runPipeline(t)
  assert.equal(code, 0, stderr)
  assert.equal(report.passed, true)
  assert.equal(report.cleanupPassed, true)
  assert.equal(report.externalModelCalls, 0)
  assert.notEqual(report.residentPids[0], report.residentPids[1])
})

test('missing saved identity cannot pass restart acceptance', { timeout: 30000 }, async t => {
  const { code, report, stderr } = await runPipeline(t, ['--drop-saved-identity'])
  assert.equal(code, 1)
  assert.equal(report.passed, false)
  assert.match(stderr, /Saved reporter is missing after restart/)
})

test('an unresponsive resident cannot hang or pass teardown', { timeout: 30000 }, async t => {
  const { code, report } = await runPipeline(t, ['--stall-resident-close'])
  assert.equal(code, 1)
  assert.equal(report.passed, false)
  assert.equal(report.cleanupPassed, false)
  assert.equal(report.forcedCleanup, true)
})
