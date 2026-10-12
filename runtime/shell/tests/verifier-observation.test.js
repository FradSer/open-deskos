'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')

test('verifier observation preserves spawn identity and excludes private fields', async t => {
  const { createVerifierObserver } = require('./helpers/verifier-observation')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-verifier-observer-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  let onFile, watcherClosed = 0
  const args = ['profile', 'runner', 'private-bundle', path.join(directory, 'result.json')]
  const options = { env: { PRIVATE_FIXTURE_VALUE: 'not-for-diagnostics' } }
  const observer = createVerifierObserver({
    watch(folder, callback) { assert.equal(folder, directory); onFile = callback; return { on() {}, close() { watcherClosed++ } } },
    spawnProcess(executable, actualArgs, actualOptions) {
      assert.equal(executable, 'fixture-electron')
      assert.equal(actualArgs, args)
      assert.equal(actualOptions, options)
      return child
    },
  })
  assert.equal(observer.spawnProcess('fixture-electron', args, options), child)
  child.emit('spawn')
  fs.writeFileSync(args[3], JSON.stringify({ ok: true, error: 'private-result-content' }))
  onFile('change', 'result.json')
  child.stdout.emit('data', Buffer.from('{"ok":true,"detail":"private-stdout"}\n'))
  observer.recordVerdict({ ok: false, error: 'verification-timeout', detail: 'private-verdict' })
  let settled = false
  const closing = observer.close().then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  child.emit('exit', null, 'SIGKILL')
  child.emit('close', null, 'SIGKILL')
  await closing
  const snapshot = observer.snapshot()
  assert.deepEqual(snapshot[0].events.map(event => event.event), ['requested', 'spawned', 'file-result', 'stdout-result', 'verdict', 'exit', 'close'])
  assert.deepEqual(snapshot[0].events.find(event => event.event === 'verdict').outcome, 'timeout')
  assert.equal(snapshot[0].events.find(event => event.event === 'file-result').ok, true)
  assert.equal(snapshot[0].closed, true)
  assert.equal(watcherClosed, 1)
  assert.doesNotMatch(JSON.stringify(snapshot), /private|fixture-electron|result\.json|not-for-diagnostics/)
})

test('verifier observation failure never replaces the spawn error or leaks a watcher', async () => {
  const { createVerifierObserver } = require('./helpers/verifier-observation')
  const failure = Error('Controlled spawn failure')
  let closed = 0
  const observer = createVerifierObserver({
    watch() { return { on() {}, close() { closed++ } } },
    spawnProcess() { throw failure },
  })
  assert.throws(() => observer.spawnProcess('electron', ['profile', 'runner', 'bundle', '/fixture/result.json'], {}), error => error === failure)
  await observer.close()
  assert.equal(closed, 1)
  assert.equal(observer.snapshot()[0].events.at(-1).event, 'spawn-failed')
})

test('reported success remains a production timeout until the actual verifier child closes', async () => {
  const { createVerifierObserver } = require('./helpers/verifier-observation')
  const { createUserAppVerifier } = require('../src/user-app-verifier')
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  let onFile
  const observer = createVerifierObserver({
    watch(_folder, callback) { onFile = callback; return { on() {}, close() {} } },
    spawnProcess(_executable, args) {
      queueMicrotask(() => {
        child.emit('spawn')
        fs.writeFileSync(args[3], JSON.stringify({ ok: true }))
        onFile('change', 'result.json')
        child.stdout.emit('data', Buffer.from('{"ok":true}\n'))
      })
      return child
    },
  })
  const verifier = createUserAppVerifier({ spawnProcess: observer.spawnProcess, timeoutMs: 50 })
  const result = await verifier.verify({ html: '<p>Controlled fixture</p>' })
  observer.recordVerdict(result)
  assert.deepEqual(result, { ok: false, error: 'verification-timeout' })
  const record = observer.snapshot()[0]
  assert.equal(record.events.find(event => event.event === 'file-result').ok, true)
  assert.equal(record.events.find(event => event.event === 'stdout-result').ok, true)
  assert.equal(record.events.at(-1).outcome, 'timeout')
  assert.equal(record.closed, false)
  child.emit('exit', null, 'SIGKILL')
  child.emit('close', null, 'SIGKILL')
  await observer.close()
  assert.equal(observer.snapshot()[0].closed, true)
})

test('an unavailable result watcher preserves child execution and closure', async () => {
  const { createVerifierObserver } = require('./helpers/verifier-observation')
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  const observer = createVerifierObserver({
    watch() { throw Error('Controlled watcher failure') },
    spawnProcess() { return child },
  })
  assert.equal(observer.spawnProcess('electron', ['profile', 'runner', 'bundle', '/fixture/result.json'], {}), child)
  child.emit('spawn')
  child.stdout.emit('data', Buffer.from('{"ok":true}\n'))
  child.emit('exit', 0, null)
  child.emit('close', 0, null)
  observer.recordVerdict({ ok: true })
  await observer.close()
  const record = observer.snapshot()[0]
  assert.equal(record.closed, true)
  assert.equal(record.events.some(event => event.event === 'observer-unavailable'), true)
  assert.equal(record.events.find(event => event.event === 'stdout-result').ok, true)
  assert.equal(record.events.at(-1).outcome, 'accepted')
})
