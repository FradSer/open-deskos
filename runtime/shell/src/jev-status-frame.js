const STATUSES = new Set(['checking', 'verified', 'missing_credential', 'auth_rejected', 'unavailable'])
const REASONS = new Set(['timeout', 'network', 'rate_limited', 'upstream', 'invalid_response', 'configuration', 'credential_unavailable', 'request_rejected'])

function parseJevStatus(value) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value) || !STATUSES.has(value.status)
    || (value.reason !== undefined && (value.status !== 'unavailable' || !REASONS.has(value.reason)))) return { status: 'unavailable' }
  return { status: value.status, ...(value.reason !== undefined ? { reason: value.reason } : {}) }
}

module.exports = { parseJevStatus }
