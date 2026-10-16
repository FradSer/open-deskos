'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { StringDecoder } = require('node:string_decoder')
const { createJsonLineReader } = require('../lib/json-line-reader')
const { validateShellState } = require('../lib/protocol')

test('oversized fragments are discarded until newline and bounded frames recover', () => {
  const records = []
  const reader = createJsonLineReader(line => records.push(line), { maxBytes: 65536 })
  reader.push(Buffer.alloc(65536, 120))
  reader.push(Buffer.from('x\n{"v":1,"type":"input","input":"back"}\n'))
  assert.deepEqual(records, ['{"v":1,"type":"input","input":"back"}'])
})

test('limits count UTF-8 bytes and preserve characters split across reads', () => {
  const lines = []
  const reader = createJsonLineReader(line => lines.push(line), { maxBytes: 6 })
  const text = Buffer.from('\u6d4b\u8bd5\n')
  for (const byte of text) reader.push(Buffer.from([byte]))
  reader.push(Buffer.from('\u6d4b\u8bd5x\nnext\r\n'))
  assert.deepEqual(lines, ['\u6d4b\u8bd5', 'next'])
})

test('large single reads discard overflowing lines and keep all later frames', () => {
  const lines = []
  const reader = createJsonLineReader(line => lines.push(line), { maxBytes: 8 })
  reader.push(Buffer.concat([Buffer.alloc(1000000, 120), Buffer.from('\na\n\nb\n')]))
  reader.end()
  assert.deepEqual(lines, ['a', 'b'])
})

test('oversized data is dropped before the UTF-8 decoder receives it', () => {
  const original = StringDecoder.prototype.write
  const lines = []
  StringDecoder.prototype.write = function (bytes) {
    assert.ok(bytes.length <= 8, 'oversized data reached decoder')
    return original.call(this, bytes)
  }
  try {
    const reader = createJsonLineReader(line => lines.push(line), { maxBytes: 8 })
    reader.push(Buffer.concat([Buffer.alloc(1000000, 120), Buffer.from('\nnext\n')]))
    assert.deepEqual(lines, ['next'])
  } finally {
    StringDecoder.prototype.write = original
  }
})

test('bounded runtime reports and ordinary input records share a fragmented stream', () => {
  const lines = []
  const reader = createJsonLineReader(line => lines.push(JSON.parse(line)))
  const report = { v: 1, type: 'runtime_diagnosis', plugins: [{ name: 'x'.repeat(16384) }] }
  const input = { v: 1, type: 'input', input: 'back' }
  const bytes = Buffer.from(JSON.stringify(report) + '\r\n' + JSON.stringify(input) + '\n')
  for (let offset = 0; offset < bytes.length; offset += 512) reader.push(bytes.subarray(offset, offset + 512))
  assert.deepEqual(lines, [report, input])
})

test('end drops an oversized unterminated line and preserves a bounded tail', () => {
  const lines = []
  const reader = createJsonLineReader(line => lines.push(line), { maxBytes: 4 })
  reader.push(Buffer.from('12345'))
  reader.end()
  reader.push(Buffer.from('tail'))
  reader.end()
  assert.deepEqual(lines, ['tail'])
})

test('invalid buffer limits fail before reading input', () => {
  for (const maxBytes of [0, -1, 1.5, Infinity, NaN, '8']) {
    assert.throws(() => createJsonLineReader(() => {}, { maxBytes }), /positive integer/)
  }
})

test('default reader preserves valid records above 64 KiB', () => {
  const lines = []
  const record = { v: 1, type: 'state', name: 'x'.repeat(131072), page: 1, pages: 1, canPrev: false, canNext: false }
  assert.equal(validateShellState(record).ok, true)
  const bytes = Buffer.from(JSON.stringify(record) + '\r\n')
  const reader = createJsonLineReader(line => lines.push(JSON.parse(line)))
  for (let offset = 0; offset < bytes.length; offset += 997) reader.push(bytes.subarray(offset, offset + 997))
  assert.deepEqual(lines, [record])
})

test('explicit limits include CR and exclude LF at the exact boundary', () => {
  const lines = []
  const reader = createJsonLineReader(line => lines.push(line), { maxBytes: 4 })
  reader.push(Buffer.from('1234\n1234\r\n123\r\nok\n'))
  assert.deepEqual(lines, ['1234', '123', 'ok'])
})
