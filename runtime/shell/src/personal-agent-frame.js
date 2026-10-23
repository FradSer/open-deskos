const { parseConversation } = require('./conversation-frame')
const { parseReplyTo } = require('./personal-bot-reply-reference')
/**
 * The Personal Agent frame the Android Shell Host receives.
 *
 * The resident Personal Bot produces every briefing, reply and notification.
 * Android holds no generator, so this projection is the only content that
 * crosses the link: it keeps the fields the Shell renderer reads and drops
 * everything else. An oversized or malformed status degrades to an explicit
 * unavailable state rather than a silently truncated one.
 */

const MAX_PERSONAL_AGENT_FRAME_BYTES = 128 * 1024
const PERSONAL_AGENT_STATES = new Set([
  'idle',
  'recording',
  'starting',
  'sending',
  'transcribing',
  'thinking',
  'unavailable',
  'error',
])

const VOICE_FAILURES = new Set(['microphone','timeout','unavailable','protocol','invalid_audio','cleanup'])
function parseVoiceFailure(status) {
  return status.state === 'error' && VOICE_FAILURES.has(status.voiceFailure) ? status.voiceFailure : undefined
}

function personalAgentUnavailable(message) {
  return { state: 'unavailable', message }
}

function readableProposals(value) {
  if (!Array.isArray(value) || value.length > 64) return null
  const kept = []
  for (const p of value) {
    if (!p || typeof p.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.id) ||
        typeof p.advice !== 'string' || p.advice.length > 1000 || !['pending', 'ignored', 'expired', 'executing', 'completed', 'unknown'].includes(p.status)) return null
    const row = { id: p.id, status: p.status, advice: p.advice, action: null, confirmation: '', offered: p.offered === true, presented: p.presented === true }
    if (Object.hasOwn(p, 'nextStep')) {
      if (typeof p.nextStep !== 'string' || !p.nextStep.trim() || p.nextStep.length > 240 || /[\x00-\x1f\x7f]/.test(p.nextStep)) return null
      row.nextStep = p.nextStep
    }
    for (const [key, limit] of [['ruleId', 128], ['createdAt', 40], ['completedAt', 40]]) {
      if (typeof p[key] === 'string' && p[key].length <= limit) row[key] = p[key]
    }
    if (['done', 'snooze', 'useful', 'irrelevant', 'incorrect'].includes(p.feedback)) row.feedback = p.feedback
    if (Number.isFinite(p.snoozedUntil) && p.snoozedUntil >= 0) row.snoozedUntil = p.snoozedUntil
    row.evidence = []
    if (!Array.isArray(p.evidence) || p.evidence.length > 8) return null
    for (const e of p.evidence) {
      if (!e || !['string', 'number', 'boolean'].includes(typeof e.value) || (typeof e.value === 'number' && !Number.isFinite(e.value)) ||
          (typeof e.value === 'string' && e.value.length > 256) || !['readingId', 'field', 'state', 'measuredAt'].every(key => typeof e[key] === 'string' && e[key].length <= 256)) return null
      const item = Object.fromEntries(['readingId', 'field', 'value', 'state', 'measuredAt'].map(key => [key, e[key]]))
      if (typeof e.ruleId === 'string' && e.ruleId.length <= 128) item.ruleId = e.ruleId
      row.evidence.push(item)
    }
    kept.push(row)
  }
  return kept
}

function projectPersonalAgentFrame(status) {
  if (!status || typeof status !== 'object' || !PERSONAL_AGENT_STATES.has(status.state)) {
    return personalAgentUnavailable('Personal Agent state unavailable')
  }
  const frame = { state: status.state, voiceInput: false }
  const voiceFailure = parseVoiceFailure(status)
  if (voiceFailure) frame.voiceFailure = voiceFailure
  for (const key of ['transcript', 'message', 'proposalError']) {
    if (typeof status[key] === 'string') frame[key] = status[key]
  }
  for (const key of ['ownerTurnId', 'threadId']) {
    if (typeof status[key] === 'string' && (key === 'threadId' ? /^[a-f0-9]{64}$/.test(status[key]) : /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(status[key]))) frame[key] = status[key]
  }
  if (status.replyTo !== undefined && parseReplyTo(status.replyTo)) frame.replyTo = parseReplyTo(status.replyTo)
  if (status.conversation && parseConversation(status.conversation)) frame.conversation = parseConversation(status.conversation)
  for (const key of ['textInput', 'replyInput']) if (typeof status[key] === 'boolean') frame[key] = status[key]
  if (status.judgment && typeof status.judgment === 'object') {
    frame.judgment = {}
    for (const key of ['status', 'provider', 'model']) if (typeof status.judgment[key] === 'string' && status.judgment[key].length <= 256) frame.judgment[key] = status.judgment[key]
  }
  if (Array.isArray(status.notifications)) {
    frame.notifications = status.notifications
      .filter((notification) => notification && typeof notification.id === 'string' && typeof notification.message === 'string')
      .map((notification) => ({ id: notification.id, message: notification.message }))
  }
  for (const key of ['briefing', 'agents', 'remote']) {
    if (status[key] && typeof status[key] === 'object') frame[key] = status[key]
  }
  if (Array.isArray(status.proposals) || status.proposalCapabilities !== undefined) {
    const proposals = readableProposals(status.proposals ?? [])
    const readable = proposals !== null && (status.proposalCapabilities === undefined || status.proposalCapabilities?.read === true)
    frame.proposalCapabilities = { read: readable, respond: false, acknowledge: false }
    frame.proposals = readable ? proposals : []
    frame.proposalPopup = readable && status.proposalPopup === true
    frame.proposalInteraction = readable && status.proposalInteraction === true
    frame.proposalRecovery = readable && status.proposalRecovery === true
    frame.proposalHiddenCount = Number.isSafeInteger(status.proposalHiddenCount) && status.proposalHiddenCount >= 0 ? status.proposalHiddenCount : 0
  }
  if (Buffer.byteLength(JSON.stringify(frame), 'utf8') > MAX_PERSONAL_AGENT_FRAME_BYTES) {
    return personalAgentUnavailable('Personal Agent state exceeded its bound')
  }
  return frame
}

module.exports = {
  projectPersonalAgentFrame,
  parseVoiceFailure,
  MAX_PERSONAL_AGENT_FRAME_BYTES,
  PERSONAL_AGENT_STATES,
}
