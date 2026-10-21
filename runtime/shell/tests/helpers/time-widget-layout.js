'use strict'

// Preview and lifecycle layouts stay inside the isolated test document.
// Production placement remains unchanged.
function widgetGridLayout() {
  let layout
  Object.defineProperty(window, 'DESKTOP_LAYOUT', {
    configurable: true,
    get() { return layout },
    set(value) {
      layout = value
      const plugins = window.odkPlugins.byKind('tile')
      const byId = new Map(plugins.map(plugin => [plugin.id, plugin]))
      const gridPages = layout.pages.filter(page => page.kind === 'grid')
      const placed = new Set(gridPages.flatMap(page => page.widgets.map(widget => widget.id)))
      const extra = [...byId.keys()].filter(id => !placed.has(id))
      window.__odkWidgetGridPages = gridPages.map(page => page.id)
      for (let offset = 0; offset < extra.length; offset += 9) {
        const id = `widget-grid-extra-${offset / 9 + 1}`
        window.__odkWidgetGridPages.push(id)
        layout.pages.push({ id, name: `Additional Widgets ${offset / 9 + 1}`, kind: 'grid', surface: 'display', gridRows: 3,
          widgets: extra.slice(offset, offset + 9).map((id, index) => ({ id, opensApp: byId.get(id).opensApp,
            col: String(index % 3 + 1), row: String(Math.floor(index / 3) + 1) })) })
      }
    },
  })
}

async function installLayoutScript(win, source) {
  if (!win.webContents.debugger.isAttached()) {
    await win.loadURL('about:blank')
    win.webContents.debugger.attach('1.3')
  }
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source,
  })
}

async function installWidgetGridLayout(win) {
  await installLayoutScript(win, `(${widgetGridLayout.toString()})()`)
}

module.exports = { installWidgetGridLayout }
