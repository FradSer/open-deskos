'use strict'
const disconnected = () => ({ status: 'disconnected', reason: 'bridge-unavailable', gateway: { status: 'disconnected' }, remote: { status: 'disconnected' }, peers: [], events: [] })
function createBridgeDeviceSource({ client, authorize = () => false } = {}) {
  let stopped = false
  let revision = 0
  const eventListeners = new Set()
  const snapshotListeners = new Set()
  const unsubscribeEvents = client?.onDeviceEvent?.(event => { if (!stopped) for (const listener of eventListeners) { try { listener(structuredClone(event)) } catch {} } })
  let current = client?.getDeviceSnapshot?.() || disconnected()
  const update = snapshot => {
    if (stopped) return
    revision++; current = structuredClone(snapshot)
    for (const listener of snapshotListeners) { try { listener(structuredClone(current)) } catch {} }
  }
  const unsubscribe = client?.onDeviceSnapshot?.(update)
  const cleanups = new Set([unsubscribe, unsubscribeEvents].filter(value => typeof value === 'function'))
  const snapshot = () => { if (!stopped) client?.getDeviceSnapshot?.(); return structuredClone(current) }
  return {
    snapshot,
    onSnapshot(listener) {
      if (stopped) return () => {}
      snapshotListeners.add(listener)
      try { listener(snapshot()) } catch {}
      return () => snapshotListeners.delete(listener)
    },
    onEvent(listener) { if (stopped) return () => {}; eventListeners.add(listener); return () => eventListeners.delete(listener) },
    async refresh() {
      if (stopped || !client?.deviceAction) return snapshot()
      const observedRevision = revision
      const reply = await client.deviceAction({ type: 'status' })
      if (!stopped && revision === observedRevision) update(reply?.ok && reply.snapshot ? reply.snapshot : disconnected())
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
      if (!stopped) update(disconnected())
      stopped = true; eventListeners.clear(); snapshotListeners.clear(); current = disconnected()
      const failures = []
      for (const cleanup of cleanups) { try { cleanup(); cleanups.delete(cleanup) } catch (error) { failures.push(error) } }
      if (failures.length) throw new AggregateError(failures, 'Bridge subscription cleanup failed')
    },
  }
}
module.exports = { createBridgeDeviceSource }
