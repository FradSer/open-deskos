const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

const {
  createDeskLinkService,
  controlProof,
  controlTranscript,
  DESK_LINK_CONTROL_PROTOCOL,
} = require('../src/desk-link-service')
const { createDeskLinkClient } = require('../src/desk-link-client')
const { createPiSessionsSource } = require('../src/pi-sessions-source')
const controlFixture = require('./fixtures/control-v2.json')

const jsonl = (record) => `${JSON.stringify(record)}\n`
const pause = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

function tempSocket() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-desk-control-'))
  return { dir, socketPath: path.join(dir, 'service.sock') }
}

function fakeHost() {
  const calls = []
  const attachments = []
  return {
    calls,
    attachments,
    async request(record) {
      calls.push(record)
      if (record.type === 'list') {
        return {
          sessions: [{
            sessionId: 'hosted-1', status: 'settled', project: '/workspace/desk',
            goal: 'Keep the runtime truthful', startedAt: 1700000000000, updatedAt: 1700000001000,
          }],
        }
      }
      if (record.type === 'launch') return { sessionId: record.sessionId || 'hosted-new', state: 'pending' }
      if (record.type === 'history') return { sessionId: record.sessionId, entries: [], nextPosition: null }
      return { ok: true }
    },
    async attach(record, handlers) {
      calls.push(record)
      const attachment = {
        record,
        handlers,
        sent: [],
        closed: false,
        send(command) { this.sent.push(command) },
        close() { this.closed = true },
      }
      attachments.push(attachment)
      return {
        boundary: 7,
        history: Number.isSafeInteger(record.after) && record.after > 0 ? { entries: [{ position: 5, events: [{ kind: 'assistant', text: 'Caught up' }] }] } : { entries: [] },
        connection: attachment,
      }
    },
  }
}

/** Mirrors the real Pi host's history contract: it REFUSES a page larger than 100 entries
 *  (integrations/voice-agent/src/task-service.mjs) and breaks a page on bytes, so a mock that
 *  merely clamps the limit would certify behaviour the real host never produces. */
const HOST_HISTORY_BYTES = 192 * 1024

function historyBodies(total, size = 0) {
  return Array.from({ length: total }, (_, index) => ({
    position: index + 1,
    events: [{ kind: 'assistant', text: size > 0 ? `entry ${index + 1} ${'x'.repeat(size)}` : `entry ${index + 1}` }],
  }))
}

function faithfulHost(entries, pageSize = 100) {
  return {
    async request(record) {
      if (record.type !== 'history') return { sessionId: record.sessionId, entries: [], boundary: entries.length, nextPosition: null }
      const after = Number.isSafeInteger(record.after) ? record.after : 0
      const limit = Number.isSafeInteger(record.limit) ? record.limit : 64
      if (limit < 1 || limit > 100) throw new Error('History position 无效')
      const boundary = entries.length
      const page = []
      let bytes = 0
      let scanned = after
      while (scanned < boundary && page.length < Math.min(limit, pageSize)) {
        const entry = entries[scanned]
        const size = Buffer.byteLength(JSON.stringify([{ position: entry.position, events: entry.events }]))
        if (page.length > 0 && bytes + size > HOST_HISTORY_BYTES) break
        if (page.length === 0 && size > HOST_HISTORY_BYTES) {
          return { sessionId: record.sessionId, entries: [], boundary, nextPosition: after, oversized: true }
        }
        page.push(entry)
        bytes += size
        scanned += 1
      }
      return { sessionId: record.sessionId, entries: page, boundary, nextPosition: scanned < boundary ? scanned : null }
    },
  }
}

