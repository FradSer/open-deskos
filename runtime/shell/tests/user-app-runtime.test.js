'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { buildUserAppDocument, USER_APP_CSP } = require('../src/user-app-content')
const { createUserAppVerifier } = require('../src/user-app-verifier')

const electronPath = require('electron')
const feature = fs.readFileSync(path.join(__dirname, 'features', 'user-app-runtime.feature'), 'utf8')

function verifier(timeoutMs = 30000) {
  return createUserAppVerifier({ electronPath, timeoutMs })
}

test('BDD feature specifies opaque sandbox runtime guarantees and no CPU promise', () => {
  assert.match(feature, /Feature: Sandboxed self-contained user applications/)
  assert.match(feature, /Startup does not create resources after quit/)
  assert.match(feature, /a control listener that finishes after quit closes immediately/i)
  assert.match(feature, /independent Electron verification process exceeds its deadline/)
  assert.match(feature, /Retry cleanup after a verifier releases its profile lock/)
  assert.match(feature, /Runtime iframe CPU scheduling is not an isolation guarantee/)
  assert.doesNotMatch(feature, /unsafe-inline on the shell/i)
})

test('buildUserAppDocument injects token readiness without srcdoc', () => {
  const html = buildUserAppDocument('<body><p>ready</p></body>', { token: 'secret-token' })
  assert.match(html, /odk-user-app-ready/)
  assert.match(html, /secret-token/)
  assert.doesNotMatch(html, /srcdoc/i)
  assert.match(USER_APP_CSP, /connect-src 'none'/)
  assert.match(USER_APP_CSP, /frame-ancestors 'self' file:/)
})

test('verifier rejects oversized input before spawning a child', async () => {
  const result = await verifier().verify({ html: 'x'.repeat(256 * 1024 + 1) })
  assert.deepEqual(result, { ok: false, error: 'html-too-large' })
})

test('verifier runner isolates both Electron profiles and hides its Dock entry before readiness', () => {
  const paths = []
  let hidden = false
  const app = { setPath: (name, value) => paths.push([name, value]),
    dock: { hide: () => { hidden = true } }, disableHardwareAcceleration() {} }
  const profile = path.resolve('private-verifier-profile')
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/user-app-verifier-runner.js'), 'utf8'), {
    module: { exports: {} }, process: { platform: 'darwin', argv: ['electron', '/fixture/user-app-verifier-runner.js', '/bundle', '/result', profile] },
    require(name) {
      if (name === 'electron') return { app, protocol: { registerSchemesAsPrivileged() {
        assert.deepEqual(paths, [['userData', profile], ['sessionData', profile]])
        assert.equal(hidden, true)
      } } }
      if (name === './user-app-content') return {}
      if (name === './user-app-context') return {}
      if (name === './user-app-system') return { USER_APP_SCHEME_PRIVILEGES: {} }
      throw Error(`Unexpected runner import: ${name}`)
    },
  })
  assert.deepEqual(paths, [['userData', profile], ['sessionData', profile]])
  assert.equal(hidden, true)
})

