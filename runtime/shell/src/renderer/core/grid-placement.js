// Where a grid page's declared spans are decided, apart from the DOM.
//
// A page declares a span as a grid range ("2 / 4"), and the layout model gives
// every cell the same size. A span therefore produces a cell of its own: two
// cells wide is twice the cell dimension, and an instrument that cannot be drawn
// in that space is better off in a single cell, which the grid gives it
// automatically once the span is left unplaced.
//
// This is measured from the cell, not from the window. Window width does not
// predict cell size — a 400x700 window lays out one column and gets 360px cells,
// while a 1280x776 panel lays out five and gets 186px — so a rule keyed to window
// width decides nothing real.
;(function (root) {
  'use strict'

  /** The number of cells a declared grid range covers. One cell when undeclared. */
  function spanCells(range) {    if (typeof range !== 'string') return 1
    const start = Number.parseInt(range, 10)
    if (!Number.isFinite(start)) return 1
    const parts = range.split('/')
    if (parts.length < 2) return 1
    const end = Number.parseInt(parts[1], 10)
    if (!Number.isFinite(end)) return 1
    return Math.max(1, end - start)
  }

  /**
   * Whether a declared span is kept at the cell the layout model has just given
   * the page. A single cell is always kept: it is the smallest the model can
   * give, so refusing it would leave the instrument nowhere to go. An instrument
   * that declares no minimum is kept in whatever it is given.
   */
  function honorsSpan({ columns, rows }, cellWidth, cellHeight, minCell) {
    if (columns <= 1 && rows <= 1) return true
    return meetsMinCell(columns * cellWidth, rows * cellHeight, minCell)
  }

  /**
   * Whether a grid with the given count of columns or rows has the lines a
   * declared placement needs. A single line has to be a line that starts a real
   * column, and a range has to end no later than the grid's end line: anything
   * past that makes the grid create an implicit track, and the instrument ends up
   * in one far narrower than the layout asked for.
   */
  function gridHasLines(range, count) {
    if (typeof range !== 'string') return true
    const parts = range.split('/')
    if (parts.length < 2) {
      const line = Number.parseInt(parts[0], 10)
      if (!Number.isFinite(line)) return true
      return line <= count
    }
    const end = Number.parseInt(parts[1], 10)
    if (!Number.isFinite(end)) return true
    return end <= count + 1
  }

  /**
   * Whether a grid page keeps the composition it was drawn as. A page's declared
   * placements are a composition for a grid of a certain size: the Home page names
   * the fifth column, the Reading page spans five. When the grid is smaller, that
   * composition cannot be placed, and the honest result is a list of single cells
   * rather than a composition with tiles pushed into implicit tracks.
   */
  function pageFitsGrid(widgets, columns, rows) {
    for (const { col, row } of widgets) {
      if (!gridHasLines(col, columns)) return false
      if (!gridHasLines(row, rows)) return false
    }
    return true
  }

  /**
   * Whether a cell of this size is one the instrument declared it reads at. This
   * is the same question the Shell asks when it re-composes a Widget, and the
   * question a geometry gate asks when it holds the desk to a declared floor, so
   * it is answered once here.
   */
  function meetsMinCell(width, height, minCell) {
    if (!Number.isFinite(minCell)) return true
    return Math.min(width, height) >= minCell
  }

  const api = { spanCells, honorsSpan, gridHasLines, pageFitsGrid, meetsMinCell }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    root.odkGridPlacement = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
