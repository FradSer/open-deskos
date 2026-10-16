'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createPluginHost } = require('../src/plugin-host')
const id = 'odk.test.state'
const port = 'odk:test/state/v1'
const schema = 'odk:test/state-snapshot/v1'
const manifest = { schemaVersion: 1, id, name: 'State handoff fixture', version: '1.0.0', kind: 'service', host: 'electron-main',
  provides: [{ interface: port }], requires: [], permissions: [] }

function definition({ version = '1.0.0', hooks = {}, cleanup, start, created = () => {} } = {}) {
  return { manifest: { ...manifest, version }, create(ctx) {
    created()
    let value = 0
    const data = { read: () => value, write: next => { value = next } }
    if (cleanup) ctx.onCleanup(cleanup)
    return { ports: { [port]: data },
      handoff: { schema, capture: () => ({ value }), restore: state => { value = state.value }, ...hooks },
      start: () => start?.(data), stop() { value = 0 },
    }
  } }
}
async function fixture(t, original = definition()) {
  const host = createPluginHost()
  host.register(original)
  t.after(() => host.stop())
  await host.start()
  host.get(port).write(42)
  return host
}

test('state reaches candidate before startup and later replacement captures its newest state', async t => {
  const host = await fixture(t)
  await host.replace(definition({ version: '2.0.0', start: data => assert.equal(data.read(), 42) }))
  assert.equal(host.get(port).read(), 42)
  host.get(port).write(73)
  const starts = []
  await host.replace(definition({ version: '3.0.0', start: data => starts.push(data.read()) }))
  assert.deepEqual(starts, [73])
  assert.equal(host.get(port).read(), 73)
  await host.setEnabled(id, false)
  await host.setEnabled(id, true)
  assert.equal(host.get(port).read(), 0)
  assert.deepEqual(starts, [73, 0])
})

for (const invalid of ['missing', 'schema', 'async-restore', 'mutating-restore']) {
  test(`candidate ${invalid} failure restores detached previous state`, async t => {
    const host = await fixture(t)
    let candidate = definition({ version: '2.0.0' })
    if (invalid === 'schema') candidate = definition({ hooks: { schema: 'odk:test/other/v1' } })
    if (invalid === 'async-restore') candidate = definition({ hooks: { restore: () => Promise.reject(Error('controlled async restore')) } })
    if (invalid === 'mutating-restore') candidate = definition({ hooks: { restore(state) { state.value = 999; throw Error('controlled restoration failure') } } })
    if (invalid === 'missing') {
      const create = candidate.create
      candidate.create = ctx => { const instance = create(ctx); delete instance.handoff; return instance }
    }
    await assert.rejects(host.replace(candidate), /previous factory restored/)
    assert.equal(host.definition(id).manifest.version, '1.0.0')
    assert.equal(host.get(port).read(), 42)
  })
}

test('async capture refuses replacement before releasing or aborting the running instance', async t => {
  let signal
  const original = definition({ hooks: { capture: () => Promise.reject(Error('controlled async capture')) } })
  const create = original.create
  original.create = ctx => { signal = ctx.signal; return create(ctx) }
  const host = await fixture(t, original)
  await assert.rejects(host.replace(definition()), /must be synchronous/)
  assert.equal(signal.aborted, false)
  assert.equal(host.get(port).read(), 42)
})

test('failed old release retains captured state even when stop already cleared its live state', async t => {
  let fail = true
  const host = await fixture(t, definition({ cleanup: () => { if (fail) throw Error('controlled cleanup failure') } }))
  await assert.rejects(host.replace(definition({ version: '2.0.0' })), /retains resources/)
  assert.equal(host.get(port), null)
  fail = false
  await host.replace(definition({ version: '2.0.0' }))
  assert.equal(host.get(port).read(), 42)
})

test('candidate cleanup failure retains recovery state until explicit replacement retry', async t => {
  const original = definition()
  const host = await fixture(t, original)
  let fail = true
  await assert.rejects(host.replace(definition({ version: '2.0.0', start: () => { throw Error('controlled startup failure') },
    cleanup: () => { if (fail) throw Error('controlled candidate cleanup failure') } })), /retains resources/)
  assert.equal(host.get(port), null)
  fail = false
  await host.replace(original)
  assert.equal(host.get(port).read(), 42)
})

