'use strict'
const { app, BrowserWindow, session } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const profile = process.env.ODK_CSS_RECOVERY_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
let win
app.on('window-all-closed', () => {})
const timer = setTimeout(() => { console.error('CSS recovery fixture timed out'); app.exit(1) }, 20000)
app.whenReady().then(async () => {
  const fixtureSession = session.fromPartition(`css-recovery-${process.pid}`, { cache: false })
  assert.equal(fixtureSession.isPersistent(), false)
  fixtureSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  fixtureSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
  const reports = []
  for (const mode of ['success', 'missing', 'mount-failure', 'cleanup-failure', 'no-css']) {
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, session: fixtureSession } })
    assert.equal(win.webContents.session, fixtureSession)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    let loads = 0
    win.webContents.on('did-finish-load', () => loads++)
    await win.loadFile(path.join(profile, 'index.html'), { query: { mode } })
    const report = await win.webContents.executeJavaScript(`(async () => {
      await window.fixtureReady;
      const before = getComputedStyle(window.fixtureElement).width;
      const retainedDocument = document;
      const retainedElement = window.fixtureElement;
      const previous = document.querySelector('link[data-plugin="odk.tile.css-fixture"]');
      let receipt, failed = false;
      try { receipt = await window.odkPlugins.restoreDefault('odk.tile.css-fixture') } catch { failed = true }
      const after = getComputedStyle(retainedElement).width;
      const active = document.querySelector('link[data-plugin="odk.tile.css-fixture"]');
      const selected = window.odkPlugins.get('odk.tile.css-fixture').manifest.version;
      const result = { before, after, failed, selected, implementation: receipt?.implementation || null,
        sameDocument: retainedDocument === document, sameElement: retainedElement === window.fixtureElement,
        value: retainedElement.textContent, previousConnected: previous.isConnected,
        externalCSS: active === previous, mountWidth: window.defaultMountWidth || null,
        staged: document.querySelectorAll('link[media="not all"]').length };
      window.refuseCleanup = false;
      await window.odkPlugins.stop();
      return result;
    })()`)
    assert.equal(report.before, '29px')
    assert.equal(report.sameDocument, true)
    assert.equal(report.sameElement, true)
    assert.equal(report.value, '24.5 °C')
    assert.equal(report.staged, 0)
    const success = ['success', 'no-css'].includes(mode)
    assert.equal(report.failed, !success)
    assert.equal(report.selected, success ? '1.0.0' : '2.0.0')
    assert.equal(report.implementation, success ? 'built-in' : null)
    assert.equal(report.after, mode === 'success' ? '17px' : mode === 'no-css' ? '11px' : '29px')
    assert.equal(report.mountWidth, ['success', 'mount-failure'].includes(mode) ? '17px' : mode === 'no-css' ? '11px' : null)
    assert.equal(report.previousConnected, !success)
    assert.equal(report.externalCSS, !success)
    assert.equal(loads, 1)
    reports.push(mode)
    assert.equal(win.isVisible(), false)
    win.destroy(); win = null
  }
  clearTimeout(timer)
  console.log(JSON.stringify({ ok: true, modes: reports, hidden: true, stylesheetMeasured: true }))
  app.exit(0)
}).catch(error => { clearTimeout(timer); console.error(error); win?.destroy(); app.exit(1) })
