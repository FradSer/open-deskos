'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createUserAppVerifier, MAX_OUTPUT_BYTES } = require('../src/user-app-verifier')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

for (const platform of ['darwin', 'linux', 'win32']) {
  test(`verifier launch policy delays only macOS best-effort work: ${platform}`, async () => {
    const isolated = { exports: {} }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/user-app-verifier.js'), 'utf8'), {
      module: isolated, require, __dirname: path.join(__dirname, '../src'),
      process: { ...process, platform }, Buffer, setTimeout, clearTimeout,
    })
    let argumentsSeen
    const verifier = isolated.exports.createUserAppVerifier({ spawnProcess(_file, args) {
      argumentsSeen = args
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      queueMicrotask(() => {
        fs.writeFileSync(args[3], '{"ok":true}')
        child.emit('close', 0, null)
      })
      return child
    } })
    assert.equal((await verifier.verify({ html: '<body>Fixture</body>' })).ok, true)
    await verifier.close()
    assert.equal(argumentsSeen.filter(value => value === '--disable-best-effort-tasks').length, platform === 'darwin' ? 1 : 0)
    assert.equal(argumentsSeen.some(value => value === '--no-sandbox' || value === '--single-process'), false)
    assert.equal(argumentsSeen.length, platform === 'darwin' ? 6 : 5)
  })
}

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
