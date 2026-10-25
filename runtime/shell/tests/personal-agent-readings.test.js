const test = require('node:test')
const assert = require('node:assert/strict')
const { createPersonalAgentReadingSource } = require('../src/personal-agent-readings')
const { createShellOdkData } = require('../src/odk-data')
const { integrationURL } = require('./helpers/repo-root')

const contract = 'odk:producer-projection/v1'
const entry = { id: 'odk.agent.task', label: 'Helper', kind: 'service', home: { mode: 'optional', priority: 0, icon: 'tasks', fields: ['state', 'goal'] } }

test('JSON wire inventories isolate incompatible declarations and reject ambiguous identities', async () => {
  const { createProducerControl, PRODUCER_INTERFACE } = await import(integrationURL('personal-agent/src/producer-readings.mjs', __dirname))
  const arrayEntry = Object.assign([], { ...entry, id: 'array.entry' })
  const arrayHome = { ...entry, id: 'array.home', home: Object.assign([], entry.home) }
  const healthy = { list: () => [entry], read: id => ({ id, state: 'live', value: { state: 'current', goal: 'Current goal' } }) }
  const incompatible = [{ ...entry, id: 'app.reading', kind: 'app' }, { id: 'no.home', label: 'No Home', kind: 'service' }]
  for (const bad of [arrayEntry, arrayHome, ...incompatible]) {
    const providers = [{ list: () => [bad], read: () => { throw Error('Incompatible readings must not be read') } }, healthy]
    const control = createProducerControl({ ports: () => providers, current: () => true })
    const source = createPersonalAgentReadingSource({ request: async ({ request }) => JSON.parse(JSON.stringify(await control.dispatch(request))) })
    await source.refresh()
    const data = createShellOdkData({ readings: [], serviceReadings: source.readings })
    assert.deepEqual(data.registry.list().map(e => e.id), [entry.id])
    assert.equal((await data.registry.read(entry.id)).reading.value.state, 'current')
    if (incompatible.includes(bad)) {
      const inventory = await control.dispatch({ command: 'producer_list', interface: PRODUCER_INTERFACE })
      assert.ok(inventory.readings.some(e => e.id === bad.id), 'control retains its public app and optional Home contract')
    }
    await source.close()
  }
  const source = createPersonalAgentReadingSource({ request: async () => JSON.parse(JSON.stringify({ interface: contract,
    readings: [entry, { ...entry, kind: 'app' }, { ...entry, id: 'unrelated.reading' }] })) })
  await source.refresh()
  assert.deepEqual(source.readings().map(e => e.id), ['unrelated.reading'])
  await source.close()
})

test('declared producer data joins the existing registry without retaining values', async () => {
  let state = 'waiting', reads = 0, online = true
  const source = createPersonalAgentReadingSource({ request: async ({ request }) => {
    if (!online) throw Error('private transport error')
    if (request.command === 'producer_list') return { interface: contract, readings: [entry] }
    reads++; return { interface: contract, reading: { id: entry.id, state: 'live', value: { state, goal: 'Resolve current task' } } }
  } })
  await source.refresh()
  const data = createShellOdkData({ readings: [], serviceReadings: source.readings })
  assert.equal(data.registry.list().length, 1)
  assert.equal(reads, 0, 'listing never reads source values')
  assert.equal((await data.registry.read(entry.id)).reading.value.state, 'waiting')
  state = 'finished'
  assert.equal((await data.registry.read(entry.id)).reading.value.state, 'finished')
  assert.equal(reads, 2)
  online = false
  assert.equal((await data.registry.read(entry.id)).ok, false)
  await source.refresh(); data.syncServices()
  assert.deepEqual(data.registry.list(), [])
  await source.close()
})

test('producer replacement and shutdown cannot publish late declarations or values', async () => {
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const source = createPersonalAgentReadingSource({ request: async () => { entered(); await gate; return { interface: contract, readings: [entry] } } })
  const pending = source.refresh()
  await started
  const closing = source.close()
  release()
  await Promise.all([pending, closing])
  assert.deepEqual(source.readings(), [])
})

test('invalid inventory cannot register arbitrary owners or malformed fields', async () => {
  for (const declaration of [{ ...entry, id: 'invalid/reading' }, { ...entry, kind: 'package' }, { ...entry, home: { ...entry.home, fields: ['__proto__'] } }]) {
    const source = createPersonalAgentReadingSource({ request: async () => ({ interface: contract, readings: [declaration] }) })
    await source.refresh()
    assert.deepEqual(source.readings(), [])
    await source.close()
  }
})

test('an unchanged declaration refresh does not discard an active current read', async () => {
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const source = createPersonalAgentReadingSource({ request: async ({ request }) => {
    if (request.command === 'producer_list') return { interface: contract, readings: [structuredClone(entry)] }
    entered(); await gate
    return { interface: contract, reading: { id: entry.id, state: 'live', value: { state: 'waiting', goal: 'Current goal' } } }
  } })
  await source.refresh()
  const pending = source.readings()[0].read()
  await started; await source.refresh(); release()
  assert.equal((await pending).value.state, 'waiting')
  await source.close()
})

