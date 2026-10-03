const test = require('node:test')
const assert = require('node:assert/strict')
const { measureDensity } = require('./helpers/widget-density.js')

const frame = { x: 0, y: 0, width: 100, height: 100 }

test('measures a 62 percent content envelope and occupied area', () => {
  const result = measureDensity(frame, [{ x: 10, y: 10, width: 80, height: 77.5 }])
  assert.equal(result.fill, 0.62)
  assert.equal(result.occupied, 0.62)
  assert.deepEqual(result.violations, [])
})

test('unions overlaps without counting nested content twice', () => {
  const result = measureDensity(frame, [
    { x: 10, y: 10, width: 80, height: 77.5 },
    { x: 20, y: 20, width: 20, height: 20 },
  ])
  assert.equal(result.occupied, 0.62)
})

test('detects sparse corner content instead of accepting its large envelope', () => {
  const result = measureDensity(frame, [
    { x: 10, y: 10, width: 10, height: 10 },
    { x: 80, y: 80, width: 10, height: 10 },
  ])
  assert.equal(result.fill, 0.64)
  assert.equal(result.occupied, 0.02)
  assert.equal(result.emptyBand, 0.6)
  assert.ok(result.violations.includes('sparse-content'))
  assert.ok(result.violations.includes('empty-band'))
})

test('clips measured area to the frame and separately fails overflow', () => {
  const result = measureDensity(frame, [{ x: -10, y: 0, width: 120, height: 100 }])
  assert.equal(result.occupied, 1)
  assert.ok(result.violations.includes('overflow'))
})

test('rejects invalid widget frames rather than returning a false pass', () => {
  for (const invalid of [{ ...frame, width: 0 }, { ...frame, height: -1 }, { ...frame, x: NaN }]) {
    assert.throws(() => measureDensity(invalid, []), /Invalid Widget frame/)
  }
})

test('empty, invalid, and zero-area content cannot pass', () => {
  for (const boxes of [[], [{ x: 0, y: 0, width: 0, height: 10 }], [{ x: NaN, y: 0, width: 10, height: 10 }]]) {
    assert.ok(measureDensity(frame, boxes).violations.includes('missing-content'))
  }
})
