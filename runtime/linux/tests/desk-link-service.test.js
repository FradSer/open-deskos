const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

const {
  createDeskLinkService,
  parseRecords,
  boundedEvent,
  resolveListenHost,
  reportedSession,
  MAX_EVENTS_PER_SESSION,
  MAX_SESSIONS_PER_MACHINE,
} = require('../src/desk-link-service')
const { createDeskLinkClient } = require('../src/desk-link-client')

function tempSocket(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `odk-desk-link-${name}-`))
  return { dir, socketPath: path.join(dir, 'service.sock') }
}

// A Unix socket file outlives its listener, so a restart used to fail with EADDRINUSE: a service that
// could never come back after its first stop, and an activation that restarts it would have
// crash-looped. The stale path is removed when it is a socket this user owns, and anything else at
// that path is refused instead of deleted.
test('a restart over its own socket file succeeds and a stop withdraws the path', async () => {
  const { dir, socketPath } = tempSocket('restart')
  const first = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  await first.start()
  assert.equal(fs.lstatSync(socketPath).isSocket(), true)
  await first.stop()
  assert.equal(fs.existsSync(socketPath), false, 'a stopped service must not leave a runtime channel behind')

  // The same path, twice, with no manual cleanup in between.
  const second = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  await second.start()
  await second.stop()
  const third = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  await third.start()
  try { assert.equal(fs.lstatSync(socketPath).isSocket(), true) } finally { await third.stop() }
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a non-socket at the socket path is refused rather than deleted', async () => {
  const { dir, socketPath } = tempSocket('occupied')
  fs.writeFileSync(socketPath, 'private notes')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  await assert.rejects(service.start(), /exists and is not a socket/)
  assert.equal(fs.readFileSync(socketPath, 'utf8'), 'private notes', 'the file must be left untouched')
  fs.rmSync(dir, { recursive: true, force: true })
})

async function withService(run, options = {}) {
  const { dir, socketPath } = tempSocket('svc')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1', ...options })
  const bound = await service.start()
  service.port = bound.port
  try {
    await run(service, socketPath)
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const jsonl = (record) => `${JSON.stringify(record)}\n`

/**
 * A reporting machine keeps one long-lived link, so the helper does too: closing
 * it is a dropped link, which is a different behaviour under test.
 */
async function openReporter(port, { token = 'tok', machine = 'desk-mac' } = {}) {
  const socket = net.createConnection({ host: '127.0.0.1', port })
  const replies = []
  let buffer = ''
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) replies.push(JSON.parse(line))
  })
  socket.on('error', () => {})
  const waitFor = async (count) => {
    const deadline = Date.now() + 2000
    while (replies.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
    return replies
  }
  return {
    socket,
    replies,
    waitFor,
    send(record) { socket.write(jsonl(record)) },
    async identify(records) {
      socket.write(jsonl({ v: 1, type: 'hello', machine, token }))
      await waitFor(1)
      for (const record of records) socket.write(jsonl(record))
      await new Promise((resolve) => setTimeout(resolve, 80))
    },
    close() { socket.destroy() },
  }
}

/** A one-shot refused connection: it never becomes a Reporting Machine. */
function refusedReporter(port, records) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const replies = []
    let buffer = ''
    const hardStop = setTimeout(() => { socket.destroy(); reject(new Error('refused helper timed out')) }, 3000)
    socket.on('connect', () => { for (const record of records) socket.write(jsonl(record)) })
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) replies.push(JSON.parse(line))
    })
    socket.on('error', reject)
    socket.on('close', () => { clearTimeout(hardStop); resolve(replies) })
  })
}

function runningSession(sessionId = 's1', extra = {}) {
  return {
    sessionId,
    cwd: '/workspace/desk',
    workspaceName: 'desk',
    status: 'running',
    startedAt: 1700000000000,
    updatedAt: 1700000000000,
    ...extra,
  }
}



test('token comparison rejects equal-code-unit unequal-byte Unicode without crashing', () => {
  const { tokenMatches } = require('../src/desk-link-service')
  assert.equal(tokenMatches('é', 'a'), false)
  assert.equal(tokenMatches('é', 'é'), true)
  assert.equal(tokenMatches('\ud800', '\ufffd'), false, 'malformed UTF-16 must not alias its UTF-8 replacement')
})

