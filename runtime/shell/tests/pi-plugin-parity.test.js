'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createPiSessionsSource, createConfiguredPiSessionReader } = require('../src/pi-sessions-source')
const { createPiSessionEventsSource } = require('../src/pi-session-events-source')
const { readSessionEvents } = require('../src/pi-sessions')
const { createShellDeskData } = require('../src/desk-data')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const run = promisify(execFile)
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { install: installSignedEvents } = require('./helpers/pi-events-selection')
const { loadNativePlugins } = require('../src/native-plugin-loader')
const cli = path.join(__dirname, '../scripts/open-deskos-plugin-cli.js')
const ids = ['odk.source.pi-sessions', 'odk.source.pi-events']
const directories = ids.map(id => path.join(__dirname, 'fixtures', id.replace('odk.source.', '') + '-replacement'))
const session = { sessionId: 'fixture', uuid: 'fixture', status: 'running', isAlive: true, pid: 1,
  cwd: '/fixture', workspaceName: 'Fixture', latestGoal: 'Keep behavior', updatedAt: 1791417600000 }
function snapshot(sessions = [session]) {
  return { ok: true, updatedAt: 1791417600000, scannedAt: 1791417600000, sessions,
    workspaces: [{ name: 'Fixture', cwd: '/fixture', sessions }],
    summary: { total: sessions.length, running: sessions.filter(s => s.status === 'running').length,
      settled: sessions.filter(s => s.status === 'settled').length, exited: 0, workspacesCount: 1 } }
}
function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}

for (const preAborted of [false, true]) test(`Pi Events replacement constructs without host factories or imports (${preAborted ? 'pre-aborted' : 'active'})`, async t => {
  const exported = {}
  vm.runInNewContext(fs.readFileSync(path.join(directories[1], 'entry.cjs'), 'utf8'), {
    exports: exported, AbortController,
    require(name) { throw Error(`Host import refused: ${name}`) },
  })
  const handlers = new Map()
  const cleanups = []
  const reported = { ok: false, reason: 'desk-link-unavailable' }
  const local = { ok: true, events: [{ kind: 'assistant', text: 'Fixture local event' }] }
  const controller = new AbortController()
  if (preAborted) controller.abort()
  let reportedReads = 0
  const instance = exported.create({ signal: controller.signal,
    get(name) { assert.equal(name, DATA_PORTS.deskLink); return { sessionEvents: async () => { reportedReads++; return reported } } },
    capability(name) {
      if (name === 'source.pi-events') return { create() { throw Error('Default source construction refused') }, readLocal: async () => local }
      assert.equal(name, 'ipc')
      return { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) }
    }, onCleanup: callback => cleanups.push(callback),
  })
  t.after(async () => { for (const callback of cleanups.reverse()) await callback() })
  assert.equal(typeof instance.ports[DATA_PORTS.piEvents], 'function')
  const result = await handlers.get('odk-pi-session-events')(null, { sessionId: 'fixture' })
  if (preAborted) {
    assert.equal(result.reason, 'pi-source-stopped')
    assert.equal(reportedReads, 0)
  } else assert.equal(result, local)
})

test('Main supplies the local event operation alongside the existing Pi Events constructor', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8')
  assert.match(main, /'source\.pi-events':\s*\{\s*create:\s*createPiSessionEventsSource,\s*readLocal:\s*readSessionEvents\s*\}/)
})

for (const preAborted of [false, true]) test(`Pi Sessions replacement constructs without host factories or imports (${preAborted ? 'pre-aborted' : 'active'})`, async t => {
  const exported = {}
  vm.runInNewContext(fs.readFileSync(path.join(directories[0], 'entry.cjs'), 'utf8'), {
    exports: exported, AbortController,
    require(name) { throw Error(`Host import refused: ${name}`) },
  })
  const cleanups = []
  const controller = new AbortController()
  if (preAborted) controller.abort()
  const instance = exported.create({ signal: controller.signal,
    get() { return { machines: async () => { assert.equal(preAborted, false); return [] }, hostedSessions: async () => ({ ok: false, sessions: [] }) } },
    capability(name) {
      if (name === 'source.pi-sessions') return { create() { throw Error('Default session construction refused') },
        configured: () => ({ source: { kind: 'local', label: 'Local' }, read: async () => { assert.equal(preAborted, false); return snapshot() } }) }
      assert.equal(name, 'ipc')
      return { handle() {}, removeHandler() {} }
    }, onCleanup: callback => cleanups.push(callback),
  })
  t.after(async () => { for (const callback of cleanups.reverse()) await callback() })
  const result = await instance.ports[DATA_PORTS.piSessions]()
  assert.equal(result.ok, !preAborted)
  if (preAborted) assert.equal(result.error, 'Pi source stopped.')
  else assert.equal(result.sessions[0].sessionId, 'fixture')
})

