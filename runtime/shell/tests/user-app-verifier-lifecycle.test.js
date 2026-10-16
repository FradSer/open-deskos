'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createUserAppVerifier, MAX_OUTPUT_BYTES } = require('../src/user-app-verifier')

for (const mode of ['timeout', 'abort', 'output-limit', 'abort-during-spawn']) {
  test(`verifier release retains the child after ${mode} until actual close`, async () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const controller = new AbortController()
    const verifier = createUserAppVerifier({ timeoutMs: 5, spawnProcess() {
      if (mode === 'abort-during-spawn') controller.abort()
      return child
    } })
    const verifying = verifier.verify({ html: '<body>Fixture</body>' }, { signal: controller.signal })
    if (mode === 'abort') controller.abort()
    if (mode === 'output-limit') child.stdout.emit('data', Buffer.alloc(MAX_OUTPUT_BYTES + 1))
    const result = await verifying
    assert.equal(result.error, mode === 'timeout' ? 'verification-timeout'
      : mode === 'output-limit' ? 'verifier-output-too-large' : 'verification-aborted')
    assert.equal(typeof verifier.close, 'function', 'verifier must expose actual child release')
    let released = false
    const closing = verifier.close().then(() => { released = true })
    const concurrent = verifier.close()
    await new Promise(setImmediate)
    const releasedBeforeClose = released
    child.emit('close', null, 'SIGKILL')
    await Promise.all([closing, concurrent])
    assert.equal(releasedBeforeClose, false)
    assert.deepEqual(await verifier.verify({ html: '<body>Late</body>' }), { ok: false, error: 'verification-aborted' })
  })
}

test('verifier release without a spawned child settles and remains closed', async () => {
  const verifier = createUserAppVerifier({ spawnProcess() { throw Error('Controlled spawn failure') } })
  assert.equal((await verifier.verify({ html: '<body>Fixture</body>' })).error, 'Controlled spawn failure')
  assert.equal(typeof verifier.close, 'function')
  await verifier.close()
  await verifier.close()
  assert.deepEqual(await verifier.verify({ html: '<body>Late</body>' }), { ok: false, error: 'verification-aborted' })
})