async function withService(run, options = {}) {
  const { dir, socketPath } = tempSocket()
  const hostAdapter = options.hostAdapter || fakeHost()
  const service = createDeskLinkService({
    token: 'report-token', controlCredential: 'control-secret', socketPath,
    port: 0, host: '127.0.0.1', hostAdapter, hostRequestTimeoutMs: 100,
    ...options,
  })
  const bound = await service.start()
  service.port = bound.port
  try {
    await run(service, socketPath, hostAdapter)
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

async function openLines(port) {
  const socket = net.createConnection({ host: '127.0.0.1', port })
  const records = []
  let pending = ''
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  socket.on('data', (chunk) => {
    pending += chunk.toString('utf8')
    const lines = pending.split('\n')
    pending = lines.pop() || ''
    for (const line of lines) if (line) records.push(JSON.parse(line))
  })
  socket.on('error', () => {})
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 1000
    while (Date.now() < deadline) {
      const found = records.find(predicate)
      if (found) return found
      await pause(5)
    }
    throw new Error(`timed out waiting for record: ${JSON.stringify(records)}`)
  }
  return { socket, records, send: (record) => socket.write(jsonl(record)), waitFor }
}

async function authenticateConsole(port, identity = { machine: 'desk-mac', sessionId: 'console-a' }) {
  const link = await openLines(port)
  link.send({ v: DESK_LINK_CONTROL_PROTOCOL, type: 'control-hello', token: 'report-token', ...identity })
  const challenge = await link.waitFor((record) => record.type === 'challenge')
  link.send({
    v: DESK_LINK_CONTROL_PROTOCOL,
    type: 'control-proof',
    proof: controlProof('control-secret', { ...identity, nonce: challenge.nonce }),
  })
  await link.waitFor((record) => record.type === 'control-ack')
  return link
}

test('v2 challenge proof uses the shared canonical transcript, is one-time, and does not send the credential', async () => {
  assert.equal(
    controlTranscript({ machine: controlFixture.handshake.hello.machine, sessionId: controlFixture.handshake.hello.sessionId, nonce: controlFixture.handshake.challenge.nonce }),
    controlFixture.handshake.transcript,
  )
  assert.equal(
    controlProof(controlFixture.handshake.credential, { machine: controlFixture.handshake.hello.machine, sessionId: controlFixture.handshake.hello.sessionId, nonce: controlFixture.handshake.challenge.nonce }),
    controlFixture.handshake.proof.proof,
  )
  await withService(async (service) => {
    const first = await openLines(service.port)
    first.send({ v: 2, type: 'control-hello', token: 'report-token', machine: 'desk-mac', sessionId: 'console-a' })
    const challenge = await first.waitFor((record) => record.type === 'challenge')
    assert.match(challenge.nonce, /^[a-f0-9]{64}$/)
    assert.equal(JSON.stringify(first.records).includes('control-secret'), false)
    const proof = controlProof('control-secret', { machine: 'desk-mac', sessionId: 'console-a', nonce: challenge.nonce })
    first.send({ v: 2, type: 'control-proof', proof })
    assert.equal((await first.waitFor((record) => record.type === 'control-ack')).machine, 'desk-mac')

    const replay = await openLines(service.port)
    replay.send({ v: 2, type: 'control-hello', token: 'report-token', machine: 'desk-mac', sessionId: 'console-a' })
    await replay.waitFor((record) => record.type === 'challenge')
    replay.send({ v: 2, type: 'control-proof', proof })
    assert.equal((await replay.waitFor((record) => record.type === 'error')).reason, 'control credential refused')
    first.socket.destroy()
    replay.socket.destroy()
  })
})

test('a v1 reporting connection refuses control without changing its reported sessions', async () => {
  await withService(async (service, socketPath, hostAdapter) => {
    const reporter = await openLines(service.port)
    reporter.send({ v: 1, type: 'hello', token: 'report-token', machine: 'report-only' })
    await reporter.waitFor((record) => record.type === 'ack')
    reporter.send({ v: 1, type: 'sessions', sessions: [{ sessionId: 'reported-1', cwd: '/workspace/reported', workspaceName: 'reported', status: 'running', startedAt: 1, updatedAt: 2 }] })
    reporter.send({ v: 1, type: 'list', requestId: 'must-not-control' })
    assert.equal((await reporter.waitFor((record) => record.type === 'error')).reason, 'reporting link is report-only')
    const snapshot = await createDeskLinkClient({ socketPath }).snapshot()
    assert.equal(snapshot.sessions[0].sessionId, 'reported-1')
    assert.deepEqual(hostAdapter.calls, [])
    reporter.socket.destroy()
  })
})

test('a v1 session report coalesced with hello survives listener routing', async () => {
  await withService(async (service, socketPath) => {
    const link = await openLines(service.port)
    link.socket.write(jsonl({ v: 1, type: 'hello', token: 'report-token', machine: 'coalesced-mac' }) + jsonl({
      v: 1,
      type: 'sessions',
      sessions: [{ sessionId: 'coalesced-1', cwd: '/workspace/coalesced', workspaceName: 'coalesced', status: 'settled', startedAt: 1, updatedAt: 2 }],
    }))
    await link.waitFor((record) => record.type === 'ack')
    await pause()
    const snapshot = await createDeskLinkClient({ socketPath }).snapshot()
    assert.equal(snapshot.sessions[0].sessionId, 'coalesced-1')
    link.socket.destroy()
  })
})

test('an unsupported first-record version is refused explicitly', async () => {
  await withService(async (service) => {
    const link = await openLines(service.port)
    link.send({ v: 9, type: 'control-hello', token: 'report-token', machine: 'desk-mac', sessionId: 'console-a' })
    assert.deepEqual(await link.waitFor((record) => record.type === 'version-mismatch'), {
      v: 2, type: 'version-mismatch', received: 9, accepted: [2],
    })
    link.socket.destroy()
  })
})

test('the private runtime channel preserves snapshots larger than the network record bound', async () => {
  await withService(async (service, socketPath) => {
    const reporter = await openLines(service.port)
    reporter.send({ v: 1, type: 'hello', token: 'report-token', machine: 'large-snapshot-mac' })
    await reporter.waitFor((record) => record.type === 'ack')
    reporter.send({
      v: 1,
      type: 'sessions',
      sessions: Array.from({ length: 64 }, (_, index) => ({
        sessionId: `large-${index}`,
        cwd: `/workspace/${index}/${'w'.repeat(6000)}`,
        workspaceName: `workspace-${index}`,
        status: 'running',
        startedAt: index + 1,
        updatedAt: index + 1,
        latestGoal: 'g'.repeat(2500),
        activity: 'a'.repeat(500),
      })),
    })
    await pause(60)

    const snapshot = await createDeskLinkClient({ socketPath }).snapshot()
    assert.equal(snapshot.ok, true)
    assert.equal(snapshot.sessions.length, 64)
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) > 1024 * 1024)
    reporter.socket.destroy()
  })
})

