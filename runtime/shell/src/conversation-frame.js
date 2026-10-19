'use strict'
const { parseReplyTo } = require('./personal-bot-reply-reference')
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)
const text = (value, limit) => typeof value === 'string' && value.length <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)
/** Read-only display history. It grants no dispatch or receipt authority. */
function parseConversation(value) {
  try {
    if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.turns) || value.turns.length > 8
      || Buffer.byteLength(JSON.stringify(value)) > 61440 || (value.omittedCount !== undefined && (!Number.isSafeInteger(value.omittedCount) || value.omittedCount < 0))) return null
    const ids = new Set(), turns = []
    for (const item of value.turns) {
      if (!item || !uuid(item.id) || ids.has(item.id) || !Number.isFinite(item.at) || item.at < 0
        || !text(item.transcript, 4096) || !text(item.message, 16384) || !['idle', 'error', 'thinking', 'transcribing', 'unconfirmed'].includes(item.state)
        || (item.replyTo !== undefined && !parseReplyTo(item.replyTo))
        || (item.threadId !== undefined && (typeof item.threadId !== 'string' || !/^[a-f0-9]{64}$/.test(item.threadId)))) return null
      ids.add(item.id)
      turns.push({ id: item.id, at: item.at, transcript: item.transcript, message: item.message, state: item.state,
        ...(item.replyTo !== undefined ? { replyTo: parseReplyTo(item.replyTo) } : {}), ...(item.threadId !== undefined ? { threadId: item.threadId } : {}) })
    }
    return { revision: value.revision, turns, omittedCount: value.omittedCount ?? 0 }
  } catch { return null }
}
module.exports = { parseConversation }
