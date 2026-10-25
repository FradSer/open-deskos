'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const nativeFs = require('node:fs')
const { spawn } = require('node:child_process')
const path = require('node:path')
const { isolatedElectronArgs } = require('./helpers/electron-fixture')
const os = require('node:os')

function fixtureEnvironment(profile, inherited = process.env) {
  const env = { PATH: inherited.PATH, LANG: inherited.LANG || 'en_US.UTF-8', HOME: profile, USERPROFILE: profile,
    APPDATA: profile, LOCALAPPDATA: profile, TMPDIR: profile, XDG_CONFIG_HOME: profile, XDG_STATE_HOME: profile, XDG_CACHE_HOME: profile,
    ODK_DEVICE_GATEWAY_TEST_PROFILE: profile }
  for (const name of ['SystemRoot', 'WINDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) if (inherited[name]) env[name] = inherited[name]
  if (inherited.ODK_DEVICE_GATEWAY_TEST_EVIDENCE) env.ODK_DEVICE_GATEWAY_TEST_EVIDENCE = inherited.ODK_DEVICE_GATEWAY_TEST_EVIDENCE
  return env
}

test('Devices manages Hydra association and confirmed control through actual preload across themes and compact sizes', { timeout: 60000 }, async t => {
  const profile = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'odk-devices-ui-')))
  await fs.chmod(profile, 0o700)
  const env = fixtureEnvironment(profile)
  const stdoutFile = path.join(profile, 'fixture.stdout'), stderrFile = path.join(profile, 'fixture.stderr')
  const stdoutFd = nativeFs.openSync(stdoutFile, 'wx', 0o600), stderrFd = nativeFs.openSync(stderrFile, 'wx', 0o600)
  let successfulExit = false, child, timer, exit = null, timedOut = false, spawnError = null, descriptorsOpen = true
  const start = Date.now()
  try {
    child = spawn(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, path.join(__dirname, 'device-gateway-electron.cjs')]),
      { env, signal: t.signal, killSignal: 'SIGKILL', stdio: ['ignore', stdoutFd, stderrFd] })
    nativeFs.closeSync(stdoutFd); nativeFs.closeSync(stderrFd); descriptorsOpen = false
    child.once('exit', (code, signal) => { exit = { code, signal, elapsedMs: Date.now() - start } })
    child.once('error', error => { spawnError = { name: error.name, code: error.code || null } })
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, 50000)
    const closed = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, elapsedMs: Date.now() - start })))
    clearTimeout(timer)
    const [stdout, stderr] = await Promise.all([fs.readFile(stdoutFile, 'utf8'), fs.readFile(stderrFile, 'utf8')])
    assert.ok(stdout.length < 1024 * 1024 && stderr.length < 1024 * 1024, 'Fixture output exceeds its evidence bound')
    const reports = stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)), report = reports.findLast(value => value.result)
    const receipt = { pid: child.pid, exit, close: closed, timedOut, spawnError, report: report || null, stderr: stderr.slice(-8000), profile }
    if (process.env.ODK_DEVICE_GATEWAY_TEST_EXIT_EVIDENCE) await fs.writeFile(process.env.ODK_DEVICE_GATEWAY_TEST_EXIT_EVIDENCE, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    assert.equal(timedOut, false, `Fixture exceeded its unchanged 50-second timeout; retained profile: ${profile}`)
    assert.equal(spawnError, null)
    assert.equal(exit?.code, 0, `Fixture did not exit zero; retained profile: ${profile}; ${stderr.slice(-2000)}`)
    assert.equal(exit.signal, null)
    assert.equal(closed.code, 0); assert.equal(closed.signal, null)
    assert.equal(report?.result, 'CHECKS_PASSED', JSON.stringify(receipt))
    assert.equal(report.mainPid, child.pid)
    assert.equal(report.actualPreload, true); assert.equal(report.actualDevice, false)
    assert.equal(report.themeSizeChecks, 16); assert.equal(report.fixturePeers, 2)
    assert.ok(Array.isArray(report.sdkBaselineErrors) && report.sdkBaselineErrors.length <= 1)
    if (report.sdkBaselineErrors.length) assert.deepEqual(report.sdkBaselineErrors[0], { signature: 'frozen-liquid-glass-blob-worker-csp', phase: 'theme:liquid-glass', source: 'themes/liquid-glass-sdk.js:108' })
    assert.equal(report.zoom200, true); assert.equal(report.cleanupReleased, true); assert.equal(report.lifecycleReleased, true); assert.equal(report.rendererErrors, 0)
    successfulExit = true
  } finally {
    clearTimeout(timer)
    if (descriptorsOpen) { nativeFs.closeSync(stdoutFd); nativeFs.closeSync(stderrFd) }
    // Do not delete a failed process's profile while its descendants may retain it.
    if (successfulExit) await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('private Electron fixture retains graphical connection variables without inheriting test or credential environment', () => {
  const inherited = { PATH: '/synthetic-bin', DISPLAY: ':synthetic', WAYLAND_DISPLAY: 'synthetic-wayland',
    XAUTHORITY: '/synthetic-auth', XDG_RUNTIME_DIR: '/synthetic-runtime', DBUS_SESSION_BUS_ADDRESS: 'synthetic-bus',
    HOME: '/formal-home', XDG_CONFIG_HOME: '/formal-config', XDG_STATE_HOME: '/formal-state', XDG_CACHE_HOME: '/formal-cache',
    NODE_TEST_CONTEXT: 'synthetic-worker', NODE_OPTIONS: 'synthetic-options', ELECTRON_RUN_AS_NODE: '1', PRIVATE_TOKEN: 'synthetic-token' }
  const env = fixtureEnvironment('/private-profile', inherited)
  for (const name of ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) assert.equal(env[name], inherited[name])
  for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) assert.equal(env[name], '/private-profile')
  for (const name of ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'PRIVATE_TOKEN']) assert.equal(Object.hasOwn(env, name), false)
})
