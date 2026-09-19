const net = require('node:net')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const { timingSafeEqual, createHmac, randomBytes } = require('node:crypto')
const { StringDecoder } = require('node:string_decoder')
const { boundedEvent, retainEvents, MAX_EVENTS, MAX_SESSION_EVENT_BYTES } = require('./pi-session-events')

// The service bounds reported data itself: a reporting machine is never trusted
// to have bounded its own events. Its bounds are the shared ones, so a reporter
// and the service can never disagree about what fits.
const MAX_EVENTS_PER_SESSION = MAX_EVENTS
const MAX_SESSIONS_PER_MACHINE = 64
/** A peer that has not authenticated within this window is dropped. */
const AUTH_TIMEOUT_MS = 10000
/** Unauthenticated peers may not accumulate. */
const MAX_CONNECTIONS = 64
const MAX_EVENT_TEXT = 200
const MAX_RECORD_BYTES = 1024 * 1024
const SESSION_STATUSES = new Set(['running', 'settled', 'exited'])
const HOSTED_PI_STATUSES = new Set(['pending', 'running', 'settled', 'finished', 'failed', 'cancelled', 'interrupted'])
const HOSTED_PI_TURN_OUTCOMES = new Set(['finished', 'failed', 'cancelled', 'interrupted'])
const DESK_LINK_PROTOCOL = 1
const DESK_LINK_CONTROL_PROTOCOL = 2
const ACCEPTED_CONTROL_PROTOCOLS = [DESK_LINK_CONTROL_PROTOCOL]
const CONTROL_DOMAIN = 'open-deskos-control-v2'
const CONTROL_NONCE_BYTES = 32
const CONTROL_ID_MAX_BYTES = 256
const CONTROL_PROMPT_MAX_BYTES = 64 * 1024
const HOST_REQUEST_TIMEOUT_MS = 5000
const MAX_RUNTIME_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_SOCKET_WRITE_BYTES = 2 * 1024 * 1024
/** The reason a Desk Link reports when it does not know a session at all; the
 *  events endpoint falls back to local log reading only for this one. */
const SESSION_LOG_MISSING = 'session-log-missing'

function encodeJsonLine(record) {
  return `${JSON.stringify(record)}\n`
}

/** Split records on LF only, tolerating a trailing CR. */
function parseRecords(chunk, remainder) {
  const text = `${remainder}${chunk}`
  const lines = text.split('\n')
  const pending = lines.pop() ?? ''
  const records = []
  for (const line of lines) {
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
    if (trimmed.length === 0 || Buffer.byteLength(trimmed) > MAX_RECORD_BYTES) continue
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      /* a malformed record never breaks a link */
    }
  }
  return { records, pending }
}

function recordReader(onOversize = () => {}) {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let dropping = false
  return (chunk) => {
    let text = decoder.write(chunk)
    if (dropping) {
      const newline = text.indexOf('\n')
      if (newline === -1) return []
      text = text.slice(newline + 1)
      dropping = false
    }
    const lines = `${pending}${text}`.split('\n')
    pending = lines.pop() ?? ''
    const records = []
    for (const raw of lines) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (line.length === 0) continue
      if (Buffer.byteLength(line) > MAX_RECORD_BYTES) {
        onOversize()
        continue
      }
      try { records.push(JSON.parse(line)) } catch { /* malformed records are isolated */ }
    }
    if (Buffer.byteLength(pending) > MAX_RECORD_BYTES) {
      pending = ''
      dropping = true
      onOversize()
    }
    return records
  }
}

function boundedText(value, max = MAX_EVENT_TEXT) {
  if (typeof value !== 'string') return ''
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length === 0) continue
    return line.length > max ? `${line.slice(0, max - 1)}…` : line
  }
  return ''
}
/** A session as the runtime's Pi source expects to read it. */
function reportedSession(session, machine) {
  const status = SESSION_STATUSES.has(session.status) ? session.status : 'running'
  return {
    sessionId: String(session.sessionId),
    uuid: String(session.sessionId),
    pid: null,
    // A settled session is idle at its prompt, not a dead process: only an
    // exited report means the Pi process that owned it is gone.
    isAlive: status !== 'exited',
    status,
    cwd: typeof session.cwd === 'string' ? session.cwd : '',
    workspaceName: typeof session.workspaceName === 'string' && session.workspaceName.length > 0
      ? session.workspaceName
      : 'Unknown',
    startedAt: Number.isFinite(session.startedAt) ? session.startedAt : 0,
    updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : 0,
    latestGoal: typeof session.latestGoal === 'string' ? session.latestGoal : '',
    activity: typeof session.activity === 'string' ? session.activity : '',
    modifiedFiles: [],
    source: 'desk-link',
    reportedBy: machine,
  }
}

