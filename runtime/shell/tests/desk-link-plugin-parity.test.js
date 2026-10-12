'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const net = require('node:net')
const { posixOnlyReason } = require('./not-ported')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { createDeskLinkClient, createDeskLinkTransport } = require('../src/desk-link-client')
const { createPiSessionEventsSource } = require('../src/pi-session-events-source')
const { createPiSessionsSource } = require('../src/pi-sessions-source')
const { select } = require('./helpers/desk-link-selection')
const { wait } = require('./helpers/hydra-wire-lifecycle')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function fixture(t, mode, send, socketPath = '/fixture/link.sock') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-desk-link-parity-'))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  let host
  t.after(async () => {
    await wait(host?.stop() || Promise.resolve(), t.signal)
    fs.rmSync(root, { recursive: true, force: true })
  })
  const replacements = await select(root, mode, env, t.signal)
  const options = { socketPath, platform: 'linux', env, send, host: { stateDir: path.join(root, 'state'), endpoint: () => socketPath } }
  let defaults = 0
  let localReads = 0
  const handlers = new Map()
  host = createPluginHost({ capabilities: {
    'source.desk-link': { options, create(configuration) {
      assert.equal(mode, 'default', 'independent implementation must not construct default client')
      defaults++
      return createDeskLinkClient({ ...options, ...configuration })
    }, createTransport: configuration => createDeskLinkTransport({ ...options, ...configuration }) },
    'source.pi-events': { create: createPiSessionEventsSource },
    ipc: { handle: (id, callback) => handlers.set(id, callback), removeHandler: id => handlers.delete(id) },
  } })
  const composition = createMainPlugins({ replacementPlugins: replacements })
  host.register(composition.find(plugin => plugin.manifest.id === 'odk.source.desk-link'))
  const events = composition.find(plugin => plugin.manifest.id === 'odk.source.pi-events')
  host.register({ ...events, create(ctx) {
    return events.create({ ...ctx, capability(name) {
      if (name === 'source.pi-events') return { create: configuration => createPiSessionEventsSource({ ...configuration,
        readLocal: async () => { localReads++; return { ok: true, events: [{ text: 'Local fallback' }] } } }) }
      return ctx.capability(name)
    } })
  } })
  await host.start()
  const source = host.get(DATA_PORTS.deskLink)
  assert.ok(source)
  assert.equal(defaults, mode === 'default' ? 1 : 0)
  if (mode !== 'default') assert.equal(source.fixtureRevision, '2.0.0')
  return { source, host, handlers, localReads: () => localReads }
}

