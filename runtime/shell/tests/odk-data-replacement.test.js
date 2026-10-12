'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { selection, runtime, ID } = require('./helpers/odk-data-replacement')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { createOdkDataLinkReplacement } = require('./fixtures/odk-data-link-replacement')

// Load the Bot SDK once before timed Link scenarios; transport deadlines remain unchanged.
let odkDataRequest
test.before(async () => {
  ;({ odkDataRequest } = await import('../../../integrations/personal-bot/src/odk-data.mjs'))
}, { timeout: 30000 })

for (const alternative of [false, true]) {
  test(`${alternative ? 'selected alternative' : 'default'} Open DeskOS Data Link preserves actual Bot reads and release`, {
    timeout: 10000,
  }, async t => {
    const selected = alternative ? createOdkDataLinkReplacement() : null
    const f = await runtime(t, selected ? [selected.plugin] : [], { link: true })
    const options = { env: f.clientEnv }
    assert.equal(f.defaultLinkStarts(), alternative ? 0 : 1)
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === 'odk.transport.data').manifest.version,
      alternative ? '2.0.0' : '1.0.0')
    await f.request({ command: 'list' })
    assert.equal((await odkDataRequest('list', options)).readings.some(reading => reading.id === 'timer'), true)
    assert.equal((await odkDataRequest('read', { ...options, id: 'odk.tile.weather' })).reading.value.temperatureC, 21)
    const registry = f.data().registry
    registry.publish('timer', { remaining_seconds: 42 })
    const published = await odkDataRequest('read', { ...options, id: 'timer' })
    assert.equal(published.reading.untrusted, true)
    assert.equal(published.reading.value.remaining_seconds, 42)
    assert.equal((await f.request({ command: 'publish', readingId: 'timer' })).error, 'invalid-command')
    registry.publish('timer', { remaining_seconds: 7 })
    assert.equal((await odkDataRequest('read', { ...options, id: 'timer' })).reading.value.remaining_seconds, 7)
    await f.host.setEnabled('odk.transport.data', false)
    await f.assertLinkClosed()
    await assert.rejects(odkDataRequest('list', options), /ENOENT|unavailable/i)
    assert.equal(f.data().registry, registry)
    await f.host.setEnabled('odk.transport.data', true)
    await f.request({ command: 'list' })
    assert.equal((await odkDataRequest('read', { ...options, id: 'timer' })).reading.value.remaining_seconds, 7)
    await f.host.stop()
    await f.assertLinkClosed()
    if (selected) {
      assert.equal(selected.counts.starts, 2)
      assert.equal(selected.counts.closes, 2)
      assert.equal(selected.counts.requests, 8)
      assert.equal(f.defaultLinkStarts(), 0)
    }
  })
}

