const { execFile } = require('node:child_process')
const { scanPiSessions } = require('./pi-sessions')

function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function validSession(session) {
  return session && typeof session === 'object' && typeof session.isAlive === 'boolean'
    && ['running', 'settled', 'exited'].includes(session.status)
    && (session.pid === null || (Number.isSafeInteger(session.pid) && session.pid > 0))
    && ['cwd', 'workspaceName', 'latestGoal', 'uuid', 'sessionId', 'command', 'activity', 'recap'].every((key) => session[key] === undefined || typeof session[key] === 'string')
    && (session.modifiedFiles === undefined || (Array.isArray(session.modifiedFiles) && session.modifiedFiles.every((file) => typeof file === 'string')))
}

function validSnapshot(data) {
  const counts = ['total', 'running', 'settled', 'exited', 'workspacesCount']
  return data?.ok === true && Number.isFinite(data.scannedAt)
    && Math.abs(Date.now() - data.scannedAt) < 60000
    && Array.isArray(data.sessions) && Array.isArray(data.workspaces)
    && counts.every((key) => Number.isSafeInteger(data.summary?.[key]) && data.summary[key] >= 0)
    && data.summary.total === data.sessions.length
    && data.summary.workspacesCount === data.workspaces.length
    && data.summary.total === data.summary.running + data.summary.settled + data.summary.exited
    && data.sessions.every(validSession)
    && data.workspaces.every((workspace) => workspace && Array.isArray(workspace.sessions) && workspace.sessions.every(validSession))
}

function unavailable(source, error) {
  return { ok: false, source, error, scannedAt: null, summary: null, sessions: [], workspaces: [] }
}

/**
 * One entry per session identity.
 *
 * A reporting machine may describe the same session from several processes: one
 * owns it directly while the others name it in their inventory. Reporting them
 * separately would show one session twice and count it twice, and it would
 * collide on the identity this page keys its rows by. The runtime resolves it
 * itself rather than trusting every peer to, so a page never renders one
 * session as two. The freshest report describes the session; an equally fresh
 * one that actually reported activity is preferred.
 */
function dedupeSessions(sessions) {
  const winners = new Map()
  const order = []
  for (const session of sessions) {
    // A session with no identity cannot collide with another, so it is kept as
    // it is rather than being dropped for lacking one.
    const id = session && typeof session === 'object' ? String(session.uuid || session.sessionId || '') : ''
    if (id.length === 0) {
      order.push({ session })
      continue
    }
    const current = winners.get(id)
    if (current === undefined) {
      order.push({ id })
      winners.set(id, session)
    } else if (prefersOver(session, current)) {
      winners.set(id, session)
    }
  }
  return order.map((entry) => (entry.id === undefined ? entry.session : winners.get(entry.id)))
}

function prefersOver(candidate, current) {
  const candidateAt = Number(candidate.updatedAt) || Number(candidate.startedAt) || 0
  const currentAt = Number(current.updatedAt) || Number(current.startedAt) || 0
  if (candidateAt !== currentAt) return candidateAt > currentAt
  const candidateActive = typeof candidate.activity === 'string' && candidate.activity.length > 0
  const currentActive = typeof current.activity === 'string' && current.activity.length > 0
  if (candidateActive !== currentActive) return candidateActive
  return false
}

/** Rebuild the snapshot around the deduplicated set so its own invariants hold. */
function dedupeSnapshot(data) {
  const sessions = dedupeSessions(data.sessions)
  if (sessions.length === data.sessions.length) return data
  const workspaces = new Map()
  for (const session of sessions) {
    const key = session.cwd || session.workspaceName || 'Default'
    if (!workspaces.has(key)) workspaces.set(key, { name: session.workspaceName, cwd: session.cwd, sessions: [] })
    workspaces.get(key).sessions.push(session)
  }
  return {
    ...data,
    sessions,
    workspaces: [...workspaces.values()],
    summary: {
      total: sessions.length,
      running: sessions.filter((session) => session.status === 'running').length,
      settled: sessions.filter((session) => session.status === 'settled').length,
      exited: sessions.filter((session) => session.status === 'exited').length,
      workspacesCount: workspaces.size,
    },
  }
}

function scanRemote(config, source, execute) {
  const { host, node, collector } = config
  const validPath = (value) => typeof value === 'string' && value.startsWith('/') && !/[\r\n\0]/.test(value)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(host || '') || !validPath(node) || !validPath(collector)) {
    return Promise.resolve(unavailable(source, 'Invalid SSH configuration: set host and absolute Node/collector paths.'))
  }
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=3',
    '-o', 'ServerAliveCountMax=1', '-o', 'ClearAllForwardings=yes', host,
    `${quote(node)} ${quote(collector)}`]
  return new Promise((resolve) => {
    execute('ssh', args, { encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024, killSignal: 'SIGKILL' }, (error, stdout) => {
      if (error) return resolve(unavailable(source, 'SSH scan unavailable: check connection, host key, authentication, and collector.'))
      try {
        const data = JSON.parse(stdout)
        if (!validSnapshot(data)) throw new Error('Invalid snapshot')
        resolve({ ...data, source })
      } catch {
        resolve(unavailable(source, 'SSH collector returned an invalid or stale snapshot.'))
      }
    })
  })
}

function createPiSessionsSource({ env = process.env, scanLocal = scanPiSessions, execute = execFile, deskLink = null } = {}) {
  const config = { host: env.ODK_PI_SSH_HOST, node: env.ODK_PI_SSH_NODE, collector: env.ODK_PI_SSH_COLLECTOR }
  const remote = Object.values(config).some((value) => value !== undefined)
  const source = remote
    ? { kind: 'ssh', label: `Mac / SSH · ${config.host || 'unconfigured'}` }
    : { kind: 'local', label: 'Local' }
  let pending
  // A connected Desk Link answers first: its machine owns those sessions, so
  // mixing it with a filesystem or SSH scan would report one list from two
  // sources. With no connected link the configured SSH source, then the local
  // collector, answer exactly as before.
  const scanConfiguredSource = () => (remote
    ? scanRemote(config, source, execute)
    : Promise.resolve().then(scanLocal).then((data) => ({ ...data, source })))

  function scan() {
    // A connected Desk Link answers first: its machine owns those sessions, so
    // mixing it with a filesystem or SSH scan would report one list from two
    // sources. With no connected link the configured SSH source, then the local
    // collector, answer exactly as before.
    const result = !deskLink
      ? scanConfiguredSource()
      : Promise.resolve()
        .then(() => deskLink.machines())
        .then((machines) => (machines.length === 0 ? scanConfiguredSource() : deskLink.snapshot()))
    return result.then((data) => (data?.ok === true && Array.isArray(data.sessions) ? dedupeSnapshot(data) : data))
  }

  return () => {
    if (!pending) {
      pending = scan().catch(() => unavailable(source, 'Pi scan unavailable.')).finally(() => { pending = null })
    }
    return pending
  }
}

module.exports = { createPiSessionsSource, dedupeSessions, dedupeSnapshot }
