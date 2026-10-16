'use strict'

// Time-plugin lifecycle tests need mounted consumers even when the default
// desktop omits these Widgets. Keep that composition inside the test document.
function timeWidgetLayout() {
  let layout
  Object.defineProperty(window, 'DESKTOP_LAYOUT', {
    configurable: true,
    get() { return layout },
    set(value) {
      layout = value
      const desk = layout.pages.find(page => page.id === 'desk')
      const existing = new Set(layout.pages.flatMap(page => (page.widgets || []).map(widget => widget.id)))
      for (const widget of [
        { id: 'odk.tile.clock', col: '1', row: '2' },
        { id: 'odk.tile.almanac', col: '2', row: '2' },
      ]) {
        if (!existing.has(widget.id)) desk.widgets.push(widget)
      }
    },
  })
}

async function installTimeWidgetLayout(win) {
  if (!win.webContents.debugger.isAttached()) {
    await win.loadURL('about:blank')
    win.webContents.debugger.attach('1.3')
  }
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: `(${timeWidgetLayout.toString()})()`,
  })
}

module.exports = { installTimeWidgetLayout }
