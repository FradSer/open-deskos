const { test } = require('node:test')
const assert = require('node:assert/strict')
const { computeDesk } = require('../src/renderer/layout')

test('Home fits one Overview row and two Widget rows in the same square canvas', () => {
  for (const [width, height, deskHeight] of [[1920, 1280, 1184], [1920, 1080, 999], [1280, 800, 724], [1280, 776, 700]]) {
    const deskWidth = width * 0.67
    const metrics = computeDesk(width, height, deskWidth, 0, 6, deskHeight)
    assert.equal(metrics.cols, 3)
    assert.equal(metrics.widgetGap, 16)
    assert.equal(metrics.rows, 2)
    assert.equal(metrics.cellW, metrics.cellH)
    assert.equal(metrics.widgetViewportH, null, 'paging owns the entire right pane')
    assert.ok(metrics.cellDim >= 186)
    assert.ok(3 * metrics.cellDim + 64 <= deskHeight - 48)
    assert.ok(metrics.gridW <= deskWidth - 32)
    assert.deepEqual(computeDesk(width, height, deskWidth, 720, 6, deskHeight), metrics)
  }
})

test('compact panes retain their scrollable layout and installed Widget row count', () => {
  const compact = computeDesk(320, 480, 320, 360, 6, 500)
  assert.equal(compact.cols, 1)
  assert.equal(compact.rows, 6)
  assert.equal(compact.widgetViewportH, null)
  assert.ok(compact.gridW <= 320 - 32 - 32)
  const installed = computeDesk(1920, 1280, 1286, 0, 8, 1184)
  assert.equal(installed.rows, 3)
  assert.equal(installed.widgetViewportH, null)
})

test('the handheld fits the complete three-row canvas without vertical scrolling', () => {
  for (const [height, deskHeight] of [[800, 724], [776, 700]]) {
    const metrics = computeDesk(1280, height, 857, deskHeight - 48, 6, deskHeight, 217)
    assert.equal(metrics.cols, 3)
    assert.equal(metrics.cellW, metrics.cellH)
    assert.ok(3 * metrics.cellDim + 64 <= deskHeight - 48)
  }
})

test('intermediate pane widths choose fewer columns before violating published minimums', () => {
  for (const paneWidth of [651, 670, 685, 699, 714]) {
    const metrics = computeDesk(1000, 800, paneWidth, 676, 6, 724, 217)
    assert.equal(metrics.cols, 2)
    assert.ok(metrics.cellDim >= 217)
  }
  assert.equal(computeDesk(1000, 800, 715, 676, 6, 724, 217).cols, 3)
})

// Extra installed packages and unusually short windows retain their readable fallback.
test('unsupported canvas sizes cannot shrink every Widget below its reading floor', () => {
  for (const args of [[1280, 776, 857, 652, 8, 700, 217], [1280, 480, 857, 356, 6, 404, 217]]) {
    const metrics = computeDesk(...args)
    assert.equal(metrics.fitCanvas, false)
    assert.ok(metrics.cellDim >= metrics.minCell)
  }
})