test('the service refuses an unknown token and registers no machine', async () => {
  await withService(async (service) => {
    const replies = await refusedReporter(service.port, [{ v: 1, type: 'hello', machine: 'mac', token: 'wrong' }])
    assert.deepEqual(replies, [{ v: 1, type: 'error', reason: 'token refused' }])
    assert.deepEqual(service.machines(), [])
    assert.equal(service.snapshot().source.label, 'Desk Link')
  })
})

test('a connection must identify itself before reporting', async () => {
  await withService(async (service, socketPath) => {
    const replies = await refusedReporter(service.port, [{ v: 1, type: 'sessions', machine: 'mac', sessions: [runningSession()] }])
    assert.deepEqual(replies, [{ v: 1, type: 'error', reason: 'hello required' }])
    assert.deepEqual(service.machines(), [])
    assert.equal(socketPath.endsWith('service.sock'), true)
  })
})

test('an accepted reporter becomes a Reporting Machine named as provenance', async () => {
  await withService(async (service) => {
    const link = await openReporter(service.port)
    await link.identify([{ v: 1, type: 'sessions', machine: 'desk-mac', sessions: [runningSession('s1')] }])

    assert.equal(link.replies.length, 1)
    assert.equal(link.replies[0].type, 'ack')
    assert.equal(typeof link.replies[0].at, 'number')
    assert.deepEqual(service.machines(), ['desk-mac'])
    const snapshot = service.snapshot()
    assert.equal(snapshot.source.label, 'Desk Link · desk-mac')
    assert.equal(snapshot.sessions[0].reportedBy, 'desk-mac')
    assert.equal(snapshot.sessions[0].isAlive, true)

    // Closing the link is a dropped link, so the machine goes with it.
    link.close()
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.deepEqual(service.machines(), [])
  })
})

test('parseRecords splits on LF only and tolerates a trailing CR', () => {
  const parsed = parseRecords('{"a":1}\r\n{"b":2}\npartial', '')
  assert.deepEqual(parsed.records, [{ a: 1 }, { b: 2 }])
  assert.equal(parsed.pending, 'partial')
})

test('the service bounds what a reporter may send', () => {
  // The service bounds the body, not the line: a long tool body keeps its
  // lines and is truncated per kind with an explicit flag.
  const long = `${'x'.repeat(5000)}\nsecond line`
  const bounded = boundedEvent({ kind: 'tool', text: long })
  assert.equal(bounded.truncated, true)
  assert.ok(Buffer.byteLength(bounded.text) <= 4 * 1024)
  assert.deepEqual(boundedEvent({ kind: 'tool', text: 'bash: pnpm test\nsecond' }), { kind: 'tool', text: 'bash: pnpm test\nsecond' })
  assert.equal(boundedEvent({ kind: 'nonsense', text: 'value' }), null)
  assert.equal(boundedEvent({ kind: 'tool', text: '   ' }), null)
})

test('a reported session carries the runtime session shape', () => {
  const session = reportedSession(runningSession('s9'), 'desk-mac')
  assert.equal(session.uuid, 's9')
  assert.equal(session.pid, null)
  assert.equal(session.isAlive, true)
  assert.equal(session.status, 'running')
  assert.equal(session.reportedBy, 'desk-mac')
  assert.equal(session.source, 'desk-link')
  assert.deepEqual(session.modifiedFiles, [])
  const settled = reportedSession(runningSession('s10', { status: 'settled' }), 'desk-mac')
  // A settled session is idle at its prompt: the Pi process is still alive.
  assert.equal(settled.isAlive, true)
  assert.equal(reportedSession(runningSession('s11', { status: 'exited' }), 'desk-mac').isAlive, false)
})