for (const mode of ['default', 'linked', 'signed']) {
  test(`${mode} Desk Link suppresses cancellation between transport and public completion`, { timeout: 15000 }, async t => {
    let gate
    let ready
    const f = await fixture(t, mode, () => { ready.resolve(); return gate.promise })
    for (const [method, args, reply, expected] of [
      ['machines', [], { machines: ['late'] }, []],
      ['snapshot', [], { ok: true, sessions: ['late'] }, { ok: false, reason: 'desk-link-unavailable', scannedAt: null, summary: null, sessions: [], workspaces: [] }],
      ['hostedSessions', [], { ok: true, sessions: ['late'], scannedAt: 1 }, { ok: false, reason: 'pi host unavailable', sessions: [], scannedAt: null }],
      ['sessionEvents', ['fixture'], { ok: true, events: ['late'] }, { ok: false, reason: 'desk-link-unavailable' }],
    ]) {
      gate = deferred()
      ready = deferred()
      const controller = new AbortController()
      const reading = f.source[method](...args, { signal: controller.signal })
      await ready.promise
      gate.resolve(reply)
      const cancellation = Promise.resolve().then(() => {}).then(() => {}).then(() => controller.abort())
      const result = await reading
      await cancellation
      assert.deepEqual(result, expected, `${method} must suppress cancellation before public completion`)
    }
  })

  test(`${mode} Desk Link preserves actual socket frames and releases pending connections`,
    { timeout: 15000, skip: posixOnlyReason('unix-socket') }, async t => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-desk-link-wire-'))
      const endpoint = path.join(root, 'link.sock')
      const sockets = new Set()
      const requests = []
      const ready = deferred()
      const closed = deferred()
      const server = net.createServer(socket => {
        sockets.add(socket)
        let pending = ''
        let held = false
        socket.on('error', () => {})
        socket.on('close', () => { sockets.delete(socket); if (held) closed.resolve() })
        socket.on('data', bytes => {
          pending += bytes.toString()
          if (!pending.includes('\n')) return
          const record = JSON.parse(pending.trim())
          requests.push(record)
          if (record.type === 'machines') { held = true; ready.resolve(); return }
          const responseBytes = Buffer.from(JSON.stringify({ ok: true, events: [{ text: '中文事件' }], truncated: true }) + '\n')
          const split = responseBytes.indexOf(Buffer.from('中')) + 1
          socket.write(responseBytes.subarray(0, split))
          socket.end(responseBytes.subarray(split))
        })
      })
      t.after(async () => {
        for (const socket of sockets) socket.destroy()
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        fs.rmSync(root, { recursive: true, force: true })
      })
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve) })
      const f = await fixture(t, mode, undefined, endpoint)
      assert.deepEqual(await f.handlers.get('odk-pi-session-events')(null, { sessionId: 'fixture', hostedPi: true }),
        { ok: true, events: [{ text: '中文事件' }], truncated: true })
      const reading = f.source.machines()
      await ready.promise
      await f.host.stop()
      assert.deepEqual(await reading, [])
      await closed.promise
      assert.equal(sockets.size, 0)
      assert.deepEqual(requests, [{ v: 1, type: 'events', sessionId: 'fixture', hostedPi: true }, { v: 1, type: 'machines' }])
      assert.equal(f.handlers.size, 0)
    })

  test(`${mode} Desk Link preserves wire records and actual Pi consumers`, { timeout: 15000 }, async t => {
    const requests = []
    const sessions = [{ sessionId: 'fixture', uuid: 'fixture', status: 'running', isAlive: true, pid: 1,
      cwd: '/fixture', workspaceName: 'Fixture', latestGoal: 'Preserve protocol', updatedAt: 1700000000000 }]
    const snapshot = { ok: true, scannedAt: 1700000000000, sessions,
      workspaces: [{ name: 'Fixture', cwd: '/fixture', sessions }],
      summary: { total: 1, running: 1, settled: 0, exited: 0, workspacesCount: 1 } }
    let reply = { snapshot, machines: { machines: [{ id: 'fixture-machine' }] },
      'hosted-sessions': { ok: true, sessions: [], scannedAt: 1700000000000 },
      events: { ok: true, events: [{ text: 'Reported event' }], truncated: true } }
    const f = await fixture(t, mode, async (_endpoint, record) => { requests.push(record); return reply[record.type] })
    assert.deepEqual(await f.source.snapshot(), snapshot)
    assert.deepEqual(await f.source.hostedSessions(), reply['hosted-sessions'])
    assert.deepEqual(await f.source.machines(), reply.machines.machines)
    assert.deepEqual(await f.source.sessionEvents('fixture', { hostedPi: true }), reply.events)
    assert.deepEqual(requests, [{ v: 1, type: 'snapshot' }, { v: 1, type: 'hosted-sessions' },
      { v: 1, type: 'machines' }, { v: 1, type: 'events', sessionId: 'fixture', hostedPi: true }])
    assert.deepEqual(await f.handlers.get('odk-pi-session-events')(null, { sessionId: 'fixture' }), reply.events)
    assert.equal(f.localReads(), 0)
    const scan = createPiSessionsSource({ deskLink: f.source, scanLocal() { throw Error('Reported machine must prevent local scan') } })
    try { assert.equal((await scan()).sessions[0].sessionId, 'fixture') } finally { await scan.stop() }
    reply.events = { ok: false, reason: 'desk-link-unavailable' }
    assert.deepEqual(await f.handlers.get('odk-pi-session-events')(null, { sessionId: 'fixture' }), { ok: true, events: [{ text: 'Local fallback' }] })
    assert.equal(f.localReads(), 1)
    reply.events = { ok: false, reason: 'reported-session-unavailable' }
    assert.deepEqual(await f.handlers.get('odk-pi-session-events')(null, { sessionId: 'fixture' }), reply.events)
    assert.equal(f.localReads(), 1)
    reply = {}
    assert.deepEqual(await f.source.snapshot(), { ok: false, reason: 'desk-link-unavailable', scannedAt: null, summary: null, sessions: [], workspaces: [] })
    assert.deepEqual(await f.source.hostedSessions(), { ok: false, reason: 'pi host unavailable', sessions: [], scannedAt: null })
    assert.deepEqual(await f.source.machines(), [])
    assert.deepEqual(await f.source.sessionEvents('fixture'), { ok: false, reason: 'desk-link-unavailable' })
    await f.host.stop()
    assert.equal(f.handlers.size, 0)
    const count = requests.length
    assert.deepEqual(await f.source.machines(), [])
    assert.equal(requests.length, count)
  })

  test(`${mode} Desk Link drains parallel requests and isolates cancellation`, { timeout: 15000 }, async t => {
    const gates = [deferred(), deferred()]
    const ready = deferred()
    const signals = []
    const f = await fixture(t, mode, (_endpoint, _record, _timeout, channel) => {
      signals.push(channel.signal)
      if (signals.length === 2) ready.resolve()
      return gates[signals.length - 1].promise
    })
    const controller = new AbortController()
    const first = f.source.machines({ signal: controller.signal })
    const second = f.source.machines()
    await ready.promise
    controller.abort()
    assert.equal(signals[0].aborted, true)
    assert.equal(signals[1].aborted, false)
    gates[0].reject(Error('Cancelled controlled transport'))
    assert.deepEqual(await first, [])
    let stopped = false
    const stop = f.host.stop().then(() => { stopped = true })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(signals[1].aborted, true)
    assert.equal(stopped, false)
    gates[1].resolve({ machines: ['late'] })
    await stop
    assert.deepEqual(await second, [])
  })

  test(`${mode} unconfigured Desk Link performs no transport operation`, { timeout: 15000 }, async t => {
    const f = await fixture(t, mode, () => { throw Error('Unconfigured source must not send') }, null)
    assert.equal((await f.source.snapshot()).reason, 'desk-link-unconfigured')
    assert.equal((await f.source.hostedSessions()).reason, 'desk-link-unconfigured')
    assert.deepEqual(await f.source.machines(), [])
    assert.equal((await f.source.sessionEvents('fixture')).reason, 'desk-link-unconfigured')
  })
}

test('independent Desk Link entry imports no Shell implementation', async () => {
  const exported = {}
  const controller = new AbortController()
  const cleanups = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'fixtures/desk-link-replacement/entry.cjs'), 'utf8'), {
    exports: exported, AbortController, AbortSignal, require() { throw Error('Host imports refused') },
  })
  const instance = exported.create({ signal: controller.signal, onCleanup: callback => cleanups.push(callback),
    capability(name) {
      assert.equal(name, 'source.desk-link')
      return { create() { throw Error('Default construction refused') }, createTransport: () => ({ socketPath: null }) }
    } })
  assert.equal((await instance.ports[DATA_PORTS.deskLink].snapshot()).reason, 'desk-link-unconfigured')
  for (const cleanup of cleanups) await cleanup()
})