test('Main supplies configured session inspection alongside the existing constructor', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8')
  assert.match(main, /'source\.pi-sessions':\s*\{\s*create:\s*createPiSessionsSource,\s*configured:\s*createConfiguredPiSessionReader\s*\}/)
})

async function fixture(t, replacement, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-pi-parity-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const env = options.env || { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  let native
  if (replacement === 'signed' || replacement === 'signed-pi') native = await installSignedEvents(root, env, { sessions: replacement === 'signed-pi' })
  if (replacement === true) for (let i = 0; i < ids.length; i++) {
    await run(process.execPath, [cli, 'link', directories[i], '--trust', '--replace', '--grant',
      i === 0 ? 'source.pi-sessions' : 'source.pi-events', '--grant', 'ipc'], { env })
  }
  const config = readConfig(resolveConfigPath(env))
  const replacements = [...loadDevelopmentPlugins(config), ...await loadNativePlugins(config, { env, report: options.nativeReport })]
  if (replacement === 'signed' || replacement === 'signed-pi') {
    assert.ok(config.plugins[ids[1]].native, 'signed event selection must use native installation')
    if (options.mutateStored !== false) fs.writeFileSync(native.stored.entry, 'throw Error("Stored event entry changed after discovery")')
    if (replacement === 'signed-pi') {
      assert.ok(config.plugins[ids[0]]?.native, 'signed session selection must use native installation')
      if (options.mutateStored !== false) fs.writeFileSync(native.storedSessions.entry, 'throw Error("Stored session entry changed after discovery")')
    }
  }
  const expected = options.expectedReplacements || (replacement === 'signed' ? [ids[1]] : replacement ? ids : [])
  assert.deepEqual(replacements.map(plugin => plugin.manifest.id).sort(), [...expected].sort())
  const replacementIds = new Set(replacements.map(plugin => plugin.manifest.id))
  let localScans = 0
  const localEvents = []
  const link = { machines: async () => [], hostedSessions: async () => ({ ok: false, sessions: [] }),
    snapshot: async () => snapshot(), sessionEvents: async () => ({ ok: false, reason: 'desk-link-unavailable' }),
    ...options.link }
  const handlers = new Map()
  const readLocal = request => {
    localEvents.push(request)
    return options.readLocal ? options.readLocal(request) : { ok: true, events: [{ kind: 'result', text: 'Local' }] }
  }
  const host = createPluginHost({ capabilities: {
    ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); handlers.set(name, handler) }, removeHandler: name => handlers.delete(name) },
    'source.desk-link': { create: () => link },
    'source.pi-sessions': { configured: () => createConfiguredPiSessionReader({ env: options.sessionEnv || {}, execute: options.execute,
      scanLocal: () => { localScans++; return options.scanLocal ? options.scanLocal() : snapshot() } }),
      create: config => {
        assert.equal(replacementIds.has(ids[0]), false, 'independent Pi Sessions must not use the default source constructor')
        return createPiSessionsSource({ ...config, env: options.sessionEnv || {}, execute: options.execute, scanLocal: () => {
          localScans++; return options.scanLocal ? options.scanLocal() : snapshot()
        } })
      } },
    'source.pi-events': { readLocal, create: config => {
      assert.equal(replacementIds.has(ids[1]), false, 'independent Pi Events must not use the default source constructor')
      return createPiSessionEventsSource({ ...config, readLocal })
    } },
    'desk.data': { create: createShellDeskData, smokeMode: true },
  } })
  t.after(() => host.stop())
  createMainPlugins({ replacementPlugins: replacements }).filter(plugin => [...ids, 'odk.source.desk-link', 'odk.system.desk-data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
  await host.start()
  for (const id of ids) {
    const record = host.list().find(item => item.manifest.id === id)
    const expectedVersion = replacementIds.has(id) ? options.expectedVersions?.[id] || '2.0.0' : '1.0.0'
    assert.equal(record.manifest.version, expectedVersion)
    assert.equal(record.state, 'running')
    const source = host.get(id === ids[0] ? DATA_PORTS.piSessions : DATA_PORTS.piEvents)
    assert.equal(source.fixtureRevision, replacementIds.has(id) && config.plugins[id]?.native ? expectedVersion : undefined)
  }
  return { host, handlers, env, link, native, localEvents, localScans: () => localScans,
    scan: () => handlers.get('odk-pi-sessions')(null),
    events: request => handlers.get('odk-pi-session-events')(null, request),
    reading: () => host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.app.pi-sessions' }) }
}

for (const replacement of [false, true, 'signed', 'signed-pi']) {
  const name = replacement === 'signed-pi' ? 'signed independent Pi Sessions and Events'
    : replacement === 'signed' ? 'signed independent Pi Events with default Pi Sessions'
    : replacement ? 'independently linked Pi factories' : 'default Pi factories'
  test(`${name} coalesce session reads and refresh after settlement`, async t => {
    const entered = deferred()
    const gate = deferred()
    const f = await fixture(t, replacement, { scanLocal: () => { entered.resolve(); return gate.promise } })
    const first = f.scan()
    const second = f.scan()
    assert.equal(first, second)
    await entered.promise
    assert.equal(f.localScans(), 1)
    gate.resolve(snapshot())
    assert.equal((await first).ok, true)
    assert.deepEqual(await second, await first)
    assert.equal((await f.scan()).ok, true)
    assert.equal(f.localScans(), 2)
  })

  test(`${name} coalesce session scans reentered by a provider`, async t => {
    let calls = 0
    let nested
    const f = await fixture(t, replacement, { link: { machines() {
      calls++
      if (calls === 1) nested = f.scan()
      return Promise.resolve([])
    } } })
    const first = f.scan()
    assert.equal(calls, 1)
    assert.equal(nested, first)
    assert.equal((await first).ok, true)
  })

  test(`${name} retain synchronous provider rejection`, async t => {
    const failure = Error('Fixture synchronous machine failure')
    const f = await fixture(t, replacement, { link: { machines() { throw failure } } })
    await assert.rejects(f.scan(), error => error === failure)
    assert.equal(f.localScans(), 0)
  })

  for (const kind of ['local', 'SSH']) test(`${name} drain active ${kind} inspection before session restart`, async t => {
    const entered = deferred()
    const child = new EventEmitter()
    let rejectLocal
    const f = await fixture(t, replacement, kind === 'local' ? {
      scanLocal: () => { entered.resolve(); return new Promise((_resolve, reject) => { rejectLocal = reject }) },
    } : {
      sessionEnv: { ODK_PI_SSH_HOST: 'fixture', ODK_PI_SSH_NODE: '/node', ODK_PI_SSH_COLLECTOR: '/collector' },
      execute(_file, _args, options, callback) {
        options.signal.addEventListener('abort', () => callback(Object.assign(Error('Fixture SSH abort'), { name: 'AbortError' }), '', ''), { once: true })
        entered.resolve()
        return child
      },
    })
    const old = f.host.get(DATA_PORTS.piSessions)
    const pending = f.scan()
    await entered.promise
    let restarted = false
    const disable = f.host.setEnabled(ids[0], false)
    const enable = f.host.setEnabled(ids[0], true).then(() => { restarted = true })
    try {
      await new Promise(setImmediate)
      assert.equal(restarted, false)
      assert.notEqual(f.host.get(DATA_PORTS.piSessions), old)
    } finally {
      if (kind === 'local') rejectLocal(Error('Fixture late local scan rejection'))
      else child.emit('close', null, 'SIGKILL')
    }
    assert.equal((await pending).error, 'Pi source stopped.')
    await Promise.all([disable, enable])
    assert.notEqual(f.host.get(DATA_PORTS.piSessions), old)
    assert.equal(f.host.get(DATA_PORTS.deskLink), f.link)
    assert.equal(child.listenerCount('close'), 0)
  })

  test(`${name} retain a Hosted Pi read after a parallel machine request fails`, async t => {
    const gate = deferred()
    let active
    const f = await fixture(t, replacement, { link: {
      machines: () => Promise.reject(Error('Fixture machine request failure')),
      hostedSessions: options => { active = options.signal; return gate.promise },
    } })
    const pending = f.scan()
    assert.equal((await pending).error, 'Pi scan unavailable.')
    let stopped = false
    const disable = f.host.setEnabled(ids[0], false).then(() => { stopped = true })
    await new Promise(setImmediate)
    assert.equal(active.aborted, true)
    assert.equal(stopped, false)
    assert.equal(f.localScans(), 0)
    gate.resolve({ ok: false, sessions: [] })
    await disable
    assert.equal(f.host.get(DATA_PORTS.deskLink), f.link)
    assert.equal((await f.events({ sessionId: 'fixture' })).ok, true)
  })

  test(`${name} deduplicate identities and rebuild workspace counts`, async t => {
    const rows = [session, { ...session, activity: 'Equal-time activity', status: 'settled' },
      { ...session, uuid: 'second', sessionId: 'second', cwd: '/other', updatedAt: 0, startedAt: 50 },
      { ...session, uuid: 'second', sessionId: 'second', cwd: '/other', updatedAt: 0, startedAt: 51, status: 'exited' },
      { ...session, uuid: '', sessionId: '', cwd: '/unidentified' }, { ...session, uuid: '', sessionId: '', cwd: '/unidentified' }]
    const f = await fixture(t, replacement, { scanLocal: () => snapshot(rows) })
    const data = await f.scan()
    assert.deepEqual(data.sessions, [rows[1], rows[3], rows[4], rows[5]])
    assert.deepEqual(data.summary, { total: 4, running: 2, settled: 1, exited: 1, workspacesCount: 3 })
    assert.deepEqual(data.workspaces.map(workspace => workspace.sessions), [[rows[1]], [rows[3]], [rows[4], rows[5]]])
  })

  test(`${name} preserve projection bounds, nulls, omissions, and unknown counts`, async t => {
    const rows = Array.from({ length: 23 }, (_, i) => ({ ...session, uuid: `row-${i}`, sessionId: `row-${i}`,
      status: i === 0 ? '' : i % 2 ? 'settled' : 'running', latestGoal: '目'.repeat(170), activity: null,
      controlAttribution: { machine: 'private', sessionId: 'private' } }))
    rows[0] = { ...rows[0], sessionId: undefined, id: undefined, latestGoal: undefined, workspaceName: undefined, cwd: undefined, updatedAt: undefined }
    const f = await fixture(t, replacement, { scanLocal: () => ({ ...snapshot(rows), updatedAt: undefined }) })
    const reading = (await f.reading()).reading
    assert.equal(reading.value.asOf, undefined)
    assert.equal(reading.value.total, 23)
    assert.equal(reading.value.truncated, true)
    assert.equal(reading.value.sessions.length, 20)
    assert.deepEqual(reading.value.counts, { running: 11, settled: 11, unknown: 1 })
    assert.deepEqual(reading.value.sessions[0], { state: '', goal: null, activity: null, updatedAt: null })
    assert.equal(reading.value.sessions[1].goal, '目'.repeat(160) + '...')
    assert.equal('controlAttribution' in reading.value.sessions[1], false)
  })

  for (const connected of [false, true]) test(`${name} preserve configured SSH precedence (${connected ? 'reported' : 'SSH'})`, async t => {
    let calls = 0
    const remote = { ...snapshot(), scannedAt: Date.now() }
    const reported = snapshot([{ ...session, activity: 'Reported fixture' }])
    const f = await fixture(t, replacement, { sessionEnv: { ODK_PI_SSH_HOST: 'fixture', ODK_PI_SSH_NODE: '/node', ODK_PI_SSH_COLLECTOR: '/collector' },
      execute(file, args, options, callback) {
        calls++
        assert.equal(file, 'ssh')
        assert.equal(options.signal instanceof AbortSignal, true)
        assert.equal(args.includes('StrictHostKeyChecking=yes'), true)
        callback(null, JSON.stringify(remote), '')
      }, link: { machines: async () => connected ? ['fixture'] : [], snapshot: async () => reported } })
    const data = await f.scan()
    assert.equal(data.ok, true)
    assert.equal(calls, connected ? 0 : 1)
    assert.equal(f.localScans(), 0)
    assert.deepEqual(data, connected ? reported : { ...remote, source: { kind: 'ssh', label: 'Mac / SSH · fixture' } })
  })

  test(`${name} preserve actual local event log parsing`, async t => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-pi-events-log-'))
    t.after(() => fs.rmSync(agentDir, { recursive: true, force: true }))
    const cwd = '/fixture/events'
    const sessionId = 'fixture-event-log'
    const folder = path.join(agentDir, 'sessions', '--fixture-events--')
    fs.mkdirSync(folder, { recursive: true })
    const file = path.join(folder, `${sessionId}.jsonl`)
    const message = (role, content) => ({ type: 'message', message: { role, content } })
    const lines = [
      message('user', [{ type: 'text', text: 'Fixture user request' }]),
      message('assistant', [{ type: 'thinking', thinking: 'Fixture reasoning' }]),
      message('assistant', [{ type: 'toolCall', id: 'fixture-call', name: 'bash', arguments: { command: 'fixture command' } }]),
      { type: 'message', message: { role: 'toolResult', toolCallId: 'fixture-call', toolName: 'bash', isError: true,
        content: [{ type: 'text', text: 'Fixture first line\nFixture second line' }] } },
      message('assistant', [{ type: 'text', text: 'Fixture English 与中文\nSecond paragraph' }]),
    ]
    fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n') + '\ninvalid fixture record\n')
    const f = await fixture(t, replacement, { readLocal: request => readSessionEvents({ ...request, agentDir }) })
    const response = await f.events({ cwd, sessionId })
    assert.deepEqual(response.events.map(event => event.kind), ['user', 'thinking', 'tool', 'result', 'assistant'])
    assert.equal(response.events[3].isError, true)
    assert.equal(response.events[3].toolCallId, 'fixture-call')
    assert.equal(response.events[3].text, 'Fixture first line\nFixture second line')
    assert.equal(response.events[4].text, 'Fixture English 与中文\nSecond paragraph')
    assert.deepEqual(response, readSessionEvents({ cwd, sessionId, agentDir }))
    assert.equal(f.localEvents.length, 1)
    f.link.sessionEvents = async () => ({ ok: false, reason: 'reported-session-ended' })
    assert.deepEqual(await f.events({ cwd, sessionId }), { ok: false, reason: 'reported-session-ended' })
    assert.equal(f.localEvents.length, 1)
    fs.rmSync(file)
    f.link.sessionEvents = async () => ({ ok: false, reason: 'desk-link-unavailable' })
    assert.deepEqual(await f.events({ cwd, sessionId }), { ok: false, reason: 'session-log-missing' })
  })
  test(`${name} drain local event fallback and suppress its late rejection`, async t => {
    let enter, reject
    const entered = new Promise(resolve => { enter = resolve })
    const pendingLocal = new Promise((_resolve, no) => { reject = no })
    const f = await fixture(t, replacement, { readLocal: () => { enter(); return pendingLocal } })
    const previous = f.host.get(DATA_PORTS.piEvents)
    const previousHandler = f.handlers.get('odk-pi-session-events')
    const pending = f.events({ cwd: '/fixture', sessionId: 'fixture' })
    await entered
    let restarted = false
    const disable = f.host.setEnabled(ids[1], false)
    const enable = f.host.setEnabled(ids[1], true).then(() => { restarted = true })
    try {
      await new Promise(setImmediate)
      assert.equal(restarted, false)
      assert.deepEqual(await previousHandler(null, { sessionId: 'another' }), { ok: false, reason: 'pi-source-stopped' })
      assert.equal(f.localEvents.length, 1)
    } finally { reject(Error('Fixture late local read failure')) }
    assert.deepEqual(await pending, { ok: false, reason: 'pi-source-stopped' })
    await Promise.all([disable, enable])
    assert.notEqual(f.host.get(DATA_PORTS.piEvents), previous)
    assert.equal(f.host.get(DATA_PORTS.deskLink), f.link)
  })

  test(`${name} preserve local event rejection while active`, async t => {
    const f = await fixture(t, replacement, { readLocal: () => { throw Error('Fixture local read failure') } })
    await assert.rejects(f.events({ cwd: '/fixture', sessionId: 'fixture' }), /Fixture local read failure/)
    assert.equal(f.localEvents.length, 1)
  })

  test(`${name} wait for every parallel event read after cancellation`, async t => {
    const operations = []
    const f = await fixture(t, replacement, { link: { sessionEvents: (_id, options) => new Promise((resolve, reject) => operations.push({ resolve, reject, signal: options.signal })) } })
    const first = f.events({ sessionId: 'one' })
    const second = f.events({ sessionId: 'two' })
    assert.equal(operations.length, 2)
    const disable = f.host.setEnabled(ids[1], false)
    let done = false
    disable.then(() => { done = true })
    assert.equal(operations.every(operation => operation.signal.aborted), true)
    operations[0].resolve({ ok: true, events: [] })
    assert.deepEqual(await first, { ok: false, reason: 'pi-source-stopped' })
    await new Promise(setImmediate)
    assert.equal(done, false)
    operations[1].reject(Error('Fixture late reported failure'))
    assert.deepEqual(await second, { ok: false, reason: 'pi-source-stopped' })
    await disable
    assert.equal(f.localEvents.length, 0)
    assert.equal(f.handlers.has('odk-pi-session-events'), false)
  })
  test(`${name} preserve local snapshots and Desk Data projection`, async t => {
    const f = await fixture(t, replacement)
    assert.deepEqual(await f.scan(), { ...snapshot(), source: { kind: 'local', label: 'Local' } })
    const reading = (await f.reading()).reading
    assert.equal(reading.state, 'live')
    assert.equal(reading.id, 'odk.app.pi-sessions')
    assert.equal(reading.value.total, 1)
    assert.deepEqual(reading.value.counts, { running: 1 })
    assert.deepEqual(reading.value.sessions[0], { id: 'fixture', project: 'Fixture', workingDirectory: '/fixture',
      state: 'running', goal: 'Keep behavior', activity: null, updatedAt: '2026-10-08T00:00:00.000Z' })
    await f.host.setEnabled(ids[0], false)
    assert.equal(f.host.get(DATA_PORTS.piSessions), null)
    assert.equal(f.host.get(DATA_PORTS.deskLink), f.link)
    assert.equal(f.host.get(DESK_PORTS.data).registry.has('odk.app.pi-sessions'), false)
    assert.equal((await f.events({ sessionId: 'fixture' })).ok, true)
    await f.host.setEnabled(ids[0], true)
    assert.equal((await f.reading()).reading.state, 'live')
  })

  test(`${name} preserve reported precedence and authoritative Hosted Pi collisions`, async t => {
    const hosted = { ...session, hostedPi: true, status: 'settled', activity: 'Hosted' }
    const reported = { ...session, updatedAt: session.updatedAt + 1000, activity: 'Newer report' }
    const f = await fixture(t, replacement, { link: { machines: async () => ['fixture'],
      hostedSessions: async () => ({ ok: true, sessions: [hosted] }), snapshot: async () => snapshot([reported]) } })
    const value = await f.scan()
    assert.deepEqual(value.sessions, [hosted])
    assert.equal(value.summary.total, 1)
    assert.equal(value.summary.settled, 1)
    assert.equal(f.localScans(), 0)
    assert.deepEqual((await f.reading()).reading.value.counts, { settled: 1 })
  })

  test(`${name} preserve event fallback, request validation, and authoritative failures`, async t => {
    let response = { ok: true, events: [{ kind: 'result', text: 'Reported' }] }
    const requests = []
    const f = await fixture(t, replacement, { link: { sessionEvents: async (id, options) => {
      assert.equal(options.signal instanceof AbortSignal, true)
      requests.push([id, options.hostedPi]); return response
    } } })
    assert.deepEqual(await f.events({ cwd: '/fixture', sessionId: 'fixture', hostedPi: true }), response)
    assert.deepEqual(requests, [['fixture', true]])
    for (const reason of ['session-log-missing', 'desk-link-unconfigured', 'desk-link-unavailable']) {
      response = { ok: false, reason }
      assert.deepEqual(await f.events({ cwd: '/fixture', sessionId: 'fixture', hostedPi: false }), { ok: true, events: [{ kind: 'result', text: 'Local' }] })
    }
    assert.deepEqual(f.localEvents, Array(3).fill({ cwd: '/fixture', sessionId: 'fixture', hostedPi: false }))
    response = { ok: false, reason: 'reported-session-ended' }
    assert.deepEqual(await f.events({ cwd: 42, sessionId: 42, hostedPi: 'true' }), response)
    assert.deepEqual(requests.at(-1), ['', false])
    assert.equal(f.localEvents.length, 3)
    await f.host.setEnabled(ids[1], false)
    assert.equal(f.handlers.has('odk-pi-session-events'), false)
    assert.equal(f.host.get(DATA_PORTS.deskLink), f.link)
    assert.equal((await f.scan()).ok, true)
  })

  test(`${name} preserve unavailable readings and ordinary event rejection`, async t => {
    const f = await fixture(t, replacement, { scanLocal: () => { throw Error('fixture scan failure') },
      link: { sessionEvents: async () => { throw Error('fixture event failure') } } })
    assert.equal((await f.scan()).ok, false)
    const reading = (await f.reading()).reading
    assert.equal(reading.state, 'unavailable')
    assert.equal(reading.value, null)
    await assert.rejects(f.events({ sessionId: 'fixture' }), /fixture event failure/)
    assert.equal(f.localEvents.length, 0)
  })

  for (const index of [0, 1]) test(`${name} drain ${index === 0 ? 'session' : 'event'} reads before restart`, async t => {
    const gate = deferred()
    const entered = deferred()
    let active
    const f = await fixture(t, replacement, { link: index === 0
      ? { machines: async options => { active = options.signal; entered.resolve(); return gate.promise } }
      : { sessionEvents: async (_id, options) => { active = options.signal; entered.resolve(); return gate.promise } } })
    const port = index === 0 ? DATA_PORTS.piSessions : DATA_PORTS.piEvents
    const old = f.host.get(port)
    const pending = index === 0 ? f.scan() : f.events({ sessionId: 'fixture' })
    await entered.promise
    let restarted = false
    const disable = f.host.setEnabled(ids[index], false)
    const enable = f.host.setEnabled(ids[index], true).then(() => { restarted = true })
    try {
      assert.equal(active.aborted, true)
      await new Promise(setImmediate)
      assert.equal(restarted, false)
      assert.equal(f.host.get(DATA_PORTS.deskLink), f.link)
    } finally { gate.resolve(index === 0 ? ['fixture'] : { ok: true, events: [] }) }
    assert.equal((await pending).ok, false)
    await Promise.all([disable, enable])
    assert.notEqual(f.host.get(port), old)
    assert.equal(f.localScans(), 0)
    assert.equal(f.localEvents.length, 0)
  })
}

for (const index of [0, 1]) test(`signed ${ids[index]} update rollback and removal preserve Pi consumers`, async t => {
  const f = await fixture(t, 'signed-pi', { mutateStored: false })
  const id = ids[index]
  const ports = [DATA_PORTS.piSessions, DATA_PORTS.piEvents]
  const old = f.host.get(ports[index])
  const peerId = ids[1 - index]
  const peer = f.host.get(ports[1 - index])
  assert.equal(old.fixtureRevision, '2.0.0')
  const peerSelection = structuredClone(f.native.config().plugins[peerId].native)
  const consumers = async current => ({ sessions: await current.scan(), events: await current.events({ cwd: '/fixture', sessionId: 'fixture' }),
    reading: (await current.reading()).reading })
  const baseline = await consumers(f)
  let active = f
  const restart = async (expectedReplacements, expectedVersions = {}) => {
    await active.host.stop()
    assert.equal(active.host.list().some(plugin => ['cleanup-failed', 'cleanup-blocked'].includes(plugin.state)), false)
    assert.equal(active.handlers.size, 0)
    active = await fixture(t, false, { env: f.env, expectedReplacements, expectedVersions })
    assert.deepEqual(await consumers(active), baseline)
  }
  const first = f.native.config().plugins[id].native.revision
  const bundle = f.native.bundle(id, '3.0.0')
  const update = await f.native.command(['update', id, bundle, '--keyring', f.native.keyring, '--trust', '--grant',
    index === 0 ? 'source.pi-sessions' : 'source.pi-events', '--grant', 'ipc'])
  assert.equal(JSON.parse(update.stdout).effect, 'selection-only')
  const second = f.native.config().plugins[id].native.revision
  assert.notEqual(second, first)
  assert.equal(f.host.get(ports[index]), old)
  assert.equal(f.host.get(ports[1 - index]), peer)
  assert.deepEqual(f.native.config().plugins[peerId].native, peerSelection)
  assert.deepEqual(await consumers(f), baseline)
  await restart(ids, { [id]: '3.0.0' })
  const updated = active.host.get(ports[index])
  const updatedPeer = active.host.get(ports[1 - index])
  assert.equal(updated.fixtureRevision, '3.0.0')
  assert.equal(active.host.get(ports[1 - index]).fixtureRevision, '2.0.0')
  const configBytes = fs.readFileSync(resolveConfigPath(f.env))
  fs.writeFileSync(path.join(bundle, 'entry.cjs'), 'unsigned fixture revision')
  await assert.rejects(f.native.command(['update', id, bundle, '--keyring', f.native.keyring, '--trust', '--grant',
    index === 0 ? 'source.pi-sessions' : 'source.pi-events', '--grant', 'ipc']), /native file hash mismatch/)
  assert.deepEqual(fs.readFileSync(resolveConfigPath(f.env)), configBytes)
  assert.equal(active.host.get(ports[index]), updated)
  assert.equal(active.host.get(ports[1 - index]), updatedPeer)
  assert.deepEqual(await consumers(active), baseline)
  const rollback = JSON.parse((await f.native.command(['rollback', id, '--keyring', f.native.keyring])).stdout)
  assert.equal(rollback.effect, 'selection-only')
  assert.equal(f.native.config().plugins[id].native.revision, first)
  assert.deepEqual(f.native.config().plugins[peerId].native, peerSelection)
  assert.equal(active.host.get(ports[index]), updated)
  assert.equal(active.host.get(ports[1 - index]), updatedPeer)
  assert.equal(updated.fixtureRevision, '3.0.0')
  assert.deepEqual(await consumers(active), baseline)
  await restart(ids)
  const rolledBack = active.host.get(ports[index])
  const rolledBackPeer = active.host.get(ports[1 - index])
  assert.equal(rolledBack.fixtureRevision, '2.0.0')
  const removal = JSON.parse((await f.native.command(['remove', id])).stdout)
  assert.equal(removal.effect, 'selection-only')
  assert.equal(f.native.config().plugins[id].native, undefined)
  assert.equal(active.host.get(ports[index]), rolledBack)
  assert.equal(active.host.get(ports[1 - index]), rolledBackPeer)
  assert.deepEqual(f.native.config().plugins[peerId].native, peerSelection)
  assert.deepEqual(await consumers(active), baseline)
  await restart([peerId])
  assert.equal(active.host.get(ports[index]).fixtureRevision, undefined)
  assert.equal(active.host.get(ports[1 - index]).fixtureRevision, '2.0.0')
  assert.equal((await f.native.store.read(first)).manifest.version, '2.0.0')
  assert.equal((await f.native.store.read(second)).manifest.version, '3.0.0')
  assert.equal((await f.native.store.read(peerSelection.revision)).manifest.id, peerId)
})

for (const corruptIndex of [0, 1]) test(`corrupt signed ${ids[corruptIndex]} selection preserves its signed peer and removal restores defaults`, async t => {
  const f = await fixture(t, 'signed-pi', { mutateStored: false })
  const stored = [f.native.storedSessions, f.native.stored]
  fs.writeFileSync(stored[corruptIndex].entry, 'throw Error("Fixture corruption before next discovery")')
  assert.equal((await f.scan()).ok, true)
  assert.equal((await f.events({ sessionId: 'fixture' })).ok, true)
  assert.equal((await f.reading()).reading.state, 'live')
  await f.host.stop()
  const errors = []
  const report = (id, error) => errors.push([id, error.message])
  const peer = ids[1 - corruptIndex]
  const fallback = await fixture(t, false, { env: f.env, expectedReplacements: [peer], nativeReport: report })
  assert.equal(errors.length, 1)
  assert.equal(errors[0][0], ids[corruptIndex])
  assert.match(errors[0][1], /native file hash mismatch/)
  assert.equal(fallback.host.list().find(plugin => plugin.manifest.id === peer).manifest.version, '2.0.0')
  assert.equal(fallback.host.list().find(plugin => plugin.manifest.id === ids[corruptIndex]).manifest.version, '1.0.0')
  assert.equal((await fallback.scan()).ok, true)
  assert.deepEqual(await fallback.events({ sessionId: 'fixture' }), { ok: true, events: [{ kind: 'result', text: 'Local' }] })
  assert.equal((await fallback.reading()).reading.value.total, 1)
  await fallback.host.stop()
  const inventory = plugin => {
    const root = path.dirname(plugin.entry)
    const names = fs.readdirSync(root).sort()
    assert.deepEqual(names, ['bundle.json', 'entry.cjs', 'manifest.json'])
    return Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(root, name))]))
  }
  const retained = stored.map(inventory)
  for (const id of ids) {
    const receipt = JSON.parse((await f.native.command(['remove', id])).stdout)
    assert.equal(receipt.effect, 'selection-only')
    assert.equal(f.native.config().plugins[id].native, undefined)
  }
  const restored = await fixture(t, false, { env: f.env })
  assert.equal((await restored.scan()).ok, true)
  assert.equal((await restored.events({ sessionId: 'fixture' })).ok, true)
  assert.equal((await restored.reading()).reading.state, 'live')
  assert.deepEqual(stored.map(inventory), retained)
  assert.equal((await f.native.store.read(stored[1 - corruptIndex].revision)).manifest.id, peer)
  await assert.rejects(f.native.store.read(stored[corruptIndex].revision), /native file hash mismatch/)
})

