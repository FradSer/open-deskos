const { parseConversation } = require('./conversation-frame')
const { parseReplyTo } = require('./personal-agent-reply-reference')
/**
 * The Personal Agent frame the Android Shell Host receives.
 *
 * The resident Personal Agent produces every briefing, reply and notification.
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

// Same bounds as the service-side proposal state (proactive-state.mjs). The Shell
// frame is CJS and cannot import the ESM service module, so the contract is
// mirrored here; both ends must agree on what a renderable OpenUI tree is.
const UI_MAX_BYTES = 16384
const UI_MAX_DEPTH = 8
const plainObject = value => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Bounded plain-JSON component tree; props/children containers do not add depth. */
function validOpenUITree(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || !plainObject(node) || typeof node.type !== 'string' || !node.type) return false
  let serialized
  try { serialized = JSON.stringify(node) } catch { return false }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > UI_MAX_BYTES) return false
  const stack = [[node, 1]]
  while (stack.length) {
    const [value, depth] = stack.pop()
    const kind = typeof value
    if (['function', 'symbol', 'bigint', 'undefined'].includes(kind)) return false
    if (value === null) continue
    if (kind === 'number') { if (!Number.isFinite(value)) return false; continue }
    if (kind !== 'object') { if (kind !== 'string' && kind !== 'boolean') return false; continue }
    const isNode = !Array.isArray(value) && typeof value.type === 'string'
    if (!Array.isArray(value) && !plainObject(value)) return false
    if (isNode && depth > UI_MAX_DEPTH) return false
    // A component's children container must be an array of nodes, not a scalar.
    if (isNode && Object.hasOwn(value, 'children')) {
      if (!Array.isArray(value.children) || value.children.some(child => !child || typeof child !== 'object' || Array.isArray(child) || typeof child.type !== 'string')) return false
    }
    if (isNode && value.props !== undefined && value.props !== null && (typeof value.props !== 'object' || Array.isArray(value.props) || !plainObject(value.props))) return false
    for (const child of Object.values(value)) stack.push([child, isNode ? depth + 1 : depth])
  }
  return true
}

function parseReplyPresentation(status) {
  const presentation = status.replyPresentation
  if (status.state !== 'idle' || status.replyTo || !status.message || typeof presentation?.text !== 'string'
      || !presentation.text.trim() || presentation.text.length > 180
      || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(presentation.text)
      || presentation.ui?.type !== 'Suggestion' || !validOpenUITree(presentation.ui)) return undefined
  return { text: presentation.text, ui: presentation.ui }
}

const VOICE_FAILURES = new Set(['microphone','timeout','unavailable','protocol','invalid_audio','cleanup'])
function parseVoiceFailure(status) {
  return status.state === 'error' && VOICE_FAILURES.has(status.voiceFailure) ? status.voiceFailure : undefined
}

function personalAgentUnavailable(message) {
  return { state: 'unavailable', message }
}

const isGmailMessageId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const isCalendarReadingId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)

function parseProposalSources(value) {
  if (!Array.isArray(value) || !value.length || value.length > 8) return null
  const sources = []
  for (const source of value) {
    if (source?.kind === 'gmail' && source.label === 'Gmail' && isGmailMessageId(source.messageId)) {
      sources.push({ kind: 'gmail', label: 'Gmail', messageId: source.messageId })
    } else if (source?.kind === 'calendar' && source.label === 'Calendar' && isCalendarReadingId(source.readingId)) {
      sources.push({ kind: 'calendar', label: 'Calendar', readingId: source.readingId })
    } else return null
  }
  return sources
}

function privateProposal(proposal) {
  if (proposal?.privateData === true || (Array.isArray(proposal?.sources) && proposal.sources.some(source => source?.kind === 'gmail'))) return true
  // An owner-selected reading grants the resident context, not remote display access.
  const ruleId = proposal?.ruleId
  if (proposal?.action !== null || typeof ruleId !== 'string' || !/^intent-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ruleId)
    || !Array.isArray(proposal.evidence)) return false
  const syntheticReading = 'intent.' + ruleId.slice('intent-'.length)
  return proposal.evidence.some(row => typeof row?.readingId === 'string' && row.readingId !== syntheticReading)
}

