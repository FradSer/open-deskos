import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTaskReadings, createRemoteReadings, createProducerControl, PRODUCER_INTERFACE } from '../src/producer-readings.mjs'

const taskId = 'f0562a65-12f6-427a-a005-8ffbca46e15b'
const current = { taskId, request: 'Finish the current task', response: 'Checks need review', identity: { name: 'Helper' }, state: 'finished', verification: { status: 'needs_review' }, learning: { status: 'skipped' }, updatedAt: '2026-10-23T00:00:00.000Z', private: 'not public' }

test('producer readings resolve the current owner without generation, source reads or private data', async () => {
  let reads = 0
  const provider = createTaskReadings({ list: () => ({ tasks: [{ taskId, identity: current.identity }], total: 1 }), status: () => { reads++; return current } })
  const declarations = provider.list()
  assert.equal(reads, 0)
  assert.equal(declarations.length, 1)
  const first = await provider.read(declarations[0].id)
  assert.equal(first.value.goal, current.request)
  assert.equal(first.value.verification, 'needs_review')
  assert.equal(JSON.stringify(first).includes('not public'), false)
  current.request = 'Changed owner goal'
  assert.equal((await provider.read(declarations[0].id)).value.goal, 'Changed owner goal')
  assert.equal(reads, 2)
})

test('remote readings expose every retained report and preserve uncertainty without replies or control grants', async () => {
  const pages = offset => ({ state: 'partial', total: 2, nextOffset: offset === 0 ? 1 : null, messages: [{ id: 'report-' + offset, at: 1000, text: 'Reported done', verification: 'reported_unverified', sources: [{ sessionId: 'session', machine: 'mac', project: '/project', taskName: 'Task', control: 'configured', target: 'mac' }] }], replies: [{ text: 'private owner turn' }], omitted: 1 })
  const provider = createRemoteReadings({ snapshot: pages })
  const entries = provider.list()
  assert.equal(entries.length, 2)
  const reading = await provider.read(entries[1].id)
  assert.equal(reading.value.verification, 'reported_unverified')
  assert.equal(reading.value.incomplete, true)
  assert.equal(reading.value.tasks[0].control, 'report_only')
  assert.equal(JSON.stringify(reading).includes('private owner turn'), false)
})

test('producer control is versioned, dynamically discovers selected ports and rejects foreign or late values', async () => {
  let selected = createTaskReadings({ list: () => ({ tasks: [{ taskId }], total: 1 }), status: () => current })
  const control = createProducerControl({ ports: () => selected ? [selected] : [], current: () => true })
  assert.equal((await control.dispatch({ command: 'producer_list', interface: PRODUCER_INTERFACE })).readings.length, 1)
  assert.equal((await control.dispatch({ command: 'producer_list', interface: 'unknown' })).ok, false)
  assert.equal((await control.dispatch({ command: 'producer_read', interface: PRODUCER_INTERFACE, readingId: 'foreign' })).ok, false)
  selected = null
  assert.deepEqual((await control.dispatch({ command: 'producer_list', interface: PRODUCER_INTERFACE })).readings, [])
})

