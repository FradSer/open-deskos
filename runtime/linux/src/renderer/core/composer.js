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
          if (!validGridLine(widget.col) || !validGridLine(widget.row)) throw new Error(`tile "${widget.id}" has invalid grid placement`)
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
    const tile = document.createElement(plugin.interaction === 'open-app' ? 'button' : 'div')
    if (plugin.interaction === 'open-app') tile.type = 'button'
    tile.className = `widget ${widgetClass(plugin)} flex flex-col items-center justify-center`
    tile.dataset.widget = plugin.id
    tile.dataset.app = plugin.app
    tile.dataset.state = plugin.state
    tile.dataset.interaction = plugin.interaction || 'display-only'
    if (widgetDef.col) tile.style.gridColumn = widgetDef.col
    if (widgetDef.row) tile.style.gridRow = widgetDef.row
    root.odkPlugins.activate(plugin, tile, uiCtx)
    if (plugin.interaction === 'open-app') {
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
        for (const widget of page.widgets) grid.append(buildTile(widget, uiCtx))
        section.append(grid)
      } else {
        root.odkPlugins.activate(root.odkPlugins.get(page.plugin), section, uiCtx)
      }
    })
  }

  root.odkComposer = { validate, build }
})(typeof window !== 'undefined' ? window : globalThis)
