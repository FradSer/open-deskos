'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { inspect } = require('node:util')
const { EventEmitter } = require('node:events')
const { execFile } = require('node:child_process')
const { createPiSessionsSource } = require('../src/pi-sessions-source')
const { createPiSessionEventsSource } = require('../src/pi-session-events-source')
const { createPluginHost } = require('../src/plugin-host')
const { createDataSourcePlugins, DATA_PORTS } = require('../src/plugins/data-sources')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('SSH cancellation waits for close after an early abort callback', async () => {
  const child = new EventEmitter()
  let active
  let callback
  const scan = createPiSessionsSource({ env: { ODK_PI_SSH_HOST: 'fixture', ODK_PI_SSH_NODE: '/node', ODK_PI_SSH_COLLECTOR: '/collector' },
    execute: (_command, _args, options, complete) => {
      active = options.signal
      callback = complete
      active?.addEventListener('abort', () => complete(Error('aborted'), '', ''), { once: true })
      return child
    } })
  const reading = scan()
  let stopped = false
  const stopping = scan.stop().then(() => { stopped = true })
  assert.equal(active?.aborted, true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(stopped, false)
  child.emit('close', null, 'SIGKILL')
  assert.equal((await reading).ok, false)
  await stopping
  callback(null, '{}', '')
  assert.equal(stopped, true)
})

test('native child cancellation closes the actual process before source stop completes', async t => {
  const ready = deferred()
  const closed = deferred()
  const parent = new AbortController()
  let child
  let callbackBeforeClose = false
  let isClosed = false
  const scan = createPiSessionsSource({ signal: parent.signal,
    env: { ODK_PI_SSH_HOST: 'fixture', ODK_PI_SSH_NODE: '/node', ODK_PI_SSH_COLLECTOR: '/collector' },
    execute: (_command, _args, options, callback) => {
      child = execFile(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'], options,
        (...args) => { callbackBeforeClose = !isClosed; callback(...args) })
      child.once('close', () => { isClosed = true; closed.resolve() })
      child.once('error', error => ready.reject(error))
      child.stdout.once('data', () => ready.resolve())
      return child
    } })
  t.after(async () => { child?.kill('SIGKILL'); if (child) await closed.promise })
  const reading = scan()
  await ready.promise
  parent.abort()
  assert.equal(child.killed, true)
  await scan.stop()
  assert.equal(callbackBeforeClose, true)
  assert.equal(isClosed, true)
  assert.equal((await reading).ok, false)
  assert.notEqual(child.signalCode, null)
})

test('Pi Events cancellation during promise settlement suppresses a successful response', async () => {
  for (const depth of [2, 3]) {
    const controller = new AbortController()
    const read = createPiSessionEventsSource({ signal: controller.signal,
      deskLink: { sessionEvents: () => ({ ok: true, events: [] }) } })
    const reading = read({ sessionId: 'fixture' })
    let pendingAtCancellation = null
    const cancel = remaining => queueMicrotask(() => {
      if (remaining > 1) return cancel(remaining - 1)
      // Inspect the native Promise boundary; fulfilled results cannot be retracted.
      pendingAtCancellation = inspect(reading).includes('<pending>')
      controller.abort()
    })
    cancel(depth)
    const result = await reading
    assert.notEqual(pendingAtCancellation, null)
    assert.equal(result.ok, !pendingAtCancellation)
    await read.stop()
  }
})

test('pre-aborted and stopped Pi sources start no additional reads', async () => {
  for (const before of [true, false]) {
    const controller = new AbortController()
    if (before) controller.abort()
    let calls = 0
    const scan = createPiSessionsSource({ signal: controller.signal, env: {}, deskLink: { machines: () => { calls++; return [] } } })
    const read = createPiSessionEventsSource({ signal: controller.signal, deskLink: { sessionEvents: () => { calls++; return { ok: true } } } })
    const pending = [scan(), read({ sessionId: 'fixture' })]
    await Promise.all([scan.stop(), read.stop()])
    assert.deepEqual((await Promise.all(pending)).map(value => value.ok), [false, false])
    const started = calls
    if (before) assert.equal(calls, 0)
    await Promise.all([scan(), read({ sessionId: 'second' })])
    assert.equal(calls, started)
    await Promise.all([scan.stop(), read.stop()])
  }
})

test('Pi Events waits for an already started local read and preserves normal rejection', async () => {
  const gate = deferred()
  const started = deferred()
  const read = createPiSessionEventsSource({ deskLink: { sessionEvents: async () => ({ ok: false, reason: 'desk-link-unavailable' }) },
    readLocal: () => { started.resolve(); return gate.promise } })
  const reading = read({ sessionId: 'fixture' })
  await started.promise
  let stopped = false
  const stopping = read.stop().then(() => { stopped = true })
  await Promise.resolve()
  assert.equal(stopped, false)
  gate.resolve({ ok: true, events: [] })
  assert.equal((await reading).ok, false)
  await stopping
  const failing = createPiSessionEventsSource({ deskLink: { sessionEvents: async () => { throw Error('fixture') } } })
  await assert.rejects(failing({ sessionId: 'fixture' }), /fixture/)
  await failing.stop()
})

test('Pi Sessions stop waits for an already started SSH callback', async () => {
  const started = deferred()
  let complete
  let calls = 0
  const scan = createPiSessionsSource({ env: { ODK_PI_SSH_HOST: 'fixture', ODK_PI_SSH_NODE: '/node', ODK_PI_SSH_COLLECTOR: '/collector' },
    execute: (_command, _args, _options, callback) => { calls++; complete = callback; started.resolve() } })
  const reading = scan()
  await started.promise
  let stopped = false
  const stopping = scan.stop().then(() => { stopped = true })
  await Promise.resolve()
  assert.equal(stopped, false)
  complete(Error('fixture'), '', '')
  assert.equal((await reading).ok, false)
  await stopping
  assert.equal((await scan()).ok, false)
  assert.equal(calls, 1)
})

test('Pi Sessions stop drains parallel requests and prevents late local fallback', async () => {
  const machines = deferred()
  const hosted = deferred()
  const started = deferred()
  let scans = 0
  const scan = createPiSessionsSource({ env: {}, scanLocal: () => { scans++; return { ok: true, sessions: [] } },
    deskLink: { machines: () => machines.promise, hostedSessions: () => { started.resolve(); return hosted.promise } } })
  const reading = scan()
  assert.equal(scan(), reading)
  await started.promise
  let stopped = false
  const stopping = scan.stop().then(() => { stopped = true })
  machines.resolve([])
  await Promise.resolve()
  assert.equal(stopped, false)
  hosted.resolve({ ok: true, sessions: [] })
  assert.equal((await reading).ok, false)
  await stopping
  assert.equal(scans, 0)
  assert.equal((await scan()).ok, false)
})

test('Pi Sessions retains a parallel request after its sibling fails', async () => {
  const hosted = deferred()
  const started = deferred()
  const scan = createPiSessionsSource({ env: {}, deskLink: { machines: async () => { throw Error('fixture') },
    hostedSessions: () => { started.resolve(); return hosted.promise } } })
  const reading = scan()
  await started.promise
  assert.equal((await reading).ok, false)
  let stopped = false
  const stopping = scan.stop().then(() => { stopped = true })
  await Promise.resolve()
  assert.equal(stopped, false)
  hosted.resolve({ ok: false, sessions: [] })
  await stopping
  assert.equal(stopped, true)
})

test('Pi Events stop drains concurrent reads without starting late local fallback', async () => {
  const gates = [deferred(), deferred()]
  const started = deferred()
  let reads = 0
  let local = 0
  const read = createPiSessionEventsSource({ deskLink: { sessionEvents() {
    const gate = gates[reads++]
    if (reads === 2) started.resolve()
    return gate.promise
  } }, readLocal: () => { local++; return { ok: true, events: [] } } })
  const first = read({ sessionId: 'first' })
  const second = read({ sessionId: 'second' })
  await started.promise
  let stopped = false
  const stopping = read.stop().then(() => { stopped = true })
  gates[0].resolve({ ok: false, reason: 'desk-link-unavailable' })
  assert.equal((await first).ok, false)
  assert.equal(stopped, false)
  gates[1].resolve({ ok: true, events: [{ type: 'assistant' }] })
  assert.equal((await second).ok, false)
  await stopping
  assert.equal(local, 0)
  assert.equal((await read({ sessionId: 'third' })).ok, false)
  assert.equal(reads, 2)
})

test('Pi source replacement waits for the old callable source to finish', async () => {
  const gate = deferred()
  const started = deferred()
  let instances = 0
  const handlers = new Map()
  const host = createPluginHost({ capabilities: {
    'source.desk-link': { create: () => ({ machines: async () => [] }) },
    'source.pi-sessions': { create: options => { instances++; return createPiSessionsSource({ ...options, env: {},
      scanLocal: () => { started.resolve(); return gate.promise } }) } },
    ipc: { handle: (id, handler) => handlers.set(id, handler), removeHandler: id => handlers.delete(id) },
  } })
  createDataSourcePlugins().filter(plugin => ['odk.source.desk-link', 'odk.source.pi-sessions'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
  await host.start()
  const stale = host.get(DATA_PORTS.piSessions)
  const reading = handlers.get('odk-pi-sessions')()
  await started.promise
  const disabling = host.setEnabled('odk.source.pi-sessions', false)
  const enabling = host.setEnabled('odk.source.pi-sessions', true)
  await Promise.resolve()
  assert.equal(instances, 1)
  gate.resolve({ ok: true, sessions: [], workspaces: [], summary: {} })
  assert.equal((await reading).ok, false)
  await disabling
  await enabling
  assert.equal(instances, 2)
  assert.notEqual(host.get(DATA_PORTS.piSessions), stale)
  assert.equal((await stale()).ok, false)
  await host.stop()
  assert.equal(handlers.size, 0)
})
