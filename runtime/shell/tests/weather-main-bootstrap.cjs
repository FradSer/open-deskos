'use strict'

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const profile = process.env.ODK_WEATHER_BOOTSTRAP_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Bootstrap fixture requires a private parent-owned profile')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
// The wrapper lives under tests; production package startup uses the Shell root.
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
const version = process.env.ODK_WEATHER_BOOTSTRAP_VERSION
assert.ok(['1.0.0', '2.0.0', '3.0.0'].includes(version), 'Bootstrap fixture requires a supported expected revision')
const signed = version !== '1.0.0'
const surfaceVersion = process.env.ODK_WEATHER_BOOTSTRAP_SURFACE_VERSION
assert.ok(!surfaceVersion || ['1.0.0', '2.0.0', '3.0.0'].includes(surfaceVersion), 'Unsupported Main surface revision')
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), layout)
const surfaces = layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin])
process.env.ODESK_DISABLED_PLUGINS += ',' + surfaces.filter(id => id !== 'odk.tile.weather').join(',')
let providerCalls = 0
globalThis.fetch = async url => {
  const parsed = new URL(url)
  assert.equal(parsed.origin, 'https://api.open-meteo.com')
  assert.equal(parsed.pathname, '/v1/forecast')
  assert.equal(parsed.searchParams.get('latitude'), '1')
  assert.equal(parsed.searchParams.get('longitude'), '2')
  providerCalls++
  return new Response(JSON.stringify({ current_units: { temperature_2m: '°C' },
    current: { temperature_2m: 24, weather_code: 0 },
    daily: { temperature_2m_min: [20], temperature_2m_max: [28] } }), {
    headers: { 'content-type': 'application/json' },
  })
}
const sourceModule = require('../src/weather-source')
const defaultCreate = sourceModule.createWeatherSource
let defaultConstructions = 0
sourceModule.createWeatherSource = options => {
  defaultConstructions++
  assert.equal(signed, false, 'Signed startup must not construct the default Weather source')
  return defaultCreate(options)
}
const hostModule = require('../src/plugin-host')
const createHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  const result = createHost(options)
  if (options?.capabilities?.['source.weather']) host = result
  return result
}
const handlers = new Set()
const handle = ipcMain.handle.bind(ipcMain)
const remove = ipcMain.removeHandler.bind(ipcMain)
ipcMain.handle = (channel, handler) => { handle(channel, handler); handlers.add(channel) }
ipcMain.removeHandler = channel => { remove(channel); handlers.delete(channel) }
let report
let failed = false
const deadline = setTimeout(() => { void fail(Error('WEATHER_MAIN_BOOTSTRAP_TIMEOUT')) }, 45000)
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
      assert.ok(host, 'Actual Main must construct its Host')
      const selected = host.list().find(record => record.manifest.id === 'odk.source.weather')
      assert.equal(selected.state, 'running')
      assert.equal(selected.manifest.version, version)
      const source = host.get('odk:source/weather/v1')
      assert.equal(source.fixtureRevision, signed ? version : undefined)
      const executedVersion = signed ? source.fixtureRevision : selected.manifest.version
      assert.ok(host.list().filter(record => !['odk.source.weather', 'odk.system.renderer-development'].includes(record.manifest.id))
        .every(record => record.state === 'disabled'), 'Unrelated Main factories must remain disabled')
      const snapshot = await win.webContents.executeJavaScript('window.odkPlatform.getWeatherStatus({force:true})')
      assert.equal(snapshot.status, 'live')
      assert.equal(snapshot.current.temperature, 24)
      const consumer = await win.webContents.executeJavaScript(`(async () => {
        const deadline = performance.now() + 4000;
        let tile;
        while (!(tile = document.querySelector('[data-widget="odk.tile.weather"]')) || tile.dataset.state !== 'live') {
          if (performance.now() > deadline) throw Error('Actual Main Weather Widget did not become live');
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        const text = selector => tile.querySelector(selector).textContent;
        return { state:tile.dataset.state, place:text('.w-weather-place'), number:text('.w-weather-number'),
          unit:text('.w-weather-unit'), condition:text('.w-weather-condition'), low:text('#w-weather-low'), high:text('#w-weather-high') };
      })()`)
      let surface
      if (surfaceVersion) {
        surface = await win.webContents.executeJavaScript(`(() => {
          const tile = document.querySelector('[data-widget="odk.tile.weather"]');
          return { version: window.odkPlugins.catalog().find(record => record.manifest.id === 'odk.tile.weather').manifest.version,
            marker: tile.dataset.fixtureSurface || null, executedVersion: tile.dataset.fixtureSurfaceRevision || null };
        })()`)
        assert.equal(surface.version, surfaceVersion)
        assert.equal(surface.executedVersion, surfaceVersion === '1.0.0' ? null : surfaceVersion)
        assert.equal(surface.marker, surfaceVersion === '1.0.0' ? null : 'independent-weather')
        const entries = await win.webContents.executeJavaScript('window.odkRendererPluginBridge.list()')
        surface.entries = entries.length
        assert.equal(entries.length, surfaceVersion === '1.0.0' ? 0 : 1)
        if (entries.length) {
          assert.equal(entries[0].manifest.id, 'odk.tile.weather')
          assert.equal(entries[0].manifest.version, surfaceVersion)
          assert.match(entries[0].entryUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/entry\.js$/)
          assert.match(entries[0].cssUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/weather\.css$/)
        }
        surface.protocolActive = protocol.isProtocolHandled('odk-native-plugin')
        assert.equal(surface.protocolActive, surfaceVersion !== '1.0.0')
      }
      report = { ...(surfaceVersion ? { surface } : {}), productionMain: true, actualPreload: true, pid: process.pid, version: selected.manifest.version, executedVersion,
        defaultConstructions, providerCalls, hidden: !win.isVisible(), consumer }
      await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
      app.quit()
    })().catch(fail)
  })
})
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report, 'Bootstrap must verify consumers before quitting')
    assert.equal(handlers.has('odk-weather-status'), false, 'Normal Main shutdown must remove the Weather handler')
    assert.equal(host.list().find(record => record.manifest.id === 'odk.source.weather').state, 'stopped')
    if (surfaceVersion) {
      assert.equal(handlers.has('odk-renderer-development-plugins'), false)
      assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
      assert.equal(host.list().find(record => record.manifest.id === 'odk.system.renderer-development').state, 'stopped')
      report.surface.released = true
    }
    clearTimeout(deadline)
    console.log(JSON.stringify({ ...report, handlerReleased: true }))
  } catch (error) { console.error(error); app.exit(1) }
})
assert.equal(process.argv.includes('--smoke'), false)
require('../src/main')
