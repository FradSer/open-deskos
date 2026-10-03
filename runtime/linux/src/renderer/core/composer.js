;
(function (root) {
  'use strict'

  /*
   * Desktop composer: turns the declarative DESKTOP_LAYOUT config into pages
   * inside #pages-track. Grid pages use the config's explicit tile placement;
   * page plugins own their markup.
   */
  function validGridLine(value) {
    return typeof value === 'string' && /^\d+(?:\s*\/\s*\d+)?$/.test(value)
  }

  function validateSurface(page, plugin) {
    const surface = page.surface || plugin?.surface || 'display'
    if (!['display', 'app'].includes(surface)) {
      throw new Error(`page "${page.id}" has unsupported surface: ${surface}`)
    }
    if (page.kind === 'grid' && surface !== 'display') {
      throw new Error(`grid page "${page.id}" must use the display surface`)
    }
    if (plugin?.surface && plugin.surface !== surface) {
      throw new Error(`page "${page.id}" surface does not match plugin "${plugin.id}"`)
    }
    return surface
  }

  function validate(layout) {
    if (!layout || !Array.isArray(layout.pages) || layout.pages.length === 0) {
      throw new Error('desktop layout requires a non-empty pages array')
    }
    const pageIds = new Set()
    for (const page of layout.pages) {
      if (!page.id || !page.name || pageIds.has(page.id)) throw new Error(`page has missing or duplicate id/name: ${JSON.stringify(page)}`)
      pageIds.add(page.id)
      if (page.kind === 'grid') {
        validateSurface(page)
        if (!Array.isArray(page.widgets)) throw new Error(`grid page "${page.id}" requires widgets`)
        const widgetIds = new Set()
        for (const widget of page.widgets) {
          if (!root.odkPlugins.has(widget.id)) throw new Error(`unknown widget plugin "${widget.id}"`)
          const plugin = root.odkPlugins.get(widget.id)
          if (plugin.kind !== 'tile') throw new Error(`grid page "${page.id}" must reference a tile plugin`)
          if (widget.col && widget.row) {
            if (!validGridLine(widget.col) || !validGridLine(widget.row)) throw new Error(`tile "${widget.id}" has invalid grid placement`)
          }
          if (widgetIds.has(widget.id)) throw new Error(`tile "${widget.id}" appears more than once on page "${page.id}"`)
          widgetIds.add(widget.id)
          if (plugin.interaction && plugin.interaction !== 'display-only') {
            throw new Error(`display grid tile "${widget.id}" cannot expose an App interaction`)
          }
        }
      } else if (page.kind === 'page') {
        if (!root.odkPlugins.has(page.plugin)) throw new Error(`unknown page plugin "${page.plugin}"`)
        const plugin = root.odkPlugins.get(page.plugin)
        if (plugin.kind !== 'page') throw new Error(`page "${page.id}" must reference a page plugin`)
        validateSurface(page, plugin)
      } else {
        throw new Error(`page "${page.id}" has unsupported kind: ${page.kind}`)
      }
    }
    return true
  }

  function widgetClass(plugin) {
    return `w-${plugin.id.replace(/^odk\.tile\./, '')}`
  }

  function filterLayout(layout, disabled) {
    if (!disabled || disabled.size === 0) return layout
    const kept = []
    for (const page of layout.pages) {
      if (page.kind === 'page' && disabled.has(page.plugin)) continue
      if (page.kind === 'grid' && page.widgets.some((widget) => disabled.has(widget.id))) {
        kept.push({ ...page, widgets: page.widgets.filter((widget) => !disabled.has(widget.id)) })
      } else {
        kept.push(page)
      }
    }
    return { ...layout, pages: kept }
  }

  function markActivationError(container, def) {
    container.dataset.state = 'Error'
    const note = document.createElement('span')
    note.className = 'widget-error'
    note.textContent = 'Widget error'
    note.title = def.id
    container.append(note)
  }

  function buildTile(page, widgetDef, uiCtx) {
    const plugin = root.odkPlugins.get(widgetDef.id)
    const tile = document.createElement('div')
    tile.className = `widget widget-display-only ${widgetClass(plugin)} flex flex-col`
    tile.dataset.widget = plugin.id
    tile.dataset.app = plugin.app
    tile.dataset.state = plugin.state
    tile.dataset.interaction = plugin.interaction || 'display-only'
    // The declared floor is published on the tile so the geometry gates can hold
    // the desk to it instead of trusting a comment.
    if (Number.isFinite(Number(plugin.manifest?.minCell))) tile.dataset.minCell = String(plugin.manifest.minCell)
    placeTile(page, tile, widgetDef, plugin)
    if (!root.odkPlugins.activate(plugin, tile, uiCtx)) markActivationError(tile, plugin)
    return tile
  }

  // The geometry the layout model has just produced: the cell every tile is given,
  // and the lines of the grid they are placed in. Spans are decided from this, so a
  // page keeps its composition whenever the grid can satisfy it and the resulting
  // cell is large enough for the instrument it holds.
  function gridMetrics() {
    const style = root.getComputedStyle ? root.getComputedStyle(document.documentElement) : null
    const pixels = (name) => Number.parseFloat(style?.getPropertyValue(name) || '') || 0
    const count = (name) => Number.parseInt(style?.getPropertyValue(name) || '', 10) || 0
    return {
      cellWidth: pixels('--cell-w'),
      cellHeight: pixels('--cell-h'),
      columns: count('--cols'),
      rows: count('--rows'),
    }
  }

  function placeTile(page, tile, widgetDef, plugin) {
    if (!widgetDef.col) return
    if (!widgetDef.row) return
    const { spanCells, honorsSpan, gridHasLines, pageFitsGrid } = root.odkGridPlacement
    const { cellWidth, cellHeight, columns, rows } = gridMetrics()
    // The grid has to be able to give the span its lines, the page has to be a
    // grid its composition was drawn for, and the cell the span produces has to
    // reach what the instrument declared it reads at. Failing any of those leaves
    // the tile unplaced, and the grid then gives it one cell, which is always
    // somewhere an instrument can be drawn.
    const placeable = columns > 0 && rows > 0
      && pageFitsGrid(page.widgets, columns, rows)
      && gridHasLines(widgetDef.col, columns)
      && gridHasLines(widgetDef.row, rows)
    const honored = placeable && honorsSpan({
      columns: spanCells(widgetDef.col),
      rows: spanCells(widgetDef.row),
    }, cellWidth, cellHeight, plugin.manifest?.minCell)
    if (honored) {
      tile.style.gridColumn = widgetDef.col
      tile.style.gridRow = widgetDef.row
      tile.dataset.span = 'kept'
    } else {
      // Left unplaced, the grid gives the instrument a single cell, which is
      // always enough for it to be drawn.
      tile.style.gridColumn = ''
      tile.style.gridRow = ''
      tile.dataset.span = 'dropped'
    }
  }

  function placeGridTiles(track) {
    const layout = root.DESKTOP_LAYOUT
    if (!layout?.pages) return
    for (const page of layout.pages) {
      if (page.kind !== 'grid') continue
      const grid = track.querySelector(`.page[data-page-id="${page.id}"] .widget-grid`)
      if (!grid) continue
      for (const widgetDef of page.widgets) {
        const tile = grid.querySelector(`[data-widget="${widgetDef.id}"]`)
        if (!tile) continue
        placeTile(page, tile, widgetDef, root.odkPlugins.get(widgetDef.id))
      }
      for (const tile of grid.querySelectorAll('[data-user-app-id]')) {
        placeTile(page, tile, { col: tile.dataset.col, row: tile.dataset.row }, {})
      }
    }
  }

  // A resized panel changes the cell, and so changes which spans fit. The
  // placement is re-decided from the cell the model has just produced. The
  // deferral is a timer rather than an animation frame on purpose: a frame never
  // runs in a window that is not painting, and a window the owner has behind
  // another one is still a window whose layout is live.
  // A rebuild replaces the observer rather than stacking a second one behind it.
  let cellWatcher = null
  function watchCellSize(track) {
    if (typeof ResizeObserver === 'undefined') return
    if (cellWatcher) cellWatcher.disconnect()
    let queued = false
    cellWatcher = new ResizeObserver(() => {
      if (queued) return
      queued = true
      setTimeout(() => {
        queued = false
        placeGridTiles(track)
      }, 0)
    })
    cellWatcher.observe(document.documentElement)
  }

  function build(layout, track, uiCtx) {
    validate(layout)
    track.replaceChildren()
    layout.pages.forEach((page, index) => {
      const section = document.createElement('section')
      const surface = page.surface || (page.kind === 'page' ? root.odkPlugins.get(page.plugin).surface : 'display') || 'display'
      section.className = `page page-${surface} flex flex-col`
      section.dataset.page = String(index)
      section.dataset.pageId = page.id
      section.dataset.surface = surface
      section.dataset.builtBy = 'composer'
      section.setAttribute('aria-label', page.name)
      track.append(section)
      if (page.kind === 'grid') {
        const grid = document.createElement('div')
        grid.className = 'widget-grid grid'
        for (const widget of page.widgets) grid.append(buildTile(page, widget, uiCtx))
        section.append(grid)
      } else {
        const plugin = root.odkPlugins.get(page.plugin)
        if (!root.odkPlugins.activate(plugin, section, uiCtx)) markActivationError(section, plugin)
      }
    })
    // The cell changes when the window does, and the cell is what decides a span.
    watchCellSize(track)
  }

  root.odkComposer = { validate, build, filterLayout, placeGridTiles }
})(typeof window !== 'undefined' ? window : globalThis)
