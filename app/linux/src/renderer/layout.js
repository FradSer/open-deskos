;
(function (root) {
  'use strict'

  /*
   * Open DeskOS Linux shell layout model.
   * Single source of truth for shell geometry, mirroring the firmware's
   * aiodi.grid_metrics() portrait branch. Pure function in, metrics out;
   * CSS consumes these values through custom properties only.
   */
  const REF = {
    w: 320,
    h: 480,
    gutter: 16,
    radius: 20,
    stroke: 2,
    barIcon: 20,
    stripMin: 72,
  }
  const COLS = 3
  const ROWS = 4
  const PEEK_MIN = 96
  const PEEK_MAX = 160
  const CELL_FLOOR = 24

  function compute(width, height) {
    const fit = Math.min(width / REF.w, height / REF.h)
    const px = (value) => Math.floor(value * fit + 0.5)
    const gutter = px(REF.gutter)
    const statusH = Math.max(40, px(REF.barIcon + 12))
    const peekH = Math.min(PEEK_MAX, Math.max(PEEK_MIN, px(REF.stripMin)))

    // Vertical budget (all gaps are one gutter, same rhythm as tile spacing):
    //   statusH + pagePadTop + gridH + pagePadBottom + breathingAbovePeek
    //   + peekH + bottomInset <= height
    // Cells take the smaller of the width-derived square (P4 rule: grid is
    // flush to the side edges) and the height-derived ceiling, so panels
    // proportionally shorter than the 320x480 reference shrink cells instead
    // of clipping the last row.
    const reservedV = statusH + peekH + 4 * gutter
    const cellByHeight = Math.floor((height - reservedV - (ROWS - 1) * gutter) / ROWS)
    const cellByWidth = Math.floor((width - (COLS - 1) * gutter) / COLS)
    const cell = Math.max(CELL_FLOOR, Math.min(cellByWidth, cellByHeight))

    const gridW = COLS * cell + (COLS - 1) * gutter
    const gridH = ROWS * cell + (ROWS - 1) * gutter

    return {
      width,
      height,
      fit,
      gutter,
      statusH,
      cols: COLS,
      rows: ROWS,
      cellW: cell,
      cellH: cell,
      radius: px(REF.radius),
      stroke: Math.max(1, px(REF.stroke)),
      peekH,
      peekInset: gutter,
      gridW,
      gridH,
      budgetUsed: statusH + gutter + gridH + gutter + gutter + peekH + gutter,
    }
  }

  const api = { REF, compute }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    root.odkLayout = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