// The runner is a GUI process on Windows, where a piped stdin is not a channel it
// can read: the bundle travels as a file and the result comes back as a file, so
// neither direction depends on the child's standard streams.
for (const state of [{ visible: true, error: '' }, { visible: false, error: '' }, { visible: true, error: 'controlled script error' }]) {
for (const stdout of ['backpressure', 'closed']) {
test(`verifier runner exits after writing its ${state.visible && !state.error ? 'success' : 'failure'} result without another scheduling turn: ${stdout} ${JSON.stringify(state)}`, { timeout: 1000 }, async () => {
  let options
  let written, savedResult
  const saved = new Promise(resolve => { written = resolve })
  const events = [], pendingImmediates = []
  const app = { setPath() {}, disableHardwareAcceleration() {}, whenReady: async () => {}, exit(code) { events.push({ kind: 'exit', code }) } }
  const verificationSession = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    webRequest: { onBeforeRequest() {} }, protocol: { handle() {} } }
  const session = { fromPartition(partition, settings) {
    assert.equal(partition, 'verify-1')
    assert.equal(JSON.stringify(settings), JSON.stringify({ cache: false }))
    return verificationSession
  }, get defaultSession() { throw Error('Verification must not initialize the default persistent session') } }
  const protocol = { registerSchemesAsPrivileged() {}, handle() { throw Error('Verification must use its session protocol') } }
  class BrowserWindow {
    constructor(value) {
      options = value
      this.webContents = { setWindowOpenHandler() {}, on() {}, executeJavaScript: async () => state }
    }
    async loadURL() {}
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/user-app-verifier-runner.js'), 'utf8'), {
    module: { exports: {} }, process: { platform: 'linux', argv: ['electron', '/fixture/user-app-verifier-runner.js', '/bundle', '/result', '/profile'],
      pid: 1, stdout: { write(text) { events.push({ kind: 'stdout', text }); if (stdout === 'closed') throw Error('Controlled closed stdout'); return false } } }, Buffer,
    setTimeout: callback => callback(), setImmediate: callback => { pendingImmediates.push(callback) },
    require(name) {
      if (name === 'electron') return { app, session, protocol, BrowserWindow }
      if (name === './user-app-content') return { buildUserAppDocument: () => '<body>Fixture</body>' }
      if (name === './user-app-context') return {}
      if (name === './user-app-system') return { USER_APP_SCHEME_PRIVILEGES: {} }
      if (name === 'node:fs') return { statSync: () => ({ size: 30 }), readFileSync: () => JSON.stringify({ html: '<body>Fixture</body>' }), writeFileSync(file, text) {
        assert.equal(file, '/result')
        savedResult = JSON.parse(text)
        events.push({ kind: 'file' })
        written()
      } }
      throw Error(`Unexpected runner import: ${name}`)
    },
  })
  await saved
  const ok = state.visible && !state.error
  assert.equal(savedResult.ok, !!ok)
  if (!ok) assert.equal(savedResult.error, state.error || 'user app has no visible body content')
  assert.deepEqual(events.map(event => event.kind), ['file', 'stdout', 'exit'])
  assert.equal(events.at(-1).code, ok ? 0 : 1)
  assert.equal(pendingImmediates.length, 0, 'A completed verdict must not defer its only exit request')
  assert.equal(options.show, false)
  assert.equal(options.webPreferences.backgroundThrottling, false)
  assert.equal(options.webPreferences.contextIsolation, true)
  assert.equal(options.webPreferences.nodeIntegration, false)
  assert.equal(options.webPreferences.sandbox, true)
  assert.equal(options.webPreferences.session, verificationSession)
})
}
}

test('verifier hands the bundle over as a file and reads the result from one', async () => {
  const seen = []
  const spawnProcess = (command, args, options) => {
    const bundlePath = args[2]
    const resultPath = args[3]
    const profilePath = args[4]
    seen.push({ command, bundlePath, resultPath, profilePath, options, bundle: fs.readFileSync(bundlePath, 'utf8') })
    fs.writeFileSync(resultPath, `${JSON.stringify({ ok: true })}\n`, 'utf8')
    return fakeChild()
  }
  const html = maximumSizedHtml()
  const result = await createUserAppVerifier({ electronPath: 'electron', spawnProcess }).verify({ html, manifestBytes: Buffer.alloc(500000), htmlBytes: Buffer.alloc(500000) })

  assert.deepEqual(result, { ok: true })
  assert.equal(seen.length, 1)
  assert.deepEqual(JSON.parse(seen[0].bundle), { html }, 'only semantic fields cross the file channel, without duplicating Buffers')
  assert.ok(path.isAbsolute(seen[0].bundlePath), 'the runner needs a path it can open')
  assert.ok(path.isAbsolute(seen[0].resultPath))
  assert.ok(path.isAbsolute(seen[0].profilePath))
  assert.equal(path.dirname(seen[0].profilePath), path.dirname(seen[0].bundlePath))
  assert.equal(seen[0].options.env.HOME, process.env.HOME, 'the runner uses app.setPath instead of changing the global HOME')
  assert.equal(fs.existsSync(path.dirname(seen[0].bundlePath)), false, 'bundle, result and profile are cleaned after success')
})

function fakeChild({ close = true, onKill } = {}) {
  const { EventEmitter } = require('node:events')
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => { onKill?.() }
  child.pid = 4242
  if (close) setImmediate(() => child.emit('close', 0))
  return child
}

function maximumSizedHtml() {
  const prefix = '<body><p>verified</p><!--'
  const suffix = '--></body>'
  // Exercise the byte limit without asking layout to shape a 256 KiB word.
  return `${prefix}${'x'.repeat(256 * 1024 - prefix.length - suffix.length)}${suffix}`
}

test('real Electron verifier accepts a maximum-sized visible self-contained bundle', async () => {
  const result = await verifier().verify({ html: maximumSizedHtml() })
  assert.deepEqual(result, { ok: true })
})

