'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { serializeComputedStyle } = require('./helpers/hydra-style-snapshot')

const style = values => ({
  *[Symbol.iterator]() { yield* Object.keys(values) },
  getPropertyValue(property) { return values[property] },
})

test('Hydra style snapshots preserve every property and exact value without nested IPC objects', () => {
  const values = { color: 'rgb(1, 2, 3)', '--note': '中文; "quoted"\ntext', display: '', font: 'Noto Sans SC' }
  const snapshot = serializeComputedStyle(style(values))
  assert.equal(typeof snapshot, 'string')
  assert.deepEqual(Object.fromEntries(JSON.parse(snapshot)), values)
  assert.equal(snapshot, serializeComputedStyle(style(Object.fromEntries(Object.entries(values).reverse()))))
  for (const [name, value] of Object.entries(values)) {
    assert.notEqual(snapshot, serializeComputedStyle(style({ ...values, [name]: value + 'changed' })))
    const missing = { ...values }; delete missing[name]
    assert.notEqual(snapshot, serializeComputedStyle(style(missing)))
  }
  assert.notEqual(snapshot, serializeComputedStyle(style({ ...values, '--added': 'value' })))
})

test('Hydra style serializer runs unchanged inside the isolated renderer', () => {
  const sample = style({ width: '12px', '--scale': '1' })
  const result = vm.runInNewContext(`(${serializeComputedStyle.toString()})(sample)`, { sample })
  assert.equal(result, serializeComputedStyle(sample))
})