function tokenMatches(expected, presented) {
  if (typeof expected !== 'string' || typeof presented !== 'string') return false
  // Buffer UTF-8 encoding replaces lone surrogates with U+FFFD. Reject
  // malformed UTF-16 first so two distinct secrets cannot alias after encoding.
  try {
    new TextEncoder().encodeInto(expected, new Uint8Array(Buffer.byteLength(expected) + 4))
    new TextEncoder().encodeInto(presented, new Uint8Array(Buffer.byteLength(presented) + 4))
    if (Buffer.from(expected, 'utf8').toString('utf8') !== expected || Buffer.from(presented, 'utf8').toString('utf8') !== presented) return false
  } catch { return false }
  const expectedBytes = Buffer.from(expected, 'utf8')
  const presentedBytes = Buffer.from(presented, 'utf8')
  if (expectedBytes.length !== presentedBytes.length) return false
  return timingSafeEqual(expectedBytes, presentedBytes)
}

function boundedIdentity(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= CONTROL_ID_MAX_BYTES && !/[\r\n\0]/.test(value)
}

function boundedPath(value) {
  return typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096 && !/[\r\n\0]/.test(value)
}

function boundedUtf8(value, maxBytes) {
  if (typeof value !== 'string') return ''
  const bytes = Buffer.from(value)
  if (bytes.length <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

function controlTranscript({ machine, sessionId, nonce }) {
  return `${CONTROL_DOMAIN}\n${DESK_LINK_CONTROL_PROTOCOL}\n${nonce}\n${machine}\n${sessionId}`
}

function controlProof(credential, transcript) {
  return createHmac('sha256', credential).update(controlTranscript(transcript)).digest('hex')
}

function proofMatches(credential, transcript, proof) {
  if (typeof credential !== 'string' || credential.length === 0 || typeof proof !== 'string') return false
  const expected = controlProof(credential, transcript)
  return tokenMatches(expected, proof)
}

function safeWrite(socket, record, maxRecordBytes = MAX_RECORD_BYTES) {
  if (socket.destroyed || !socket.writable) return false
  const line = encodeJsonLine(record)
  const bytes = Buffer.byteLength(line)
  if (bytes > maxRecordBytes || socket.writableLength + bytes > MAX_SOCKET_WRITE_BYTES) {
    socket.destroy()
    return false
  }
  return socket.write(line)
}

function withTimeout(operation, timeoutMs, reason = 'pi host timeout') {
  let timer
  return Promise.race([
    Promise.resolve().then(operation),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(reason)), timeoutMs) }),
  ]).finally(() => clearTimeout(timer))
}

function normalizeHostedSession(session, attribution) {
  if (!session || typeof session !== 'object' || !boundedIdentity(String(session.sessionId ?? ''))) return null
  const sessionId = String(session.sessionId)
  const rawLifecycle = session.lifecycle
  const rawStatus = session.status ?? session.state
  const hostedStatus = HOSTED_PI_STATUSES.has(rawStatus) ? rawStatus : 'interrupted'
  const hostedLifecycle = rawLifecycle === 'launching'
    ? 'launching'
    : rawLifecycle === 'live' || rawLifecycle === 'alive'
      ? (hostedStatus === 'pending' ? 'launching' : 'live')
      : rawLifecycle === 'ended'
        ? 'ended'
        : rawLifecycle === 'interrupted'
          ? 'interrupted'
          : ['pending', 'running', 'settled'].includes(hostedStatus)
            ? (hostedStatus === 'pending' ? 'launching' : 'live')
            : hostedStatus === 'interrupted'
              ? 'interrupted'
              : 'ended'
  const live = hostedLifecycle === 'launching' || hostedLifecycle === 'live'
  const status = !live ? 'exited' : hostedStatus === 'settled' ? 'settled' : 'running'
  const cwd = typeof session.project === 'string' ? session.project : typeof session.cwd === 'string' ? session.cwd : ''
  return {
    sessionId,
    uuid: sessionId,
    pid: null,
    isAlive: live,
    status,
    hostedLifecycle,
    ...(HOSTED_PI_TURN_OUTCOMES.has(session.turnOutcome) ? { lastTurnOutcome: session.turnOutcome } : {}),
    cwd,
    workspaceName: typeof session.workspaceName === 'string' && session.workspaceName ? session.workspaceName : path.basename(cwd) || 'Unknown',
    startedAt: Number.isFinite(session.startedAt) ? session.startedAt : 0,
    updatedAt: Number.isFinite(session.updatedAt) ? session.updatedAt : Number.isFinite(session.startedAt) ? session.startedAt : 0,
    latestGoal: boundedUtf8(typeof session.goal === 'string' ? session.goal : session.latestGoal, 8 * 1024),
    activity: boundedUtf8(session.activity, 4 * 1024),
    modifiedFiles: [],
    source: 'hosted-pi',
    hostedPi: true,
    ...(attribution ? { controlAttribution: attribution } : {}),
  }
}

/** The first non-internal IPv4 address, so the listener never binds every interface. */
function localAddress() {
  const interfaces = os.networkInterfaces()
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return '127.0.0.1'
}

function resolveListenHost(env = process.env) {
  const configured = (env.ODK_DESK_LINK_BIND ?? '').trim()
  return configured.length > 0 ? configured : localAddress()
}

