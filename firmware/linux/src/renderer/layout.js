;
(function (root) {
  'use strict'

  /*
   * Open DeskOS Linux shell layout model.
   * Single source of truth for shell geometry, mirroring the firmware's
   * Open DeskOS portrait grid metrics. Pure function in, metrics out;
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
  const ROWS = 5
  const PEEK_MIN = 96
  const PEEK_MAX = 160
  const CELL_FLOOR = 24

  function compute(width, height) {
    const fit = Math.min(width / REF.w, height / REF.h)
    const px = (value) => Math.floor(value * fit + 0.5)
    const gutter = px(REF.gutter)
    const statusH = Math.max(40, px(REF.barIcon + 12))

    // P4 rule: the grid touches both side edges — column tracks are 1fr in
    // CSS and never leave side margins. The height budget only bounds ROW
    // HEIGHT: panels proportionally shorter than the 320x480 reference get
    // flatter rows instead of clipped last-row tiles or side gaps.
    const colW = (width - (COLS - 1) * gutter) / COLS
    const rowsFloorTotal = ROWS * CELL_FLOOR + (ROWS - 1) * gutter

    // The peek yields before grid rows squash below the touch floor: when
    // even a floor-height grid cannot coexist with PEEK_MIN, the strip
    // shrinks toward its scaled reference height instead of overflowing.
    const peekScaled = px(REF.stripMin)
    const peekMax = Math.min(PEEK_MAX, Math.max(PEEK_MIN, peekScaled))
    const peekMin = Math.min(PEEK_MIN, peekScaled)
    const leftover = height - statusH - rowsFloorTotal - 4 * gutter
    const peekH = Math.min(peekMax, Math.max(peekMin, leftover))

    const reservedV = statusH + peekH + 4 * gutter
    const cellHByHeight = Math.floor((height - reservedV - (ROWS - 1) * gutter) / ROWS)
    const cellH = Math.max(CELL_FLOOR, Math.min(Math.floor(colW), cellHByHeight))

    const gridW = width
    const gridH = ROWS * cellH + (ROWS - 1) * gutter

    const cellDim = Math.min(Math.floor(colW), cellH)

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
      cellDim,
      radius: px(REF.radius),
      stroke: Math.max(1, px(REF.stroke)),
      peekH,
      peekInset: gutter,
      gridW,
      gridH,
    }
  }

  const api = { REF, compute }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    root.odkLayout = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