for (const signed of [false, true]) {
  const label = signed ? 'signed bundled Open DeskOS Data' : 'default Open DeskOS Data'
  test(`${label} preserves reading ownership, package publications and revisions`, async t => {
    const selected = signed ? await selection(t) : null
    const plugins = selected ? await selected.load() : []
    if (selected) {
      await fs.writeFile(selected.stored.entry, 'throw Error("mutated factory")')
      await fs.writeFile(path.join(selected.stored.root, 'odk-data-registry.js'), 'throw Error("mutated registry")')
    }
    const f = await runtime(t, plugins)
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === ID).manifest.version, signed ? '2.0.0' : '1.0.0')
    assert.equal(f.creates(), signed ? 0 : 1)
    const initial = f.data()
    const registry = initial.registry
    assert.deepEqual(registry.list().map(entry => entry.id).sort(), ['extra.service', 'extra.source', 'futu-poller', 'odk.plugins.installed', 'odk.tile.weather', 'timer'])
    const weatherReading = (await initial.control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })).reading
    assert.equal(weatherReading.id, 'odk.tile.weather')
    assert.equal(weatherReading.label, 'Weather')
    assert.equal(weatherReading.kind, 'tile')
    assert.equal(weatherReading.updatedAt, 1700000000000)
    assert.equal(weatherReading.value.temperatureC, 21)
    assert.equal(weatherReading.value.asOf, '2023-11-14T22:13:20.000Z')
    for (const state of ['stale', 'unavailable', 'unconfigured', 'live']) {
      f.weatherState(state)
      const reading = (await initial.control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })).reading
      assert.equal(reading.state, state)
      assert.equal(reading.updatedAt, 1700000000000)
      if (state === 'live' || state === 'stale') assert.equal(reading.value.temperatureC, 21)
      else assert.equal(reading.value, null)
    }
    assert.equal((await initial.control.dispatch({ command: 'read', readingId: 'futu-poller' })).reading.value.todayChangePercent, 1.23)
    assert.deepEqual((await initial.control.dispatch({ command: 'read', readingId: 'extra.source' })).reading,
      { id: 'extra.source', label: 'Extra source', kind: 'tile', state: 'live', value: { count: 3 } })
    assert.equal((await initial.control.dispatch({ command: 'read', readingId: 'extra.service' })).reading.state, 'unavailable')
    assert.deepEqual(registry.publish('timer', { remaining_seconds: 42 }), { ok: true })
    assert.deepEqual(f.updates, ['timer'])
    const published = await registry.read('timer')
    assert.equal(published.reading.untrusted, true)
    assert.equal(published.reading.value.remaining_seconds, 42)
    assert.deepEqual(registry.publish('timer', { private_field: 1 }), { ok: false, error: 'undeclared-data' })
    assert.deepEqual(await registry.read('timer'), published)
    await f.host.setEnabled('odk.test.extra', false)
    assert.equal(f.data().registry, registry)
    assert.deepEqual(await registry.read('extra.source'), { ok: false, error: 'unknown-reading' })
    assert.deepEqual(await registry.read('extra.service'), { ok: false, error: 'unknown-reading' })
    assert.deepEqual(await registry.read('timer'), published)
    await f.host.setEnabled('odk.test.extra', true)
    assert.equal((await registry.read('extra.source')).reading.value.count, 3)
    assert.equal((await registry.read('extra.service')).reading.value, null)
    await f.host.setEnabled('odk.source.weather', false)
    assert.equal(f.data().registry, registry)
    assert.deepEqual(await f.data().control.dispatch({ command: 'read', readingId: 'odk.tile.weather' }), { ok: false, error: 'unknown-reading' })
    assert.deepEqual(await registry.read('timer'), published)
    await f.host.setEnabled('odk.source.weather', true)
    assert.equal((await f.data().control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })).reading.value.temperatureC, 22)
    assert.deepEqual(await registry.read('timer'), published)
    f.catalogUnavailable(true)
    await f.data().syncPackages()
    assert.deepEqual(await registry.read('timer'), published)
    f.catalogUnavailable(false)
    await f.host.setEnabled(ID, false)
    assert.equal(f.host.get(DESK_PORTS.data), null)
    f.revision('r2')
    await f.host.setEnabled(ID, true)
    assert.equal(f.data().registry, registry)
    assert.equal((await registry.read('timer')).reading.state, 'unconfigured')
    assert.deepEqual(registry.publish('timer', { remaining_seconds: 10 }), { ok: true })
    f.catalog([])
    await f.data().syncPackages()
    assert.deepEqual(await registry.read('timer'), { ok: false, error: 'unknown-reading' })
    assert.deepEqual(await f.data().control.dispatch({ command: 'publish', readingId: 'timer' }), { ok: false, error: 'invalid-command' })
    await f.host.stop()
    assert.equal(f.handlers.size, 0)
  })

  test(`${label} cannot restore readings from catalog work completed after cancellation`, async t => {
    const selected = signed ? await selection(t) : null
    const f = await runtime(t, selected ? await selected.load() : [])
    const registry = f.data().registry
    const gate = f.holdCatalog()
    const syncing = f.data().syncPackages()
    await gate.entered
    await f.host.setEnabled(ID, false)
    f.catalog([])
    await f.host.setEnabled(ID, true)
    gate.release()
    await syncing
    assert.equal(f.data().registry, registry)
    assert.deepEqual(await registry.read('timer'), { ok: false, error: 'unknown-reading' })
  })

  test(`${label} supplies the actual read-only Open DeskOS Data Link`, { timeout: 10000 }, async t => {
    const selected = signed ? await selection(t) : null
    const f = await runtime(t, selected ? await selected.load() : [], { link: true })
    const result = await f.request({ command: 'read', readingId: 'odk.tile.weather' })
    assert.equal(result.ok, true)
    assert.equal(result.reading.value.temperatureC, 21)
    assert.equal((await f.request({ command: 'list' })).readings.some(entry => entry.id === 'timer'), true)
    assert.equal((await f.request({ command: 'publish', readingId: 'timer' })).error, 'invalid-command')
    const options = { env: f.clientEnv }
    const consumer = await odkDataRequest('read', { ...options, id: 'odk.tile.weather' })
    assert.equal(consumer.reading.value.temperatureC, 21)
    assert.equal((await odkDataRequest('list', options)).readings.some(entry => entry.id === 'timer'), true)
    f.data().registry.publish('timer', { remaining_seconds: 42 })
    const packageReading = await odkDataRequest('read', { ...options, id: 'timer' })
    assert.equal(packageReading.reading.untrusted, true)
    assert.equal(packageReading.reading.value.remaining_seconds, 42)
    await f.host.setEnabled(ID, false)
    await f.assertLinkClosed()
    await f.host.setEnabled(ID, true)
    assert.equal((await f.request({ command: 'read', readingId: 'odk.tile.weather' })).reading.value.temperatureC, 21)
    assert.deepEqual((await odkDataRequest('read', { ...options, id: 'timer' })).reading, packageReading.reading)
  })
}

