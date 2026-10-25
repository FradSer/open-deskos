'use strict'
const { createHmac, timingSafeEqual } = require('node:crypto')
const { unicast } = require('./hydra-peer-store')

const TYPES = Object.freeze({ QUERY: 1, CHALLENGE: 2, WATER: 3, STOP: 4, PLAN: 5, ACK: 6, HEARTBEAT: 7 })
const PACKET_BYTES = 128, SIGNED_BYTES = 96, MAX_UINT64 = (1n << 64n) - 1n
const uint = (value, max) => Number.isInteger(value) && value >= 0 && value <= max
const uint64 = value => typeof value === 'bigint' && value >= 0n && value <= MAX_UINT64
const node = value => uint(value, 6) && value > 0
const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name))
const nonzero = bytes => bytes.some(value => value !== 0)
const fail = () => { throw new TypeError('invalid-hydra-control-frame') }

function validBody(type, body) {
  if (!Buffer.isBuffer(body)) return false
  if (type === TYPES.QUERY) return body.length === 0
  if (type === TYPES.CHALLENGE) return body.length === 8
  if (type === TYPES.WATER) return body.length === 5 && node(body[0]) && body.readUInt32LE(1) > 0 && body.readUInt32LE(1) <= 30000
  if (type === TYPES.STOP) return body.length === 1 && node(body[0])
  if (type === TYPES.HEARTBEAT) return body.length === 5 && node(body[0]) && body.readUInt32LE(1) > 0
  if (type === TYPES.ACK) return body.length === 7 && node(body[0]) && body[1] >= 1 && body[1] <= 3 && body[2] <= 1
  if (type !== TYPES.PLAN || body.length < 7 || !node(body[0]) || !body.readUInt32LE(1) || body[5] > 3 || body[6] > 4 || body.length !== 7 + body[6] * 4) return false
  let previous = -1
  for (let index = 0; index < body[6]; index++) {
    const offset = 7 + index * 4, minute = body.readUInt16LE(offset)
    if (minute > 239 || minute <= previous || body[offset + 2] < 2 || body[offset + 2] > 4 || body[offset + 3] > 1) return false
    previous = minute
  }
  return true
}

function validFrame(frame) {
  if (!exact(frame, ['type', 'main', 'gateway', 'boot', 'challenge', 'commandId', 'deadline', 'body'])
    || !unicast(frame.main) || !unicast(frame.gateway) || frame.main.toLowerCase() === frame.gateway.toLowerCase()
    || !uint64(frame.boot) || !uint64(frame.commandId) || !uint(frame.deadline, 0xffffffff)
    || !Buffer.isBuffer(frame.challenge) || frame.challenge.length !== 16 || !validBody(frame.type, frame.body)) return false
  if (frame.type === TYPES.QUERY) return frame.boot === 0n && !nonzero(frame.challenge) && frame.deadline === 0
  if (frame.boot === 0n) return false
  if (frame.type === TYPES.CHALLENGE && frame.commandId === 0n) return !nonzero(frame.challenge) && frame.deadline === 0
  if (frame.commandId === 0n || !nonzero(frame.challenge)) return false
  return frame.type !== TYPES.CHALLENGE || frame.body.readBigUInt64LE(0) >= frame.commandId
}

function encodeControlFrame(frame, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32 || !nonzero(key) || !validFrame(frame)) fail()
  const bytes = Buffer.alloc(PACKET_BYTES)
  bytes.write('HDC1', 0, 'ascii'); bytes[4] = frame.type
  Buffer.from(frame.main.replaceAll(':', ''), 'hex').copy(bytes, 5)
  Buffer.from(frame.gateway.replaceAll(':', ''), 'hex').copy(bytes, 11)
  bytes.writeBigUInt64LE(frame.boot, 17); frame.challenge.copy(bytes, 25)
  bytes.writeBigUInt64LE(frame.commandId, 41); bytes.writeUInt32LE(frame.deadline, 49)
  bytes[53] = frame.body.length; frame.body.copy(bytes, 54)
  createHmac('sha256', key).update(bytes.subarray(0, SIGNED_BYTES)).digest().copy(bytes, SIGNED_BYTES)
  return bytes
}

function decodeControlFrame(bytes, key, identity) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== PACKET_BYTES || !Buffer.isBuffer(key) || key.length !== 32 || !nonzero(key)
    || !exact(identity, ['main', 'gateway']) || !unicast(identity.main) || !unicast(identity.gateway)
    || bytes.subarray(0, 4).toString('ascii') !== 'HDC1' || bytes[53] > 40) return null
  const expected = createHmac('sha256', key).update(bytes.subarray(0, SIGNED_BYTES)).digest()
  if (!timingSafeEqual(expected, bytes.subarray(SIGNED_BYTES))) return null
  if (nonzero(bytes.subarray(54 + bytes[53], SIGNED_BYTES))) return null
  const mac = start => bytes.subarray(start, start + 6).toString('hex').match(/../g).join(':')
  const frame = { type: bytes[4], main: mac(5), gateway: mac(11), boot: bytes.readBigUInt64LE(17), challenge: Buffer.from(bytes.subarray(25, 41)),
    commandId: bytes.readBigUInt64LE(41), deadline: bytes.readUInt32LE(49), body: Buffer.from(bytes.subarray(54, 54 + bytes[53])) }
  if (frame.main !== identity.main.toLowerCase() || frame.gateway !== identity.gateway.toLowerCase() || !validFrame(frame)) return null
  return frame
}

function waterBody(id, durationMs) {
  if (!node(id) || !uint(durationMs, 30000) || !durationMs) fail()
  const body = Buffer.alloc(5); body[0] = id; body.writeUInt32LE(durationMs, 1)
  return body
}

function planBody(plan) {
  if (!exact(plan, ['node', 'windowSeq', 'season', 'entries']) || !node(plan.node) || !uint(plan.windowSeq, 0xffffffff) || !plan.windowSeq
    || !uint(plan.season, 3) || !Array.isArray(plan.entries) || plan.entries.length > 4) fail()
  const body = Buffer.alloc(7 + plan.entries.length * 4)
  body[0] = plan.node; body.writeUInt32LE(plan.windowSeq, 1); body[5] = plan.season; body[6] = plan.entries.length
  let previous = -1
  for (const [index, entry] of plan.entries.entries()) {
    if (!exact(entry, ['offsetMinutes', 'intent', 'night']) || !uint(entry.offsetMinutes, 239) || entry.offsetMinutes <= previous
      || !uint(entry.intent, 4) || entry.intent < 2 || typeof entry.night !== 'boolean') fail()
    const offset = 7 + index * 4; body.writeUInt16LE(entry.offsetMinutes, offset); body[offset + 2] = entry.intent; body[offset + 3] = Number(entry.night)
    previous = entry.offsetMinutes
  }
  return body
}

module.exports = { TYPES, PACKET_BYTES, encodeControlFrame, decodeControlFrame, waterBody, planBody }