test('one session reported by two machines is one session, not two rows', async () => {
  await withService(async (service, socketPath) => {
    const first = await openReporter(service.port, { machine: 'first-mac' })
    const second = await openReporter(service.port, { machine: 'second-mac' })
    await first.identify([{ v: 1, type: 'sessions', machine: 'first-mac', sessions: [runningSession('shared')] }])
    await second.identify([{
      v: 1, type: 'sessions', machine: 'second-mac',
      sessions: [runningSession('shared', { updatedAt: 1700000005000, activity: 'bash: pnpm test' })],
    }])

    const snapshot = service.snapshot()
    assert.equal(snapshot.sessions.length, 1)
    assert.equal(snapshot.summary.total, 1)
    assert.equal(snapshot.summary.running, 1)
    assert.equal(snapshot.summary.workspacesCount, 1)
    // The newest report describes the session; the stale copy does not win.
    assert.equal(snapshot.sessions[0].activity, 'bash: pnpm test')

    const client = createDeskLinkClient({ socketPath })
    assert.equal((await client.snapshot()).sessions.length, 1)
    first.close()
    second.close()
  })
})

test('events are found whichever owner reported them', async () => {
  await withService(async (service, socketPath) => {
    // The first-connecting machine reports the session through inventory only
    // and holds no events; the owning machine holds them.
    const inventory = await openReporter(service.port, { machine: 'a-inventory' })
    await inventory.identify([{ v: 1, type: 'sessions', machine: 'a-inventory', sessions: [runningSession('shared')] }])
    const owner = await openReporter(service.port, { machine: 'z-owner' })
    await owner.identify([
      { v: 1, type: 'sessions', machine: 'z-owner', sessions: [runningSession('shared')] },
      { v: 1, type: 'events', machine: 'z-owner', sessionId: 'shared', events: [{ kind: 'tool', text: 'bash: pnpm test' }] },
    ])

    const client = createDeskLinkClient({ socketPath })
    const events = await client.sessionEvents('shared')
    assert.equal(events.ok, true)
    assert.deepEqual(events.events, [{ kind: 'tool', text: 'bash: pnpm test' }])
    // A session nobody has reported still reads as unknown, not as empty.
    assert.equal((await client.sessionEvents('unknown')).reason, 'session-log-missing')
    inventory.close()
    owner.close()
  })
})

test('the default bind address is never every interface', () => {
  assert.notEqual(resolveListenHost({}), '0.0.0.0')
  assert.equal(resolveListenHost({ ODK_DESK_LINK_BIND: '192.168.1.10' }), '192.168.1.10')
  assert.equal(MAX_EVENTS_PER_SESSION, 300)
})

