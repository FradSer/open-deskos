'use strict'
const disconnected = () => ({ status: 'disconnected', reason: 'bridge-unavailable', gateway: { status: 'disconnected' }, remote: { status: 'disconnected' }, peers: [], events: [] })
function createBridgeDeviceSource({ client, authorize = () => false } = {}) {
  let stopped = false
  let revision = 0
  const eventListeners = new Set()
  const unsubscribeEvents = client?.onDeviceEvent?.(event => { if (!stopped) for (const listener of eventListeners) { try { listener(structuredClone(event)) } catch {} } })
  let current = client?.getDeviceSnapshot?.() || disconnected()
  const unsubscribe = client?.onDeviceSnapshot?.(snapshot => { if (!stopped) { revision++; current = structuredClone(snapshot) } })
  const snapshot = () => { if (!stopped) client?.getDeviceSnapshot?.(); return structuredClone(current) }
  return {
    snapshot,
    onEvent(listener) { if (stopped) return () => {}; eventListeners.add(listener); return () => eventListeners.delete(listener) },
    async refresh() {
      if (stopped || !client?.deviceAction) return snapshot()
      const observedRevision = revision
      const reply = await client.deviceAction({ type: 'status' })
      if (!stopped && revision === observedRevision) current = reply?.ok && reply.snapshot ? structuredClone(reply.snapshot) : disconnected()
      return snapshot()
    },
    async action(action) {
      if (stopped || !client?.deviceAction) return { ok: false, error: 'unavailable' }
      try {
        const result = await client.deviceAction(action)
        return stopped ? { ok: false, error: action?.type === 'send' ? 'delivery-unknown' : 'unavailable' } : result
      } catch { return { ok: false, error: action?.type === 'send' ? 'delivery-unknown' : 'unavailable' } }
    },
    dispatch(event, action) {
      if (!authorize(event)) return Promise.resolve({ ok: false, error: 'unauthorized' })
      return action?.type === 'status' ? this.refresh() : this.action(action)
    },
    stop() {
      if (stopped) return
      stopped = true; unsubscribe?.(); unsubscribeEvents?.(); eventListeners.clear(); current = disconnected()
    },
  }
}
module.exports = { createBridgeDeviceSource }
