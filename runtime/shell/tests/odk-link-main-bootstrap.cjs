'use strict'

const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const profile = process.env.ODK_LINK_BOOTSTRAP_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Bootstrap requires a private parent-owned profile')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
const version = process.env.ODK_LINK_BOOTSTRAP_VERSION
assert.ok(['1.0.0', '2.0.0', '3.0.0'].includes(version))
const signed = version !== '1.0.0'
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), layout)
const surfaces = layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin])
process.env.ODK_DISABLED_PLUGINS += ',' + surfaces.join(',')
const sourceModule = require('../src/odk-link-client')
const defaultCreate = sourceModule.createOdkLinkClient
let defaultConstructions = 0
sourceModule.createOdkLinkClient = options => {
  defaultConstructions++
  assert.equal(signed, false, 'Signed bootstrap must not construct default Open DeskOS Link')
  return defaultCreate(options)
}
const hostModule = require('../src/plugin-host')
const createHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  const result = createHost(options)
  if (options?.capabilities?.['source.odk-link']) host = result
  return result
}
const handlers = new Set()
const handle = ipcMain.handle.bind(ipcMain)
const remove = ipcMain.removeHandler.bind(ipcMain)
ipcMain.handle = (channel, handler) => { handle(channel, handler); handlers.add(channel) }
ipcMain.removeHandler = channel => { remove(channel); handlers.delete(channel) }
let report
let failed = false
const deadline = setTimeout(() => { void fail(Error('ODK_LINK_MAIN_BOOTSTRAP_TIMEOUT')) }, 45000)
async function fail(error) {
  if (failed) return
  failed = true
  clearTimeout(deadline)
  console.error(error)
  try { await host?.stop() } finally { app.exit(1) }
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load', () => {
    void (async () => {
      assert.ok(host)
      const selected = host.list().find(record => record.manifest.id === 'odk.source.odk-link')
      assert.equal(selected.state, 'running')
      assert.equal(selected.manifest.version, version)
      const source = host.get('odk:source/link/v1')
      assert.equal(source.fixtureRevision, signed ? version : undefined)
      assert.equal(source.socketPath, process.env.ODK_LINK_SOCKET)
      const enabled = new Set(['odk.source.odk-link', 'odk.source.pi-sessions', 'odk.source.pi-events', 'odk.system.renderer-development'])
      assert.ok(host.list().filter(record => !enabled.has(record.manifest.id)).every(record => record.state === 'disabled'))
      const consumer = await win.webContents.executeJavaScript(`(async () => {
        const sessions = await window.odkPlatform.getPiSessions();
        const events = await window.odkPlatform.getPiSessionEvents({sessionId:'fixture',hostedPi:true});
        if (!sessions.ok || !events.ok) throw Error('Actual preload Pi consumers unavailable');
        return {sessionId:sessions.sessions[0].sessionId,goal:sessions.sessions[0].latestGoal,
          running:sessions.summary.running,events:events.events,truncated:events.truncated};
      })()`)
      report = { productionMain: true, actualPreload: true, pid: process.pid, version: selected.manifest.version,
        executedVersion: signed ? source.fixtureRevision : selected.manifest.version,
        defaultConstructions, hidden: !win.isVisible(), consumer }
      await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
      app.quit()
    })().catch(fail)
  })
})
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report)
    assert.equal(handlers.has('odk-pi-sessions'), false)
    assert.equal(handlers.has('odk-pi-session-events'), false)
    assert.equal(host.list().find(record => record.manifest.id === 'odk.source.odk-link').state, 'stopped')
    clearTimeout(deadline)
    console.log(JSON.stringify({ ...report, handlersReleased: true }))
  } catch (error) { console.error(error); app.exit(1) }
})
assert.equal(process.argv.includes('--smoke'), false)
require('../src/main')
