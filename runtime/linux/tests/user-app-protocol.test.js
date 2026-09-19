const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createUserAppResponse } = require('../src/user-app-protocol')

const runtimeRoot = path.join(__dirname, '..')
const installed = { getContent: async id => id === 'clock'
  ? { ok: true, app: { id, revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, html: '<p>clock</p>' }
  : { ok: false } }

test('the appearance travels on the frame URL into the served document', async () => {
  let built
  const build = (bundle, options) => { built = options; return bundle.html }
  await createUserAppResponse('odk-user-app://app/clock/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?token=nonce&theme=pixel', installed, build, '')
  assert.equal(built.theme, 'pixel')
  await createUserAppResponse('odk-user-app://app/clock/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?token=nonce', installed, build, '')
  assert.equal(built.theme, 'instrument')
  await createUserAppResponse('odk-user-app://app/clock/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?token=nonce&theme=midnight', installed, build, '')
  assert.equal(built.theme, 'instrument', 'an unknown theme must not reach a package')
  await createUserAppResponse('odk-user-app://app/clock/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?token=nonce&theme=pixel&radius=23.04px', installed, build, '')
  assert.equal(built.radius, '23.04px', 'the measured tile radius must reach the document')
  await createUserAppResponse('odk-user-app://app/clock/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?token=nonce&radius=javascript:alert(1)', installed, build, '')
  assert.equal(built.radius, 'javascript:alert(1)', 'the builder validates the radius, not the URL')
})

test('only the appearance faces are reachable through the font route', async () => {
  const served = await createUserAppResponse('odk-user-app://app/font/zpix', installed, () => '', '', { runtimeRoot })
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('Content-Type'), 'font/woff2')
  assert.equal(served.headers.get('Cache-Control'), 'no-store')
  assert.ok((await served.arrayBuffer()).byteLength > 1000)

  const noto = await createUserAppResponse('odk-user-app://app/font/noto-sans-sc', installed, () => '', '', { runtimeRoot })
  assert.equal(noto.status, 200)
  assert.equal(noto.headers.get('Content-Type'), 'font/ttf')

  for (const rejected of [
    'odk-user-app://app/font/../../etc/passwd',
    'odk-user-app://app/font/zpix.ttf',
    'odk-user-app://app/font/missing',
    'odk-user-app://font/zpix',
    `odk-user-app://app/font/${'a'.repeat(40)}`,
  ]) {
    assert.equal((await createUserAppResponse(rejected, installed, () => '', '', { runtimeRoot })).status, 404, rejected)
  }
})

test('only exact installed revisions are served with isolated policy', async () => {
  const store = { getContent: async id => id === 'clock' ? { ok: true, app: { id, revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, html: '<p>clock</p>' } : { ok: false } }
  const build = (bundle, options) => `${bundle.html}:${options.token}`
  const response = await createUserAppResponse('odk-user-app://app/clock/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?token=nonce', store, build, "default-src 'none'")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'none'")
  assert.equal(await response.text(), '<p>clock</p>:nonce')
  assert.equal((await createUserAppResponse('odk-user-app://app/clock/old', store, build, '')).status, 404)
  assert.equal((await createUserAppResponse('odk-user-app://other/clock/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', store, build, '')).status, 404)
  assert.equal((await createUserAppResponse('odk-user-app://app/clock/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/extra', store, build, '')).status, 404)
})
