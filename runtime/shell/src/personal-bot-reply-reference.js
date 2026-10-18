'use strict'

const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

function parseReplyTo(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
    || !['messageId','sourceKey','sourceRevision'].every(key => Object.hasOwn(value,key))
    || !sha(value.messageId) || !sha(value.sourceRevision) || typeof value.sourceKey !== 'string'
    || !value.sourceKey.trim() || value.sourceKey.length > 256 || /[\x00-\x1f\x7f]/.test(value.sourceKey)) return null
  return { messageId: value.messageId, sourceKey: value.sourceKey, sourceRevision: value.sourceRevision }
}

module.exports = { parseReplyTo }