test('list, launch, and history are correlated one-shot host requests', async () => {
  await withService(async (service, _socketPath, hostAdapter) => {
    for (const request of [
      { type: 'list', requestId: 'list-1' },
      { type: 'launch', requestId: 'launch-1', mutationId: 'mutation-launch-1', project: '/workspace/desk', prompt: 'Run the focused tests', sessionId: 'durable-1' },
      { type: 'history', requestId: 'history-1', sessionId: 'hosted-1', after: 3, through: 20 },
    ]) {
      const link = await authenticateConsole(service.port)
      link.send({ v: 2, ...request })
      const reply = await link.waitFor((record) => record.requestId === request.requestId)
      assert.equal(reply.type, 'ack')
      assert.equal(reply.requestId, request.requestId)
      if (request.type === 'list') assert.equal(reply.result.sessions[0].sessionId, 'hosted-1')
      if (request.type === 'launch') assert.equal(reply.result.sessionId, 'durable-1')
      if (request.type === 'history') {
        assert.deepEqual(reply.result.entries, [])
        assert.equal(hostAdapter.calls.at(-1).through, 20)
      }
      link.socket.destroy()
    }
    assert.deepEqual(hostAdapter.calls.map((call) => call.type), ['list', 'launch', 'history'])
  })
})

test('a one-shot control connection forwards only its first request', async () => {
  await withService(async (service, _socketPath, hostAdapter) => {
    const link = await authenticateConsole(service.port)
    link.socket.write(jsonl({ v: 2, type: 'list', requestId: 'first-list' }) + jsonl({ v: 2, type: 'list', requestId: 'second-list' }))
    assert.equal((await link.waitFor((record) => record.requestId === 'first-list')).type, 'ack')
    assert.equal((await link.waitFor((record) => record.requestId === 'second-list')).reason, 'one-shot connection accepts one request')
    assert.deepEqual(hostAdapter.calls.map((call) => call.requestId), ['first-list'])
    link.socket.destroy()
  })
})

