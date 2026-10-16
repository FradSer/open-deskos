'use strict'

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const profile = process.env.ODK_QUOTA_BOOTSTRAP_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Quota bootstrap requires a private parent-owned profile')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
const surfaceMode = process.env.ODK_QUOTA_MAIN_SURFACE_MODE
const surfaceView = surfaceMode ? require('./helpers/quota-main-view').prepareQuotaMainView(BrowserWindow, surfaceMode) : null
const version = process.env.ODK_QUOTA_BOOTSTRAP_VERSION
assert.ok(['1.0.0', '2.0.0', '3.0.0'].includes(version))
const signed = version !== '1.0.0'
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), layout)
const surfaces = layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin])
process.env.ODK_DISABLED_PLUGINS += ',' + surfaces.filter(id => !surfaceView || id !== 'odk.page.quota').join(',')
let defaults = 0
let providerCalls = 0
let measuring = false
const responses = [
  { state: 'available', snapshot: { fetchedAt: '2026-10-09T00:00:00.000Z', accounts: [
    { id: 'fixture', provider: 'codex', account: 'fixture@example.test', plan: 'Pro', groups: [
      { title: 'Usage', quotas: [
        { label: '5 hours', remainingPct: 12.345, resetAt: '2026-10-09T05:00:00.000Z' },
        { label: 'Weekly', remainingPct: 0, resetAt: null },
      ] },
    ] },
  ] } },
  { state: 'available', snapshot: { fetchedAt: '2026-10-09T00:00:00.000Z', accounts: [] } },
  { state: 'unauthorized', reason: 'Controlled provider refused authorization' },
  { state: 'unavailable', reason: 'Controlled provider unavailable' },
  { state: 'unconfigured', missing: ['Controlled setting'] },
]
const quotaModule = require('../src/quota-source')
const createQuota = quotaModule.createQuotaSource
quotaModule.createQuotaSource = options => {
  defaults++
  assert.equal(signed, false, 'Signed startup must not construct default Quota')
  return createQuota(options)
}
const providerModule = require('../src/opencode-go')
const config = Object.freeze({ controlled: true })
providerModule.resolveOpenCodeGoConfig = () => config
providerModule.fetchOpenCodeGo = async (selected, options) => {
  assert.equal(selected, config)
  assert.ok(options.signal instanceof AbortSignal)
  assert.equal(options.signal.aborted, false)
  if (!measuring) return responses[4]
  const expected = responses.length * (surfaceMode && surfaceMode !== 'default' ? 3 : 1)
  assert.ok(providerCalls < expected, 'Unexpected provider request during explicit consumer acceptance')
  return responses[providerCalls++ % responses.length]
}
const hostModule = require('../src/plugin-host')
const createHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  const result = createHost(options)
  if (options?.capabilities?.['source.quota']) host = result
  return result
}
const handlers = new Set()
const handle = ipcMain.handle.bind(ipcMain)
const remove = ipcMain.removeHandler.bind(ipcMain)
ipcMain.handle = (channel, handler) => { handle(channel, handler); handlers.add(channel) }
ipcMain.removeHandler = channel => { remove(channel); handlers.delete(channel) }
let report
let failed = false
const deadline = setTimeout(() => { void fail(Error('QUOTA_MAIN_BOOTSTRAP_TIMEOUT')) }, 45000)
async function fail(error) {
  if (failed) return
  failed = true
  clearTimeout(deadline)
  console.error(error)
  try { await host?.stop() } finally { app.exit(1) }
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('did-finish-load', () => {
    if (win.webContents.getURL() === 'about:blank') return
    void (async () => {
      assert.ok(host)
      const selected = host.list().find(record => record.manifest.id === 'odk.source.quota')
      assert.equal(selected.state, 'running')
      assert.equal(selected.manifest.version, version)
      const source = host.get('odk:source/quota/v1')
      assert.equal(source.fixtureRevision, signed ? version : undefined)
      const executedVersion = signed ? source.fixtureRevision : selected.manifest.version
      const enabled = new Set(['odk.source.quota', 'odk.system.renderer-development'])
      if (surfaceView) enabled.add('odk.system.renderer-control')
      assert.ok(host.list().filter(record => !enabled.has(record.manifest.id)).every(record => record.state === 'disabled'))
      await win.webContents.executeJavaScript('window.odkShellReady')
      let surface, consumer
      if (surfaceView) {
        surface = await surfaceView.exercise(win, host, responses, value => { measuring = value })
        consumer = surface.phases[0].map(observation => observation.status)
      } else {
        await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
        measuring = true
        consumer = await win.webContents.executeJavaScript(`(async () => {
        const results = [];
        for (let index = 0; index < 5; index++) results.push(await window.odkPlatform.getOpenCodeGoStatus());
        return results;
      })()`)
      }
      assert.deepEqual(consumer, responses)
      report = { productionMain: true, actualPreload: true, pid: process.pid, version, executedVersion,
        defaultConstructions: defaults, providerCalls, hidden: !win.isVisible(), consumer, ...(surface ? { surface } : {}) }
      await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
      if (surfaceView) { await surfaceView.assertReleased(win); report.surface.subscriptionsReleased = true }
      app.quit()
    })().catch(fail)
  })
})
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report)
    assert.equal(handlers.has('odk-opencode-go-status'), false)
    assert.equal(host.list().find(record => record.manifest.id === 'odk.source.quota').state, 'stopped')
    assert.equal(providerCalls, responses.length * (surfaceMode && surfaceMode !== 'default' ? 3 : 1))
    if (surfaceView) assert.equal(handlers.size, 0)
    if (surfaceView) {
      assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
      report.surface.protocolReleased = true
    }
    clearTimeout(deadline)
    console.log(JSON.stringify({ ...report, handlersReleased: true }))
  } catch (error) { console.error(error); app.exit(1) }
})
assert.equal(process.argv.includes('--smoke'), false)
require('../src/main')
