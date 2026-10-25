'use strict'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LINE = 2048
const inflight = new WeakMap()
const unavailable = () => ({ status: 'disconnected', reason: 'bridge-unavailable', gateway: { status: 'disconnected' }, remote: { status: 'disconnected' }, peers: [], events: [] })
function writeDeviceRecord(socket, record) {
  const line = JSON.stringify(record) + '\n'
  if (Buffer.byteLength(line) > MAX_LINE || socket.writableLength + Buffer.byteLength(line) > 65536) { socket.destroy(); return false }
  if (socket.destroyed) return false
  try { socket.write(line); return true } catch { socket.destroy(); return false }
}
function deviceSnapshot(adapter) { return typeof adapter?.deviceSnapshot === 'function' ? adapter.deviceSnapshot() : unavailable() }
function respondDeviceRequest(socket, record, adapter) {
  if (record.type !== 'device_request') return false
  if (record.v !== 1 || !UUID.test(record.requestId) || Object.keys(record).some(key => !['v', 'type', 'requestId', 'action'].includes(key))) return true
  if (Buffer.byteLength(JSON.stringify(record)) > MAX_LINE) return true
  socket.odkDeviceSubscriber = true
  const count = inflight.get(socket) || 0
  const respond = result => writeDeviceRecord(socket, { v: 1, type: 'device_reply', requestId: record.requestId, result })
  if (count >= 8) { respond({ ok: false, error: 'busy' }); return true }
  const action = record.action
  if (!action || Array.isArray(action) || typeof action !== 'object') { respond({ ok: false, error: 'invalid-action' }); return true }
  if (action.type === 'status' && Object.keys(action).length === 1) { respond({ ok: true, snapshot: deviceSnapshot(adapter) }); return true }
  inflight.set(socket, count + 1)
  void Promise.resolve().then(() => typeof adapter?.deviceAction === 'function' ? adapter.deviceAction(action) : { ok: false, error: 'unavailable' })
    .then(respond, () => respond({ ok: false, error: action.type === 'send' ? 'delivery-unknown' : 'unavailable' }))
    .finally(() => inflight.set(socket, (inflight.get(socket) || 1) - 1))
  return true
}
module.exports = { MAX_LINE, UUID, unavailable, writeDeviceRecord, deviceSnapshot, respondDeviceRequest }
