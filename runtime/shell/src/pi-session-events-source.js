const { readSessionEvents } = require('./pi-sessions')
const { createPiReadSource } = require('./pi-read-source')

function createPiSessionEventsSource({ odkLink, readLocal = readSessionEvents, signal }) {
  const unavailable = () => ({ ok: false, reason: 'pi-source-stopped' })
  return createPiReadSource({ signal, unavailable, read: async (active, _own, request) => {
    const reported = await odkLink.sessionEvents(request.sessionId, { hostedPi: request.hostedPi === true, signal: active })
    if (active.aborted) return unavailable()
    if (reported.ok) return reported
    // An unavailable optional Open DeskOS Link cannot block local log inspection.
    // A known reported session's own unavailable/empty state stays authoritative.
    if (!['session-log-missing', 'odk-link-unconfigured', 'odk-link-unavailable'].includes(reported.reason)) return reported
    return readLocal(request)
  } })
}

module.exports = { createPiSessionEventsSource }
