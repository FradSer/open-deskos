'use strict'

function preferred(candidate, current) {
  if ((candidate.hostedPi === true) !== (current.hostedPi === true)) return candidate.hostedPi === true
  const at = session => Number(session.updatedAt) || Number(session.startedAt) || 0
  if (at(candidate) !== at(current)) return at(candidate) > at(current)
  const hasActivity = session => typeof session.activity === 'string' && session.activity.length > 0
  return hasActivity(candidate) && !hasActivity(current)
}

function uniqueSessions(sessions) {
  const result = []
  const positions = new Map()
  for (const session of sessions) {
    const id = session && typeof session === 'object' ? String(session.uuid || session.sessionId || '') : ''
    if (!id || !positions.has(id)) {
      if (id) positions.set(id, result.length)
      result.push(session)
    } else {
      const index = positions.get(id)
      if (preferred(session, result[index])) result[index] = session
    }
  }
  return result
}

function rebuild(data, sessions) {
  const groups = new Map()
  for (const session of sessions) {
    const key = session.cwd || session.workspaceName || 'Default'
    if (!groups.has(key)) groups.set(key, { name: session.workspaceName, cwd: session.cwd, sessions: [] })
    groups.get(key).sessions.push(session)
  }
  return { ...data, sessions, workspaces: [...groups.values()], summary: {
    total: sessions.length,
    running: sessions.filter(session => session.status === 'running').length,
    settled: sessions.filter(session => session.status === 'settled').length,
    exited: sessions.filter(session => session.status === 'exited').length,
    workspacesCount: groups.size,
  } }
}

function aggregate(data, hosted) {
  if (data?.ok !== true) return data
  const sessions = uniqueSessions(data.sessions)
  let result = sessions.length === data.sessions.length ? data : rebuild(data, sessions)
  if (Array.isArray(result.sessions) && hosted?.ok === true && Array.isArray(hosted.sessions) && hosted.sessions.length) {
    result = rebuild(result, uniqueSessions([...result.sessions, ...hosted.sessions]))
  }
  return result
}

const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null
const text = value => typeof value !== 'string' ? value === undefined ? null : value
  : value.length <= 160 ? value : `${value.slice(0, 160)}...`

function project(data) {
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  const states = [...new Set(sessions.map(session => session.status || 'unknown'))].sort()
  return { asOf: iso(data.updatedAt) ?? undefined, total: sessions.length,
    counts: Object.fromEntries(states.map(state => [state, sessions.filter(session => (session.status || 'unknown') === state).length])),
    sessions: sessions.slice(0, 20).map(session => Object.fromEntries(Object.entries({
      id: session.sessionId ?? session.id, project: session.workspaceName, workingDirectory: session.cwd,
      state: session.status, goal: text(session.latestGoal), activity: text(session.activity), updatedAt: iso(session.updatedAt),
    }).filter(([, value]) => value !== undefined))), truncated: sessions.length > 20 }
}

// Aggregation, projection, and request ownership use no Shell implementation imports.
exports.create = context => {
  const configured = context.capability('source.pi-sessions').configured()
  const link = context.get('odk:source/link/v1')
  const controller = new AbortController()
  const operations = new Set()
  let current = null
  const cancel = () => controller.abort()
  const unavailable = error => ({ ok: false, source: configured.source, error,
    scannedAt: null, summary: null, sessions: [], workspaces: [] })
  const stopped = () => unavailable('Pi source stopped.')
  if (context.signal.aborted) cancel()
  else context.signal.addEventListener('abort', cancel, { once: true })

  const retain = value => {
    const promise = Promise.resolve(value)
    operations.add(promise)
    void promise.then(() => operations.delete(promise), () => operations.delete(promise))
    return promise
  }
  const scan = () => {
    if (controller.signal.aborted) return Promise.resolve(stopped())
    if (current) return current
    let resolve
    let reject
    const result = new Promise((yes, no) => { resolve = yes; reject = no })
    const owned = retain(result.then(data => controller.signal.aborted ? stopped() : data, error => {
      if (controller.signal.aborted) return stopped()
      throw error
    }))
    current = owned
    void owned.then(() => { if (current === owned) current = null }, () => { if (current === owned) current = null })
    try {
      const options = { signal: controller.signal }
      const machines = retain(link.machines(options))
      const hosted = retain(link.hostedSessions?.(options) ?? { ok: false, sessions: [] })
      resolve(Promise.all([machines, hosted]).then(async ([machines, hosted]) => {
        if (controller.signal.aborted) return stopped()
        const data = await (machines.length ? link.snapshot(options) : configured.read(options))
        return aggregate(data, hosted)
      }).catch(() => unavailable('Pi scan unavailable.')))
    } catch (error) { reject(error) }
    return owned
  }
  scan.stop = async () => {
    cancel()
    context.signal.removeEventListener('abort', cancel)
    await Promise.allSettled([...operations])
  }
  context.onCleanup(() => scan.stop())
  const ipc = context.capability('ipc')
  ipc.handle('odk-pi-sessions', () => scan())
  context.onCleanup(() => ipc.removeHandler('odk-pi-sessions'))
  return { ports: {
    'odk:source/pi-sessions/v1': scan,
    'odk:desk-reading/pi-sessions/v1': [{ id: 'odk.app.pi-sessions', label: 'Pi sessions', kind: 'app',
      home: { mode: 'optional', priority: 70, icon: 'sessions', fields: ['total', 'counts', 'truncated'] },
      read: async () => {
        const data = await scan()
        return data?.ok === true ? { state: 'live', value: project(data), updatedAt: data.updatedAt } : { state: 'unavailable', value: null }
      } }],
  } }
}
