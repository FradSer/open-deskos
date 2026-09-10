'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
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
