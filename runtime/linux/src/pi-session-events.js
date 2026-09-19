'use strict'

const MAX_EVENTS = 300
const MAX_SUMMARY_TEXT = 200
// Every event keeps the body Pi produced, so a bash command, a prompt, or a
// result is read in full instead of being flattened to one line. The bounds are
// per kind: an inspection surface bounds each body, never the whole event away.
const MAX_RESULT_BYTES = 64 * 1024
const MAX_MESSAGE_BYTES = 16 * 1024
const MAX_USER_BYTES = 8 * 1024
const MAX_THINKING_BYTES = 4 * 1024
const MAX_TOOL_BYTES = 4 * 1024
const MAX_SESSION_EVENT_BYTES = 1024 * 1024
const EVENT_KINDS = new Set(['user', 'thinking', 'tool', 'result', 'assistant'])
const BODY_BYTES = {
  result: MAX_RESULT_BYTES,
  assistant: MAX_MESSAGE_BYTES,
  user: MAX_USER_BYTES,
  thinking: MAX_THINKING_BYTES,
  tool: MAX_TOOL_BYTES,
}

function summaryText(value, max = MAX_SUMMARY_TEXT) {
  if (typeof value !== 'string') return ''
  const line = value.split(/\r?\n/).map(part => part.replace(/\s+/g, ' ').trim()).find(Boolean) || ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function bodyText(value, maxBytes) {
  if (typeof value !== 'string' || !value.trim()) return null
  const bytes = Buffer.from(value)
  if (bytes.length <= maxBytes) return { text: value }
  let end = maxBytes
  // Do not split a multibyte codepoint at the byte limit.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return { text: bytes.subarray(0, end).toString('utf8'), truncated: true }
}

function boundedEvent(event) {
  if (!event || typeof event !== 'object' || !EVENT_KINDS.has(event.kind)) return null
  const body = bodyText(event.text, BODY_BYTES[event.kind])
  if (!body) return null
  const toolName = summaryText(event.toolName)
  return { kind: event.kind, ...body, ...(toolName ? { toolName } : {}), ...(event.truncated === true ? { truncated: true } : {}) }
}

function retainEvents(events, maxEvents = MAX_EVENTS) {
  const retained = []
  let bytes = 0
  for (let index = events.length - 1; index >= 0 && retained.length < maxEvents; index -= 1) {
    const event = events[index]
    const size = Buffer.byteLength(event.text) + Buffer.byteLength(event.toolName || '')
    if (bytes + size > MAX_SESSION_EVENT_BYTES) break
    retained.push(event)
    bytes += size
  }
  return retained.reverse()
}

module.exports = {
  boundedEvent, retainEvents, summaryText,
  MAX_EVENTS, MAX_RESULT_BYTES, MAX_MESSAGE_BYTES, MAX_USER_BYTES, MAX_THINKING_BYTES, MAX_TOOL_BYTES,
  MAX_SESSION_EVENT_BYTES, BODY_BYTES,
}
