const test = require('node:test')
const assert = require('node:assert/strict')
const { spanCells, honorsSpan, gridHasLines, pageFitsGrid } = require('../src/renderer/core/grid-placement.js')

test('a declared grid range reports the cells it covers', () => {
  assert.deepEqual(spanCells('2 / 4'), 2)
  assert.deepEqual(spanCells('1'), 1)
  assert.deepEqual(spanCells('1 / 6'), 5)
  assert.deepEqual(spanCells(undefined), 1)
})

test('a single cell is always honored, whatever an instrument declares', () => {
  // One cell is the smallest the layout model can give, so refusing it would
  // leave the instrument with nowhere to go.
  assert.equal(honorsSpan({ columns: 1, rows: 1 }, 186, 400, 600), true)
})

test('a multi-cell span is honored when the cell it produces reaches the declared minimum', () => {
  assert.equal(honorsSpan({ columns: 2, rows: 2 }, 186, 186, 200), true)
  assert.equal(honorsSpan({ columns: 2, rows: 2 }, 348, 200, 400), true)
  assert.equal(honorsSpan({ columns: 3, rows: 2 }, 200, 200, 400), true)
})

test('a multi-cell span is refused when the cell it would produce is smaller than the minimum', () => {
  assert.equal(honorsSpan({ columns: 2, rows: 2 }, 120, 240, 300), false)
  assert.equal(honorsSpan({ columns: 3, rows: 2 }, 100, 100, 400), false)
  // The narrow dimension decides: a wide but short cell is not enough.
  assert.equal(honorsSpan({ columns: 3, rows: 2 }, 100, 200, 400), false)
})

test('an instrument that declares nothing is honored in whatever cell it is given', () => {
  assert.equal(honorsSpan({ columns: 2, rows: 2 }, 60, 60), true)
})

test('the two promised cells keep the spans the layout declares', () => {
  // 348px is the reference panel and 186px the handheld. A 2x2 span gives 696px
  // and 372px, both above every declared minimum.
  for (const cell of [348, 186]) {
    assert.equal(honorsSpan({ columns: 2, rows: 2 }, cell, cell), true)
  }
})

test('a grid answers for the lines a declared range needs', () => {
  // A five-column grid ends at line 6, so a range ending at 4 is placeable and one
  // ending at 7 is not.
  assert.equal(gridHasLines('2 / 4', 5), true)
  assert.equal(gridHasLines('2 / 4', 2), false)
  assert.equal(gridHasLines('1', 1), true)
  assert.equal(gridHasLines(undefined, 1), true)
})

test('a single declared line is answered against the grid too', () => {
  // A layout can name the fifth column of a grid that has two, and the second
  // column of a grid that has one. Placing either anyway is how a tile ends up
  // 47px wide inside a 282px cell.
  assert.equal(gridHasLines('5', 5), true)
  assert.equal(gridHasLines('5', 2), false)
  assert.equal(gridHasLines('2', 1), false)
  assert.equal(gridHasLines('1', 1), true)
})

test('a page keeps its composition only when the grid can give every tile its lines', () => {
  // The Home page names the fifth column and the Reading page spans five, so
  // both need five columns to be the composition they were drawn as.
  const home = [{ col: '5', row: '2 / 4' }, { col: '2 / 4', row: '2 / 4' }]
  const reading = [{ col: '1 / 6', row: '1 / 3' }]
  assert.equal(pageFitsGrid(home, 5, 3), true)
  assert.equal(pageFitsGrid(reading, 5, 3), true)
  // Three columns cannot place the fifth, so the page becomes a list of cells
  // rather than a composition with a tile pushed into an implicit column.
  assert.equal(pageFitsGrid(home, 3, 4), false)
  assert.equal(pageFitsGrid(reading, 3, 3), false)
  assert.equal(pageFitsGrid(home, 5, 2), false)
  assert.equal(pageFitsGrid([], 1, 1), true)
})
test('a span the grid has no lines for is never kept', () => {
  // Placing it anyway would push the tile into an implicit column, which is how a
  // 1x2 tile ends up 47px wide inside a 282px cell.
  const placeable = gridHasLines('2 / 4', 1) && honorsSpan({ columns: 2, rows: 2 }, 282, 282, 217)
  assert.equal(placeable, false)
})

test('a tall instrument keeps its slot on a panel a little shorter than the promised one', () => {
  // Hydra declares 120px as the narrowest cell it draws its 1x2 slot in. A 1280x740
  // window computes a 174px cell, which is 12px narrower than the 1280x776 panel the
  // desk promises, and the slot is still whole there: a floor set to the panel's own
  // minimum cell would have dropped it and collapsed the tile into a square.
  assert.equal(honorsSpan({ columns: 1, rows: 2 }, 174, 174, 120), true)
  assert.equal(honorsSpan({ columns: 1, rows: 2 }, 128, 128, 120), true)
  // Below the floor the grid takes the single cell the layout model can always give,
  // and the tile re-composes inside it.
  assert.equal(honorsSpan({ columns: 1, rows: 2 }, 110, 110, 120), false)
  assert.equal(honorsSpan({ columns: 1, rows: 1 }, 110, 110, 120), true)
})
