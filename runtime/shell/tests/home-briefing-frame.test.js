const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseHomeBriefing } = require('../src/home-briefing-frame')

const frame = { state: 'live', generatedAt: 1000, omittedSources: 0, items: [{ text: '<script>literal</script>', sources: [{ id: 'mail', label: 'Mail', state: 'live', updatedAt: 900 }] }] }
test('agent home frame preserves literal bounded text and source provenance', () => {
  assert.deepEqual(parseHomeBriefing(frame), frame)
})
test('home coverage survives transport and rejects impossible source counts', () => {
  const coverage = { totalSources: 70, readSources: 70, failedSources: 2, incompleteSources: 1, selectedSources: 1 }
  assert.deepEqual(parseHomeBriefing({ ...frame, coverage }).coverage, coverage)
  for (const patch of [{ readSources: 71 }, { failedSources: -1 }, { selectedSources: 71 }, { incompleteSources: 0.5 }]) {
    assert.equal(parseHomeBriefing({ ...frame, coverage: { ...coverage, ...patch } }).state, 'unavailable')
  }
})
test('malformed home content is unavailable rather than partially rendered', () => {
  for (const bad of [null, {}, { ...frame, state: 'invented' }, { ...frame, items: Array(5).fill(frame.items[0]) },
    { ...frame, items: [{ ...frame.items[0], text: 'a'.repeat(601) }] }, { ...frame, items: [{ text: 'No evidence', sources: [] }] },
    { ...frame, generatedAt: Infinity }, { ...frame, items: [{ ...frame.items[0], sources: [{ id: 'mail', label: 'Mail', state: 'invented' }] }] }]) {
    assert.equal(parseHomeBriefing(bad).state, 'unavailable')
    assert.deepEqual(parseHomeBriefing(bad).items, [])
  }
})

test('compact segments survive transport only with matching literal text and approved icons', () => {
  const segments = [{ text: 'You have ' }, { text: 'new mail', icon: 'mail' }, { text: ' today.' }]
  const compact = { ...frame, items: [{ ...frame.items[0], text: segments.map(s => s.text).join(''), segments }] }
  assert.deepEqual(parseHomeBriefing(compact), compact)
  for (const segments of [[{ text: compact.items[0].text, icon: 'javascript:alert(1)' }], [{ text: 'Different text', icon: 'mail' }]]) {
    assert.equal(parseHomeBriefing({ ...compact, items: [{ ...compact.items[0], segments }] }).state, 'unavailable')
  }
})
