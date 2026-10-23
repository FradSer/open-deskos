/** Public source projections. These adapters own no copies of resident state. */
export const PRODUCER_INTERFACE = 'odk:producer-projection/v1'
export const PRODUCER_PORT = /^odk:producer-readings\/[a-z0-9-]+\/v1$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const declaration = (id, label, icon, fields) => ({ id, label, kind: 'service', home: { mode: 'optional', priority: 0, icon, fields } })
const text = (value, limit = 256) => typeof value === 'string' ? value.slice(0, limit) : ''
const unavailable = id => ({ id, state: 'unavailable', value: null })

export function createTaskReadings(owner) {
  const entries = () => {
    if (!owner) return []
    const result = []
    for (let offset = 0; offset <= 128; offset += 32) {
      const page = owner.list({ offset, limit: 32 })
      result.push(...page.tasks)
      if (offset + page.tasks.length >= page.total || !page.tasks.length) return result
    }
    throw Error('Invalid task reading inventory')
  }
  return {
    list: () => entries().map(task => declaration(`odk.agent.${task.taskId}`, text(task.identity?.name || 'Personal Agent task', 128), 'tasks', ['taskId', 'goal', 'state', 'result', 'verification', 'learning', 'truncated', 'asOf'])),
    read(id) {
      if (!this.list().some(entry => entry.id === id)) return unavailable(id)
      const task = owner.status(id.slice('odk.agent.'.length))
      if (!task) return unavailable(id)
      return { id, state: 'live', updatedAt: Date.parse(task.updatedAt), value: {
        taskId: task.taskId, goal: text(task.request), state: text(task.state, 32), result: text(task.response, 1024),
        verification: text(task.verification?.status || 'not_run', 64), learning: text(task.learning?.status || task.learning, 64),
        truncated: (task.request?.length ?? 0) > 256 || (task.response?.length ?? 0) > 1024, asOf: task.updatedAt,
      } }
    },
  }
}

export function createRemoteReadings(owner) {
  const records = () => {
    if (!owner) return []
    const result = []
    let offset = 0
    for (let count = 0; count < 256; count++) {
      const page = owner.snapshot(offset, 8)
      result.push(...page.messages.map(message => ({ message, state: page.state, incomplete: Boolean(page.omitted || page.unavailableSources || page.hasMore || page.heldCount || page.disconnectedSources || message.omittedSources) })))
      if (page.nextOffset === null || page.nextOffset === undefined) return result
      if (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset) throw Error('Invalid report reading page')
      offset = page.nextOffset
    }
    throw Error('Report reading inventory exceeds bounds')
  }
  return {
    list: () => records().map(({ message }) => declaration(`odk.remote.${message.id}`, 'Remote Pi report', 'sessions', ['report', 'verification', 'tasks', 'incomplete', 'asOf'])),
    read(id) {
      const record = records().find(({ message }) => `odk.remote.${message.id}` === id)
      if (!record) return unavailable(id)
      const { message, state, incomplete } = record
      const clipped = (value, limit) => typeof value === 'string' && value.length > limit
      const shortened = clipped(message.text, 4000) || (message.sources ?? []).some(source =>
        clipped(source.sessionId ?? source.taskId, 256) || clipped(source.taskName, 40)
        || clipped(source.project, 1024) || clipped(source.machine, 256) || clipped(source.state, 64))
      return { id, state: ['live', 'partial'].includes(state) ? 'live' : 'stale', updatedAt: message.at, value: {
        report: text(message.text, 4000), verification: 'reported_unverified', incomplete: incomplete || shortened,
        asOf: Number.isFinite(message.at) ? new Date(message.at).toISOString() : undefined,
        tasks: (message.sources ?? []).map(source => ({ id: text(source.sessionId ?? source.taskId), name: text(source.taskName || 'Remote Pi task', 40),
          workingDirectory: text(source.project, 1024), reportingMachine: text(source.machine), control: 'report_only',
          reportedState: text(source.state, 64), verification: 'reported_unverified', updatedAt: source.updatedAt })),
      } }
    },
  }
}

/** Versioned read-only dispatch beside, never inside, plugin lifecycle commands. */
export function createProducerControl({ ports, current }) {
  function catalog() {
    const entries = []
    for (const provider of ports()) {
      try {
        const declarations = structuredClone(provider.list())
        if (!Array.isArray(declarations) || Buffer.byteLength(JSON.stringify(declarations)) > 196608) throw Error('Invalid producer inventory')
        for (const entry of declarations) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['id', 'label', 'kind', 'home'].includes(key))
            || typeof entry.id !== 'string' || !ID.test(entry.id) || !['app', 'service'].includes(entry.kind)
            || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 128 || /[\x00-\x1f]/.test(entry.label)) throw Error('Invalid producer declaration')
          if (entry.home !== undefined) {
            const home = entry.home
            if (!home || typeof home !== 'object' || Array.isArray(home) || Object.keys(home).some(key => !['mode', 'priority', 'icon', 'fields'].includes(key))
              || !['required', 'optional', 'hidden'].includes(home.mode) || !Number.isInteger(home.priority) || home.priority < 0 || home.priority > 100
              || !['sessions', 'plants', 'weather', 'mail', 'calendar', 'tasks', 'reading', 'portfolio', 'quota', 'apps', 'status'].includes(home.icon)
              || !Array.isArray(home.fields) || home.fields.length > 16 || new Set(home.fields).size !== home.fields.length
              || home.fields.some(field => typeof field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field) || ['__proto__', 'prototype', 'constructor'].includes(field))) throw Error('Invalid producer declaration')
          }
        }
        entries.push(...declarations.map(entry => ({ provider, entry })))
      } catch { /* A malformed provider cannot remove healthy sibling readings. */ }
    }
    const counts = new Map()
    for (const { entry } of entries) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
    const unique = entries.filter(({ entry }) => counts.get(entry.id) === 1)
    if (Buffer.byteLength(JSON.stringify(unique.map(({ entry }) => entry))) > 196608) throw Error('Producer inventory too large')
    return unique
  }
  return { async dispatch(request) {
    if (!current()) return { ok: false, error: 'runtime-stopped' }
    if (!request || request.interface !== PRODUCER_INTERFACE || !['producer_list', 'producer_read'].includes(request.command)
      || Object.keys(request).some(key => !['v', 'id', 'command', 'interface', 'readingId'].includes(key))
      || (request.command === 'producer_list' && request.readingId !== undefined)) return { ok: false, error: 'invalid-producer-request' }
    try {
      const entries = catalog()
      if (request.command === 'producer_list') return { ok: true, interface: PRODUCER_INTERFACE, readings: entries.map(({ entry }) => structuredClone(entry)) }
      if (typeof request.readingId !== 'string' || !ID.test(request.readingId)) return { ok: false, error: 'invalid-reading-id' }
      const selected = entries.find(({ entry }) => entry.id === request.readingId)
      if (!selected) return { ok: false, error: 'unknown-reading' }
      const reading = await selected.provider.read(selected.entry.id)
      if (!current() || !ports().includes(selected.provider)) return { ok: false, error: 'provider-unavailable' }
      if (reading?.id !== selected.entry.id || Buffer.byteLength(JSON.stringify(reading)) > 65536) return { ok: false, error: 'invalid-producer-reading' }
      return { ok: true, interface: PRODUCER_INTERFACE, reading }
    } catch { return { ok: false, error: 'producer-unavailable' } }
  } }
}