test('attach holds routing, forwards host events, and clears attribution on disconnect', async () => {
  await withService(async (service, socketPath, hostAdapter) => {
    const link = await authenticateConsole(service.port, { machine: 'desk-mac', sessionId: 'console-a' })
    link.send({ v: 2, type: 'attach', requestId: 'attach-1', sessionId: 'hosted-1', attachmentId: 'attachment-1', after: 4 })
    const attached = await link.waitFor((record) => record.requestId === 'attach-1')
    assert.equal(attached.type, 'ack')
    assert.equal(attached.result.boundary, 7)
    assert.equal(attached.result.caughtUp, true)
    const caughtUp = link.records.find((record) => record.type === 'event' && record.position === 5)
    assert.deepEqual(caughtUp.events, [{ kind: 'assistant', text: 'Caught up' }])
    assert.equal(caughtUp.attachmentId, 'attachment-1')
    assert.equal(link.records.some((record) => record.type === 'caught_up' && record.attachmentId === 'attachment-1'), true)

    link.send({ v: 2, type: 'prompt', requestId: 'prompt-1', mutationId: 'mutation-prompt-1', sessionId: 'hosted-1', attachmentId: 'attachment-1', prompt: 'Continue carefully' })
    await pause()
    assert.equal(hostAdapter.attachments[0].sent[0].type, 'prompt')
    hostAdapter.attachments[0].handlers.onRecord({ type: 'ack', requestId: 'prompt-1', sessionId: 'hosted-1' })
    await link.waitFor((record) => record.requestId === 'prompt-1')

    hostAdapter.attachments[0].handlers.onRecord({ type: 'event', sessionId: 'hosted-1', position: 8, events: [{ kind: 'thinking', text: 'Checking' }, { kind: 'assistant', text: 'Done' }] })
    const liveEvent = await link.waitFor((record) => record.type === 'event' && record.position === 8)
    assert.equal(liveEvent.position, 8)
    assert.deepEqual(liveEvent.events, [{ kind: 'thinking', text: 'Checking' }, { kind: 'assistant', text: 'Done' }])
    assert.equal(liveEvent.attachmentId, 'attachment-1')
    hostAdapter.attachments[0].handlers.onRecord({ type: 'state', state: 'settled', turnOutcome: 'finished', response: 'Terminal result' })
    const terminal = await link.waitFor((record) => record.type === 'terminal')
    assert.equal(terminal.response, 'Terminal result')

    link.send({ v: 2, type: 'history', requestId: 'history-held', sessionId: 'hosted-1', after: 4 })
    const history = await link.waitFor((record) => record.requestId === 'history-held')
    assert.equal(history.type, 'ack')
    assert.deepEqual(history.result.entries, [])
    assert.equal(link.socket.destroyed, false)

    link.send({ v: 2, type: 'history', requestId: 'history-wrong', sessionId: 'hosted-other', after: 0 })
    assert.equal((await link.waitFor((record) => record.requestId === 'history-wrong')).reason, 'attached session mismatch')

    const client = createDeskLinkClient({ socketPath })
    let hosted = await client.hostedSessions()
    assert.equal(hosted.sessions[0].hostedPi, true)
    assert.deepEqual(hosted.sessions[0].controlAttribution, { machine: 'desk-mac', sessionId: 'console-a' })

    link.socket.destroy()
    await pause(60)
    hosted = await client.hostedSessions()
    assert.equal(hosted.sessions[0].controlAttribution, undefined)
    assert.equal(hostAdapter.attachments[0].closed, true)
  })
})

test('disconnecting while host Attach is pending cannot leave stale attribution', async () => {
  let finishAttach
  const connection = { closed: false, send() {}, close() { this.closed = true } }
  const hostAdapter = fakeHost()
  hostAdapter.attach = () => new Promise((resolve) => { finishAttach = () => resolve({ boundary: 0, history: { entries: [] }, connection }) })
  await withService(async (service, socketPath) => {
    const link = await authenticateConsole(service.port)
    link.send({ v: 2, type: 'attach', requestId: 'attach-pending', sessionId: 'hosted-1', attachmentId: 'attachment-pending', after: 0 })
    while (!finishAttach) await pause(5)
    link.socket.destroy()
    await pause()
    finishAttach()
    await pause(40)
    const hosted = await createDeskLinkClient({ socketPath }).hostedSessions()
    assert.equal(hosted.sessions[0].controlAttribution, undefined)
    assert.equal(connection.closed, true)
  }, { hostAdapter })
})

