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

// The runner is a GUI process on Windows, where a piped stdin is not a channel it
// can read: the bundle travels as a file and the result comes back as a file, so
// neither direction depends on the child's standard streams.
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

test('verifier restarts bounded cleanup after the child closes and releases its profile lock', async () => {
  const pending = []
  let child
  let closeObserved = false
  let lockReleased = false
  let rmAttempts = 0
  const originalRmSync = fs.rmSync
  const originalProcessKill = process.kill
  fs.rmSync = (target, options) => {
    const directory = pending[0] && path.dirname(pending[0][2])
    if (directory && target === directory && !lockReleased) {
      rmAttempts++
      if (closeObserved && rmAttempts >= 41) lockReleased = true
      throw new Error('profile is still locked')
    }
    return originalRmSync(target, options)
  }
  const closeAfterKill = () => {
    setTimeout(() => {
      closeObserved = true
      child.emit('close', 0)
    }, 2100)
  }
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
    await new Promise(resolve => setTimeout(resolve, 2400))
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
  const result = await verifier(1200).verify({ html: '<body><script>while (true) {}</script></body>' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'verification-timeout')
  assert.ok(Date.now() - started < 5000)
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
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { window: packageWindow, globalThis: packageWindow, document: packageWindow.document, parent: packageWindow.parent, setTimeout, clearTimeout })
  assert.equal(typeof packageWindow.odkPackageData?.publish, 'function', 'a package needs no new API surface to publish')
  packageWindow.odkPackageData.publish({ remaining_seconds: 90 })
  const dataMessages = () => posted.filter(message => message.type === 'odk-user-app-data')
  assert.deepEqual(JSON.parse(JSON.stringify(dataMessages().at(-1))), { type: 'odk-user-app-data', token: 'secret-token', data: { remaining_seconds: 90 } })
  packageWindow.odkPackageData.publish('not-an-object')
  assert.equal(dataMessages().length, 1, 'the bridge sends only an object')
})
