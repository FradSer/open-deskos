'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, rm, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { connect } = require('node:net')
const { once } = require('node:events')
const { createDeskDataRegistry, MAX_READING_BYTES } = require('../src/desk-data-registry')
const { createDeskDataControl, listenDeskData } = require('../src/desk-data-control')
const { posixOnlyReason } = require('./not-ported')

const HYDRA = 'odk.tile.hydra'

test('the tile and the spoken answer read one registered source', async () => {
  let soil = 30
  let reads = 0
  const registry = createDeskDataRegistry()
  registry.register({
    id: HYDRA,
    label: 'Hydra plants',
    kind: 'tile',
    read: async () => { reads += 1; return { state: 'live', value: { nodes: [{ id: 1, soilPercent: soil }] } } },
  })
  const control = createDeskDataControl(registry)

  const listed = await control.dispatch({ command: 'list' })
  assert.deepEqual(listed.readings, [{ id: HYDRA, label: 'Hydra plants', kind: 'tile' }])
  assert.equal(reads, 0, 'listing must not read a source')

  const first = await control.dispatch({ command: 'read', readingId: HYDRA })
  assert.equal(first.ok, true)
  assert.equal(first.reading.state, 'live')
  assert.equal(first.reading.value.nodes[0].soilPercent, 30)

  soil = 42
  const second = await control.dispatch({ command: 'read', readingId: HYDRA })
  assert.equal(second.reading.value.nodes[0].soilPercent, 42, 'a second read must not serve a cached value')
  assert.equal(reads, 2)
})

test('an instrument state reaches the reader as itself and never as a value', async () => {
  const registry = createDeskDataRegistry()
  registry.register({
    id: 'odk.tile.weather',
    label: 'Weather',
    kind: 'tile',
    read: async () => ({ state: 'unconfigured', value: null }),
  })
  const control = createDeskDataControl(registry)
  const { ok, reading } = await control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })
  assert.equal(ok, true)
  assert.equal(reading.state, 'unconfigured')
  assert.equal(reading.value, null)
})

test('the registry adds no refresh policy of its own to a source that owns one', async () => {
  let requests = 0
  const registry = createDeskDataRegistry()
  registry.register({
    id: 'odk.tile.weather',
    label: 'Weather',
    kind: 'tile',
    read: async () => { requests += 1; return { state: 'stale', value: { current: { temperature: 19 } } } },
  })
  const control = createDeskDataControl(registry)
  await control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })
  await control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })
  assert.equal(requests, 2, 'the source keeps its own policy; the registry adds no refresh of its own')
})

test('a Service Plugin reading is answerable by its service id', async () => {
  const registry = createDeskDataRegistry()
  registry.register({
    id: 'futu-poller',
    label: 'Futu holdings',
    kind: 'service',
    read: async () => ({ state: 'live', value: { positions: [{ symbol: 'AAPL', quantity: 10 }] } }),
  })
  const control = createDeskDataControl(registry)
  const { readings } = await control.dispatch({ command: 'list' })
  assert.ok(readings.some(reading => reading.id === 'futu-poller' && reading.kind === 'service'))
  const { reading } = await control.dispatch({ command: 'read', readingId: 'futu-poller' })
  assert.equal(reading.value.positions[0].symbol, 'AAPL')
})

test('a disconnected Service Plugin is unavailable rather than empty', async () => {
  const registry = createDeskDataRegistry()
  registry.register({
    id: 'futu-poller',
    label: 'Futu holdings',
    kind: 'service',
    read: async () => ({ state: 'unavailable', value: null }),
  })
  const { reading } = await createDeskDataControl(registry).dispatch({ command: 'read', readingId: 'futu-poller' })
  assert.equal(reading.state, 'unavailable')
  assert.equal(reading.value, null)
})

test('an unknown reading is refused rather than answered empty', async () => {
  const registry = createDeskDataRegistry()
  const control = createDeskDataControl(registry)
  assert.deepEqual(await control.dispatch({ command: 'read', readingId: 'odk.tile.nothing' }), { ok: false, error: 'unknown-reading' })
  assert.deepEqual(await control.dispatch({ command: 'read' }), { ok: false, error: 'invalid-reading-id' })
  assert.deepEqual(await control.dispatch({ command: 'read', readingId: '../escape' }), { ok: false, error: 'invalid-reading-id' })
})

test('the link reads and changes nothing', async () => {
  let changed = 0
  const registry = createDeskDataRegistry()
  registry.register({
    id: HYDRA,
    label: 'Hydra plants',
    kind: 'tile',
    read: async () => { changed += 1; return { state: 'live', value: { soil: 30 } } },
  })
  const control = createDeskDataControl(registry)
  for (const command of ['install', 'remove', 'place', 'publish', 'set']) {
    assert.deepEqual(await control.dispatch({ command, readingId: HYDRA }), { ok: false, error: 'invalid-command' })
  }
  assert.equal(changed, 0)
})

test('an oversized reading is refused rather than truncated', async () => {
  const registry = createDeskDataRegistry()
  registry.register({
    id: HYDRA,
    label: 'Hydra plants',
    kind: 'tile',
    read: async () => ({ state: 'live', value: { notes: 'x'.repeat(MAX_READING_BYTES + 1024) } }),
  })
  const result = await createDeskDataControl(registry).dispatch({ command: 'read', readingId: HYDRA })
  assert.deepEqual(result, { ok: false, error: 'reading-too-large' })
})