test('a concurrent newer attach fences a pending Console before attribution is published', async () => {
  const pending = []
  const hostAdapter = fakeHost()
  hostAdapter.attach = (record) => new Promise((resolve) => {
    pending.push({
      record,
      resolve: () => resolve({
        boundary: 0,
        history: { entries: [] },
        connection: { closed: false, send() {}, close() { this.closed = true } },
      }),
    })
  })
  await withService(async (service, socketPath) => {
    const first = await authenticateConsole(service.port, { machine: 'first-mac', sessionId: 'console-a' })
    first.send({ v: 2, type: 'attach', requestId: 'attach-a', sessionId: 'hosted-1', attachmentId: 'attachment-a', after: 0 })
    while (pending.length < 1) await pause(5)

    const second = await authenticateConsole(service.port, { machine: 'second-mac', sessionId: 'console-b' })
    second.send({ v: 2, type: 'attach', requestId: 'attach-b', sessionId: 'hosted-1', attachmentId: 'attachment-b', after: 0 })
    while (pending.length < 2) await pause(5)
    pending[1].resolve()
    await second.waitFor((record) => record.requestId === 'attach-b')
    pending[0].resolve()
    await pause(40)

    const hosted = await createDeskLinkClient({ socketPath }).hostedSessions()
    assert.deepEqual(hosted.sessions[0].controlAttribution, { machine: 'second-mac', sessionId: 'console-b' })
    assert.equal(first.records.some((record) => record.requestId === 'attach-a' && record.type === 'ack'), false)
    first.socket.destroy()
    second.socket.destroy()
  }, { hostAdapter })
})

test('a newer attach replaces the previous Console attribution', async () => {
  await withService(async (service, socketPath) => {
    const first = await authenticateConsole(service.port, { machine: 'first-mac', sessionId: 'console-a' })
    first.send({ v: 2, type: 'attach', requestId: 'attach-a', sessionId: 'hosted-1', attachmentId: 'attachment-a', after: 0 })
    await first.waitFor((record) => record.requestId === 'attach-a')

    const second = await authenticateConsole(service.port, { machine: 'second-mac', sessionId: 'console-b' })
    second.send({ v: 2, type: 'attach', requestId: 'attach-b', sessionId: 'hosted-1', attachmentId: 'attachment-b', after: 0 })
    await second.waitFor((record) => record.requestId === 'attach-b')
    assert.equal((await first.waitFor((record) => record.type === 'error')).reason, 'attach replaced')

    const hosted = await createDeskLinkClient({ socketPath }).hostedSessions()
    assert.deepEqual(hosted.sessions[0].controlAttribution, { machine: 'second-mac', sessionId: 'console-b' })
    first.socket.destroy()
    second.socket.destroy()
  })
})

test('a Hosted Pi marker wins over a colliding Reported Session identity', async () => {
  await withService(async (service, socketPath) => {
    const reporter = await openLines(service.port)
    reporter.send({ v: 1, type: 'hello', token: 'report-token', machine: 'reporting-mac' })
    await reporter.waitFor((record) => record.type === 'ack')
    reporter.send({ v: 1, type: 'sessions', sessions: [{
      sessionId: 'hosted-1', cwd: '/workspace/reported-collision', workspaceName: 'reported-collision',
      status: 'running', startedAt: 1700000000000, updatedAt: 1700000009999,
      latestGoal: 'Reported collision', activity: 'Reported activity',
    }] })
    await pause()

    const deskLink = createDeskLinkClient({ socketPath })
    const scan = createPiSessionsSource({ env: {}, deskLink, scanLocal: async () => { throw new Error('local must not answer') } })
    const snapshot = await scan()
    const session = snapshot.sessions.find((item) => item.sessionId === 'hosted-1')
    assert.equal(snapshot.sessions.filter((item) => item.sessionId === 'hosted-1').length, 1)
    assert.equal(session.hostedPi, true)
    assert.equal(session.source, 'hosted-pi')
    assert.equal(session.reportedBy, undefined)
    assert.equal(session.cwd, '/workspace/desk')
    reporter.socket.destroy()
  })
})

