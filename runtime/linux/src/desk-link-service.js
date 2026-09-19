const net = require('node:net')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const { timingSafeEqual } = require('node:crypto')
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
const DESK_LINK_PROTOCOL = 1
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

function recordReader() {
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
    const parsed = parseRecords(text, pending)
    pending = parsed.pending
    if (Buffer.byteLength(pending) > MAX_RECORD_BYTES) {
      pending = ''
      dropping = true
    }
    return parsed.records
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
  if (typeof presented !== 'string' || presented.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(presented))
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

function createDeskLinkService({ token, socketPath, port = 8765, host, env = process.env, now = () => Date.now(), authTimeoutMs = AUTH_TIMEOUT_MS } = {}) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('a Desk Link Service requires a token')
  if (typeof socketPath !== 'string' || !path.isAbsolute(socketPath)) {
    throw new Error('a Desk Link Service requires an absolute Unix socket path')
  }
  const listenHost = host ?? resolveListenHost(env)
  let connections = 0
  const machines = new Map()
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

  function attachReporter(socket) {
    const readRecords = recordReader()
    let authenticated = false
    let machine = null
    socket.setKeepAlive(true, 15000)
    // A peer that never authenticates must not hold a connection open.
    socket.setTimeout(authTimeoutMs, () => {
      if (!authenticated) socket.destroy()
    })

    socket.on('data', (chunk) => {
      for (const record of readRecords(chunk)) {
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
        }
      }
    })
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
    socket.on('data', (chunk) => {
      for (const record of readRecords(chunk)) {
        if (!record || typeof record !== 'object' || record.v !== DESK_LINK_PROTOCOL) continue
        if (record.type === 'snapshot') socket.write(encodeJsonLine(snapshot()))
        else if (record.type === 'events') socket.write(encodeJsonLine(eventsForSession(String(record.sessionId ?? ''))))
        else if (record.type === 'machines') {
          socket.write(encodeJsonLine({ v: DESK_LINK_PROTOCOL, type: 'machines', machines: [...machines.keys()] }))
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
      server.on('connection', (socket) => attachReporter(track(socket)))
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
      started = false
    },
    snapshot,
    eventsForSession,
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
}