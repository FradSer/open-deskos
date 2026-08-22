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

    // P4 rule: the grid touches both side edges — column tracks are 1fr in
    // CSS and never leave side margins. The height budget only bounds ROW
    // HEIGHT: panels proportionally shorter than the 320x480 reference get
    // flatter rows instead of clipped last-row tiles or side gaps.
    const reservedV = statusH + peekH + 4 * gutter
    const colW = (width - (COLS - 1) * gutter) / COLS
    const cellHByHeight = Math.floor((height - reservedV - (ROWS - 1) * gutter) / ROWS)
    const cellH = Math.max(CELL_FLOOR, Math.min(Math.floor(colW), cellHByHeight))

    const gridW = width
    const gridH = ROWS * cellH + (ROWS - 1) * gutter

    return {
      width,
      height,
      fit,
      gutter,
      statusH,
      cols: COLS,
      rows: ROWS,
      colW,
      cellW: Math.floor(colW),
      cellH,
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