test('reported sessions remain unchanged while Hosted Pi overlays the same source', async () => {
  await withService(async (service, socketPath) => {
    const reporter = await openLines(service.port)
    reporter.send({ v: 1, type: 'hello', token: 'report-token', machine: 'desk-mac' })
    await reporter.waitFor((record) => record.type === 'ack')
    reporter.send({ v: 1, type: 'sessions', sessions: [{ sessionId: 'reported-1', cwd: '/workspace/reported', workspaceName: 'reported', status: 'running', startedAt: 1, updatedAt: 2 }] })
    await pause()

    const deskLink = createDeskLinkClient({ socketPath })
    const scan = createPiSessionsSource({ env: {}, deskLink, scanLocal: async () => { throw new Error('local must not answer') } })
    const snapshot = await scan()
    const reported = snapshot.sessions.find((session) => session.sessionId === 'reported-1')
    const hosted = snapshot.sessions.find((session) => session.sessionId === 'hosted-1')
    assert.equal(reported.reportedBy, 'desk-mac')
    assert.equal(reported.hostedPi, undefined)
    assert.equal(hosted.hostedPi, true)
    assert.equal(hosted.reportedBy, undefined)
    reporter.socket.destroy()
  })
})

test('the existing Pi Sessions source overlays Hosted Pi even without a Reporting Machine', async () => {
  await withService(async (_service, socketPath) => {
    const deskLink = createDeskLinkClient({ socketPath })
    const scan = createPiSessionsSource({
      env: {},
      deskLink,
      scanLocal: async () => ({
        ok: true, scannedAt: Date.now(), source: { kind: 'local', label: 'Local' },
        summary: { total: 1, running: 1, settled: 0, exited: 0, workspacesCount: 1 },
        sessions: [{ sessionId: 'local-1', uuid: 'local-1', pid: 12, isAlive: true, status: 'running', cwd: '/workspace/local', workspaceName: 'local' }],
        workspaces: [{ name: 'local', cwd: '/workspace/local', sessions: [] }],
      }),
    })
    const snapshot = await scan()
    assert.deepEqual(snapshot.sessions.map((session) => session.sessionId).sort(), ['hosted-1', 'local-1'])
    const hosted = snapshot.sessions.find((session) => session.sessionId === 'hosted-1')
    assert.equal(hosted.hostedPi, true)
    assert.equal(hosted.reportedBy, undefined)
    assert.equal(snapshot.source.label, 'Local')
  })
})

test('Hosted Pi events are read from bounded host history instead of a local log fallback', async () => {
  const hostAdapter = fakeHost()
  hostAdapter.request = async (record) => {
    hostAdapter.calls.push(record)
    if (record.type === 'history') {
      return {
        sessionId: record.sessionId,
        // A real page starts at the log's first entry, so a complete three-entry log reports
        // itself as complete: entries without events contribute nothing to the view.
        entries: [
          { position: 1, events: [] },
          { position: 2, events: [] },
          { position: 3, events: [{ kind: 'assistant', text: 'Hosted result' }] },
        ],
        nextPosition: null,
        boundary: 3,
      }
    }
    return { sessions: [] }
  }
  await withService(async (_service, socketPath) => {
    const result = await createDeskLinkClient({ socketPath }).sessionEvents('hosted-1')
    assert.equal(result.ok, true)
    assert.deepEqual(result.events, [{ kind: 'assistant', text: 'Hosted result' }])
    assert.equal(result.truncated, false)
    assert.equal(hostAdapter.calls.at(-1).type, 'history')
  }, { hostAdapter })
})

test('an explicit Hosted Pi event read wins over a colliding Reported Session identity', async () => {
  const hostAdapter = fakeHost()
  hostAdapter.request = async (record) => {
    hostAdapter.calls.push(record)
    return record.type === 'history'
      ? { sessionId: record.sessionId, entries: [{ position: 4, events: [{ kind: 'assistant', text: 'Hosted owner' }] }], nextPosition: null, boundary: 4 }
      : { sessions: [] }
  }
  await withService(async (service, socketPath) => {
    const reporter = await openLines(service.port)
    reporter.send({ v: 1, type: 'hello', token: 'report-token', machine: 'reporting-mac' })
    await reporter.waitFor((record) => record.type === 'ack')
    reporter.send({ v: 1, type: 'sessions', sessions: [{ sessionId: 'hosted-1', cwd: '/reported', workspaceName: 'reported', status: 'running' }] })
    reporter.send({ v: 1, type: 'events', sessionId: 'hosted-1', events: [{ kind: 'assistant', text: 'Reported owner' }] })
    await pause()

    const result = await createDeskLinkClient({ socketPath }).sessionEvents('hosted-1', { hostedPi: true })
    assert.deepEqual(result.events, [{ kind: 'assistant', text: 'Hosted owner' }])
    assert.equal(hostAdapter.calls.at(-1).type, 'history')
    reporter.socket.destroy()
  }, { hostAdapter })
})

