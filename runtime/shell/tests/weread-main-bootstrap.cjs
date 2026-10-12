'use strict'

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const profile = process.env.ODK_WEREAD_BOOTSTRAP_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'WeRead bootstrap requires a private parent-owned profile')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
const version = process.env.ODK_WEREAD_BOOTSTRAP_VERSION
assert.ok(['1.0.0', '2.0.0', '3.0.0'].includes(version))
const signed = version !== '1.0.0'
const surfaceVersion = process.env.ODK_WEREAD_BOOTSTRAP_SURFACE_VERSION
assert.ok(!surfaceVersion || ['1.0.0', '2.0.0', '3.0.0'].includes(surfaceVersion))
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), layout)
const surfaces = layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin])
process.env.ODK_DISABLED_PLUGINS += ',' + surfaces.filter(id => !surfaceVersion || id !== 'odk.tile.weread').join(',')
const mode = process.env.ODK_WEREAD_BOOTSTRAP_MODE
assert.ok(['live', 'empty', 'error', 'unconfigured'].includes(mode))
const cacheFile = process.env.ODK_WEREAD_BOOTSTRAP_CACHE
assert.ok(cacheFile && path.isAbsolute(cacheFile))
assert.equal(path.dirname(cacheFile), path.dirname(process.env.ODK_CONFIG_DIR))
const cacheLoaded = fs.existsSync(cacheFile)
const timestamp = 1700000000000
let defaults = 0
let apiCalls = 0
let coverCalls = 0
const highlight = { type: 1, markText: 'Controlled highlight\n独立插件保持原文。', range: '1-2', createTime: 7 }
const controlledFetch = async (url, options) => {
  assert.ok(options.signal instanceof AbortSignal)
  assert.equal(options.signal.aborted, false)
  if (url === 'https://fixture.example.test/cover.png') {
    assert.equal(mode, 'live')
    coverCalls++
    return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('cover') }
  }
  assert.equal(url, 'https://i.weread.qq.com/api/agent/gateway')
  assert.equal(options.method, 'POST')
  assert.equal(options.headers.Authorization, 'Bearer controlled-fixture-key')
  assert.equal(cacheLoaded, false, 'Retained recent cache must avoid API synchronization')
  apiCalls++
  const body = JSON.parse(options.body)
  assert.equal(body.skill_version, '1.0.4')
  if (mode === 'error') return { ok: false, status: 503 }
  assert.ok(['live', 'empty'].includes(mode))
  if (body.api_name === '/user/notebooks') {
    assert.equal(body.count, 100)
    return { ok: true, json: async () => ({ books: mode === 'empty' ? [] : [
      { bookId: 'fixture', noteCount: 1, book: { title: 'Controlled book', author: 'Fixture author', cover: surfaceVersion ? '' : 'https://fixture.example.test/cover.png' } },
    ] }) }
  }
  assert.equal(body.api_name, '/book/bookmarklist')
  assert.equal(body.bookId, 'fixture')
  return { ok: true, json: async () => ({ updated: [highlight] }) }
}
globalThis.fetch = () => { throw Error('Uncontrolled network access refused') }
const sourceModule = require('../src/weread-source')
const createSource = sourceModule.createWeReadSource
sourceModule.createWeReadSource = options => {
  defaults++
  assert.equal(signed, false, 'Signed startup must not construct default WeRead')
  return createSource(options)
}
const hostModule = require('../src/plugin-host')
const createHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  if (options?.capabilities?.['source.weread']) {
    const capability = options.capabilities['source.weread']
    capability.options = { ...capability.options, apiKey: mode === 'unconfigured' || (surfaceVersion && cacheLoaded) ? '' : 'controlled-fixture-key',
      cacheFile, fetchImpl: controlledFetch, now: () => timestamp, random: () => 0 }
  }
  const result = createHost(options)
  if (options?.capabilities?.['source.weread']) host = result
  return result
}
const handlers = new Set()
const handle = ipcMain.handle.bind(ipcMain)
const remove = ipcMain.removeHandler.bind(ipcMain)
ipcMain.handle = (channel, handler) => { handle(channel, handler); handlers.add(channel) }
ipcMain.removeHandler = channel => { remove(channel); handlers.delete(channel) }
let report
let failed = false
const deadline = setTimeout(() => { void fail(Error('WEREAD_MAIN_BOOTSTRAP_TIMEOUT')) }, 45000)
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
      const selected = host.list().find(record => record.manifest.id === 'odk.source.weread')
      assert.equal(selected.state, 'running')
      assert.equal(selected.manifest.version, version)
      const source = host.get('odk:source/weread/v1')
      assert.equal(source.fixtureRevision, signed ? version : undefined)
      const executedVersion = signed ? source.fixtureRevision : selected.manifest.version
      const enabled = new Set(['odk.source.weread', 'odk.system.renderer-development'])
      assert.ok(host.list().filter(record => !enabled.has(record.manifest.id)).every(record => record.state === 'disabled'))
      await win.webContents.executeJavaScript('(async () => { await window.odkShellReady;  })()')
      const consumer = await win.webContents.executeJavaScript('window.odkPlatform.getWeReadHighlight()')
      assert.equal(consumer.status, mode)
      let surface
      if (surfaceVersion) {
        surface = await win.webContents.executeJavaScript(`(async () => {
          await window.odkShellReady;
          const deadline = performance.now() + 4000;
          let tile;
          while (!(tile = document.querySelector('[data-widget="odk.tile.weread"]'))
            || tile.querySelector('.weread-text')?.textContent !== ${JSON.stringify(highlight.markText)}) {
            if (performance.now() > deadline) throw Error('Actual Main WeRead Widget did not render');
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          const text = selector => tile.querySelector(selector).textContent;
          return { version: window.odkPlugins.catalog().find(record => record.manifest.id === 'odk.tile.weread').manifest.version,
            executedVersion: tile.dataset.fixtureSurfaceRevision || null, marker: tile.dataset.fixtureSurface || null,
            text: text('.weread-text'), title: text('.weread-title'), author: text('.weread-author'),
            date: text('.weread-date'), coverHidden: tile.querySelector('.weread-cover-wrap').hidden };
        })()`)
        assert.equal(surface.version, surfaceVersion)
        assert.equal(surface.executedVersion, surfaceVersion === '1.0.0' ? null : surfaceVersion)
        assert.equal(surface.marker, surfaceVersion === '1.0.0' ? null : 'independent-weread')
        assert.equal(surface.text, consumer.highlight.markText)
        assert.equal(surface.title, consumer.highlight.title)
        assert.equal(surface.author, consumer.highlight.author)
        const date = new Date(consumer.highlight.createTime * 1000)
        const expectedDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
        assert.equal(surface.date, expectedDate)
        assert.equal(surface.coverHidden, true)
        const entries = await win.webContents.executeJavaScript('window.odkRendererPluginBridge.list()')
        surface.entries = entries.length
        assert.equal(entries.length, surfaceVersion === '1.0.0' ? 0 : 1)
        if (entries.length) {
          assert.equal(entries[0].manifest.id, 'odk.tile.weread')
          assert.equal(entries[0].manifest.version, surfaceVersion)
          assert.match(entries[0].entryUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/entry\.js$/)
          assert.match(entries[0].cssUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/weread\.css$/)
        }
        surface.protocolActive = protocol.isProtocolHandled('odk-native-plugin')
        assert.equal(surface.protocolActive, surfaceVersion !== '1.0.0')
      }
      await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
      source.refresh = () => { throw Error('Cached health must not request WeRead data') }
      const requests = apiCalls + coverCalls
      const health = host.get('odk:plugin-health/odk.source.weread/v1').snapshot()
      assert.deepEqual(host.get('odk:plugin-health/odk.source.weread/v1').snapshot(), health)
      assert.equal(apiCalls + coverCalls, requests)
      report = { ...(surfaceVersion ? { surface } : {}), productionMain: true, actualPreload: true, pid: process.pid, version, executedVersion,
        defaultConstructions: defaults, apiCalls, coverCalls, cacheLoaded, hidden: !win.isVisible(), consumer, health }
      app.quit()
    })().catch(fail)
  })
})
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report)
    assert.equal(handlers.has('odk-weread-highlight'), false)
    assert.equal(host.list().find(record => record.manifest.id === 'odk.source.weread').state, 'stopped')
    if (surfaceVersion) {
      assert.equal(handlers.has('odk-renderer-development-plugins'), false)
      assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
      assert.equal(host.list().find(record => record.manifest.id === 'odk.system.renderer-development').state, 'stopped')
      report.surface.released = true
    }
    clearTimeout(deadline)
    console.log(JSON.stringify({ ...report, handlersReleased: true }))
  } catch (error) { console.error(error); app.exit(1) }
})
assert.equal(process.argv.includes('--smoke'), false)
require('../src/main')
