;
(function (root) {
  'use strict'

  /*
   * Open DeskOS Linux shell layout model.
   * Single source of truth for shell geometry. Pure function in, metrics out;
   * CSS consumes these values through custom properties only.
   *
   * Requirement: Every widget cell is strictly square (cellW === cellH === cellDim).
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

  function compute(width, height) {
    const isWidescreen = width >= 1000 && width > height
    const cols = isWidescreen ? 5 : 3
    const rows = isWidescreen ? 3 : 5

    const fit = Math.min(width / (isWidescreen ? 1920 : REF.w), height / (isWidescreen ? 1280 : REF.h))
    const gutter = isWidescreen ? 28 : Math.max(8, Math.min(24, Math.floor(REF.gutter * fit + 0.5)))
    const statusH = isWidescreen ? 76 : Math.max(36, Math.min(64, Math.floor((REF.barIcon + 12) * fit + 0.5)))
    const peekScaled = Math.floor(REF.stripMin * fit + 0.5)
    const peekH = isWidescreen ? 128 : Math.max(48, Math.min(140, peekScaled))
    const peekInset = gutter

    // Vertical budget available for grid rows
    const availableV = height - statusH - peekH - 4 * gutter
    const maxCellH = Math.max(24, Math.floor((availableV - (rows - 1) * gutter) / rows))
    const maxCellW = Math.max(24, Math.floor((width - (cols - 1) * gutter) / cols))

    // Strict square cell constraint: cellW === cellH === cellDim
    const targetDim = isWidescreen ? 270 : Math.min(maxCellW, maxCellH)
    const cellDim = Math.min(maxCellW, maxCellH, targetDim)
    const cellW = cellDim
    const cellH = cellDim
    const colW = cellDim

    const gridW = cols * cellW + (cols - 1) * gutter
    const gridH = rows * cellH + (rows - 1) * gutter

    const radius = isWidescreen ? 32 : Math.max(10, Math.floor(REF.radius * fit + 0.5))
    const stroke = isWidescreen ? 3 : Math.max(1, Math.floor(REF.stroke * fit + 0.5))

    return {
      width,
      height,
      fit,
      gutter,
      statusH,
      cols,
      rows,
      colW,
      cellW,
      cellH,
      cellDim,
      radius,
      stroke,
      peekH,
      peekInset,
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
