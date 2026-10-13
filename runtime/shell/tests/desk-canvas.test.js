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
    assert.ok(metrics.cellDim >= 200)
    if (deskHeight - 48 >= 3 * metrics.minCell + 64) {
      assert.ok(3 * metrics.cellDim + 64 <= deskHeight - 48)
    } else {
      assert.equal(metrics.cellDim, metrics.minCell, 'short panels scroll at the reading floor')
    }
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

test('a short three-row canvas scrolls before violating a Widget reading floor', () => {
  const metrics = computeDesk(1280, 776, 857, 652, 6, 700, 217)
  assert.equal(metrics.cellDim, 217)
  assert.ok(3 * metrics.cellDim + 64 > 652)
})

test('intermediate pane widths choose fewer columns before violating published minimums', () => {
  for (const paneWidth of [651, 670, 685, 699, 714]) {
    const metrics = computeDesk(1000, 800, paneWidth, 676, 6, 724, 217)
    assert.equal(metrics.cols, 2)
    assert.ok(metrics.cellDim >= 217)
  }
  assert.equal(computeDesk(1000, 800, 715, 676, 6, 724, 217).cols, 3)
})
