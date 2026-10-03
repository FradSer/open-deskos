import { mkdirSync, lstatSync, realpathSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readProactiveFile, checkProactivePath, protectProactivePath, openProactiveTemporary } from './proactive-private.mjs'

const LIMIT = 2 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validate(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.proposals) || state.proposals.length > 64 || new Set(state.proposals.map(p => p.id)).size !== state.proposals.length) throw Error('Invalid private proposal state')
  for (const p of state.proposals) {
    if (p.judgment !== undefined) {
      const j = p.judgment
      if (!j || Object.keys(j).some(key => !['model', 'probability', 'groundingProbability', 'threshold', 'trigger', 'judgedAt'].includes(key)) || typeof j.model !== 'string' || !/^jev-[\w.-]{1,60}$/.test(j.model) || !Number.isFinite(j.probability) || j.probability < 0 || j.probability > 1 || (j.groundingProbability !== undefined && (!Number.isFinite(j.groundingProbability) || j.groundingProbability < 0 || j.groundingProbability > 1)) || !Number.isFinite(j.threshold) || j.threshold <= 0.5 || j.threshold > 1 || !['heartbeat', 'service_push'].includes(j.trigger) || !Number.isFinite(Date.parse(j.judgedAt))) throw Error('Invalid private Jev judgment')
    }
    if (!UUID.test(p.id) || typeof p.ruleId !== 'string' || typeof p.subject !== 'string' || typeof p.ruleVersion !== 'string' ||
        !['pending', 'ignored', 'expired', 'executing', 'completed', 'unknown'].includes(p.status) ||
        typeof p.advice !== 'string' || p.advice.length > 1000 || typeof p.confirmation !== 'string' || p.confirmation.length > 2048 || typeof p.result !== 'string' || p.result.length > 8192 || !Number.isFinite(Date.parse(p.createdAt)) ||
        (p.status === 'completed' && !Number.isFinite(Date.parse(p.completedAt))) ||
        (p.routineDay !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(p.routineDay)) ||
        (p.action !== null && (!p.action || !['memory_update', 'user_app_install', 'coding_task_start', 'coding_task_history'].includes(p.action.tool) || typeof p.action.params !== 'object')) ||
        typeof p.offered !== 'boolean' || typeof p.presented !== 'boolean' || !Array.isArray(p.evidence) || p.evidence.length > 8 ||
        !p.evidence.every(e => e && typeof e.readingId === 'string' && typeof e.field === 'string' && typeof e.ruleId === 'string' && typeof e.state === 'string' && typeof e.measuredAt === 'string' && ['string', 'number', 'boolean'].includes(typeof e.value))) throw Error('Invalid private proposal state')
  }
  return state
}

/** Synchronous bounded checkpoints reserve an action before its existing tool runs. */
export function proposalStateStore(file) {
  const directory = dirname(file)
  function privateDirectory() {
    let exists = true
    try { lstatSync(directory) } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error }
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (process.platform === 'win32') {
      if (!exists) protectProactivePath(directory)
      checkProactivePath(directory)
      return
    }
    const info = lstatSync(directory)
    if (!info.isDirectory() || realpathSync(directory) !== directory || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw Error('Unsafe private proposal directory')
  }
  return {
    load() {
      privateDirectory()
      try { lstatSync(file) } catch (error) {
        if (error.code === 'ENOENT') return { version: 1, proposals: [] }
        throw error
      }
      return validate(JSON.parse(readProactiveFile(file, LIMIT)))
    },
    save(state) {
      privateDirectory()
      const content = JSON.stringify(validate(state))
      if (Buffer.byteLength(content) > LIMIT) throw Error('Private proposal state limit exceeded')
      const temporary = join(directory, `.state-${randomUUID()}.tmp`)
      try {
        const fd = openProactiveTemporary(temporary)
        try { writeFileSync(fd, content); fsyncSync(fd) } finally { closeSync(fd) }
        renameSync(temporary, file)
        if (process.platform === 'win32') return
        const directoryFd = openSync(directory, 'r')
        try { fsyncSync(directoryFd) } finally { closeSync(directoryFd) }
      } finally { try { unlinkSync(temporary) } catch {} }
    },
  }
}
