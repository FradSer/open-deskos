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

const VOICE_FAILURES = new Set(['microphone','timeout','unavailable','protocol','invalid_audio','cleanup'])
function parseVoiceFailure(status) {
  return status.state === 'error' && VOICE_FAILURES.has(status.voiceFailure) ? status.voiceFailure : undefined
}

function personalAgentUnavailable(message) {
  return { state: 'unavailable', message }
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