;
(function (root) {
  'use strict'

  /*
   * Desktop composer: turns the declarative DESKTOP_LAYOUT config into pages
   * inside #pages-track. Grid pages assemble tiles from widget plugins with
   * col/row placement from the same config; page plugins own their markup.
   */
  function validate(layout) {
    if (!layout || !Array.isArray(layout.pages) || layout.pages.length === 0) {
      throw new Error('desktop layout requires a non-empty pages array')
    }
    for (const page of layout.pages) {
      if (!page.id || !page.name) throw new Error(`page missing id/name: ${JSON.stringify(page)}`)
      if (page.kind === 'grid') {
        if (!Array.isArray(page.widgets)) throw new Error(`grid page "${page.id}" requires widgets`)
        for (const widget of page.widgets) {
          if (!root.odkPlugins.has(widget.id)) throw new Error(`unknown widget plugin "${widget.id}"`)
        }
      } else if (page.kind === 'page') {
        if (!root.odkPlugins.has(page.plugin)) throw new Error(`unknown page plugin "${page.plugin}"`)
      } else {
        throw new Error(`page "${page.id}" has unsupported kind: ${page.kind}`)
      }
    }
    return true
  }

  function buildTile(widgetDef, uiCtx) {
    const plugin = root.odkPlugins.get(widgetDef.id)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `widget w-${widgetDef.id}`
    button.dataset.widget = widgetDef.id
    button.dataset.app = plugin.app
    button.dataset.state = plugin.state
    button.setAttribute('aria-label', `${plugin.app}，${plugin.state}`)
    if (widgetDef.col) button.style.gridColumn = widgetDef.col
    if (widgetDef.row) button.style.gridRow = widgetDef.row
    plugin.mount(button, uiCtx)
    return button
  }

  function build(layout, track, uiCtx) {
    validate(layout)
    track.replaceChildren()
    layout.pages.forEach((page, index) => {
      const section = document.createElement('section')
      section.className = 'page'
      section.dataset.page = String(index)
      section.dataset.builtBy = 'composer'
      section.setAttribute('aria-label', page.name)
      track.append(section)
      if (page.kind === 'grid') {
        const grid = document.createElement('div')
        grid.className = 'widget-grid'
        for (const widget of page.widgets) grid.append(buildTile(widget, uiCtx))
        section.append(grid)
      } else {
        root.odkPlugins.get(page.plugin).mount(section, uiCtx)
      }
    })
  }

  root.odkComposer = { validate, build }
})(typeof window !== 'undefined' ? window : globalThis)
