const { readSessionEvents } = require('./pi-sessions')

function createPiSessionEventsSource({ deskLink, readLocal = readSessionEvents }) {
  return async (request) => {
    const reported = await deskLink.sessionEvents(request.sessionId)
    if (reported.ok) return reported
    // An unavailable optional Desk Link cannot block local log inspection.
    // A known reported session's own unavailable/empty state stays authoritative.
    if (!['session-log-missing', 'desk-link-unconfigured', 'desk-link-unavailable'].includes(reported.reason)) return reported
    return readLocal(request)
  }
}

module.exports = { createPiSessionEventsSource }
