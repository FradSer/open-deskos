'use strict'
// ESP-NOW v1 compatibility: 24-byte header, at most 226 bytes per fragment.
const HEADER = 24
const CHUNK = 226
const MAX = 512
const TYPES = Object.freeze({ HELLO: 1, HELLO_ACK: 2, INPUT: 3, STATE: 4, STATE_ACK: 5 })
function frames(type, remote, host, sequence, payload = Buffer.alloc(0)) {
  if (!Object.values(TYPES).includes(type) || ![remote, host, sequence].every(n => Number.isInteger(n) && n >= 0 && n <= 0xffffffff) || !remote
    || !Buffer.isBuffer(payload) || payload.length > MAX || (type !== TYPES.STATE && payload.length > CHUNK)) throw Error('invalid-radio-frame')
  const count = Math.max(1, Math.ceil(payload.length / CHUNK))
  return Array.from({ length: count }, (_, part) => {
    const frame = Buffer.alloc(HEADER + Math.min(CHUNK, payload.length - part * CHUNK))
    frame.write('ODKR'); frame[4] = 1; frame[5] = type; frame[6] = part; frame[7] = count
    frame.writeUInt32LE(remote, 8); frame.writeUInt32LE(host, 12); frame.writeUInt32LE(sequence, 16); frame.writeUInt16LE(payload.length, 20)
    payload.copy(frame, HEADER, part * CHUNK, (part + 1) * CHUNK)
    return frame
  })
}
function decode(frame) {
  if (!Buffer.isBuffer(frame) || frame.length < HEADER || frame.length > 250 || frame.toString('ascii', 0, 4) !== 'ODKR' || frame[4] !== 1
    || !Object.values(TYPES).includes(frame[5]) || frame.readUInt16LE(22) !== 0) return null
  const type = frame[5], part = frame[6], count = frame[7], total = frame.readUInt16LE(20)
  if (!frame.readUInt32LE(8) || total > MAX || count !== Math.max(1, Math.ceil(total / CHUNK)) || part >= count
    || (type !== TYPES.STATE && count !== 1) || frame.length !== HEADER + Math.min(CHUNK, total - part * CHUNK)) return null
  if ([TYPES.HELLO, TYPES.HELLO_ACK, TYPES.STATE_ACK].includes(type) && total) return null
  return { type, part, count, remote: frame.readUInt32LE(8), host: frame.readUInt32LE(12), sequence: frame.readUInt32LE(16), total, payload: frame.subarray(HEADER) }
}
function boundedText(value, max) {
  if (typeof value !== 'string') return ''
  let result = ''
  for (const char of value) { if (Buffer.byteLength(result + char) > max) break; result += char }
  return result
}
function statePayload(record) {
  if (!Number.isInteger(record.page) || record.page < 1 || record.page > 65535 || !Number.isInteger(record.pages) || record.pages < record.page || record.pages > 65535) throw Error('unsupported-remote-state')
  // Action identifiers must remain exact. Drop unsupported actions instead of truncating authority.
  const actions = (record.actions || []).map(a => ({ id: a.id || a.action, label: a.label || a.name })).filter(a => typeof a.id === 'string' && a.id && Buffer.byteLength(a.id) <= 31 && !/[\x00-\x1f]/.test(a.id)
      && Buffer.byteLength(JSON.stringify({ v: 1, type: 'input', input: 'action', action: a.id })) <= 90).slice(0, 4)
    .map(a => ({ id: a.id, label: boundedText(a.label, 15) || '?'  }))
  const payload = Buffer.from(JSON.stringify({ v: 1, type: 'state', link: 'wireless', page: record.page, pages: record.pages,
    name: boundedText(record.name, 47), canPrev: record.canPrev, canNext: record.canNext, actions }))
  if (payload.length > MAX) throw Error('unsupported-remote-state')
  return payload
}
module.exports = { HEADER, CHUNK, MAX, TYPES, frames, decode, statePayload }
