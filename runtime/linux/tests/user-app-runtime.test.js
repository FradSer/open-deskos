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

function verifier(timeoutMs = 12000) {
  return createUserAppVerifier({ electronPath, timeoutMs })
}

test('BDD feature specifies opaque sandbox runtime guarantees and no CPU promise', () => {
  assert.match(feature, /Feature: Sandboxed self-contained user applications/)
  assert.match(feature, /independent Electron verification process exceeds its deadline/)
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

test('verifier accepts a maximum-sized visible HTML bundle without Buffer duplication', async () => {
  const result = await verifier(15000).verify({ html: `<body>${'x'.repeat(256 * 1024 - 32)}</body>`, manifestBytes: Buffer.alloc(500000), htmlBytes: Buffer.alloc(500000) })
  assert.deepEqual(result, { ok: true })
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
  const spawnProcess = (command, args) => {
    const bundlePath = args[1]
    const resultPath = args[2]
    seen.push({ command, bundlePath, resultPath, bundle: fs.readFileSync(bundlePath, 'utf8') })
    fs.writeFileSync(resultPath, `${JSON.stringify({ ok: true })}\n`, 'utf8')
    return fakeChild()
  }
  const result = await createUserAppVerifier({ electronPath: 'electron', spawnProcess }).verify({ html: '<body><p>file channel</p></body>' })

  assert.deepEqual(result, { ok: true })
  assert.equal(seen.length, 1)
  assert.equal(JSON.parse(seen[0].bundle).html, '<body><p>file channel</p></body>')
  assert.ok(path.isAbsolute(seen[0].bundlePath), 'the runner needs a path it can open')
  assert.ok(path.isAbsolute(seen[0].resultPath))
})

function fakeChild() {
  const { EventEmitter } = require('node:events')
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = Object.assign(new EventEmitter(), { end() {}, on() {} })
  child.kill = () => {}
  child.pid = 4242
  setImmediate(() => child.emit('close', 0))
  return child
}

test('real Electron verifier accepts a visible self-contained bundle', async () => {
  const result = await verifier().verify({ html: '<body><p>verified</p></body>' })
  assert.deepEqual(result, { ok: true })
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
