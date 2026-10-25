'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)
const script = path.join(__dirname, 'acceptance/ride-recommendation-live.cjs')

test('live acceptance loads the installed canonical channel before native startup', async () => {
  const vm = require('node:vm')
  const loaded = []
  const app = { setPath() {}, disableHardwareAcceleration() {}, dock: { hide() {} }, whenReady: () => new Promise(() => {}) }
  const fakeFs = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 0 },
    lstatSync: () => ({ isSocket: () => true, isDirectory: () => true, uid: process.getuid(), mode: 0o700 }),
    openSync: () => 1,
    fstatSync: () => ({ isFile: () => true, uid: process.getuid(), mode: 0o600, size: 24 }),
    readFileSync: () => 'fixture-only-channel-token', closeSync() {}, mkdirSync() {},
    readdirSync: () => [], mkdtempSync: () => '/fixture/profile',
  }
  const fixtureProcess = {
    argv: ['node', script, '--live', '--endpoint', '/fixture/channel.sock', '--token-file', '/fixture/channel.token', '--out', '/fixture/output'],
    getuid: () => process.getuid(), on() {}, stdout: { write() {} }, stderr: { write() {} },
    exit: code => { throw Error(`Unexpected fixture exit ${code}`) },
  }
  vm.runInNewContext(await fs.readFile(script, 'utf8'), {
    __dirname: path.dirname(script), process: fixtureProcess, console,
    setTimeout: () => 1, clearTimeout() {},
    require(name) {
      if (name === 'node:fs') return fakeFs
      if (name === 'node:module') return { createRequire: () => name => {
        assert.equal(name, 'electron')
        return { app }
      } }
      if (name.endsWith('/src/personal-agent-client.js') || name.endsWith('/src/personal-bot-client.js')) loaded.push(name)
      return require(name)
    },
  }, { filename: script })
  assert.deepEqual(loaded, [path.join(__dirname, '../src/personal-agent-client.js')])
})

async function observeGate(t, flags, expectedCode, expectedPhase) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-live-ride-gate-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const token = path.join(directory, 'fixture-channel.token')
  const endpoint = path.join(directory, 'fixture-forward.sock')
  const output = path.join(directory, 'screenshots')
  const report = path.join(directory, 'gate.json')
  const preload = path.join(directory, 'observe.cjs')
  const credential = 'fixture-only-do-not-expose-this-value'
  await fs.writeFile(token, credential, { mode: 0o600 })
  await fs.writeFile(preload, `
    const fs = require('node:fs'), Module = require('node:module')
    const net = require('node:net'), http = require('node:http'), https = require('node:https'), tls = require('node:tls')
    const childProcess = require('node:child_process')
    const report = ${JSON.stringify(report)}
    const targets = ${JSON.stringify([token, endpoint, output])}
    const counts = { io: 0, electron: 0, client: 0, network: 0, child: 0 }
    const write = fs.writeFileSync.bind(fs)
    const watched = value => typeof value === 'string' && targets.some(target => value === target || value.startsWith(target + '/'))
    for (const method of ['openSync', 'readFileSync', 'lstatSync', 'statSync', 'realpathSync', 'mkdirSync', 'readdirSync', 'writeFileSync']) {
      const original = fs[method].bind(fs)
      fs[method] = (target, ...args) => {
        if (watched(target)) { counts.io++; throw Error('Live gate crossed a fixture path') }
        return original(target, ...args)
      }
    }
    for (const method of ['open', 'readFile', 'lstat', 'stat', 'realpath', 'mkdir', 'readdir', 'writeFile']) {
      const original = fs.promises[method].bind(fs.promises)
      fs.promises[method] = async (target, ...args) => {
        if (watched(target)) { counts.io++; throw Error('Live gate crossed a fixture path') }
        return original(target, ...args)
      }
    }
    const network = () => { counts.network++; throw Error('Live gate attempted network access') }
    net.Socket.prototype.connect = network
    http.request = network; http.get = network; https.request = network; https.get = network; tls.connect = network
    globalThis.fetch = network
    for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) childProcess[method] = () => { counts.child++; throw Error('Live gate attempted a child process') }
    const load = Module._load
    Module._load = function (name, ...args) {
      if (name === 'electron') { counts.electron++; throw Error('Live gate loaded Electron') }
      if (String(name).endsWith('/src/personal-agent-client.js')) { counts.client++; throw Error('Live gate loaded the channel client') }
      return load.call(this, name, ...args)
    }
    process.on('exit', () => write(report, JSON.stringify(counts), { mode: 0o600 }))
  `, { mode: 0o600 })
  const args = flags({ token, endpoint, output })
  let result
  try {
    result = await execute(process.execPath, ['--require', preload, script, ...args], { timeout: 3000, maxBuffer: 32768 })
  } catch (error) { result = error }
  assert.equal(result.code ?? 0, expectedCode, result.stderr)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, `LIVE_UI phase=${expectedPhase}\n`)
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(credential))
  assert.deepEqual(JSON.parse(await fs.readFile(report, 'utf8')), { io: 0, electron: 0, client: 0, network: 0, child: 0 })
  await assert.rejects(fs.stat(output), { code: 'ENOENT' })
  assert.equal(await fs.readFile(token, 'utf8'), credential)
}

const fixtureFlags = ({ token, endpoint, output }) => ['--endpoint', endpoint, '--token-file', token, '--out', output]

test('live ride acceptance requires explicit --live before any fixture access or native/service startup', async t => {
  await observeGate(t, fixtureFlags, 2, 'authorization_required')
})

test('missing --live takes precedence over an invalid live scope', async t => {
  await observeGate(t, paths => ['--scope', 'production', ...fixtureFlags(paths)], 2, 'authorization_required')
})

test('an unsupported live scope cannot access fixture credentials or start a service', async t => {
  await observeGate(t, paths => ['--live', '--scope', 'production', ...fixtureFlags(paths)], 1, 'initialization_failed')
})

test('live ride acceptance has no default production endpoint or credential path', async t => {
  await observeGate(t, () => ['--live'], 1, 'initialization_failed')
})

test('a missing explicit endpoint fails before reading the supplied fixture token', async t => {
  await observeGate(t, ({ token, output }) => ['--live', '--token-file', token, '--out', output], 1, 'initialization_failed')
})