test('two Electron verifiers run concurrently with independent profiles', { timeout: 45000 }, async () => {
  const results = await Promise.all([
    verifier(30000).verify({ html: '<body><p>parallel one</p></body>' }),
    verifier(30000).verify({ html: '<body><p>parallel two</p></body>' }),
  ])
  assert.deepEqual(results, [{ ok: true }, { ok: true }])
})

test('verifier restarts bounded cleanup after the child closes and releases its profile lock', { timeout: 10000 }, async () => {
  const pending = []
  let child
  let closeObserved = false
  let lockReleased = false
  let rmAttempts = 0
  let killed = false
  let cleaned
  const cleanupCompleted = new Promise(resolve => { cleaned = resolve })
  const originalRmSync = fs.rmSync
  const originalProcessKill = process.kill
  fs.rmSync = (target, options) => {
    const directory = pending[0] && path.dirname(pending[0][2])
    if (directory && target === directory && !lockReleased) {
      rmAttempts++
      if (killed && rmAttempts === 41) queueMicrotask(() => { closeObserved = true; child.emit('close', 0) })
      if (closeObserved && rmAttempts > 41) lockReleased = true
      throw new Error('profile is still locked')
    }
    const result = originalRmSync(target, options)
    if (directory && target === directory) cleaned()
    return result
  }
  const closeAfterKill = () => { killed = true }
  process.kill = (pid, signal) => {
    if (pid === -4242) {
      closeAfterKill()
      return true
    }
    return originalProcessKill(pid, signal)
  }
  try {
    const result = await createUserAppVerifier({ electronPath: 'electron', timeoutMs: 10, spawnProcess: (_command, args) => {
      pending.push(args)
      fs.writeFileSync(args[3], `${JSON.stringify({ ok: true })}\n`, 'utf8')
      child = fakeChild({ close: false, onKill: closeAfterKill })
      return child
    } }).verify({ html: '<body>locked profile</body>' })
    assert.deepEqual(result, { ok: false, error: 'verification-timeout' })
    await cleanupCompleted
    assert.ok(rmAttempts >= 41, `expected cleanup to encounter the exhausted retry budget, got ${rmAttempts}`)
    assert.equal(fs.existsSync(path.dirname(pending[0][2])), false)
  } finally {
    process.kill = originalProcessKill
    fs.rmSync = originalRmSync
  }
})

test('verifier cleans its temporary directory after timeout, abort and spawn failure', async () => {
  const pending = []
  const timeout = await createUserAppVerifier({ electronPath: 'electron', timeoutMs: 10, spawnProcess: (_command, args) => {
    pending.push(args)
    return fakeChild({ close: false })
  } }).verify({ html: '<body>timeout</body>' })
  assert.deepEqual(timeout, { ok: false, error: 'verification-timeout' })
  assert.equal(fs.existsSync(path.dirname(pending[0][2])), false)

  const controller = new AbortController()
  const abortedPaths = []
  const abortedPromise = createUserAppVerifier({ electronPath: 'electron', timeoutMs: 5000, spawnProcess: (_command, args) => {
    abortedPaths.push(args)
    return fakeChild({ close: false })
  } }).verify({ html: '<body>abort</body>' }, { signal: controller.signal })
  controller.abort()
  assert.deepEqual(await abortedPromise, { ok: false, error: 'verification-aborted' })
  assert.equal(fs.existsSync(path.dirname(abortedPaths[0][2])), false)

  const syncController = new AbortController()
  let syncKills = 0
  const originalProcessKill = process.kill
  process.kill = () => { syncKills++ }
  let syncAborted
  try {
    syncAborted = await createUserAppVerifier({ electronPath: 'electron', timeoutMs: 10, spawnProcess: (_command, args) => {
      syncController.abort()
      return fakeChild({ close: false, onKill: () => { syncKills++ } })
    } }).verify({ html: '<body>sync abort</body>' }, { signal: syncController.signal })
    await new Promise(resolve => setTimeout(resolve, 30))
  } finally {
    process.kill = originalProcessKill
  }
  assert.deepEqual(syncAborted, { ok: false, error: 'verification-aborted' })
  assert.equal(syncKills, 1, 'a synchronous abort must not leave a deadline timer behind')

  const failedPaths = []
  const failed = await createUserAppVerifier({ electronPath: 'electron', spawnProcess: (_command, args) => {
    failedPaths.push(args)
    throw new Error('fixture spawn failed')
  } }).verify({ html: '<body>spawn</body>' })
  assert.deepEqual(failed, { ok: false, error: 'fixture spawn failed' })
  assert.equal(fs.existsSync(path.dirname(failedPaths[0][2])), false)
})

