;
(function (root) {
  'use strict'

  /*
   * Open DeskOS Shell layout model.
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
  }

  function compute(width, height, widgetCount = 11) {
    const isWidescreen = width >= 1000 && width > height

    const fit = Math.min(width / (isWidescreen ? 1920 : REF.w), height / (isWidescreen ? 1280 : REF.h))
    const gutter = isWidescreen ? 28 : Math.max(8, Math.min(24, Math.floor(REF.gutter * fit + 0.5)))
    const cols = isWidescreen ? 5 : Math.max(1, Math.min(3, Math.floor((width - gutter) / (200 + gutter))))
    // Compact windows scroll rather than shrinking eleven instruments below readable size.
    const rows = isWidescreen ? 3 : Math.ceil(widgetCount / cols)
    const statusH = isWidescreen
      ? Math.max(76, Math.min(104, Math.floor(height * 0.075)))
      : Math.max(72, Math.min(88, Math.floor((REF.barIcon + 12) * fit + 8.5)))
    // Vertical budget available for grid rows below the State Bar.
    const availableV = height - statusH - 3 * gutter
    const maxCellH = Math.max(24, Math.floor((availableV - (rows - 1) * gutter) / rows))
    const maxCellW = Math.max(24, Math.floor((width - (cols - 1) * gutter - (isWidescreen ? 0 : 2 * gutter)) / cols))

    const cellDim = isWidescreen ? Math.min(maxCellW, maxCellH) : maxCellW
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
      barIcon: isWidescreen ? 30 : Math.floor(20 * fit + 0.5),
      gridW,
      gridH,
    }
  }

  function computeDesk(width, height, viewportWidth, viewportHeight, widgetCount = 6, deskHeight, minCell = 200) {
    // State Bar and theme metrics still belong to the whole Shell. Only the
    // Widget grid is measured from the right pane, including its scroll rails.
    const metrics = compute(width, height, widgetCount)
    const widgetGap = 16
    const availableWidth = Math.max(24, viewportWidth - 2 * widgetGap - (width < 640 ? 32 : 0))
    const cols = Math.max(1, Math.min(3, Math.floor((availableWidth + widgetGap) / (minCell + widgetGap))))
    const widthCell = Math.floor((availableWidth - (cols - 1) * widgetGap) / cols)
    // Home has one full-width Overview card above two square Widget rows.
    // Desktop panels show the complete canvas. Single-cell Widgets use their
    // compact composition when the display height is below their full-size minimum.
    const rows = Math.max(2, Math.ceil(widgetCount / cols))
    const canvasHeight = Number.isFinite(deskHeight) ? deskHeight - 48 : viewportHeight
    const fitCell = Math.floor((canvasHeight - (rows + 2) * widgetGap) / (rows + 1))
    const fitCanvas = width >= 1280 && cols === 3 && rows === 2 && fitCell >= 186
    const heightCell = Math.max(fitCanvas ? 186 : minCell, fitCell)
    const cellDim = Math.min(widthCell, heightCell)
    return { ...metrics, widgetGap, minCell, fitCanvas, cols, rows, cellDim, cellW: cellDim, cellH: cellDim,
      colW: cellDim, gridW: cols * cellDim + (cols - 1) * widgetGap,
      gridH: rows * cellDim + (rows - 1) * widgetGap,
      widgetViewportH: null }
  }

  function gridWidgetCount(layout) {
    const grid = layout?.pages?.find((page) => page.kind === 'grid')
    return grid?.widgets?.length ?? 0
  }

  const api = { REF, compute, computeDesk, gridWidgetCount }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    root.odkLayout = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
