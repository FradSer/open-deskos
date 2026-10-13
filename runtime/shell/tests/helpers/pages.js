'use strict'

// Harness pages are addressed by layout id, never by position. Inserting a
// display page (e.g. Reading) shifts every later index, which silently
// retargets positional selectors onto the wrong surface.
async function resolvePages(win) {
  const ids = await win.webContents.executeJavaScript('window.DESKTOP_LAYOUT.pages.filter(page => !page.persistent).map(page => page.id)')
  const index = Object.fromEntries(ids.map((id, position) => [id, position]))
  return {
    index,
    dot: (id) => index[id],
    surface: (id) => `.page[data-page-id="${id}"]`,
  }
}

module.exports = { resolvePages }