test('corrupt and removed Open DeskOS Data selections restore actual default consumers', async t => {
  const selected = await selection(t)
  assert.equal((await selected.load()).length, 1)
  await fs.writeFile(path.join(selected.stored.root, 'odk-data-registry.js'), 'throw Error("corrupt registry")')
  const errors = []
  const rejected = await selected.load({ report: id => errors.push(id) })
  assert.deepEqual(rejected, [])
  assert.deepEqual(errors, [ID])
  const fallback = await runtime(t, rejected)
  assert.equal(fallback.creates(), 1)
  assert.equal((await fallback.data().control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })).reading.value.temperatureC, 21)
  await selected.invoke(['remove', ID])
  const restored = await runtime(t, await selected.load())
  assert.equal(restored.creates(), 1)
  assert.equal((await restored.data().control.dispatch({ command: 'list' })).readings.some(entry => entry.id === 'timer'), true)
  assert.equal((await fs.stat(selected.stored.root)).isDirectory(), true)
})


for (const signed of [false, true]) for (const outcome of ['removed', 'revision', 'unavailable', 'malformed']) {
  test(`${signed ? 'signed' : 'default'} Open DeskOS Data rejects older catalog completion after ${outcome}`, async t => {
    const selected = signed ? await selection(t) : null
    const f = await runtime(t, selected ? await selected.load() : [])
    const data = f.data()
    assert.deepEqual(data.registry.publish('timer', { remaining_seconds: 42 }), { ok: true })
    const previous = await data.control.dispatch({ command: 'read', readingId: 'timer' })
    const gate = f.holdCatalog()
    const pending = data.syncPackages()
    await gate.entered
    if (outcome === 'removed') f.catalog([])
    else if (outcome === 'revision') f.revision('r2')
    else if (outcome === 'malformed') f.catalog(null)
    else f.catalogUnavailable(true)
    await data.syncPackages()
    if (outcome === 'revision') {
      assert.equal((await data.control.dispatch({ command: 'read', readingId: 'timer' })).reading.state, 'unconfigured')
      assert.deepEqual(data.registry.publish('timer', { remaining_seconds: 7 }), { ok: true })
    }
    const current = await data.control.dispatch({ command: 'read', readingId: 'timer' })
    if (outcome === 'removed') assert.deepEqual(current, { ok: false, error: 'unknown-reading' })
    else if (outcome === 'unavailable' || outcome === 'malformed') assert.deepEqual(current, previous)
    gate.release()
    await pending
    assert.deepEqual(await data.control.dispatch({ command: 'read', readingId: 'timer' }), current,
      'A superseded catalog request must not register or clear package readings')
    assert.equal((await data.control.dispatch({ command: 'read', readingId: 'extra.source' })).reading.value.count, 3)
    assert.equal((await data.control.dispatch({ command: 'read', readingId: 'extra.service' })).reading.state, 'unavailable')
  })
}