function readableProposals(value) {
  if (!Array.isArray(value) || value.length > 64) return null
  const kept = []
  for (const p of value) {
    if (!p || typeof p.id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.id) ||
        typeof p.advice !== 'string' || p.advice.length > 1000 || !['pending', 'ignored', 'expired', 'executing', 'completed', 'unknown'].includes(p.status)) return null
    if (privateProposal(p)) continue
    const row = { id: p.id, status: p.status, advice: p.advice, action: null, confirmation: '', offered: p.offered === true, presented: p.presented === true }
    if (p.sources !== undefined) {
      const sources = parseProposalSources(p.sources)
      if (!sources || p.action !== null) return null
      row.sources = sources
    }
    if (Object.hasOwn(p, 'nextStep')) {
      if (typeof p.nextStep !== 'string' || !p.nextStep.trim() || p.nextStep.length > 240 || /[\x00-\x1f\x7f]/.test(p.nextStep)) return null
      row.nextStep = p.nextStep
    }
    for (const [key, limit] of [['ruleId', 128], ['createdAt', 40], ['completedAt', 40]]) {
      if (typeof p[key] === 'string' && p[key].length <= limit) row[key] = p[key]
    }
    if (['done', 'snooze', 'useful', 'irrelevant', 'incorrect'].includes(p.feedback)) row.feedback = p.feedback
    if (p.feedbackLearning !== undefined) {
      const learning = p.feedbackLearning
      if (!learning || !Number.isSafeInteger(learning.revision) || learning.revision < 1 ||
          !['done', 'snooze', 'useful', 'irrelevant', 'incorrect', 'ignore', 'mute'].includes(learning.decision) ||
          !['queued', 'running', 'applied', 'failed', 'unavailable', 'stale'].includes(learning.status)) return null
      row.feedbackLearning = { revision: learning.revision, decision: learning.decision, status: learning.status }
    }
    if (Number.isFinite(p.snoozedUntil) && p.snoozedUntil >= 0) row.snoozedUntil = p.snoozedUntil
    // The Android host renders the same OpenUI tree as the desk Shell. Reject a
    // malformed tree rather than projecting a proposal it cannot compose.
    if (p.ui !== undefined) {
      if (!validOpenUITree(p.ui)) return null
      row.ui = p.ui
    }
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
  const ownerOnly = status.ownerOnly === true
  const voiceFailure = parseVoiceFailure(status)
  if (voiceFailure) frame.voiceFailure = voiceFailure
  for (const key of ['transcript', 'message', 'proposalError']) {
    if ((!ownerOnly || key === 'proposalError') && typeof status[key] === 'string') frame[key] = status[key]
  }
  for (const key of ['ownerTurnId', 'threadId']) {
    if (!ownerOnly && typeof status[key] === 'string' && (key === 'threadId' ? /^[a-f0-9]{64}$/.test(status[key]) : /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(status[key]))) frame[key] = status[key]
  }
  if (!ownerOnly && status.replyTo !== undefined && parseReplyTo(status.replyTo)) frame.replyTo = parseReplyTo(status.replyTo)
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
    // A private-only update must not announce a suggestion on the remote display.
    const omittedPrivate = Array.isArray(status.proposals) && status.proposals.some(privateProposal)
    frame.proposalPopup = readable && status.proposalPopup === true
      && (!omittedPrivate || proposals.some(p => p.status === 'pending' && p.offered && !p.presented))
    frame.proposalInteraction = readable && status.proposalInteraction === true
    frame.proposalRecovery = readable && status.proposalRecovery === true
    frame.proposalHiddenCount = Number.isSafeInteger(status.proposalHiddenCount) && status.proposalHiddenCount >= 0 ? status.proposalHiddenCount : 0
  }
  const replyPresentation = parseReplyPresentation(status)
  if (replyPresentation) {
    const presented = { ...frame, replyPresentation }
    if (Buffer.byteLength(JSON.stringify(presented), 'utf8') <= MAX_PERSONAL_AGENT_FRAME_BYTES) return presented
  }
  if (Buffer.byteLength(JSON.stringify(frame), 'utf8') > MAX_PERSONAL_AGENT_FRAME_BYTES) {
    return personalAgentUnavailable('Personal Agent state exceeded its bound')
  }
  return frame
}

module.exports = {
  projectPersonalAgentFrame,
  parseProposalSources,
  isGmailMessageId,
  parseVoiceFailure,
  parseReplyPresentation,
  MAX_PERSONAL_AGENT_FRAME_BYTES,
  PERSONAL_AGENT_STATES,
}