function reportTime(session) {
  if (Number.isFinite(session.updatedAt)) return session.updatedAt
  return Number.isFinite(session.startedAt) ? session.startedAt : 0
}

function latestReport(reports) {
  // In-process state wins over inventory copies while its owner is alive.
  // An exited direct report may yield to a newer discovered/resumed session.
  const values = [...reports.values()]
  const direct = values.filter(report => report.discovered !== true && ['running', 'settled'].includes(report.status))
  const candidates = direct.length > 0 ? direct : values
  // Map order is receipt order; equal timestamps prefer the latest receipt.
  return candidates.reduce((latest, candidate) => reportTime(candidate) >= reportTime(latest) ? candidate : latest)
}

function createDeskLinkService({
  token, controlCredential = '', socketPath, port = 8765, host, env = process.env,
  now = () => Date.now(), authTimeoutMs = AUTH_TIMEOUT_MS, hostAdapter = null,
  hostRequestTimeoutMs = HOST_REQUEST_TIMEOUT_MS,
} = {}) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('a Desk Link Service requires a token')
  if (typeof controlCredential !== 'string') throw new Error('the Control Credential must be a string')
  if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath)) {
    throw new Error('a Desk Link Service requires an absolute Unix socket path')
  }
  const listenHost = host ?? resolveListenHost(env)
  let connections = 0
  const machines = new Map()
  const controlAttributions = new Map()
  const pendingControlAttachments = new Map()
  const openSockets = new Set()
  const server = net.createServer()
  const socketServer = net.createServer()
  let started = false

  function track(socket) {
    openSockets.add(socket)
    connections += 1
    socket.on('close', () => {
      openSockets.delete(socket)
      connections -= 1
    })
    return socket
  }

  function machineState(machine) {
    let state = machines.get(machine)
    if (!state) {
      state = { machine, sessions: new Map(), links: new Map(), connectedAt: now(), lastSeenAt: now() }
      machines.set(machine, state)
    }
    return state
  }

  /** Bound the machine's session set, dropping a finished session first. */
  function boundSessions(state) {
    while (state.sessions.size > MAX_SESSIONS_PER_MACHINE) {
      let victimId = null
      let victimAt = Number.POSITIVE_INFINITY
      let fallbackId = null
      let fallbackAt = Number.POSITIVE_INFINITY
      for (const [id, entry] of state.sessions) {
        const at = reportTime(entry.session)
        if (entry.session.status !== 'running' && at < victimAt) {
          victimAt = at
          victimId = id
        }
        if (at < fallbackAt) {
          fallbackAt = at
          fallbackId = id
        }
      }
      const target = victimId ?? fallbackId
      if (target === null) return
      state.sessions.delete(target)
      for (const owned of state.links.values()) owned.delete(target)
    }
  }

  function forgetReport(state, socket, id) {
    const entry = state.sessions.get(id)
    if (!entry) return
    entry.reports.delete(socket)
    if (entry.reports.size === 0) {
      state.sessions.delete(id)
    } else {
      entry.session = latestReport(entry.reports)
    }
  }

  function applySessions(state, socket, sessions) {
    if (!Array.isArray(sessions)) return
    const seen = new Set()
    for (const session of sessions) {
      if (!session || typeof session !== 'object') continue
      const id = typeof session.sessionId === 'string' || typeof session.sessionId === 'number' ? String(session.sessionId) : ''
      if (id.length === 0) continue
      seen.add(id)
      const existing = state.sessions.get(id)
      const report = { ...session, sessionId: id }
      const entry = existing ?? { session: report, events: [], reports: new Map() }
      entry.reports.delete(socket)
      entry.reports.set(socket, report)
      entry.session = latestReport(entry.reports)
      state.sessions.set(id, entry)
    }
    // A Pi process reports its own set, not every process on the machine.
    // Replacement and disconnect are scoped to this authenticated connection.
    for (const id of state.links.get(socket) || []) {
      if (!seen.has(id)) forgetReport(state, socket, id)
    }
    state.links.set(socket, seen)
    boundSessions(state)
  }

  function applyEvents(state, socket, sessionId, events) {
    const entry = state.sessions.get(sessionId)
    if (!entry?.reports.has(socket) || !Array.isArray(events)) return
    const bounded = events.map(boundedEvent).filter(Boolean)
    if (bounded.length === 0) return
    entry.events = retainEvents([...entry.events, ...bounded])
  }

  function explicitVersionMismatch(socket, received) {
    safeWrite(socket, { v: DESK_LINK_CONTROL_PROTOCOL, type: 'version-mismatch', received, accepted: ACCEPTED_CONTROL_PROTOCOLS })
    socket.end()
  }

  function controlError(socket, requestId, reason) {
    safeWrite(socket, {
      v: DESK_LINK_CONTROL_PROTOCOL,
      type: 'error',
      ...(boundedIdentity(requestId) ? { requestId } : {}),
      reason,
    })
  }

  async function hostRequest(record) {
    if (!hostAdapter || typeof hostAdapter.request !== 'function') throw new Error('pi host unavailable')
    return withTimeout(() => hostAdapter.request(record), hostRequestTimeoutMs)
  }

  async function hostAttach(record, handlers) {
    if (!hostAdapter || typeof hostAdapter.attach !== 'function') throw new Error('pi host unavailable')
    return withTimeout(() => hostAdapter.attach(record, handlers), hostRequestTimeoutMs)
  }

  function validateControlRequest(record, attachment) {
    if (!record || record.v !== DESK_LINK_CONTROL_PROTOCOL || !boundedIdentity(record.requestId)) return 'invalid control request'
    if (!['list', 'launch', 'history', 'attach', 'prompt', 'cancel', 'end'].includes(record.type)) return 'unknown control request'
    if (['history', 'attach', 'prompt', 'cancel', 'end'].includes(record.type) && !boundedIdentity(record.sessionId)) return 'session identity required'
    if (['launch', 'prompt', 'cancel', 'end'].includes(record.type) && !boundedIdentity(record.mutationId)) return 'mutation identity required'
    if (record.type === 'attach' && !boundedIdentity(record.attachmentId)) return 'attachment identity required'
    if (record.type === 'launch') {
      if (!boundedIdentity(record.sessionId) || !boundedPath(record.project) || typeof record.prompt !== 'string' || record.prompt.trim().length === 0 || Buffer.byteLength(record.prompt) > CONTROL_PROMPT_MAX_BYTES) return 'invalid launch request'
    }
    if (record.type === 'prompt' && (typeof record.prompt !== 'string' || record.prompt.trim().length === 0 || Buffer.byteLength(record.prompt) > CONTROL_PROMPT_MAX_BYTES)) return 'invalid prompt'
    if (record.type === 'history' || record.type === 'attach') {
      if (record.after !== undefined && record.after !== null && (!Number.isSafeInteger(record.after) || record.after < 0)) return 'invalid position'
      if (record.limit !== undefined && (!Number.isSafeInteger(record.limit) || record.limit < 1 || record.limit > 100)) return 'invalid history limit'
      if (record.through !== undefined && (!Number.isSafeInteger(record.through) || record.through < 0 || (Number.isSafeInteger(record.after) && record.through < record.after))) return 'invalid history boundary'
    }
    if (attachment && record.sessionId && record.sessionId !== attachment.sessionId) return 'attached session mismatch'
    if (attachment && ['prompt', 'cancel', 'end'].includes(record.type) && record.attachmentId !== attachment.attachmentId) return 'attachment identity mismatch'
    return ''
  }

  function attachControl(socket, hello, initialBytes = null) {
    const readRecords = recordReader(() => controlError(socket, undefined, 'control record too large'))
    const identity = { machine: hello.machine, sessionId: hello.sessionId }
    const nonce = randomBytes(CONTROL_NONCE_BYTES).toString('hex')
    let authenticated = false
    let attachment = null
    let hostConnection = null
    let processing = Promise.resolve()
    let closed = false
    let pendingAttachment = null
    let oneShotAccepted = false
    socket.setTimeout(authTimeoutMs, () => { if (!authenticated) socket.destroy() })

    const clearAttribution = () => {
      if (pendingAttachment && pendingControlAttachments.get(pendingAttachment.sessionId) === pendingAttachment) {
        pendingControlAttachments.delete(pendingAttachment.sessionId)
      }
      pendingAttachment = null
      if (attachment && controlAttributions.get(attachment.sessionId)?.socket === socket) controlAttributions.delete(attachment.sessionId)
      hostConnection?.close?.()
      hostConnection = null
    }

    const handleRequest = async (record) => {
      const problem = validateControlRequest(record, attachment)
      if (problem) return controlError(socket, record?.requestId, problem)
      const requestId = record.requestId
      if (['list', 'launch', 'history'].includes(record.type)) {
        if (attachment && record.type !== 'history') return controlError(socket, requestId, 'attach connection accepts history or attached commands only')
        if (!attachment) oneShotAccepted = true
        try {
          const result = await hostRequest({ ...record, console: identity })
          safeWrite(socket, { v: DESK_LINK_CONTROL_PROTOCOL, type: 'ack', requestId, result: result && typeof result === 'object' ? result : { value: result } })
        } catch (error) {
          controlError(socket, requestId, error?.message || 'pi host unavailable')
        }
        if (!attachment) socket.end()
        return
      }
      if (record.type === 'attach') {
        clearAttribution()
        try {
          // Replacement is fail-closed: fence both an attributed Console and
          // an Attach still awaiting the host before starting the new Attach.
          const previous = controlAttributions.get(record.sessionId)
          if (previous?.socket && previous.socket !== socket) {
            controlAttributions.delete(record.sessionId)
            controlError(previous.socket, undefined, 'attach replaced')
            previous.socket.end()
          }
          const pending = pendingControlAttachments.get(record.sessionId)
          if (pending?.socket && pending.socket !== socket) {
            pending.replaced = true
            controlError(pending.socket, pending.requestId, 'attach replaced')
            pending.socket.end()
          }
          const attempt = { socket, requestId, replaced: false }
          pendingAttachment = { sessionId: record.sessionId, ...attempt }
          pendingControlAttachments.set(record.sessionId, pendingAttachment)
          const attached = await hostAttach({ ...record, console: identity }, {
            onRecord(hostRecord) {
              if (!hostRecord || typeof hostRecord !== 'object') return
              if (hostRecord.type === 'event') {
                const events = Array.isArray(hostRecord.events)
                  ? hostRecord.events.map(boundedEvent).filter(Boolean)
                  : [boundedEvent(hostRecord.event)].filter(Boolean)
                if (events.length === 0 || !Number.isSafeInteger(hostRecord.position) || hostRecord.position < 0) return
                safeWrite(socket, { v: DESK_LINK_CONTROL_PROTOCOL, type: 'event', sessionId: record.sessionId, attachmentId: record.attachmentId, position: hostRecord.position, events })
                return
              }
              if (hostRecord.type === 'state') {
                const state = HOSTED_PI_STATUSES.has(hostRecord.state) ? hostRecord.state : 'interrupted'
                const response = typeof hostRecord.response === 'string' ? boundedUtf8(hostRecord.response, 16 * 1024) : ''
                safeWrite(socket, {
                  v: DESK_LINK_CONTROL_PROTOCOL, type: 'state', sessionId: record.sessionId, attachmentId: record.attachmentId, state,
                  ...(typeof hostRecord.lifecycle === 'string' ? { lifecycle: hostRecord.lifecycle } : {}),
                  ...(typeof hostRecord.activity === 'string' ? { activity: hostRecord.activity } : {}),
                  ...(typeof hostRecord.turnOutcome === 'string' ? { turnOutcome: hostRecord.turnOutcome } : {}),
                  ...(response ? { response } : {}),
                })
                if (['finished', 'failed', 'cancelled', 'interrupted'].includes(hostRecord.turnOutcome) && response) {
                  safeWrite(socket, { v: DESK_LINK_CONTROL_PROTOCOL, type: 'terminal', sessionId: record.sessionId, attachmentId: record.attachmentId, outcome: hostRecord.turnOutcome, response })
                }
                return
              }
              if (hostRecord.type === 'ack' && boundedIdentity(hostRecord.requestId)) safeWrite(socket, { v: DESK_LINK_CONTROL_PROTOCOL, type: 'ack', requestId: hostRecord.requestId, sessionId: record.sessionId, ...(hostRecord.result !== undefined ? { result: hostRecord.result } : {}) })
              else if (hostRecord.type === 'error') controlError(socket, hostRecord.requestId, hostRecord.reason || 'pi host unavailable')
            },
            onError(error) { controlError(socket, undefined, error?.message || 'pi host unavailable') },
            onClose() { if (!socket.destroyed) socket.end() },
          })
          if (pendingControlAttachments.get(record.sessionId) !== pendingAttachment || pendingAttachment.replaced || closed || socket.destroyed) {
            attached.connection?.close?.()
            return
          }
          pendingControlAttachments.delete(record.sessionId)
          pendingAttachment = null
          attachment = { sessionId: record.sessionId, attachmentId: record.attachmentId }
          hostConnection = attached.connection
          controlAttributions.set(record.sessionId, { ...identity, socket })
          for (const entry of attached.history?.entries ?? []) {
            const events = Array.isArray(entry?.events) ? entry.events.map(boundedEvent).filter(Boolean) : []
            if (events.length > 0 && Number.isSafeInteger(entry.position) && entry.position > 0) {
              safeWrite(socket, { v: DESK_LINK_CONTROL_PROTOCOL, type: 'event', sessionId: record.sessionId, attachmentId: record.attachmentId, position: entry.position, events })
            }
          }
          const boundary = attached.boundary ?? 0
          safeWrite(socket, { v: DESK_LINK_CONTROL_PROTOCOL, type: 'caught_up', sessionId: record.sessionId, attachmentId: record.attachmentId, boundary })
          safeWrite(socket, { v: DESK_LINK_CONTROL_PROTOCOL, type: 'ack', requestId, result: { sessionId: record.sessionId, attachmentId: record.attachmentId, boundary, caughtUp: true } })
        } catch (error) {
          if (pendingAttachment && pendingControlAttachments.get(record.sessionId) === pendingAttachment) {
            pendingControlAttachments.delete(record.sessionId)
          }
          pendingAttachment = null
          controlError(socket, requestId, error?.message || 'pi host unavailable')
          socket.end()
        }
        return
      }
      if (!attachment || !hostConnection || typeof hostConnection.send !== 'function') return controlError(socket, requestId, 'attach required')
      hostConnection.send({ ...record, console: identity })
    }

    const handleRecords = (records) => {
      for (const record of records) {
        if (!record || typeof record !== 'object') continue
        if (record.v !== DESK_LINK_CONTROL_PROTOCOL) {
          explicitVersionMismatch(socket, record.v)
          return
        }
        if (!authenticated) {
          if (record.type !== 'control-proof' || !proofMatches(controlCredential, { ...identity, nonce }, record.proof)) {
            controlError(socket, undefined, controlCredential ? 'control credential refused' : 'control unavailable')
            socket.end()
            return
          }
          authenticated = true
          socket.setTimeout(0)
          safeWrite(socket, { v: DESK_LINK_CONTROL_PROTOCOL, type: 'control-ack', ...identity, at: now() })
          continue
        }
        if (oneShotAccepted) {
          controlError(socket, record.requestId, 'one-shot connection accepts one request')
          continue
        }
        if (!attachment && ['list', 'launch', 'history'].includes(record.type)) oneShotAccepted = true
        processing = processing.then(() => handleRequest(record)).catch(() => controlError(socket, record.requestId, 'control request failed'))
      }
    }

    socket.on('data', (chunk) => handleRecords(readRecords(chunk)))
    socket.on('error', () => socket.destroy())
    socket.on('close', () => { closed = true; clearAttribution() })
    safeWrite(socket, { v: DESK_LINK_CONTROL_PROTOCOL, type: 'challenge', nonce, algorithm: 'hmac-sha256' })
    if (initialBytes?.length) handleRecords(readRecords(initialBytes))
  }

  function attachPeer(socket) {
    let pending = Buffer.alloc(0)
    let decided = false
    socket.setTimeout(authTimeoutMs, () => socket.destroy())
    const decide = (chunk) => {
      if (decided) return
      pending = Buffer.concat([pending, chunk])
      if (pending.length > MAX_RECORD_BYTES) return socket.destroy()
      const newline = pending.indexOf(10)
      if (newline === -1) return
      decided = true
      socket.off('data', decide)
      let hello
      try { hello = JSON.parse(pending.subarray(0, newline).toString('utf8').replace(/\r$/, '')) }
      catch { return socket.destroy() }
      const rest = pending.subarray(newline + 1)
      pending = Buffer.alloc(0)
      if (!hello || typeof hello !== 'object') return socket.destroy()
      if (hello.v !== DESK_LINK_PROTOCOL && hello.v !== DESK_LINK_CONTROL_PROTOCOL) return explicitVersionMismatch(socket, hello.v)
      if (hello.v === DESK_LINK_CONTROL_PROTOCOL) {
        if (hello.type !== 'control-hello' || !boundedIdentity(hello.machine) || !boundedIdentity(hello.sessionId)) {
          controlError(socket, undefined, 'control hello required')
          socket.end()
          return
        }
        if (!tokenMatches(token, hello.token)) {
          controlError(socket, undefined, 'token refused')
          socket.end()
          return
        }
        attachControl(socket, hello, rest)
        return
      }
      attachReporter(socket, [hello], rest)
    }
    socket.on('data', decide)
    socket.on('error', () => socket.destroy())
  }

  function attachReporter(socket, initialRecords = [], initialBytes = null) {
    const readRecords = recordReader()
    let authenticated = false
    let machine = null
    socket.setKeepAlive(true, 15000)
    // A peer that never authenticates must not hold a connection open.
    socket.setTimeout(authTimeoutMs, () => {
      if (!authenticated) socket.destroy()
    })

    const handleRecords = (records) => {
      for (const record of records) {
        if (!record || typeof record !== 'object' || record.v !== DESK_LINK_PROTOCOL) continue
        if (!authenticated) {
          if (record.type !== 'hello' || typeof record.machine !== 'string' || record.machine.length === 0) {
            socket.write(encodeJsonLine({ v: DESK_LINK_PROTOCOL, type: 'error', reason: 'hello required' }))
            socket.destroy()
            return
          }
          if (!tokenMatches(token, record.token)) {
            socket.write(encodeJsonLine({ v: DESK_LINK_PROTOCOL, type: 'error', reason: 'token refused' }))
            socket.destroy()
            return
          }
          authenticated = true
          socket.setTimeout(0)
          machine = record.machine
          const joined = machineState(machine)
          joined.connectedAt = now()
          joined.links.set(socket, new Set())
          socket.write(encodeJsonLine({ v: DESK_LINK_PROTOCOL, type: 'ack', at: now() }))
          continue
        }
        const state = machineState(machine)
        state.lastSeenAt = now()
        if (record.type === 'sessions') applySessions(state, socket, record.sessions)
        else if (record.type === 'events') {
          applyEvents(state, socket, String(record.sessionId ?? ''), record.events)
        } else if (record.type === 'bye') {
          socket.end()
        } else if (['list', 'launch', 'history', 'attach', 'prompt', 'cancel', 'end'].includes(record.type)) {
          safeWrite(socket, { v: DESK_LINK_PROTOCOL, type: 'error', ...(boundedIdentity(record.requestId) ? { requestId: record.requestId } : {}), reason: 'reporting link is report-only' })
        }
      }
    }
    socket.on('data', (chunk) => handleRecords(readRecords(chunk)))
    if (initialRecords.length > 0) handleRecords(initialRecords)
    if (initialBytes?.length) handleRecords(readRecords(initialBytes))
    socket.on('error', () => socket.destroy())
    // A dropped link makes its machine's sessions unavailable rather than stale,
    // but only once its last link is gone: one machine may run several Pi
    // processes, and they share the machine's identity.
    socket.on('close', () => {
      if (machine === null) return
      const state = machines.get(machine)
      if (!state) return
      for (const id of state.links.get(socket) || []) forgetReport(state, socket, id)
      state.links.delete(socket)
      if (state.links.size === 0) machines.delete(machine)
    })
  }

  /**
   * One entry per session identity.
   *
   * A session can legitimately be described by more than one Reporting Machine:
   * every reporter's inventory names the sessions of the whole machine, while
   * the owner also reports it directly. Emitting the (machine, session) cross
   * product would show one session twice, count it twice, and collide on the
   * identity the runtime keys its own rows by. The richest report wins.
   */
  function collectSessions() {
    const chosen = new Map()
    for (const [machine, state] of machines) {
      for (const [id, entry] of state.sessions) {
        const candidate = { machine, entry }
        const current = chosen.get(id)
        if (current === undefined || preferReport(candidate, current)) chosen.set(id, candidate)
      }
    }
    return chosen
  }

  function preferReport(candidate, current) {
    const candidateHasEvents = candidate.entry.events.length > 0
    const currentHasEvents = current.entry.events.length > 0
    if (candidateHasEvents !== currentHasEvents) return candidateHasEvents
    const candidateAt = reportTime(candidate.entry.session)
    const currentAt = reportTime(current.entry.session)
    if (candidateAt !== currentAt) return candidateAt > currentAt
    // Machines are visited in connection order, so an equally fresh first
    // report stays chosen and a snapshot is deterministic.
    return false
  }

  async function hostedSnapshot() {
    try {
      const response = await hostRequest({ v: DESK_LINK_CONTROL_PROTOCOL, type: 'list', requestId: `runtime-${randomBytes(8).toString('hex')}` })
      const raw = Array.isArray(response) ? response : response?.sessions
      const sessions = Array.isArray(raw)
        ? raw.map((session) => {
          const attribution = controlAttributions.get(String(session?.sessionId ?? ''))
          return normalizeHostedSession(session, attribution ? { machine: attribution.machine, sessionId: attribution.sessionId } : null)
        }).filter(Boolean).slice(0, MAX_SESSIONS_PER_MACHINE)
        : []
      return { ok: true, sessions, scannedAt: now() }
    } catch (error) {
      return { ok: false, reason: error?.message || 'pi host unavailable', sessions: [], scannedAt: now() }
    }
  }

  async function hostedEventsForSession(sessionId) {
    if (!boundedIdentity(sessionId) || !hostAdapter || typeof hostAdapter.request !== 'function') {
      return { ok: false, reason: SESSION_LOG_MISSING }
    }
    try {
      const history = await hostRequest({
        v: DESK_LINK_CONTROL_PROTOCOL,
        type: 'history',
        requestId: `runtime-history-${randomBytes(8).toString('hex')}`,
        sessionId,
        after: 0,
        limit: MAX_EVENTS_PER_SESSION,
      })
      const entries = Array.isArray(history?.entries) ? history.entries : []
      const events = retainEvents(entries.flatMap((entry) => Array.isArray(entry?.events)
        ? entry.events.map(boundedEvent).filter(Boolean)
        : []))
      return {
        ok: true,
        events,
        truncated: history?.nextPosition !== null && history?.nextPosition !== undefined,
      }
    } catch (error) {
      const reason = error?.message || 'pi host unavailable'
      return { ok: false, reason: /not found|unknown|missing/i.test(reason) ? SESSION_LOG_MISSING : reason }
    }
  }

  /** The snapshot shape the runtime's Pi source already validates. */
  function snapshot() {
    const sessions = []
    const workspaces = new Map()
    for (const { machine, entry } of collectSessions().values()) {
      const session = reportedSession(entry.session, machine)
      sessions.push(session)
      const workspace = session.cwd || session.workspaceName || 'Default'
      if (!workspaces.has(workspace)) workspaces.set(workspace, { name: session.workspaceName, cwd: session.cwd, sessions: [] })
      workspaces.get(workspace).sessions.push(session)
    }
    sessions.sort((a, b) => (b.updatedAt || b.startedAt || 0) - (a.updatedAt || a.startedAt || 0))
    const machines_ = [...machines.keys()].sort()
    return {
      ok: true,
      source: {
        kind: 'desk-link',
        label: machines_.length === 0 ? 'Desk Link' : `Desk Link · ${machines_.join(', ')}`,
      },
      scannedAt: now(),
      summary: {
        total: sessions.length,
        running: sessions.filter((session) => session.status === 'running').length,
        settled: sessions.filter((session) => session.status === 'settled').length,
        exited: sessions.filter((session) => session.status === 'exited').length,
        workspacesCount: workspaces.size,
      },
      sessions,
      workspaces: [...workspaces.values()].map((workspace) => ({ ...workspace })),
    }
  }

  function eventsForSession(sessionId) {
    // One session may be described by several machines, and only its owner has
    // its events. Answering from the first machine that merely knows the
    // session reports "no events yet" for a session that has a readable stream.
    let known = false
    for (const state of machines.values()) {
      const entry = state.sessions.get(sessionId)
      if (!entry) continue
      known = true
      if (entry.events.length > 0) return { ok: true, events: entry.events, truncated: true }
    }
    return { ok: false, reason: known ? 'no-reported-events' : SESSION_LOG_MISSING }
  }

  function handleRuntimeRequest(socket) {
    const readRecords = recordReader()
    const writeRuntime = (record) => safeWrite(socket, record, MAX_RUNTIME_RESPONSE_BYTES)
    socket.on('data', (chunk) => {
      for (const record of readRecords(chunk)) {
        if (!record || typeof record !== 'object' || record.v !== DESK_LINK_PROTOCOL) continue
        if (record.type === 'snapshot') writeRuntime(snapshot())
        else if (record.type === 'events') {
          const sessionId = String(record.sessionId ?? '')
          if (record.hostedPi === true) hostedEventsForSession(sessionId).then(writeRuntime)
          else {
            const reported = eventsForSession(sessionId)
            if (reported.reason !== SESSION_LOG_MISSING) writeRuntime(reported)
            else hostedEventsForSession(sessionId).then(writeRuntime)
          }
        } else if (record.type === 'machines') {
          writeRuntime({ v: DESK_LINK_PROTOCOL, type: 'machines', machines: [...machines.keys()] })
        } else if (record.type === 'hosted-sessions') {
          hostedSnapshot().then((reply) => writeRuntime({ v: DESK_LINK_PROTOCOL, type: 'hosted-sessions', ...reply }))
        }
      }
    })
    socket.on('error', () => socket.destroy())
  }

  async function openRuntimeSocket() {
      // The runtime channel is authenticated by filesystem ownership, so the
      // socket needs a private directory. Create one when it is missing; refuse
      // an existing directory rather than chmodding one this service does not
      // own, which would silently lock a shared or user-owned directory down.
      const socketDir = path.dirname(socketPath)
      let createdDir = false
      try {
        await fs.promises.mkdir(socketDir, { mode: 0o700 })
        createdDir = true
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
      if (createdDir) {
        await fs.promises.chmod(socketDir, 0o700)
      } else {
        const stat = await fs.promises.stat(socketDir)
        if (stat.uid !== process.getuid()) {
          throw new Error(`refusing ${socketDir}: it is not owned by this user`)
        }
        if ((stat.mode & 0o077) !== 0) {
          throw new Error(`refusing ${socketDir}: it is group- or world-accessible`)
        }
      }
      await new Promise((resolve, reject) => {
        socketServer.once('error', reject)
        socketServer.listen(socketPath, () => {
          socketServer.off('error', reject)
          resolve()
        })
      })
      socketServer.on('connection', (socket) => handleRuntimeRequest(track(socket)))
      await fs.promises.chmod(socketPath, 0o600)
  }


  return {
    listenHost,
    async start() {
      if (started) return { host: listenHost, port: server.address().port }
      server.maxConnections = MAX_CONNECTIONS
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, listenHost, () => {
          server.off('error', reject)
          resolve()
        })
      })
      server.on('connection', (socket) => attachPeer(track(socket)))
      try {
        await openRuntimeSocket()
      } catch (error) {
        // A refused start must not leave the network listener running.
        await new Promise((resolve) => server.close(resolve))
        throw error
      }
      started = true
      return { host: listenHost, port: server.address().port }
    },
    async stop() {
      // Every Desk Link is long-lived, so close() alone would wait for
      // connections that never end and a signal would hang. The service tracks
      // its own sockets rather than relying on an API that may not exist.
      for (const socket of [...openSockets]) socket.destroy()
      openSockets.clear()
      await Promise.all([
        new Promise((resolve) => server.close(resolve)),
        new Promise((resolve) => socketServer.close(resolve)),
      ])
      machines.clear()
      controlAttributions.clear()
      pendingControlAttachments.clear()
      started = false
    },
    snapshot,
    eventsForSession,
    hostedSnapshot,
    machines: () => [...machines.keys()],
    connections: () => connections,
    sessionCount: () => snapshot().summary.total,
  }
}

module.exports = {
  createDeskLinkService,
  parseRecords,
  boundedEvent,
  boundedText,
  localAddress,
  resolveListenHost,
  reportedSession,
  MAX_EVENTS_PER_SESSION,
  MAX_SESSION_EVENT_BYTES,
  MAX_SESSIONS_PER_MACHINE,
  SESSION_LOG_MISSING,
  AUTH_TIMEOUT_MS,
  MAX_CONNECTIONS,
  MAX_EVENT_TEXT,
  DESK_LINK_PROTOCOL,
  DESK_LINK_CONTROL_PROTOCOL,
  ACCEPTED_CONTROL_PROTOCOLS,
  HOSTED_PI_STATUSES,
  controlProof,
  controlTranscript,
  normalizeHostedSession,
  tokenMatches,
}