test('the runtime reads a fresh snapshot over its own socket', async () => {
  const { dir, socketPath } = tempSocket('snap')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  const bound = await service.start()
  try {
    const link = await openReporter(bound.port)
    await link.identify([
      { v: 1, type: 'sessions', machine: 'desk-mac', sessions: [runningSession('s1'), runningSession('s2', { status: 'settled' })] },
      { v: 1, type: 'events', machine: 'desk-mac', sessionId: 's1', events: [{ kind: 'tool', text: 'bash: pnpm test' }] },
    ])
    const client = createDeskLinkClient({ socketPath })
    const snapshot = await client.snapshot()
    assert.equal(snapshot.ok, true)
    assert.equal(snapshot.source.kind, 'desk-link')
    assert.equal(snapshot.source.label, 'Desk Link · desk-mac')
    assert.equal(snapshot.summary.total, 2)
    assert.equal(snapshot.summary.running, 1)
    assert.equal(snapshot.summary.settled, 1)
    assert.equal(snapshot.summary.workspacesCount, 1)
    assert.ok(Math.abs(Date.now() - snapshot.scannedAt) < 2000, 'a snapshot reports its own fresh scan time')
    assert.equal(snapshot.sessions.every((session) => session.reportedBy === 'desk-mac'), true)

    const events = await client.sessionEvents('s1')
    assert.deepEqual(events.events, [{ kind: 'tool', text: 'bash: pnpm test' }])
    assert.equal((await client.sessionEvents('nope')).ok, false)
    link.close()
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('an oversized complete record is discarded and the next bounded record survives', () => {
  const oversized = jsonl({ v: 1, type: 'sessions', sessions: [], padding: '中'.repeat(400000) })
  const valid = { v: 1, type: 'sessions', sessions: [runningSession('next')] }
  const parsed = parseRecords(oversized + jsonl(valid), '')
  assert.deepEqual(parsed.records, [valid])
  assert.equal(parsed.pending, '')
})

test('fragmented oversized reporter frames cannot smuggle a trailing record', async () => {
  await withService(async service => {
    const reporter = await openReporter(service.port)
    await reporter.identify([])
    const bogus = jsonl({ v: 1, type: 'sessions', sessions: [runningSession('smuggled')] })
    reporter.socket.write('x'.repeat(1024 * 1024 + 1))
    await new Promise(resolve => setTimeout(resolve, 25))
    reporter.socket.write(bogus)
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(service.snapshot().sessions.length, 0)
    reporter.send({ v: 1, type: 'sessions', sessions: [runningSession('valid')] })
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.deepEqual(service.snapshot().sessions.map(session => session.sessionId), ['valid'])
    reporter.close()
  })
})

test('reporter CJK workspace and goal survive split UTF-8 chunks', async () => {
  await withService(async service => {
    const reporter = await openReporter(service.port)
    await reporter.identify([])
    const text = '示例工作区'
    const payload = Buffer.from(jsonl({ v: 1, type: 'sessions', sessions: [runningSession('cjk', { cwd: `/example/${text}`, workspaceName: text, latestGoal: text })] }))
    const split = payload.indexOf(Buffer.from('示')) + 1
    reporter.socket.write(payload.subarray(0, split))
    await new Promise(resolve => setTimeout(resolve, 20))
    reporter.socket.write(payload.subarray(split))
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(service.snapshot().sessions[0].cwd, `/example/${text}`)
    reporter.close()
  })
})

test('runtime client preserves a 64-session snapshot fragmented beyond 64 KiB', async () => {
  const { dir, socketPath } = tempSocket('large-reply')
  const expected = {
    ok: true,
    sessions: Array.from({ length: 64 }, (_, index) => ({ sessionId: `session-${index}`, status: 'running', latestGoal: '示例完整会话目标'.repeat(25), activity: '示例工具事件概要'.repeat(25), cwd: '/example/' + 'workspace/'.repeat(19) })),
    workspaces: [],
  }
  // More than 64 KiB of decoded text is legitimate when sessions/workspaces
  // are included; split inside a CJK UTF-8 sequence as real sockets may do.
  expected.workspaces = [{ sessions: expected.sessions }]
  const response = Buffer.from(`${JSON.stringify(expected)}\n`)
  assert.ok(response.length > 128 * 1024)
  const server = net.createServer(socket => {
    socket.once('data', async () => {
      for (let offset = 0; offset < response.length; offset += 20003) {
        socket.write(response.subarray(offset, offset + 20003))
        await new Promise(resolve => setTimeout(resolve, 2))
      }
      socket.end()
    })
  })
  await new Promise(resolve => server.listen(socketPath, resolve))
  try {
    const snapshot = await createDeskLinkClient({ socketPath }).snapshot()
    assert.equal(snapshot.ok, true)
    assert.deepEqual(snapshot.sessions, expected.sessions)
  } finally {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runtime client rejects an oversized response', async () => {
  const { dir, socketPath } = tempSocket('oversized-reply')
  const server = net.createServer(socket => {
    socket.on('error', () => {})
    socket.once('data', () => socket.end(JSON.stringify({ ok: true, sessions: [], padding: 'x'.repeat(2 * 1024 * 1024) }) + '\n'))
  })
  await new Promise(resolve => server.listen(socketPath, resolve))
  try {
    const snapshot = await createDeskLinkClient({ socketPath }).snapshot()
    assert.equal(snapshot.ok, false)
  } finally {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('an unavailable Desk Link is never an empty successful scan', async () => {
  const client = createDeskLinkClient({ socketPath: path.join(os.tmpdir(), 'odk-desk-link-absent', 'service.sock') })
  const snapshot = await client.snapshot()
  assert.equal(snapshot.ok, false)
  assert.equal(snapshot.size === undefined, true)
  assert.equal(snapshot.summary, null)
  assert.deepEqual(snapshot.sessions, [])

  const unconfigured = createDeskLinkClient({ env: {} })
  assert.equal((await unconfigured.snapshot()).reason, 'desk-link-unconfigured')
  assert.throws(() => createDeskLinkClient({ env: { ODESK_SHELL_TEST_MODE: '1', ODESK_DESK_LINK_SOCKET: 'relative.sock' } }), /absolute/)
})

test('a dropped link makes its sessions unavailable and two machines stay separate', async () => {
  const { dir, socketPath } = tempSocket('lifecycle')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  const bound = await service.start()
  try {
    const first = net.createConnection({ host: '127.0.0.1', port: bound.port })
    await new Promise((resolve) => first.on('connect', resolve))
    first.write(`${JSON.stringify({ v: 1, type: 'hello', machine: 'mac-a', token: 'tok' })}\n`)
    first.write(`${JSON.stringify({ v: 1, type: 'sessions', machine: 'mac-a', sessions: [runningSession('a1')] })}\n`)
    const second = net.createConnection({ host: '127.0.0.1', port: bound.port })
    await new Promise((resolve) => second.on('connect', resolve))
    second.write(`${JSON.stringify({ v: 1, type: 'hello', machine: 'mac-b', token: 'tok' })}\n`)
    second.write(`${JSON.stringify({ v: 1, type: 'sessions', machine: 'mac-b', sessions: [runningSession('b1')] })}\n`)
    await new Promise((resolve) => setTimeout(resolve, 120))

    assert.deepEqual(service.machines().sort(), ['mac-a', 'mac-b'])
    const both = service.snapshot()
    assert.equal(both.summary.total, 2)
    assert.deepEqual([...new Set(both.sessions.map((session) => session.reportedBy))].sort(), ['mac-a', 'mac-b'])

    // A reporter's session set is replaced, not merged.
    first.write(`${JSON.stringify({ v: 1, type: 'sessions', machine: 'mac-a', sessions: [runningSession('a2')] })}\n`)
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.deepEqual(service.snapshot().sessions.map((session) => session.sessionId).sort(), ['a2', 'b1'])

    // A dropped link takes its machine's sessions with it.
    second.destroy()
    await new Promise((resolve) => setTimeout(resolve, 120))
    assert.deepEqual(service.machines(), ['mac-a'])
    assert.deepEqual(service.snapshot().sessions.map((session) => session.sessionId), ['a2'])
    assert.equal(service.snapshot().source.label, 'Desk Link · mac-a')
    first.destroy()
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the service keeps a reporter within the event bound', async () => {
  const { dir, socketPath } = tempSocket('bounds')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  const bound = await service.start()
  try {
    const link = await openReporter(bound.port, { machine: 'mac' })
    await link.identify([
      { v: 1, type: 'sessions', machine: 'mac', sessions: [runningSession('s1')] },
      { v: 1, type: 'events', machine: 'mac', sessionId: 's1', events: Array.from({ length: 200 }, (_, index) => ({ kind: 'tool', text: `step ${index}` })) },
      { v: 1, type: 'events', machine: 'mac', sessionId: 's1', events: [{ kind: 'result', text: `line one\n${'z'.repeat(500)}` }] },
    ])
    const events = service.eventsForSession('s1')
    assert.equal(events.ok, true)
    // 201 bodies fit both the 300-event and the 1 MiB budget, so nothing is
    // dropped and no line is flattened.
    assert.equal(events.events.length, 201)
    assert.ok(events.events.length < MAX_EVENTS_PER_SESSION)
    assert.equal(events.events[0].text, 'step 0')
    assert.equal(events.events.at(-1).text, `line one\n${'z'.repeat(500)}`)
    link.close()
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a machine survives while another of its links is still open', async () => {
  const { dir, socketPath } = tempSocket('multi')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  const bound = await service.start()
  try {
    // One machine may run several Pi processes, and they share its identity.
    const first = await openReporter(bound.port, { machine: 'desk-mac' })
    await first.identify([{ v: 1, type: 'sessions', machine: 'desk-mac', sessions: [runningSession('a1')] }])
    const second = await openReporter(bound.port, { machine: 'desk-mac' })
    await second.identify([{ v: 1, type: 'sessions', machine: 'desk-mac', sessions: [runningSession('a1'), runningSession('a2')] }])

    first.close()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.deepEqual(service.machines(), ['desk-mac'], 'one closed link must not erase a machine that is still linked')
    assert.deepEqual(service.snapshot().sessions.map((session) => session.sessionId).sort(), ['a1', 'a2'])

    second.close()
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.deepEqual(service.machines(), [], 'the last closed link takes the machine with it')
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('independent reporters on one machine preserve working and settled sessions and events', async () => {
  await withService(async (service, socketPath) => {
    const first = await openReporter(service.port, { machine: 'same-machine' })
    const second = await openReporter(service.port, { machine: 'same-machine' })
    await first.identify([
      { v: 1, type: 'sessions', sessions: [runningSession('working')] },
      { v: 1, type: 'events', sessionId: 'working', events: [{ kind: 'tool', text: 'read: example.js' }] },
    ])
    await second.identify([
      { v: 1, type: 'sessions', sessions: [runningSession('settled', { status: 'settled' })] },
      { v: 1, type: 'events', sessionId: 'settled', events: [{ kind: 'assistant', text: 'Example settled response' }] },
    ])
    const client = createDeskLinkClient({ socketPath })
    const initial = await client.snapshot()
    assert.deepEqual(initial.sessions.map(session => session.sessionId).sort(), ['settled', 'working'])
    assert.equal(initial.summary.running, 1)
    assert.equal(initial.summary.settled, 1)
    assert.equal((await client.sessionEvents('working')).events[0].text, 'read: example.js')
    first.send({ v: 1, type: 'sessions', sessions: [runningSession('working', { latestGoal: 'Updated example' })] })
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal((await client.snapshot()).summary.total, 2)
    assert.equal((await client.sessionEvents('settled')).events[0].text, 'Example settled response')
    first.send({ v: 1, type: 'sessions', sessions: [] })
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.deepEqual((await client.snapshot()).sessions.map(session => session.sessionId), ['settled'])
    first.close()
    second.close()
  })
})

test('dropping one independent reporter removes only its sessions', async () => {
  await withService(async (service) => {
    const first = await openReporter(service.port, { machine: 'same-machine' })
    const second = await openReporter(service.port, { machine: 'same-machine' })
    await first.identify([{ v: 1, type: 'sessions', sessions: [runningSession('first')] }])
    await second.identify([{ v: 1, type: 'sessions', sessions: [runningSession('second')] }])
    first.send({ v: 1, type: 'sessions', sessions: [runningSession('first')] })
    await new Promise(resolve => setTimeout(resolve, 80))
    first.close()
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.deepEqual(service.snapshot().sessions.map(session => session.sessionId), ['second'])
    assert.deepEqual(service.machines(), ['same-machine'])
    second.close()
  })
})

test('direct live reports remain authoritative over newer discovered metadata', async () => {
  await withService(async service => {
    const owner = await openReporter(service.port, { machine: 'same-machine' })
    const observer = await openReporter(service.port, { machine: 'same-machine' })
    await owner.identify([{ v: 1, type: 'sessions', sessions: [runningSession('shared', { updatedAt: 100, latestGoal: 'Direct goal' })] }])
    await observer.identify([{ v: 1, type: 'sessions', sessions: [runningSession('shared', { discovered: true, updatedAt: 200, status: 'settled' })] }])
    assert.equal(service.snapshot().sessions[0].status, 'running')
    assert.equal(service.snapshot().sessions[0].latestGoal, 'Direct goal')
    owner.send({ v: 1, type: 'sessions', sessions: [runningSession('shared', { updatedAt: 150, status: 'exited' })] })
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(service.snapshot().sessions[0].status, 'settled')
    owner.close()
    observer.close()
  })
})

test('equal timestamp duplicate reports follow receipt order', async () => {
  await withService(async (service) => {
    const first = await openReporter(service.port, { machine: 'same-machine' })
    const second = await openReporter(service.port, { machine: 'same-machine' })
    await first.identify([{ v: 1, type: 'sessions', sessions: [runningSession('shared')] }])
    await second.identify([{ v: 1, type: 'sessions', sessions: [runningSession('shared', { status: 'settled' })] }])
    first.send({ v: 1, type: 'sessions', sessions: [runningSession('shared', { status: 'running' })] })
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(service.snapshot().sessions[0].status, 'running')
    first.close()
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(service.snapshot().sessions[0].status, 'settled')
    second.close()
  })
})

test('duplicate reports with non-numeric timestamps do not crash the service', async () => {
  await withService(async (service) => {
    const first = await openReporter(service.port, { machine: 'same-machine' })
    const second = await openReporter(service.port, { machine: 'same-machine' })
    await first.identify([{ v: 1, type: 'sessions', sessions: [runningSession('shared')] }])
    await second.identify([{ v: 1, type: 'sessions', sessions: [runningSession('shared', {
      updatedAt: { valueOf: null, toString: null }, startedAt: null, status: 'exited',
    })] }])
    assert.equal(service.snapshot().sessions[0].status, 'running')
    second.close()
    first.close()
  })
})

test('stopping resolves while a long-lived link is open', async () => {
  const { dir, socketPath } = tempSocket('stop')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  const bound = await service.start()
  const link = await openReporter(bound.port)
  await link.identify([{ v: 1, type: 'sessions', machine: 'desk-mac', sessions: [runningSession('s1')] }])
  assert.deepEqual(service.machines(), ['desk-mac'])

  const stopped = await Promise.race([
    service.stop().then(() => 'stopped'),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 1500)),
  ])
  assert.equal(stopped, 'stopped', 'a signal must not hang while a Desk Link is open')
  assert.deepEqual(service.machines(), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the service bounds a machine session set', async () => {
  const { dir, socketPath } = tempSocket('sessions')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  const bound = await service.start()
  try {
    const link = await openReporter(bound.port)
    const sessions = Array.from({ length: 90 }, (_, index) => runningSession(`s${index}`, { status: index === 89 ? 'running' : 'settled', updatedAt: index }))
    await link.identify([{ v: 1, type: 'sessions', machine: 'desk-mac', sessions }])
    const snapshot = service.snapshot()
    assert.equal(snapshot.summary.total, MAX_SESSIONS_PER_MACHINE)
    assert.equal(snapshot.sessions.some((session) => session.sessionId === 's89'), true, 'the newest session survives')
    link.close()
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the runtime socket lives in an owner-only directory', async () => {
  const { dir, socketPath } = tempSocket('mode')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  await service.start()
  try {
    const directory = fs.statSync(path.dirname(socketPath))
    const socket = fs.statSync(socketPath)
    assert.equal(directory.mode & 0o777, 0o700, 'the runtime channel is authenticated by ownership, so its directory is private')
    assert.equal(socket.mode & 0o777, 0o600)
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a session the Desk Link knows keeps its own reason instead of the local fallback', async () => {
  const { dir, socketPath } = tempSocket('reason')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1' })
  const bound = await service.start()
  try {
    const link = await openReporter(bound.port)
    await link.identify([{ v: 1, type: 'sessions', machine: 'desk-mac', sessions: [runningSession('known-1')] }])
    const client = createDeskLinkClient({ socketPath })

    const known = await client.sessionEvents('known-1')
    assert.equal(known.ok, false)
    assert.equal(known.reason, 'no-reported-events', 'a reported session without events is not a missing local log')

    const unknown = await client.sessionEvents('not-a-session')
    assert.equal(unknown.reason, 'session-log-missing', 'an unknown session falls back to local reading')

    link.close()
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the service refuses a socket directory it does not own', async () => {
  // A shared directory must never be chmodded to 0700 by this service: doing so
  // silently locks a directory the service does not own.
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-shared-'))
  fs.chmodSync(shared, 0o777)
  const service = createDeskLinkService({ token: 'tok', socketPath: path.join(shared, 'service.sock'), port: 0, host: '127.0.0.1' })
  await assert.rejects(() => service.start(), /group- or world-accessible/)
  assert.equal(fs.statSync(shared).mode & 0o777, 0o777, 'a directory the service does not own keeps its mode')
  fs.rmSync(shared, { recursive: true, force: true })
})

test('the service drops peers that never authenticate', async () => {
  const { dir, socketPath } = tempSocket('auth')
  const service = createDeskLinkService({ token: 'tok', socketPath, port: 0, host: '127.0.0.1', authTimeoutMs: 150 })
  const bound = await service.start()
  try {
    const silent = net.createConnection({ host: '127.0.0.1', port: bound.port })
    await new Promise((resolve) => silent.on('connect', resolve))
    silent.write('{"v":1,"type":"hello"}\n')
    await new Promise((resolve) => setTimeout(resolve, 600))
    assert.equal(service.connections(), 0, 'an unauthenticated peer cannot hold a connection')
    assert.deepEqual(service.machines(), [])
  } finally {
    await service.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