test('cancellation after old release restores its state without constructing the candidate', async t => {
  const request = new AbortController()
  const host = await fixture(t, definition({ cleanup: () => request.abort() }))
  let constructions = 0
  await assert.rejects(host.replace(definition({ version: '2.0.0', created: () => constructions++ }), { signal: request.signal }), /cancelled before candidate startup/)
  assert.equal(constructions, 0)
  assert.equal(host.get(port).read(), 42)
})

test('failed capture of another affected instance cannot retain a stale provider snapshot', async t => {
  const host = createPluginHost()
  const provider = definition()
  host.register(provider)
  let fail = true
  host.register({ manifest: { ...manifest, id: 'odk.test.consumer', provides: [], requires: [{ interface: port }] }, create() {
    return { handoff: { schema, capture() { if (fail) throw Error('controlled capture failure'); return {} }, restore() {} } }
  } })
  t.after(() => host.stop())
  await host.start()
  host.get(port).write(42)
  await assert.rejects(host.replace(definition({ version: '2.0.0' })), /controlled capture failure/)
  host.get(port).write(73)
  fail = false
  await host.replace(definition({ version: '2.0.0' }))
  assert.equal(host.get(port).read(), 73)
})

test('stateful consumer retains state across legacy provider replacement and recovery but not Host restart', async t => {
  const host = createPluginHost()
  const view = 'odk:test/state-view/v1'
  const legacy = options => {
    const selected = definition(options)
    const create = selected.create
    selected.create = ctx => {
      const instance = create(ctx)
      delete instance.handoff
      return instance
    }
    return selected
  }
  host.register(legacy())
  host.register({ manifest: { ...manifest, id: 'odk.test.consumer', provides: [{ interface: view }], requires: [{ interface: port }] }, create(ctx) {
    let value = 0
    const provider = ctx.get(port)
    return { ports: { [view]: { read: () => value, write: next => { value = next }, provider } },
      handoff: { schema, capture: () => ({ value }), restore: state => { value = state.value } },
      stop() { assert.equal(ctx.get(port), provider); value = 0 },
    }
  } })
  t.after(() => host.stop())
  await host.start()
  host.get(view).write(42)
  const previous = host.get(port)
  await host.replace(legacy({ version: '2.0.0' }))
  assert.notEqual(host.get(port), previous)
  assert.equal(host.get(view).provider, host.get(port))
  assert.equal(host.get(view).read(), 42)
  host.get(view).write(73)
  await assert.rejects(host.replace(legacy({ version: '3.0.0', start() { throw Error('controlled legacy startup failure') } })), /previous factory restored/)
  assert.equal(host.definition(id).manifest.version, '2.0.0')
  assert.equal(host.get(view).provider, host.get(port))
  assert.equal(host.get(view).read(), 73)
  await host.stop()
  await host.start()
  assert.equal(host.get(view).read(), 0)
  assert.equal(host.get(view).provider, host.get(port))
})

for (const phase of ['capture', 'restore']) {
  test(`unsupported pending ${phase} remains owned until its promise settles`, async t => {
    let finish
    let entered
    const began = new Promise(resolve => { entered = resolve })
    const pending = new Promise(resolve => { finish = resolve })
    let cleaned = 0
    const invalid = definition({ hooks: { [phase]() { entered(); return pending } }, cleanup: () => cleaned++ })
    const host = await fixture(t, phase === 'capture' ? invalid : definition())
    let settled = false
    const operation = host.replace(phase === 'restore' ? invalid : definition())
    const refusal = assert.rejects(operation, phase === 'capture' ? /must be synchronous/ : /previous factory restored/)
    operation.then(() => { settled = true }, () => { settled = true })
    await began
    await new Promise(resolve => setImmediate(resolve))
    try {
      assert.equal(settled, false)
      assert.equal(cleaned, 0)
    } finally { finish(); await refusal }
    assert.equal(host.get(port).read(), 42)
  })
}
