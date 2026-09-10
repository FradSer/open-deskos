const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createUserAppResponse } = require('../src/user-app-protocol')

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