test('selected producers cross the authenticated local channel into the single Shell registry', async t => {
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { endpoint, fixtureToken } = await import('./helpers/private-channel.mjs')
  const { createPersonalBotComposition, BOT_PORTS, loadShellModule } = await import('../src/plugin-composition.mjs')
  const { createPersonalAgentReadingSource } = loadShellModule('personal-agent-readings.js')
  const { createShellOdkData } = loadShellModule('odk-data.js')
  const { requestLocalControl } = loadShellModule('local-control-client.js')
  const root = await mkdtemp(join(tmpdir(), 'odk-producer-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const socket = endpoint(root, 'projection')
  let modelCalls = 0, sourceReads = 0, runtimeRevision = 0
  const forbidden = () => { modelCalls++; throw Error('Producer projections cannot generate or read Desk sources') }
  const composition = createPersonalBotComposition({ control: { endpoint: socket, stateDir: root, channelToken: fixtureToken },
    createService: () => ({ close() {}, suspend() {}, resume() {} }),
    openChannel: async () => ({ close() {} }),
    initialize: async () => ({ agent: { abort() {}, close() {}, generateBriefing: forbidden, generateProposals: forbidden, odkData: forbidden,
      revision: ++runtimeRevision, agentTasks: { list: () => ({ tasks: [{ taskId }], total: 1 }), status: () => { sourceReads++; return { ...current, request: `Owner revision ${runtimeRevision}` } } } },
      remote: { snapshot: () => ({ state: 'live', messages: [{ id: 'remote-one', at: 1000, text: 'Reported result', sources: [] }], nextOffset: null }) } }),
    createTaskReadings: runtime => createTaskReadings(runtime.agent.agentTasks),
    createRemoteReadings: runtime => createRemoteReadings(runtime.remote),
    createHome: () => ({ start() {}, close() {} }), createWatch: () => ({ start() {}, close() {} }),
  })
  await composition.start()
  const source = createPersonalAgentReadingSource({ endpoint: socket, platform: process.platform })
  t.after(async () => { await source.close(); await composition.stop() })
  await source.refresh()
  const data = createShellOdkData({ readings: [], serviceReadings: source.readings })
  assert.equal(data.registry.list().length, 2)
  assert.equal(sourceReads, 0)
  const id = `odk.agent.${taskId}`
  assert.equal((await data.registry.read(id)).reading.value.goal, 'Owner revision 1')
  const watch = composition.port(BOT_PORTS.watch)
  await composition.setEnabled('odk.personal-bot.home', false)
  assert.equal(composition.port(BOT_PORTS.watch), watch)
  assert.equal((await data.registry.read(id)).reading.value.goal, 'Owner revision 1')
  await composition.setEnabled('odk.personal-bot.task-readings', false)
  await source.refresh(); data.syncServices()
  assert.equal(data.registry.list().length, 1)
  assert.equal(data.registry.list()[0].id, 'odk.remote.remote-one')
  await composition.setEnabled('odk.personal-bot.task-readings', true)
  await composition.setEnabled('odk.personal-bot.runtime', false)
  await source.refresh(); data.syncServices()
  assert.deepEqual(data.registry.list(), [])
  await composition.setEnabled('odk.personal-bot.runtime', true)
  await source.refresh(); data.syncServices()
  assert.equal((await data.registry.read(id)).reading.value.goal, 'Owner revision 2')
  const inventory = await requestLocalControl({ endpoint: socket, label: 'isolated inventory', request: { command: 'inventory' } })
  assert.equal(inventory.scope, 'personal-agent')
  assert.equal(JSON.stringify(inventory).includes('Owner revision'), false)
  const wrongToken = join(root, 'wrong-token')
  await writeFile(wrongToken, 'b'.repeat(64), { mode: 0o600 })
  await assert.rejects(requestLocalControl({ endpoint: socket, platform: 'win32', tokenFile: wrongToken,
    label: 'isolated producer authentication', timeoutMs: 500,
    request: { command: 'producer_list', interface: PRODUCER_INTERFACE } }), /closed|failed/)
  assert.equal(modelCalls, 0, 'reading has no path to source refresh, model or generation')
})

test('a released producer cannot finish an earlier reading into its replacement', async () => {
  let release, entered
  const started = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const entry = { id: 'odk.agent.example', label: 'Task', kind: 'service' }
  let selected = { list: () => [entry], read: async () => { entered(); await gate; return { id: entry.id, state: 'live', value: { state: 'finished' } } } }
  const control = createProducerControl({ ports: () => selected ? [selected] : [], current: () => true })
  const pending = control.dispatch({ command: 'producer_read', interface: PRODUCER_INTERFACE, readingId: entry.id })
  await started
  selected = null; release()
  assert.deepEqual(await pending, { ok: false, error: 'provider-unavailable' })
})

test('an unavailable producer does not remove a healthy sibling projection', async () => {
  const healthy = createTaskReadings({ list: () => ({ tasks: [{ taskId }], total: 1 }), status: () => current })
  const control = createProducerControl({ ports: () => [{ list() { throw Error('provider unavailable') } }, healthy], current: () => true })
  assert.equal((await control.dispatch({ command: 'producer_list', interface: PRODUCER_INTERFACE })).readings.length, 1)
})

test('every shortened remote projection field marks the source as incomplete', async () => {
  for (const changed of [{ text: 'x'.repeat(4001) }, { sources: [{ taskName: 'n'.repeat(41) }] }, { sources: [{ project: 'p'.repeat(1025) }] }, { sources: [{ machine: 'm'.repeat(257) }] }]) {
    const provider = createRemoteReadings({ snapshot: () => ({ state: 'live', messages: [{ id: 'clipped', text: 'Report', sources: [], ...changed }], nextOffset: null }) })
    assert.equal((await provider.read('odk.remote.clipped')).value.incomplete, true)
  }
})

test('invalid producer inventories cannot disable healthy sibling listings or reads', async () => {
  const entry = { id: 'healthy.reading', label: 'Healthy', kind: 'service' }
  const healthy = { list: () => [entry], read: id => ({ id, state: 'live', value: { state: 'current' } }) }
  const circular = { id: 'bad.circular', label: 'Bad', kind: 'service' }; circular.home = circular
  for (const invalid of [null, [null], [{ ...entry, id: 'bad/id' }], [circular], [{ ...entry, home: { fields: ['state'] } }],
    [{ ...entry, home: { fields: [() => {}] } }],
    [{ ...entry, metadata: 1n }],
    Array.from({ length: 2048 }, (_, i) => ({ id: `bad.${i}`, label: 'x'.repeat(128), kind: 'service' }))]) {
    const control = createProducerControl({ ports: () => [{ list: () => invalid }, healthy], current: () => true })
    const inventory = await control.dispatch({ command: 'producer_list', interface: PRODUCER_INTERFACE })
    assert.deepEqual(inventory.readings, [entry])
    const result = await control.dispatch({ command: 'producer_read', interface: PRODUCER_INTERFACE, readingId: entry.id })
    assert.equal(result.reading.value.state, 'current')
  }
})

test('individually valid producer inventories retain the aggregate byte limit', async () => {
  const providers = [0, 1].map(group => ({ list: () => Array.from({ length: 600 }, (_, i) => ({ id: `reading.${group}.${i}`, label: 'x'.repeat(128), kind: 'service' })) }))
  const control = createProducerControl({ ports: () => providers, current: () => true })
  assert.equal((await control.dispatch({ command: 'producer_list', interface: PRODUCER_INTERFACE })).error, 'producer-unavailable')
})

test('conflicting producer identities are unavailable without blocking unrelated readings', async () => {
  const entry = id => ({ id, label: id, kind: 'service' })
  const provider = ids => ({ list: () => ids.map(entry), read: id => ({ id, state: 'live', value: { state: 'current' } }) })
  const selected = [provider(['shared', 'first']), provider(['shared', 'second'])]
  const control = createProducerControl({ ports: () => selected, current: () => true })
  const inventory = await control.dispatch({ command: 'producer_list', interface: PRODUCER_INTERFACE })
  assert.deepEqual(inventory.readings.map(e => e.id), ['first', 'second'])
  assert.equal((await control.dispatch({ command: 'producer_read', interface: PRODUCER_INTERFACE, readingId: 'shared' })).error, 'unknown-reading')
  assert.equal((await control.dispatch({ command: 'producer_read', interface: PRODUCER_INTERFACE, readingId: 'second' })).reading.value.state, 'current')
})