test('Hosted Pi history continuation is exposed as a truncated recent stream', async () => {
  const hostAdapter = fakeHost()
  hostAdapter.request = async (record) => record.type === 'history'
    ? { sessionId: record.sessionId, entries: [], nextPosition: 40, boundary: 90 }
    : { sessions: [] }
  await withService(async (_service, socketPath) => {
    const result = await createDeskLinkClient({ socketPath }).sessionEvents('hosted-1')
    assert.equal(result.ok, true)
    assert.equal(result.truncated, true)
  }, { hostAdapter })
})

test('the live view asks for a history page the real host accepts', async () => {
  const hostAdapter = faithfulHost(historyBodies(250))
  const limits = []
  const request = hostAdapter.request
  hostAdapter.request = (record) => {
    if (record.type === 'history') limits.push(record.limit)
    return request(record)
  }
  await withService(async (_service, socketPath) => {
    const result = await createDeskLinkClient({ socketPath }).sessionEvents('hosted-1')
    assert.equal(result.ok, true, 'a page size the host refuses would surface as an unavailable host')
    assert.equal(limits.every((limit) => limit <= 100), true, 'every history page stays inside the host cap')
  }, { hostAdapter })
})

test('a Hosted Pi log inside the retained window reads its newest entries', async () => {
  const hostAdapter = faithfulHost(historyBodies(250))
  await withService(async (_service, socketPath) => {
    const result = await createDeskLinkClient({ socketPath }).sessionEvents('hosted-1')
    assert.equal(result.ok, true)
    assert.equal(result.truncated, false, 'a log the retained window covers is not truncated')
    assert.equal(result.events.length, 250, 'the whole log is delivered, not one page')
    assert.equal(result.events.some((event) => event.text === 'entry 250'), true, 'the newest entry is present')
  }, { hostAdapter })
})

test('a Hosted Pi log longer than the window still ends at the newest entry', async () => {
  const hostAdapter = faithfulHost(historyBodies(1000))
  await withService(async (_service, socketPath) => {
    const result = await createDeskLinkClient({ socketPath }).sessionEvents('hosted-1')
    assert.equal(result.ok, true)
    assert.equal(result.truncated, true)
    assert.equal(result.events.some((event) => event.text === 'entry 1000'), true, 'the newest entry is present')
    assert.equal(result.events.some((event) => event.text === 'entry 1'), false, 'the oldest page never displaces the newest window')
  }, { hostAdapter })
})

test('byte-bounded pages still end at the newest entries', async () => {
  // 16 KiB bodies make a page hold ~11 entries, so reaching the end needs re-anchoring.
  const hostAdapter = faithfulHost(historyBodies(250, 16 * 1024))
  await withService(async (_service, socketPath) => {
    const result = await createDeskLinkClient({ socketPath }).sessionEvents('hosted-1')
    assert.equal(result.ok, true)
    assert.equal(result.truncated, true, 'an earlier window is never presented as complete')
    assert.equal(result.events.some((event) => event.text.startsWith('entry 250 ')), true, 'the newest entry is present')
    assert.equal(result.events.some((event) => event.text.startsWith('entry 1 ')), false, 'the oldest page never displaces the newest window')
  }, { hostAdapter })
})

test('a log whose single entry exceeds one page is bounded, not retried at the same offset', async () => {
  // Control characters escape to six bytes each, so a body inside the host's own limit can still
  // exceed one page's byte bound; the host then answers with the offset it was given.
  const entries = [{ position: 1, events: [{ kind: 'assistant', text: '\u0001'.repeat(40 * 1024) }] }]
  const hostAdapter = faithfulHost(entries)
  let historyCalls = 0
  const request = hostAdapter.request
  hostAdapter.request = (record) => {
    if (record.type === 'history') historyCalls += 1
    return request(record)
  }
  await withService(async (_service, socketPath) => {
    const result = await createDeskLinkClient({ socketPath }).sessionEvents('hosted-1')
    assert.equal(result.ok, true)
    assert.equal(result.truncated, true, 'an entry that cannot be read is reported as truncated')
    assert.equal(historyCalls <= 2, true, 'a page that cannot advance is not retried')
  }, { hostAdapter })
})

