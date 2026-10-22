const AGENT_PREFIX = 'odk.agent.'
const REMOTE_PREFIX = 'odk.remote.'
const dataFailure = { id: 'odk.data.connection', label: 'Desk data', kind: 'status', state: 'unavailable', value: null }
const declaration = (id, label, icon, fields) => ({ id, label, kind: 'app', home: { mode: 'optional', priority: 0, icon, fields } })

/** Adapt existing read-only runtime views. Do not retain a second reading cache. */
export function createHomeSourceAccess({ dataRequest, runtime, remote }) {
  function tasks() {
    const owner = runtime()?.agent?.agentTasks
    if (!owner) return []
    const entries = []
    for (let offset = 0; ; offset += 32) {
      const page = owner.list({ offset, limit: 32 })
      entries.push(...page.tasks)
      if (offset + page.tasks.length >= page.total || !page.tasks.length) return entries
    }
  }
  function reports() {
    const owner = remote()
    if (!owner) return []
    const entries = []
    let offset = 0
    while (true) {
      const page = owner.snapshot(offset, 8)
      entries.push(...page.messages.map(message => ({ message, state: page.state, incomplete: Boolean(page.omitted || page.unavailableSources || page.hasMore || page.heldCount || page.disconnectedSources || message.omittedSources) })))
      if (page.nextOffset === null || page.nextOffset === undefined || page.nextOffset <= offset) return entries
      offset = page.nextOffset
    }
  }
  return {
    async list(signal) {
      let entries
      try { entries = (await dataRequest('list', { signal })).readings }
      catch { entries = [dataFailure] }
      if (!Array.isArray(entries)) entries = [dataFailure]
      const resident = tasks().map(task => declaration(AGENT_PREFIX + task.taskId, task.identity?.name || 'Personal Agent task', 'tasks', ['goal', 'state', 'result', 'verification', 'learning']))
      const updates = reports().map(({ message }) => declaration(REMOTE_PREFIX + message.id, 'Remote Pi report', 'sessions', ['report', 'verification', 'tasks', 'incomplete']))
      const all = [...entries, ...resident, ...updates]
      if (new Set(all.map(entry => entry.id)).size !== all.length) throw Error('Conflicting home source identity')
      return all
    },
    async read(id, signal) {
      if (id === dataFailure.id) return dataFailure
      if (id.startsWith(AGENT_PREFIX)) {
        const task = runtime()?.agent?.agentTasks?.status(id.slice(AGENT_PREFIX.length))
        if (!task) return { id, state: 'unavailable', value: null }
        return { id, state: 'live', updatedAt: Date.parse(task.updatedAt), value: {
          goal: task.request, state: task.state, ...(task.response ? { result: task.response } : {}), verification: task.verification.status, learning: task.learning,
        } }
      }
      if (id.startsWith(REMOTE_PREFIX)) {
        const record = reports().find(({ message }) => REMOTE_PREFIX + message.id === id)
        if (!record) return { id, state: 'unavailable', value: null }
        const { message, state, incomplete } = record
        return { id, state: ['live', 'partial'].includes(state) ? 'live' : 'stale', updatedAt: message.at, value: {
          report: message.text, verification: message.verification || 'reported_unverified', incomplete,
          tasks: message.sources.map(source => ({ id: source.sessionId ?? source.taskId, name: source.taskName || 'Remote Pi task',
            workingDirectory: source.project, reportingMachine: source.machine, reportedState: source.state,
            verification: 'reported_unverified', updatedAt: source.updatedAt })),
        } }
      }
      return (await dataRequest('read', { id, signal })).reading
    },
  }
}
