'use strict'

const installed = new WeakSet()

// Opt in only when a harness tests the retained independent page-plugin contract.
// Production navigation and E2E must use the default four-page layout instead.
async function installPiPageCompatibilityFixture(win) {
  if (installed.has(win.webContents)) return
  if (!win.webContents.getURL()) await win.loadURL('about:blank')
  if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    let layout;
    Object.defineProperty(window, 'DESKTOP_LAYOUT', {
      configurable: true,
      get() { return layout; },
      set(value) {
        const ids = value.pages.filter(page => !page.persistent).map(page => page.id);
        if (JSON.stringify(ids) !== JSON.stringify(['home', 'desk', 'preorder', 'reading'])) {
          throw Error('Pi page compatibility fixture requires the production four-page layout');
        }
        window.piPageCompatibilityProductionIds = ids;
        layout = { ...value, pages: [...value.pages,
          { id: 'pi-sessions', name: 'Pi Sessions', kind: 'page', surface: 'app', plugin: 'odk.page.pi-sessions' }] };
      },
    });
  })()` })
  installed.add(win.webContents)
}

module.exports = { installPiPageCompatibilityFixture }