test('an oversized control record is refused while the next bounded request still works', async () => {
  await withService(async (service) => {
    const link = await authenticateConsole(service.port)
    link.socket.write(`${JSON.stringify({ v: 2, type: 'list', requestId: 'x'.repeat(1024 * 1024) })}\n`)
    assert.equal((await link.waitFor((record) => record.type === 'error' && record.reason === 'control record too large')).reason, 'control record too large')
    link.send({ v: 2, type: 'list', requestId: 'bounded-list' })
    const reply = await link.waitFor((record) => record.requestId === 'bounded-list')
    assert.equal(reply.result.sessions[0].sessionId, 'hosted-1')
    link.socket.destroy()
  })
})

test('Hosted Pi projects lifecycle and turn outcome onto the existing display status vocabulary', async () => {
  const hostAdapter = fakeHost()
  hostAdapter.request = async () => ({ sessions: [
    { sessionId: 'idle-cancelled', state: 'settled', lifecycle: 'alive', turnOutcome: 'cancelled', project: '/workspace/desk', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' },
    { sessionId: 'restart-interrupted', state: 'interrupted', lifecycle: 'interrupted', turnOutcome: 'interrupted', project: '/workspace/desk', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:01:00.000Z' },
  ] })
  await withService(async (_service, socketPath) => {
    const hosted = await createDeskLinkClient({ socketPath }).hostedSessions()
    assert.deepEqual(hosted.sessions.map(({ sessionId, status, hostedLifecycle, lastTurnOutcome, isAlive }) => ({ sessionId, status, hostedLifecycle, lastTurnOutcome, isAlive })), [
      { sessionId: 'idle-cancelled', status: 'settled', hostedLifecycle: 'live', lastTurnOutcome: 'cancelled', isAlive: true },
      { sessionId: 'restart-interrupted', status: 'exited', hostedLifecycle: 'interrupted', lastTurnOutcome: 'interrupted', isAlive: false },
    ])
    assert.deepEqual(hosted.sessions.map((session) => session.status), ['settled', 'exited'])
  }, { hostAdapter })
})

test('task-host lifecycle values remain separate from terminal turn outcomes', async () => {
  const hostAdapter = fakeHost()
  hostAdapter.request = async () => ({ sessions: [
    { sessionId: 'launching', state: 'running', lifecycle: 'launching', project: '/workspace/desk' },
    { sessionId: 'explicitly-ended', state: 'interrupted', lifecycle: 'ended', turnOutcome: 'interrupted', project: '/workspace/desk' },
  ] })
  await withService(async (_service, socketPath) => {
    const hosted = await createDeskLinkClient({ socketPath }).hostedSessions()
    assert.deepEqual(hosted.sessions.map(({ sessionId, status, hostedLifecycle, isAlive }) => ({ sessionId, status, hostedLifecycle, isAlive })), [
      { sessionId: 'launching', status: 'running', hostedLifecycle: 'launching', isAlive: true },
      { sessionId: 'explicitly-ended', status: 'exited', hostedLifecycle: 'ended', isAlive: false },
    ])
  }, { hostAdapter })
})

test('mutation and attachment identities are required and bound to the held attach', async () => {
  await withService(async (service) => {
    const oneShot = await authenticateConsole(service.port)
    oneShot.send({ v: 2, type: 'launch', requestId: 'launch-missing-mutation', project: '/workspace/desk', prompt: 'Run tests' })
    assert.equal((await oneShot.waitFor((record) => record.requestId === 'launch-missing-mutation')).reason, 'mutation identity required')

    const attached = await authenticateConsole(service.port)
    attached.send({ v: 2, type: 'attach', requestId: 'attach-missing-id', sessionId: 'hosted-1', after: null })
    assert.equal((await attached.waitFor((record) => record.requestId === 'attach-missing-id')).reason, 'attachment identity required')
    oneShot.socket.destroy()
    attached.socket.destroy()
  })
})

test('a host timeout is an explicit correlated error and does not hang the control link', async () => {
  const hostAdapter = { request: () => new Promise(() => {}), attach: () => new Promise(() => {}) }
  await withService(async (service) => {
    const link = await authenticateConsole(service.port)
    link.send({ v: 2, type: 'list', requestId: 'slow-list' })
    const error = await link.waitFor((record) => record.requestId === 'slow-list')
    assert.equal(error.type, 'error')
    assert.equal(error.reason, 'pi host timeout')
    link.socket.destroy()
  }, { hostAdapter, hostRequestTimeoutMs: 30 })
})
