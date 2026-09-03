;
(function (root) {
  'use strict'

  /*
   * Desktop composer: turns the declarative DESKTOP_LAYOUT config into pages
   * inside #pages-track. Grid pages assemble tiles from widget plugins with
   * col/row placement from the same config; page plugins own their markup.
   */
  function validGridLine(value) {
    return typeof value === 'string' && /^\d+(?:\s*\/\s*\d+)?$/.test(value)
  }

  function parseGridSpan(value) {
    if (!value || typeof value !== 'string') return { start: 1, span: 1 }
    const parts = value.split('/').map((s) => Number.parseInt(s.trim(), 10))
    if (parts.length === 1 || Number.isNaN(parts[1])) return { start: parts[0] || 1, span: 1 }
    return { start: parts[0] || 1, span: Math.max(1, (parts[1] || 1) - (parts[0] || 1)) }
  }

  function parsePreferredSpan(spanStr) {
    if (!spanStr || typeof spanStr !== 'string') return { cols: 1, rows: 1 }
    const match = spanStr.match(/^(\d+)\s*x\s*(\d+)$/i)
    if (!match) return { cols: 1, rows: 1 }
    return { cols: Math.max(1, Number.parseInt(match[1], 10)), rows: Math.max(1, Number.parseInt(match[2], 10)) }
  }

  function resolveGridWidgets(page) {
    const configured = Array.isArray(page.widgets) ? [...page.widgets] : []
    const placedIds = new Set(configured.filter((w) => w.col && w.row).map((w) => w.id))
    const totalCols = (typeof window !== 'undefined' && window.__odkGrid?.cols) || 5
    const occupied = new Set()

    for (const widget of configured) {
      if (widget.col && widget.row) {
        const cSpan = parseGridSpan(widget.col)
        const rSpan = parseGridSpan(widget.row)
        for (let c = cSpan.start; c < cSpan.start + cSpan.span; c += 1) {
          for (let r = rSpan.start; r < rSpan.start + rSpan.span; r += 1) {
            occupied.add(`${c},${r}`)
          }
        }
      }
    }

    const autoContributed = []
    for (const plugin of root.odkPlugins.byKind('tile')) {
      if (placedIds.has(plugin.id)) continue
      const targetSlot = plugin.manifest?.contributions?.slot
      if (targetSlot === `${page.id}.grid` || targetSlot === page.id || (page.id === 'home' && targetSlot === 'home.grid')) {
        autoContributed.push({
          id: plugin.id,
          span: parsePreferredSpan(plugin.manifest?.contributions?.preferredSpan),
          route: plugin.manifest?.contributions?.defaultRoute || 'today',
        })
      }
    }

    const unplaced = configured.filter((w) => !w.col || !w.row).map((w) => {
      const plugin = root.odkPlugins.get(w.id)
      return {
        ...w,
        span: parsePreferredSpan(plugin?.manifest?.contributions?.preferredSpan),
      }
    }).concat(autoContributed)

    const finalWidgets = configured.filter((w) => w.col && w.row)

    for (const item of unplaced) {
      if (placedIds.has(item.id)) continue
      const spanCols = item.span?.cols || 1
      const spanRows = item.span?.rows || 1

      let placed = false
      for (let r = 1; r <= 20 && !placed; r += 1) {
        for (let c = 1; c <= totalCols - spanCols + 1 && !placed; c += 1) {
          let fits = true
          for (let dc = 0; dc < spanCols && fits; dc += 1) {
            for (let dr = 0; dr < spanRows && fits; dr += 1) {
              if (occupied.has(`${c + dc},${r + dr}`)) fits = false
            }
          }
          if (fits) {
            for (let dc = 0; dc < spanCols; dc += 1) {
              for (let dr = 0; dr < spanRows; dr += 1) {
                occupied.add(`${c + dc},${r + dr}`)
              }
            }
            const col = spanCols > 1 ? `${c} / ${c + spanCols}` : `${c}`
            const row = spanRows > 1 ? `${r} / ${r + spanRows}` : `${r}`
            finalWidgets.push({
              id: item.id,
              col,
              row,
              route: item.route || 'today',
            })
            placedIds.add(item.id)
            placed = true
          }
        }
      }
    }

    return finalWidgets
  }

  function validateApps() {
    const apps = new Map()
    for (const app of root.odkPlugins.byKind('app')) {
      if (!app.appId || apps.has(app.appId)) throw new Error(`built-in App "${app.appId}" must be unique`)
      apps.set(app.appId, app)
    }
    return apps
  }

  function validate(layout) {
    if (!layout || !Array.isArray(layout.pages) || layout.pages.length === 0) {
      throw new Error('desktop layout requires a non-empty pages array')
    }
    const apps = validateApps()
    const pageIds = new Set()
    for (const page of layout.pages) {
      if (!page.id || !page.name || pageIds.has(page.id)) throw new Error(`page has missing or duplicate id/name: ${JSON.stringify(page)}`)
      pageIds.add(page.id)
      if (page.kind === 'grid') {
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
          if (plugin.interaction === 'open-app' && !apps.has(plugin.appId)) {
            throw new Error(`tile "${widget.id}" references missing built-in App "${plugin.appId}"`)
          }
        }
      } else if (page.kind === 'page') {
        if (!root.odkPlugins.has(page.plugin)) throw new Error(`unknown page plugin "${page.plugin}"`)
        if (root.odkPlugins.get(page.plugin).kind !== 'page') throw new Error(`page "${page.id}" must reference a page plugin`)
      } else {
        throw new Error(`page "${page.id}" has unsupported kind: ${page.kind}`)
      }
    }
    return true
  }

  function widgetClass(plugin) {
    return `w-${plugin.id.replace(/^odk\.tile\./, '')}`
  }

  function buildTile(widgetDef, uiCtx) {
    const plugin = root.odkPlugins.get(widgetDef.id)
    const isInteractive = plugin.interaction === 'open-app'
    const tile = document.createElement(isInteractive ? 'button' : 'div')
    if (isInteractive) tile.type = 'button'
    tile.className = `widget widget-${isInteractive ? 'interactive' : 'display-only'} ${widgetClass(plugin)} flex flex-col`
    tile.dataset.widget = plugin.id
    tile.dataset.app = plugin.app
    tile.dataset.state = plugin.state
    tile.dataset.interaction = plugin.interaction || 'display-only'
    if (widgetDef.col) tile.style.gridColumn = widgetDef.col
    if (widgetDef.row) tile.style.gridRow = widgetDef.row
    root.odkPlugins.activate(plugin, tile, uiCtx)
    if (isInteractive) {
      tile.addEventListener('click', () => uiCtx.emitIntent({
        type: 'open-app',
        appId: plugin.appId,
        widgetId: widgetDef.id,
        route: widgetDef.route || 'today',
      }))
    }
    return tile
  }

  function build(layout, track, uiCtx) {
    validate(layout)
    track.replaceChildren()
    layout.pages.forEach((page, index) => {
      const section = document.createElement('section')
      section.className = 'page flex flex-col'
      section.dataset.page = String(index)
      section.dataset.builtBy = 'composer'
      section.setAttribute('aria-label', page.name)
      track.append(section)
      if (page.kind === 'grid') {
        const grid = document.createElement('div')
        grid.className = 'widget-grid grid'
        const resolvedWidgets = resolveGridWidgets(page)
        for (const widget of resolvedWidgets) grid.append(buildTile(widget, uiCtx))
        section.append(grid)
      } else {
        root.odkPlugins.activate(root.odkPlugins.get(page.plugin), section, uiCtx)
      }
    })
  }

  root.odkComposer = { validate, build }
})(typeof window !== 'undefined' ? window : globalThis)
