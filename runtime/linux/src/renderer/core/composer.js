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

  function buildTile(widgetDef, uiCtx) {
    const plugin = root.odkPlugins.get(widgetDef.id)
    const tile = document.createElement('div')
    tile.className = `widget widget-display-only ${widgetClass(plugin)} flex flex-col`
    tile.dataset.widget = plugin.id
    tile.dataset.app = plugin.app
    tile.dataset.state = plugin.state
    tile.dataset.interaction = plugin.interaction || 'display-only'
    if (widgetDef.col) tile.style.gridColumn = widgetDef.col
    if (widgetDef.row) tile.style.gridRow = widgetDef.row
    root.odkPlugins.activate(plugin, tile, uiCtx)
    return tile
  }

  function build(layout, track, uiCtx) {
    validate(layout)
    track.replaceChildren()
    layout.pages.forEach((page, index) => {
      const section = document.createElement('section')
      const surface = page.surface || (page.kind === 'page' ? root.odkPlugins.get(page.plugin).surface : 'display') || 'display'
      section.className = `page page-${surface} flex flex-col`
      section.dataset.page = String(index)
      section.dataset.surface = surface
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