test('the link answers over the channel and refuses what it cannot bound', { skip: posixOnlyReason('unix-socket') }, async t => {
  const registry = createDeskDataRegistry()
  registry.register({
    id: HYDRA,
    label: 'Hydra plants',
    kind: 'tile',
    read: async () => ({ state: 'live', value: { soil: 30 } }),
  })
  const dir = await mkdtemp(join(tmpdir(), 'odk-desk-data-'))
  const endpoint = join(dir, 'desk-data.sock')
  const server = await listenDeskData({ endpoint, control: createDeskDataControl(registry) })
  t.after(async () => { await server.close(); await rm(dir, { recursive: true, force: true }) })
  assert.equal((await stat(endpoint)).mode & 0o777, 0o600)

  const request = async (payload) => {
    const socket = connect(endpoint)
    t.after(() => socket.destroy())
    await once(socket, 'connect')
    const response = once(socket, 'data')
    socket.write(`${JSON.stringify(payload)}\n`)
    return JSON.parse((await response)[0])
  }

  assert.deepEqual(await request({ v: 1, id: 'req-1', command: 'list' }), {
    v: 1,
    id: 'req-1',
    ok: true,
    readings: [{ id: HYDRA, label: 'Hydra plants', kind: 'tile' }],
  })
  const read = await request({ v: 1, id: 'req-2', command: 'read', readingId: HYDRA })
  assert.equal(read.ok, true)
  assert.equal(read.reading.state, 'live')
  assert.equal(read.reading.value.soil, 30)
  assert.deepEqual(await request({ v: 1, id: 'req-3', command: 'read', readingId: 'missing' }), {
    v: 1, id: 'req-3', ok: false, error: 'unknown-reading',
  })
  for (const [index, command] of ['install', 'remove', 'place', 'publish', 'set'].entries()) {
    assert.deepEqual(await request({ v: 1, id: `req-mutate-${index}`, command, readingId: HYDRA }), {
      v: 1, id: `req-mutate-${index}`, ok: false, error: 'invalid-command',
    }, `${command} is not something this link can be asked to do`)
  }
  const after = (await request({ v: 1, id: 'req-4', command: 'read', readingId: HYDRA })).reading
  assert.equal(after.state, 'live', 'a refused command leaves every reading as it stood')
})

test('a package publishes only what it declared, and its value is untrusted data', async () => {
  const registry = createDeskDataRegistry()
  registry.register({ id: 'pomodoro', label: 'Pomodoro', kind: 'package', declaration: { fields: { remaining_seconds: { type: 'number' } } } })
  const control = createDeskDataControl(registry)

  const before = await control.dispatch({ command: 'read', readingId: 'pomodoro' })
  assert.equal(before.reading.state, 'unconfigured')
  assert.equal(before.reading.value, null)

  assert.deepEqual(registry.publish('pomodoro', { remaining_seconds: 90 }), { ok: true })
  const reading = (await control.dispatch({ command: 'read', readingId: 'pomodoro' })).reading
  assert.equal(reading.state, 'live')
  assert.deepEqual(reading.value, { remaining_seconds: 90 })
  assert.equal(reading.untrusted, true, 'a published value is content to read, never an instruction')

  assert.deepEqual(registry.publish('pomodoro', { remaining_seconds: 90, secret: 'x' }), { ok: false, error: 'undeclared-data' })
  assert.deepEqual(registry.publish('pomodoro', { remaining_seconds: 'soon' }), { ok: false, error: 'invalid-published-data' })
  const refused = (await control.dispatch({ command: 'read', readingId: 'pomodoro' })).reading
  assert.deepEqual(refused.value, { remaining_seconds: 90 }, 'a refused publish must not disturb the reading that stands')
})

test('a package that declares nothing publishes nothing', async () => {
  const registry = createDeskDataRegistry()
  registry.register({ id: 'notes', label: 'Notes', kind: 'package' })
  assert.deepEqual(registry.publish('notes', { remaining_seconds: 90 }), { ok: false, error: 'publish-not-declared' })
  assert.deepEqual((await createDeskDataControl(registry).dispatch({ command: 'read', readingId: 'notes' })).reading, {
    id: 'notes', label: 'Notes', kind: 'package', state: 'unconfigured', value: null,
  })
})

test('a replaced package revision cannot answer with the previous value', async () => {
  const registry = createDeskDataRegistry()
  const declaration = { fields: { remaining_seconds: { type: 'number' } } }
  registry.register({ id: 'pomodoro', label: 'Pomodoro', kind: 'package', declaration })
  registry.publish('pomodoro', { remaining_seconds: 90 })

  registry.register({ id: 'pomodoro', label: 'Pomodoro', kind: 'package', declaration: { fields: { elapsed_minutes: { type: 'number' } } } })
  const reading = (await createDeskDataControl(registry).dispatch({ command: 'read', readingId: 'pomodoro' })).reading
  assert.equal(reading.state, 'unconfigured')
  assert.equal(reading.value, null)

  registry.unregister('pomodoro')
  assert.deepEqual(await createDeskDataControl(registry).dispatch({ command: 'read', readingId: 'pomodoro' }), { ok: false, error: 'unknown-reading' })
})