test('corrupt and removed signed Pi Events selections restore actual default consumers', async t => {
  const f = await fixture(t, 'signed')
  assert.equal((await f.events({ cwd: '/fixture', sessionId: 'fixture' })).ok, true)
  await f.host.stop()
  const errors = []
  const report = (id, error) => errors.push([id, error.message])
  assert.deepEqual(await f.native.load({ report }), [])
  assert.equal(errors[0][0], ids[1])
  assert.match(errors[0][1], /native file hash mismatch/)
  const fallback = await fixture(t, false, { env: f.env, nativeReport: report })
  assert.deepEqual(await fallback.events({ cwd: '/fixture', sessionId: 'fixture' }), { ok: true, events: [{ kind: 'result', text: 'Local' }] })
  assert.equal((await fallback.scan()).ok, true)
  assert.equal(fallback.host.list().find(plugin => plugin.manifest.id === ids[1]).manifest.version, '1.0.0')
  await fallback.host.stop()
  const entryBytes = fs.readFileSync(f.native.stored.entry)
  await f.native.command(['remove', ids[1]])
  assert.equal(f.native.config().plugins[ids[1]].native, undefined)
  const restored = await fixture(t, false, { env: f.env })
  assert.deepEqual(await restored.events({ cwd: '/fixture', sessionId: 'fixture' }), { ok: true, events: [{ kind: 'result', text: 'Local' }] })
  assert.deepEqual(fs.readFileSync(f.native.stored.entry), entryBytes)
})

test('removing Pi development links restores defaults and preserves external entries', async t => {
  const f = await fixture(t, true)
  await f.host.stop()
  for (let i = 0; i < ids.length; i++) {
    const entry = path.join(directories[i], 'entry.cjs')
    const bytes = fs.readFileSync(entry)
    await run(process.execPath, [cli, 'remove', ids[i]], { env: f.env })
    assert.deepEqual(fs.readFileSync(entry), bytes)
  }
  assert.deepEqual(loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))), [])
  const defaults = await fixture(t, false, { env: f.env })
  assert.equal((await defaults.scan()).ok, true)
  assert.equal((await defaults.events({ sessionId: 'fixture' })).ok, true)
})
