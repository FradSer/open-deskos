const TASK = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const REVISION = /^[a-f0-9]{64}$/
const AVATARS = new Set(['agent', 'book', 'code', 'compass', 'spark'])
const STATES = new Set(['starting', 'running', 'cancelling'])
const unavailable = () => ({ state: 'unavailable', tasks: [] })

function parseAgentTasks(value) {
  if (value?.state !== 'live' || !Array.isArray(value.tasks) || value.tasks.length > 4) return unavailable()
  const tasks = [], seen = new Set()
  for (const item of value.tasks) {
    if (!item || typeof item.taskId !== 'string' || !TASK.test(item.taskId) || seen.has(item.taskId) || !STATES.has(item.state)
      || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))) return unavailable()
    seen.add(item.taskId)
    let identity = null
    if (item.identity !== null) {
      const saved = item.identity
      if (!saved || typeof saved.id !== 'string' || saved.id.length > 64 || !ID.test(saved.id)
        || typeof saved.name !== 'string' || !saved.name.trim() || Buffer.byteLength(saved.name) > 120 || /[\x00-\x1f]/.test(saved.name)
        || !AVATARS.has(saved.avatar) || typeof saved.revision !== 'string' || !REVISION.test(saved.revision)) return unavailable()
      identity = { id: saved.id, name: saved.name, avatar: saved.avatar, revision: saved.revision }
    }
    tasks.push({ taskId: item.taskId, identity, state: item.state, updatedAt: item.updatedAt })
  }
  return { state: 'live', tasks }
}
module.exports = { parseAgentTasks }