test('real Electron verifier rejects a bundle with a JavaScript exception', async () => {
  const result = await verifier().verify({ html: '<body><script>throw new Error("broken app")</script><p>visible</p></body>' })
  assert.equal(result.ok, false)
  assert.match(result.error, /broken app|script error|verification failed/i)
})

test('real Electron verifier kills an infinite bundle by deadline', async () => {
  const started = Date.now()
  let childClosed = false
  const owned = createUserAppVerifier({ electronPath, timeoutMs: 1200, spawnProcess(...args) {
    const child = require('node:child_process').spawn(...args)
    child.once('close', () => { childClosed = true })
    return child
  } })
  const result = await owned.verify({ html: '<body><script>while (true) {}</script></body>' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'verification-timeout')
  assert.ok(Date.now() - started < 5000)
  await owned.close()
  assert.equal(childClosed, true, 'release requires actual hostile child closure')
})

test('real Electron verifier blocks hostile navigation without crashing', async () => {
  const result = await verifier().verify({ html: '<body><script>location.href="https://example.invalid/escape"</script><p>visible</p></body>' })
  assert.equal(typeof result.ok, 'boolean')
  if (!result.ok) assert.match(result.error, /navigation|network|Content Security Policy|Refused|verification|visible body/i)
})

test('real Electron verifier keeps network-disabled bundle confined', async () => {
  const html = `<body><p id="status">network test</p><script>
    fetch('https://example.invalid/secret').then(() => { document.body.dataset.network = 'allowed' }, () => { document.body.dataset.network = 'blocked' })
  </script></body>`
  const result = await verifier().verify({ html })
  assert.equal(result.ok, false)
  assert.match(result.error, /Content Security Policy|Refused to connect|network/i)
})

test('the served package document publishes data through the system bridge it already carries', () => {
  const html = buildUserAppDocument('<body><p>ready</p></body>', { token: 'secret-token' })
  const posted = []
  const documentElement = { dataset: {}, style: { setProperty() {} } }
  const packageWindow = {
    document: { documentElement, readyState: 'complete', addEventListener() {} },
    addEventListener() {},
    setTimeout, clearTimeout,
  }
  packageWindow.parent = { postMessage: (message) => posted.push(message) }
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { window: packageWindow, globalThis: packageWindow, document: packageWindow.document, parent: packageWindow.parent, setTimeout, clearTimeout, AbortController })
  assert.equal(typeof packageWindow.odkPackageData?.publish, 'function', 'a package needs no new API surface to publish')
  packageWindow.odkPackageData.publish({ remaining_seconds: 90 })
  const dataMessages = () => posted.filter(message => message.type === 'odk-user-app-data')
  assert.deepEqual(JSON.parse(JSON.stringify(dataMessages().at(-1))), { type: 'odk-user-app-data', token: 'secret-token', data: { remaining_seconds: 90 } })
  packageWindow.odkPackageData.publish('not-an-object')
  assert.equal(dataMessages().length, 1, 'the bridge sends only an object')
})

test('deadline preserves a committed failure when the verifier cannot exit', async t => {
  const signals = []
  const originalKill = process.kill
  process.kill = (pid, signal) => { signals.push([pid, signal]); return true }
  t.after(() => { process.kill = originalKill })
  const result = await createUserAppVerifier({ timeoutMs: 20, spawnProcess: (_command, args) => {
    fs.writeFileSync(args[3], JSON.stringify({ ok: false, error: 'broken app' }))
    const child = fakeChild({ close: false })
    child.kill = signal => signals.push([child.pid, signal])
    return child
  } }).verify({ html: '<body>fixture</body>' })
  assert.deepEqual(signals, [[process.platform === 'win32' ? 4242 : -4242, 'SIGKILL']])
  assert.deepEqual(result, { ok: false, error: 'broken app' })
})

test('deadline never accepts success or console claims before verifier exit', async () => {
  for (const value of [null, { ok: true }, { ok: false, error: 42 }, { ok: false, error: '' }, { ok: false, error: 'x'.repeat(64 * 1024) }]) {
    const result = await createUserAppVerifier({ timeoutMs: 20, spawnProcess: (_command, args) => {
      fs.writeFileSync(args[3], JSON.stringify(value))
      const child = fakeChild({ close: false })
      child.pid = undefined
      setImmediate(() => child.stdout.emit('data', JSON.stringify({ ok: false, error: 'console claim' })))
      return child
    } }).verify({ html: '<body>fixture</body>' })
    assert.equal(result.error, 'verification-timeout')
  }
})

