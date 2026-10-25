'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { encodeControlFrame, decodeControlFrame, waterBody, planBody, TYPES } = require('../src/hydra-control-codec')
const KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index))
const MAIN = '02:00:00:00:00:01', GATEWAY = '02:00:00:00:00:02'
const base = () => ({ type: TYPES.WATER, main: MAIN, gateway: GATEWAY, boot: 0x0102030405060708n,
  challenge: Buffer.alloc(16, 0x11), commandId: 0x1112131415161718n, deadline: 0xfffffff0, body: waterBody(2, 1200) })
const decode = bytes => decodeControlFrame(bytes, KEY, { main: MAIN, gateway: GATEWAY })
const sign = bytes => { createHmac('sha256', KEY).update(bytes.subarray(0, 96)).digest().copy(bytes, 96); return bytes }

test('HDC1 matches an independently generated Python hmac and struct vector', () => {
  const golden = '48444331030200000000010200000000020807060504030201111111111111111111111111111111111817161514131211f0ffffff0502b00400000000000000000000000000000000000000000000000000000000000000000000000000000012ee4360577a85117c01dda27e246bcfd9529ee46c9918f1f83f940a8255d534'
  const bytes = encodeControlFrame(base(), KEY)
  assert.equal(bytes.length, 128)
  assert.equal(bytes.toString('hex'), golden)
  const value = decode(Buffer.from(golden, 'hex'))
  assert.equal(value.commandId, 0x1112131415161718n)
  assert.equal(value.boot, 0x0102030405060708n)
  assert.equal(value.deadline, 0xfffffff0)
  assert.deepEqual(value.body, waterBody(2, 1200))
})

test('every unauthenticated byte change and foreign identity is refused', () => {
  const original = encodeControlFrame(base(), KEY)
  for (let index = 0; index < original.length; index++) {
    const bytes = Buffer.from(original); bytes[index] ^= 1
    assert.equal(decode(bytes), null, `byte ${index}`)
  }
  assert.equal(decodeControlFrame(original, Buffer.alloc(32), { main: MAIN, gateway: GATEWAY }), null)
  assert.equal(decodeControlFrame(original, KEY, { main: GATEWAY, gateway: MAIN }), null)
  for (const bytes of [Buffer.alloc(0), original.subarray(1), Buffer.concat([original, Buffer.alloc(1)]), original.toString('base64')]) assert.equal(decode(bytes), null)
})

test('signed malformed fields, unused body bytes and padding remain invalid', () => {
  const original = encodeControlFrame(base(), KEY)
  for (const [offset, value] of [[4, 255], [53, 41], [53, 4], [54, 0], [94, 1], [95, 1], [75, 1]]) {
    const bytes = Buffer.from(original); bytes[offset] = value
    assert.equal(decode(sign(bytes)), null)
  }
  assert.throws(() => waterBody(7, 1000))
  for (const duration of [0, -1, 30001, 1.5, '1000']) assert.throws(() => waterBody(1, duration))
  assert.throws(() => encodeControlFrame({ ...base(), commandId: 1 }, KEY))
  assert.throws(() => encodeControlFrame(base(), KEY.subarray(1)))
})

test('status queries cannot masquerade as an executable device challenge', () => {
  const query = { type: TYPES.QUERY, main: MAIN, gateway: GATEWAY, boot: 0n, challenge: Buffer.alloc(16), commandId: 0n, deadline: 0, body: Buffer.alloc(0) }
  assert.equal(decode(encodeControlFrame(query, KEY)).commandId, 0n)
  for (const extra of [{ boot: 1n }, { challenge: Buffer.alloc(16, 1) }, { deadline: 1 }, { body: Buffer.from([1]) }]) assert.throws(() => encodeControlFrame({ ...query, ...extra }, KEY))
  assert.throws(() => encodeControlFrame({ ...base(), challenge: Buffer.alloc(16) }, KEY))
  assert.throws(() => encodeControlFrame({ ...base(), boot: 0n }, KEY))
})

test('plan encoding keeps the existing bounded relative schedule and intentions', () => {
  const plan = { node: 3, windowSeq: 9, season: 1, entries: [{ offsetMinutes: 0, intent: 2, night: false }, { offsetMinutes: 239, intent: 4, night: true }] }
  assert.equal(planBody(plan).toString('hex'), '0309000000010200000200ef000401')
  const value = decode(encodeControlFrame({ ...base(), type: TYPES.PLAN, body: planBody(plan) }, KEY))
  assert.equal(value.body.length, 15)
  assert.equal(planBody({ ...plan, entries: [] }).length, 7)
  for (const extra of [{ windowSeq: 0 }, { season: 4 }, { entries: Array(1) }, { entries: [...plan.entries, plan.entries[0]] }, { entries: [{ offsetMinutes: 240, intent: 2, night: false }] }, { entries: [{ offsetMinutes: 1, intent: 1, night: false }] }, { entries: [{ offsetMinutes: 1, intent: 2, night: 1 }] }]) assert.throws(() => planBody({ ...plan, ...extra }))
})