for (const signed of [false, true]) {
  test(`${signed ? 'signed' : 'default'} Open DeskOS Data keeps committed data while the latest catalog is pending`, async t => {
    const selected = signed ? await selection(t) : null
    const f = await runtime(t, selected ? await selected.load() : [])
    const data = f.data()
    data.registry.publish('timer', { remaining_seconds: 42 })
    const committed = await data.control.dispatch({ command: 'read', readingId: 'timer' })
    const older = f.holdCatalog()
    const oldSync = data.syncPackages()
    await older.entered
    f.revision('r2')
    const latest = f.holdCatalog()
    const newSync = data.syncPackages()
    await latest.entered
    older.release()
    await oldSync
    assert.deepEqual(await data.control.dispatch({ command: 'read', readingId: 'timer' }), committed)
    latest.release()
    await newSync
    assert.equal((await data.control.dispatch({ command: 'read', readingId: 'timer' })).reading.state, 'unconfigured')
    assert.deepEqual(data.registry.publish('timer', { remaining_seconds: 7 }), { ok: true })
    assert.equal((await data.control.dispatch({ command: 'read', readingId: 'timer' })).reading.value.remaining_seconds, 7)
  })

  test(`${signed ? 'signed' : 'default'} catalog reconciliation preserves the Personal Bot consumer`, {
    timeout: 10000,
  }, async t => {
    const selected = signed ? await selection(t) : null
    const f = await runtime(t, selected ? await selected.load() : [], { link: true })
    const data = f.data()
    data.registry.publish('timer', { remaining_seconds: 42 })
    const gate = f.holdCatalog()
    const previous = data.syncPackages()
    await gate.entered
    f.catalog([])
    await data.syncPackages()
    gate.release()
    await previous
    const options = { env: f.clientEnv }
    await f.request({ command: 'list' })
    await assert.rejects(odkDataRequest('read', { ...options, id: 'timer' }), /unknown-reading/)
    const current = await odkDataRequest('read', { ...options, id: 'odk.tile.weather' })
    assert.equal(current.reading.value.temperatureC, 21)
    assert.equal((await odkDataRequest('list', options)).readings.some(entry => entry.id === 'timer'), false)
  })
}


for (const signed of [false, true]) {
  test(`${signed ? 'signed' : 'default'} registry preserves source failure and UTF-8 bounds through the Bot consumer`, {
    timeout: 10000,
  }, async t => {
    const { MAX_READING_BYTES } = require('../src/odk-data-registry')
    const selected = signed ? await selection(t) : null
    const overhead = Buffer.byteLength(JSON.stringify({ text: '' }), 'utf8')
    const available = MAX_READING_BYTES - overhead
    const text = '界'.repeat(Math.floor(available / 3)) + 'x'.repeat(available % 3)
    assert.equal(Buffer.byteLength(JSON.stringify({ text }), 'utf8'), MAX_READING_BYTES)
    let result = { state: 'live', value: { text } }
    let failing = false
    let reads = 0
    const f = await runtime(t, selected ? await selected.load() : [], { link: true, extraRead: async () => {
      reads++
      if (failing) throw Error('Controlled source failure')
      return result
    } })
    assert.equal(f.creates(), signed ? 0 : 1)
    assert.equal(f.host.list().find(plugin => plugin.manifest.id === ID).manifest.version, signed ? '2.0.0' : '1.0.0')
    const control = f.data().control
    const bot = () => odkDataRequest('read', { env: f.clientEnv, id: 'extra.source' })
    await f.request({ command: 'list' })
    assert.equal(reads, 0, 'Listing must not acquire a source reading')
    const readBoth = async expected => {
      const before = reads
      assert.deepEqual(await control.dispatch({ command: 'read', readingId: 'extra.source' }), expected)
      if (expected.ok) assert.deepEqual((await bot()).reading, expected.reading)
      else await assert.rejects(bot(), error => error.message.includes(expected.error))
      assert.equal(reads, before + 2, 'Each consumer must acquire its own current source reading')
    }
    await readBoth({ ok: true, reading: { id: 'extra.source', label: 'Extra source', kind: 'tile', ...result } })
    result = { state: 'live', value: { text: text + 'x' } }
    await readBoth({ ok: false, error: 'reading-too-large' })
    result = { state: 'live', value: { text: text + '界' } }
    await readBoth({ ok: false, error: 'reading-too-large' })
    failing = true
    await readBoth({ ok: false, error: 'reading-unavailable' })
    assert.equal((await odkDataRequest('read', { env: f.clientEnv, id: 'odk.tile.weather' })).reading.value.temperatureC, 21)
    failing = false
    result = { state: 'stale', value: { text: 'Recovered source' }, updatedAt: 1700000000001 }
    await readBoth({ ok: true, reading: { id: 'extra.source', label: 'Extra source', kind: 'tile', ...result } })
    await f.host.stop()
    await f.assertLinkClosed()
  })
}
