const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

test('Futu deadline cannot leave Electron alive or remove its profile before close', async () => {
  const file = path.join(__dirname, 'futu-service-isolation.test.js')
  const originalRequire = createRequire(file)
  const profile = path.join(__dirname, 'fixtures', 'synthetic-parent-profile')
  const root = path.join(__dirname, 'fixtures', 'synthetic-futu')
  const marker = { timeoutFixture: true, profile, signedFactory: true, rendererUrl: '', windows: 0,
    root, storedRoot: path.join(root, 'state', 'revision'), endpoint: path.join(root, 'publisher.sock') }
  let callback
  let settle
  let running = false
  let options
  const removed = []
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    __dirname, process: { env: {} },
    require(name) {
      if (name === 'node:test') return { test(_name, _options, action) { callback = action } }
      if (name === 'electron') return '/synthetic-electron'
      if (name === './not-ported') return { posixOnlyReason: () => false }
      if (name === 'node:child_process') return { execFile(_executable, _args, configuration, done) {
        options = configuration
        running = true
        settle = () => {
          running = false
          const failure = Object.assign(Error('fixture failure'), { code: 1, stdout: JSON.stringify(marker) + '\n', stderr: 'FUTU_SERVICE_TIMEOUT' })
          done(failure, JSON.stringify(marker) + '\n', 'FUTU_SERVICE_TIMEOUT')
        }
      } }
      if (name === 'node:fs/promises') return {
        mkdtemp: async () => profile,
        rm: async folder => { assert.equal(running, false); removed.push(folder) },
        realpath: async folder => folder,
        stat: async () => { throw Object.assign(Error('missing'), { code: 'ENOENT' }) },
      }
      return originalRequire(name)
    },
  })
  const operation = callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(running, true)
  assert.deepEqual(removed, [])
  // Always close the injected child, including when the deadline assertion fails.
  try {
    assert.equal(options.timeout, 10000)
    assert.equal(options.killSignal, 'SIGKILL')
  } finally { settle(); await operation }
  assert.deepEqual(removed, [profile])
})


test('Futu negative fixture reaches signed publisher timeout without creating a window', async () => {
  const file = path.join(__dirname, 'futu-service-electron.cjs')
  const originalRequire = createRequire(file)
  let start
  let timeout
  let observed
  let exited
  const reached = new Promise(resolve => { observed = resolve })
  const windows = []
  class Window {
    constructor() { windows.push(this) }
    static getAllWindows() { return windows }
    destroy() { windows.splice(windows.indexOf(this), 1) }
    webContents = { getURL: () => '' }
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    __dirname, process: { platform: 'darwin', env: { ODK_FUTU_FIXTURE_PROFILE: '/synthetic-profile' },
      argv: ['electron', file, '--timeout-after-connect'] },
    console: { log: record => observed(JSON.parse(record)), error() {} },
    setTimeout: () => 0, clearTimeout() {}, setImmediate: action => { timeout = action },
    require(name) {
      if (name === 'electron') return { BrowserWindow: Window, ipcMain: { removeHandler() {}, handle() {} },
        app: { dock: { hide() {} }, setPath() {}, on() {}, exit: code => { exited = code },
          whenReady: () => ({ then(action) { start = action; return { then() { return { catch() {} } } } } }) } }
      if (name === './helpers/live-fixtures') return { installGeometryFixtures() {} }
      if (name === './helpers/futu-service') return {
        fixture: async () => ({ root: '/synthetic-root', capturedRoot: '/synthetic-root/revision', endpoint: '/synthetic-root/publisher.sock' }),
        publisher: async () => ({}),
      }
      if (name === 'node:fs/promises') return { stat: async () => ({ isDirectory: () => true }) }
      return originalRequire(name)
    },
  })
  void start().catch(error => observed({ error: error.message }))
  const marker = await reached
  try {
    assert.equal(marker.timeoutFixture, true)
    assert.equal(marker.signedFactory, true)
    assert.equal(windows.length, 0)
    assert.equal(marker.rendererUrl, '')
    assert.equal(marker.windows, 0)
  } finally {
    timeout?.()
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.equal(exited, 1)
})