test('producer-defined reading identities use registry ownership rather than consumer business prefixes', async () => {
  const declared = { ...entry, id: 'third.party.signal' }
  const source = createPersonalAgentReadingSource({ request: async () => ({ interface: contract, readings: [declared] }) })
  await source.refresh()
  assert.equal(source.readings()[0].id, declared.id)
  const data = createShellOdkData({ readings: [{ ...declared, kind: 'app', read: () => ({ state: 'live', value: { state: 'owned' } }) }], serviceReadings: () => [] })
  const services = createShellOdkData({ registry: data.registry, readings: [{ ...declared, kind: 'app', read: () => ({ state: 'live', value: { state: 'owned' } }) }], serviceReadings: () => [] })
  assert.equal((await services.registry.read(declared.id)).reading.value.state, 'owned')
  assert.throws(() => createShellOdkData({ registry: services.registry, readings: [], serviceReadings: source.readings }), /conflicting-service-reading/)
  await source.close()
})

test('disabling a source plugin cancels a slow authenticated read before a fresh instance starts', { timeout: 5000 }, async t => {
  const fs = require('node:fs/promises')
  const os = require('node:os')
  const path = require('node:path')
  const crypto = require('node:crypto')
  const { createPluginHost } = require('../src/plugin-host')
  const { createPersonalAgentReadingsPlugin, READING_PORT } = require('../src/plugins/personal-agent-readings')
  const { listenOdkData } = require('../src/odk-data-control')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-source-cancel-'))
  const endpoint = process.platform === 'win32' ? '\\\\.\\pipe\\odk-source-cancel-' + crypto.randomUUID() : path.join(root, 'read.sock')
  const channelToken = 'a'.repeat(64), tokenFile = path.join(root, 'token')
  await fs.writeFile(tokenFile, channelToken, { mode: 0o600 })
  let release, entered, hold = true, value = 'waiting'
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const server = await listenOdkData({ endpoint, stateDir: root, channelToken, control: { async dispatch(request) {
    if (request.command === 'producer_list') return { ok: true, interface: contract, readings: [entry] }
    if (hold) { entered(); await gate }
    return { ok: true, interface: contract, reading: { id: entry.id, state: 'live', value: { state: value, goal: 'Current goal' } } }
  } } })
  const host = createPluginHost({ capabilities: { 'source.personal-agent-readings': { endpoint, tokenFile } } })
  host.register(createPersonalAgentReadingsPlugin())
  t.after(async () => { release(); await host.stop(); await server.close(); await fs.rm(root, { recursive: true, force: true }) })
  await host.start()
  const source = host.get(READING_PORT)
  const pending = source.readings()[0].read()
  const rejected = assert.rejects(pending, /cancelled|unavailable/)
  await started
  let timer
  try {
    assert.equal(await Promise.race([
      host.setEnabled('odk.source.personal-agent-readings', false).then(() => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), 1000) }),
    ]), true, 'disable must cancel the owned socket rather than wait for its slow reply')
  } finally { clearTimeout(timer); release() }
  await rejected
  hold = false; value = 'finished'
  await host.setEnabled('odk.source.personal-agent-readings', true)
  const fresh = host.get(READING_PORT)
  assert.notEqual(fresh, source)
  assert.deepEqual(source.readings(), [])
  assert.equal((await fresh.readings()[0].read()).value.state, 'finished')
})

test('Main discovers default and independent replacement producer ports through the same registry', async () => {
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const { createPluginHost } = require('../src/plugin-host')
  const { DESK_PORTS } = require('../src/plugins/desk-runtime')
  const { READING_PORT } = require('../src/plugins/personal-agent-readings')
  for (const alternative of [false, true]) {
    let value = 'waiting', starts = 0, defaultRequests = 0
    const id = 'odk.source.personal-agent-readings'
    const original = createMainPlugins().find(plugin => plugin.manifest.id === id)
    const replacement = { manifest: { ...original.manifest, version: '2.0.0' }, create() {
      starts++
      return { ports: { [READING_PORT]: { readings: () => [{ ...entry, read: async () => ({ state: 'live', value: { state: value, goal: 'Current goal' } }) }], refresh: async () => {} } } }
    } }
    const plugins = createMainPlugins({ replacementPlugins: alternative ? [replacement] : [] })
    const host = createPluginHost({ capabilities: {
      'source.personal-agent-readings': { request: async ({ request }) => {
        defaultRequests++
        if (request.command === 'producer_list') return { interface: contract, readings: [entry] }
        return { interface: contract, reading: { id: entry.id, state: 'live', value: { state: value, goal: 'Current goal' } } }
      } },
      'desk.data': { create: createShellOdkData, smokeMode: true },
    } })
    plugins.filter(plugin => [id, 'odk.system.data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
    await host.start()
    try {
      const data = () => host.get(DESK_PORTS.data)
      assert.equal((await data().registry.read(entry.id)).reading.value.state, 'waiting')
      const registry = data().registry
      await host.setEnabled(id, false)
      assert.equal(data().registry, registry)
      assert.deepEqual(data().registry.list(), [])
      value = 'finished'
      await host.setEnabled(id, true)
      assert.equal((await data().registry.read(entry.id)).reading.value.state, 'finished')
      assert.equal(starts, alternative ? 2 : 0)
      assert.equal(defaultRequests > 0, !alternative, 'replacement must not construct the default bridge')
    } finally { await host.stop() }
  }
})
