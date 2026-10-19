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
const MAX_PERSONAL_AGENT_TEXT_BYTES = 16 * 1024
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

function personalAgentUnavailable(message) {
  return { state: 'unavailable', message }
}

/** Bound a submitted owner turn the same way the resident channel does. */
function boundedTurnText(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (trimmed.length === 0) return ''
  const bytes = Buffer.from(trimmed, 'utf8')
  if (bytes.length <= MAX_PERSONAL_AGENT_TEXT_BYTES) return trimmed
  let end = MAX_PERSONAL_AGENT_TEXT_BYTES
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

function projectPersonalAgentFrame(status) {
  if (!status || typeof status !== 'object' || !PERSONAL_AGENT_STATES.has(status.state)) {
    return personalAgentUnavailable('Personal Agent state unavailable')
  }
  const frame = { state: status.state }
  for (const key of ['transcript', 'message', 'proposalError']) {
    if (typeof status[key] === 'string') frame[key] = status[key]
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
  boundedTurnText,
  MAX_PERSONAL_AGENT_FRAME_BYTES,
  MAX_PERSONAL_AGENT_TEXT_BYTES,
  PERSONAL_AGENT_STATES,
}