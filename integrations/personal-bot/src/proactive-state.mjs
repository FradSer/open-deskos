import { isJudgmentModel } from './judgment-client.mjs'
import { validRidePreview } from './didi/preview.mjs'
import { INTENT_OUTCOMES, isIntentRuleId } from './intents.mjs'
import { lstatSync, realpathSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readProactiveFile, checkProactivePath, createProactiveDirectory, openProactiveTemporary } from './proactive-private.mjs'

const LIMIT = 2 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validate(state) {
  if (!state || state.version !== 1 || !Array.isArray(state.proposals) || state.proposals.length > 64 || new Set(state.proposals.map(p => p.id)).size !== state.proposals.length) throw Error('Invalid private proposal state')
  if (state.observationEpisodes !== undefined && (!state.observationEpisodes || typeof state.observationEpisodes !== 'object' || Array.isArray(state.observationEpisodes) || Object.keys(state.observationEpisodes).length > 64
    || !Object.entries(state.observationEpisodes).every(([id, episode]) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && episode && Object.keys(episode).sort().join(',') === 'key,sequence'
      && typeof episode.key === 'string' && /^[0-9a-f]{64}$/.test(episode.key) && Number.isSafeInteger(episode.sequence) && episode.sequence >= 0))) throw Error('Invalid recommendation observation episodes')
  if (state.isolatedTopics !== undefined && (!Array.isArray(state.isolatedTopics) || state.isolatedTopics.length > 64 || new Set(state.isolatedTopics).size !== state.isolatedTopics.length || !state.isolatedTopics.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)))) throw Error('Invalid isolated recommendation topics')
  if (state.handledOccurrences !== undefined && (!state.handledOccurrences || typeof state.handledOccurrences !== 'object' || Array.isArray(state.handledOccurrences) || Object.keys(state.handledOccurrences).length > 1024
    || !Object.entries(state.handledOccurrences).every(([key, receipt]) => receipt && Object.keys(receipt).sort().join(',') === 'fingerprint,needKey,observationKey,occurrenceKey,ruleId,ruleVersionKey,status,subject'
      && ['fingerprint', 'needKey', 'observationKey', 'occurrenceKey', 'ruleVersionKey'].every(field => typeof receipt[field] === 'string' && /^[0-9a-f]{64}$/.test(receipt[field]))
      && key === receipt.occurrenceKey && typeof receipt.ruleId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(receipt.ruleId)
      && typeof receipt.subject === 'string' && receipt.subject.length <= 256 && ['ignored', 'completed'].includes(receipt.status)))) throw Error('Invalid handled recommendation receipts')
  if (state.lastAttentionAt !== undefined && (!Number.isSafeInteger(state.lastAttentionAt) || state.lastAttentionAt < 0 || state.lastAttentionAt > 8640000000000000)) throw Error('Invalid proposal attention checkpoint')
  if (state.generationCache !== undefined && (!state.generationCache || typeof state.generationCache !== 'object' || Array.isArray(state.generationCache) || Object.keys(state.generationCache).length > 64 || !Object.entries(state.generationCache).every(([id, item]) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && item && Object.keys(item).sort().join(',') === 'at,key' && typeof item.key === 'string' && item.key.length <= 8192 && Number.isSafeInteger(item.at) && item.at >= 0 && item.at <= 8640000000000000))) throw Error('Invalid proposal generation checkpoint')
  if (state.intentClaims !== undefined && (!Array.isArray(state.intentClaims) || state.intentClaims.length > 256 || new Set(state.intentClaims.map(c => c.key)).size !== state.intentClaims.length || !state.intentClaims.every(c => c && Object.keys(c).every(k => ['key', 'intentId', 'revision', 'date', 'status', 'updatedAt', 'model', 'contextHash'].includes(k)) && typeof c.key === 'string' && c.key.length <= 120 && UUID.test(c.intentId) && Number.isInteger(c.revision) && c.revision > 0 && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && c.key === `${c.intentId}:${c.revision}:${c.date}` && INTENT_OUTCOMES.includes(c.status) && Number.isFinite(Date.parse(c.updatedAt)) && (c.contextHash === undefined || /^[0-9a-f]{64}$/.test(c.contextHash)) && (c.model === undefined || isJudgmentModel(c.model))))) throw Error('Invalid Intent occurrence state')
  if (state.intentWatermarks !== undefined && (!state.intentWatermarks || typeof state.intentWatermarks !== 'object' || Array.isArray(state.intentWatermarks) || Object.keys(state.intentWatermarks).length > 16 || !Object.entries(state.intentWatermarks).every(([id, w]) => UUID.test(id) && w && Object.keys(w).sort().join(',') === 'date,revision' && Number.isInteger(w.revision) && w.revision > 0 && /^\d{4}-\d{2}-\d{2}$/.test(w.date)))) throw Error('Invalid Intent date watermark')
  if (state.intentArchive !== undefined && (!state.intentArchive || Object.keys(state.intentArchive).sort().join(',') !== 'byStatus,count' || !Number.isSafeInteger(state.intentArchive.count) || state.intentArchive.count < 0 || !state.intentArchive.byStatus || typeof state.intentArchive.byStatus !== 'object' || Array.isArray(state.intentArchive.byStatus) || !Object.entries(state.intentArchive.byStatus).every(([status, count]) => INTENT_OUTCOMES.includes(status) && Number.isSafeInteger(count) && count >= 0) || Object.values(state.intentArchive.byStatus).reduce((sum, n) => sum + n, 0) !== state.intentArchive.count)) throw Error('Invalid Intent archive summary')
  for (const p of state.proposals) {
    if (['needKey', 'observationKey', 'occurrenceKey'].some(key => p[key] !== undefined && !/^[0-9a-f]{64}$/.test(p[key]))
      || (p.reason !== undefined && (typeof p.reason !== 'string' || p.reason.length > 600 || /[\x00-\x08]/.test(p.reason)))
      || (p.feedback !== undefined && !['done', 'snooze', 'useful', 'irrelevant', 'incorrect', 'ignore'].includes(p.feedback))
      || (p.snoozedUntil !== undefined && (!Number.isSafeInteger(p.snoozedUntil) || p.snoozedUntil < 0 || p.snoozedUntil > 8640000000000000))) throw Error('Invalid proposal occurrence or feedback')
    if (p.ridePreview !== undefined && (p.action !== null || !isIntentRuleId(p.ruleId) || !validRidePreview(p.ridePreview))) throw Error('Invalid read-only ride preview')
    if (p.judgment !== undefined) {
      const j = p.judgment
      if (!j || Object.keys(j).some(key => !['model', 'probability', 'groundingProbability', 'threshold', 'trigger', 'judgedAt'].includes(key)) || typeof j.model !== 'string' || !isJudgmentModel(j.model) || !Number.isFinite(j.probability) || j.probability < 0 || j.probability > 1 || (j.groundingProbability !== undefined && (!Number.isFinite(j.groundingProbability) || j.groundingProbability < 0 || j.groundingProbability > 1)) || !Number.isFinite(j.threshold) || j.threshold <= 0.5 || j.threshold > 1 || !['heartbeat', 'service_push'].includes(j.trigger) || !Number.isFinite(Date.parse(j.judgedAt))) throw Error('Invalid private judgment')
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
    createProactiveDirectory(directory)
    if (process.platform === 'win32') {
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