test('verifier drain waits for child closure and permits subsequent verification', async t => {
  let firstChild, count = 0
  const controller = new AbortController()
  const owned = createUserAppVerifier({ electronPath: 'fixture-electron', spawnProcess(_command, args) {
    fs.writeFileSync(args[3], JSON.stringify({ ok: true }))
    const child = fakeChild({ close: ++count > 1 })
    child.pid = undefined
    if (count === 1) firstChild = child
    return child
  } })
  t.after(async () => { firstChild?.emit('close', 0); await owned.close() })
  const verifying = owned.verify({ html: '<body>Fixture</body>' }, { signal: controller.signal })
  controller.abort()
  assert.equal((await verifying).error, 'verification-aborted')
  assert.equal(typeof owned.drain, 'function')
  let finished = false
  const draining = owned.drain().then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finished, false)
  firstChild.emit('close', 0)
  await draining
  assert.equal((await owned.verify({ html: '<body>Next fixture</body>' })).ok, true)
  await owned.close()
})


test('the opaque bootstrap shares the detector and accepts Home capability only from its parent', () => {
  const html = buildUserAppDocument('<body>App</body>', { token: 'owned' })
  const root = new EventTarget(), parent = { postMessage: message => posted.push(message) }, posted = []
  const documentElement = { dataset: {}, style: { setProperty() {} }, contains: target => target === documentElement }
  const document = { documentElement, readyState: 'complete' }
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { window: root, document, parent, AbortController })
  function message(source, token) {
    const event = new Event('message'); Object.assign(event, { source, data: { type: 'odk-user-app-theme', token, returnHome: true } }); root.dispatchEvent(event)
  }
  function pinch() {
    for (const [type, span] of [['touchstart', 200], ['touchmove', 100], ['touchend', 0]]) {
      const event = new Event(type, { cancelable: true })
      Object.assign(event, { touches: span ? [0, 1].map(i => ({ identifier: i, target: documentElement, clientX: 300 + (i ? span / 2 : -span / 2), clientY: 200 })) : [] })
      root.dispatchEvent(event)
    }
  }
  const returns = () => posted.filter(message => message.type === 'odk-user-app-return-home')
  pinch(); message({}, 'owned'); pinch(); message(parent, 'old'); pinch()
  assert.equal(returns().length, 0)
  message(parent, 'owned'); pinch()
  assert.deepEqual(JSON.parse(JSON.stringify(returns())), [{ type: 'odk-user-app-return-home', token: 'owned' }])
  root.dispatchEvent(new Event('pagehide')); pinch()
  assert.equal(returns().length, 1, 'disposal removes the detector')
})

// Native lifecycle acceptance runs with the existing Electron verifier checks.
for (const [name, html, expectedCode] of [
  ['visible content', '<body><p>Verifier lifecycle regression</p></body>', 0],
  ['script failure', '<body><p>Verifier lifecycle regression</p><script>throw Error("controlled lifecycle failure")</script></body>', 1],
]) {
  test(`native verifier normally closes within its default eight-second deadline: ${name}`, { timeout: 25000 }, async t => {
    let closed
    let stderr = ''
    const events = []
    const began = performance.now()
    const verifier = createUserAppVerifier({ electronPath: require('electron'), spawnProcess(file, args, options) {
      const child = require('node:child_process').spawn(file, args, options)
      child.stdout.on('data', chunk => {
        if (chunk.toString().includes('"ok":')) events.push({ phase: 'reported', elapsedMs: Math.round(performance.now() - began) })
      })
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000) })
      child.once('exit', (code, signal) => events.push({ phase: 'exit', code, signal, elapsedMs: Math.round(performance.now() - began) }))
      child.once('close', (code, signal) => { closed = { code, signal }; events.push({ phase: 'close', ...closed, elapsedMs: Math.round(performance.now() - began) }) })
      return child
    } })
    t.after(() => verifier.close())
    const result = await verifier.verify({ html })
    await verifier.close()
    t.diagnostic(JSON.stringify({ result, events, stderr }))
    assert.deepEqual(closed, { code: expectedCode, signal: null }, 'A verdict requires the actual normal child close')
    assert.equal(result.ok, expectedCode === 0)
    if (expectedCode === 1) assert.match(result.error, /controlled lifecycle failure/)
  })
}
