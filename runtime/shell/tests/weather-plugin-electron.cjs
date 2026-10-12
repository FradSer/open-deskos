'use strict'

require('node:child_process').execFile = () => { throw Error('Fixture subprocesses belong to parent') }

const { app, BrowserWindow, ipcMain, session, protocol } = require('electron')
if (process.platform === 'darwin') app.dock.hide()
if (process.platform === 'linux') app.disableHardwareAcceleration()
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const profile = process.env.ODK_WEATHER_FIXTURE_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Weather fixture needs a parent-owned absolute profile')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createWeatherSource } = require('../src/weather-source')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { healthPort } = require('../src/plugins/health')
const { loadPrepared } = require('./helpers/weather-selection')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const surfaceReplacement = process.env.ODK_WEATHER_SURFACE_REPLACEMENT === '1'
const surfaceRevision = process.env.ODK_WEATHER_SURFACE_REVISION
assert.ok(!surfaceRevision || ['1.0.0', '2.0.0', '3.0.0'].includes(surfaceRevision), 'Invalid surface process revision')
const signedSurface = surfaceReplacement && process.env.ODK_WEATHER_SURFACE_NATIVE === '1'
const { createNativeRendererAssets, NATIVE_PLUGIN_SCHEME } = require('../src/native-renderer-assets')
const { capture: captureSignedSurface } = require('./helpers/weather-surface-selection')
const nativeSurfaceAssets = signedSurface ? createNativeRendererAssets() : null
if (signedSurface) require('../src/user-app-system').registerUserAppScheme(protocol)
let rendererHost
let surfaceEntries = []
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { loadNativePlugins } = require('../src/native-plugin-loader')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const { surfaceTimeouts } = require('./helpers/weather-selection')
const { WEATHER_PROFILE, measureDensity, collectWidgetContent } = require('./helpers/widget-density')
const id = 'odk.source.weather'
const widget = 'odk.tile.weather'
const channel = 'odk-weather-status'
const restartVersion = process.env.ODK_WEATHER_RESTART_VERSION
assert.ok(!restartVersion || ['1.0.0', '2.0.0', '3.0.0'].includes(restartVersion), 'Invalid Weather process fixture version')
const persistentCache = process.env.ODK_WEATHER_PERSISTENT_CACHE
if (persistentCache) {
  assert.ok((restartVersion || surfaceRevision) && path.isAbsolute(persistentCache), 'Persistent cache requires external revision mode')
  assert.equal(path.dirname(persistentCache), path.dirname(profile), 'Persistent cache must share the parent-owned profile root')
}
const payload = { current_units: { temperature_2m: '°C' }, current: { temperature_2m: -99.6, weather_code: 99 },
  daily: { temperature_2m_max: [100], temperature_2m_min: [-100] } }
const response = () => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => payload })
let win
let host
let release
let finishing
app.on('window-all-closed', () => {})
const deadline = setTimeout(() => { void finish(1, Error('WEATHER_ELECTRON_TIMEOUT')) }, restartVersion ? 45000 : surfaceTimeouts().fixture)
function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(deadline)
  if (error) console.error(error)
  release?.(response())
  finishing = (async () => {
    if (win && !win.isDestroyed()) {
      try { await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()') }
      finally { win.destroy() }
    }
    await rendererHost?.stop()
    nativeSurfaceAssets?.close()
    await host?.stop()
  })().then(() => app.exit(code), failure => { console.error(failure); app.exit(1) })
  return finishing
}

app.whenReady().then(async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(0)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }), /Fixture subprocesses belong to parent/)
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  installGeometryFixtures(ipcMain)
  ipcMain.removeHandler(channel)
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (surfaceReplacement) {
    ipcMain.removeHandler('odk-renderer-development-plugins')
    rendererHost = createPluginHost({ capabilities: { 'system.renderer-development': {
      ipc: ipcMain, protocol, nativeAssets: nativeSurfaceAssets, frames: () => [win.webContents], entries: () => surfaceEntries,
    } } })
    rendererHost.register(createRendererDevelopmentPlugin())
    await rendererHost.start()
  }
  const js = async source => {
    if (!source.startsWith('(')) return win.webContents.executeJavaScript(source)
    const result = await win.webContents.executeJavaScript(`(async () => {
      try { return { ok: true, value: await (${source}) }; }
      catch (error) { return { ok: false, error: error.stack || String(error) }; }
    })()`)
    if (!result.ok) throw Error(result.error)
    return result.value
  }
  const wait = state => js(`(async () => {
    const deadline = performance.now() + 4000;
    while (document.querySelector('[data-widget="odk.tile.weather"]')?.dataset.state !== ${JSON.stringify(state)}) {
      if (performance.now() > deadline) throw Error('Weather state did not settle: ${state}');
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await document.fonts.load('16px "Zpix"');
    await document.fonts.load('16px "Montserrat"');
    await document.fonts.load('16px "Noto Sans SC"');
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`)
  const collect = async () => {
    const result = await js(`(() => {
    const tile = document.querySelector('[data-widget="odk.tile.weather"]');
    const bounds = tile.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || bounds.left < -1 || bounds.right > innerWidth + 1
      || bounds.top < -1 || bounds.bottom > innerHeight + 1) throw Error('Weather tile outside viewport: ' + JSON.stringify({ bounds: bounds.toJSON(), width: innerWidth, height: innerHeight }));
    const selectors = ['.w-weather-place', '.w-weather-badge', '.w-weather-number', '.w-weather-unit',
      '.w-weather-condition', '.w-weather-detail', '.w-weather-range-label', '#w-weather-low', '#w-weather-high', '.w-weather-glyph svg'];
    for (const selector of selectors) {
      for (const node of tile.querySelectorAll(selector)) {
        if (node.hidden || getComputedStyle(node).display === 'none' || !node.textContent && !selector.includes('svg')) continue;
        const box = node.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0 || box.left < bounds.left - 1 || box.right > bounds.right + 1
          || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1) throw Error('Weather content outside tile: ' + selector);
        if (!selector.includes('svg') && parseFloat(getComputedStyle(node).fontSize) < 12) throw Error('Weather text below minimum: ' + selector);
      }
    }
    for (const selector of ['.w-weather-number', '.w-weather-unit', '.w-weather-condition', '#w-weather-low', '#w-weather-high']) {
      if (parseFloat(getComputedStyle(tile.querySelector(selector)).fontSize) < 14) throw Error('Weather reading below minimum: ' + selector);
    }
    const text = selector => tile.querySelector(selector).textContent;
    const glyph = tile.querySelector('.w-weather-glyph svg');
    return { state: tile.dataset.state, place: text('.w-weather-place'), badge: text('.w-weather-badge'),
      badgeHidden: tile.querySelector('.w-weather-badge').hidden, number: text('.w-weather-number'), unit: text('.w-weather-unit'),
      condition: text('.w-weather-condition'), detail: text('.w-weather-detail'), low: text('#w-weather-low'), high: text('#w-weather-high'),
      labels: [...tile.querySelectorAll('.w-weather-range-label')].map(node => node.textContent),
      title: tile.title, glyph: glyph.getAttribute('data-tabler'), glyphMarkup: glyph.innerHTML,
      controls: tile.querySelectorAll('button, input, select, textarea, a').length,
      font: getComputedStyle(tile.querySelector('.w-weather-number')).fontFamily,
      theme: document.documentElement.dataset.theme,
      zpixLoaded: [...document.fonts].some(face => face.family.replace(/["']/g, '') === 'Zpix' && face.status === 'loaded') };
  })()`)
    const measured = await js(`(${collectWidgetContent.toString()})().find(widget => widget.id === 'odk.tile.weather')`)
    assert.ok(measured, 'Weather density collector must observe the selected tile')
    const density = measureDensity(measured.frame, measured.boxes, WEATHER_PROFILE)
    assert.equal(measured.clipped, false, `Weather density clipping: ${result.theme}/${result.state}`)
    assert.deepEqual(density.violations, [], `Weather density: ${result.theme}/${result.state}`)
    return { ...result, density: { fill: density.fill, occupied: density.occupied, emptyBand: density.emptyBand } }
  }
  const baseline = new Map()
  let executedVersion
  let cacheReport
  for (const signed of restartVersion ? [restartVersion !== '1.0.0'] : [false, true]) {
    const env = surfaceRevision ? process.env : { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(profile, 'config'),
      XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state') }
    if (surfaceReplacement && signed) {
      if (signedSurface) {
        await js('window.odkRendererRuntime.stop()')
        await rendererHost.stop()
        surfaceEntries = await captureSignedSurface(env, process.env.ODK_WEATHER_SURFACE_KEYRING, nativeSurfaceAssets, { mutate: !surfaceRevision, productionPolicy: Boolean(surfaceRevision) })
        await rendererHost.start()
        assert.equal(protocol.isProtocolHandled(NATIVE_PLUGIN_SCHEME), surfaceRevision !== '1.0.0')
      } else {
        surfaceEntries = loadDevelopmentPlugins(readConfig(resolveConfigPath(env)), { host: 'electron-renderer' })
      }
      assert.equal(surfaceEntries.length, surfaceRevision === '1.0.0' ? 0 : 1)
    }
    const replacements = restartVersion
      ? await loadNativePlugins(readConfig(resolveConfigPath(process.env)), { env: process.env })
      : signed ? await loadPrepared(env, { mutate: !signedSurface }) : []
    assert.equal(replacements.length, signed ? 1 : 0)
    const cacheFile = path.join(profile, 'weather.json')
    let failed = false
    let pending = null
    let providerCalls = 0
    const options = { latitude: 1, longitude: 2, place: 'English 与中文地点', cacheFile, now: () => 1791504000000,
      fetchImpl: async () => { providerCalls++; if (failed) throw Error('Controlled provider unavailable'); return pending || response() } }
    const handlers = new Set()
    host = createPluginHost({ capabilities: {
      ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); ipcMain.handle(name, handler); handlers.add(name) },
        removeHandler(name) { ipcMain.removeHandler(name); handlers.delete(name) } },
      'source.weather': { options, create(configuration) {
        assert.equal(signed, false, 'Signed Weather cannot call the default source')
        return createWeatherSource(configuration)
      } },
    } })
    host.register(createMainPlugins({ replacementPlugins: replacements }).find(plugin => plugin.manifest.id === id))
    await host.start()
    const selected = () => {
      const version = restartVersion || (signed ? '2.0.0' : '1.0.0')
      assert.equal(host.list()[0].manifest.version, version)
      assert.equal(host.get(DATA_PORTS.weather).fixtureRevision, signed ? version : undefined)
      executedVersion = host.get(DATA_PORTS.weather).fixtureRevision || host.list()[0].manifest.version
    }
    const remount = async () => {
      const source = host.get(DATA_PORTS.weather)
      await js(`window.odkRendererRuntime.setEnabled(${JSON.stringify(widget)}, false)`)
      await js(`window.odkRendererRuntime.setEnabled(${JSON.stringify(widget)}, true)`)
      assert.equal(host.get(DATA_PORTS.weather), source)
      assert.equal(handlers.size, 1)
    }
    const restart = async configured => {
      await js(`window.odkRendererRuntime.setEnabled(${JSON.stringify(widget)}, false)`)
      await host.setEnabled(id, false)
      assert.equal(handlers.size, 0)
      fs.rmSync(cacheFile, { force: true })
      options.latitude = configured ? 1 : null
      options.longitude = configured ? 2 : null
      await host.setEnabled(id, true)
      selected()
      await js(`window.odkRendererRuntime.setEnabled(${JSON.stringify(widget)}, true)`)
    }
    for (const size of [[1920, 1280], [1920, 1080], [960, 640], [480, 854], [320, 480]]) for (const theme of ['instrument', 'pixel', 'border-beam']) {
      await host.setEnabled(id, false)
      fs.rmSync(cacheFile, { force: true })
      options.latitude = 1
      options.longitude = 2
      failed = false
      pending = new Promise(resolve => { release = resolve })
      await host.setEnabled(id, true)
      selected()
      win.setContentSize(...size)
      await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
      win.webContents.debugger.attach('1.3')
      try {
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
          width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false,
        })
      } finally { win.webContents.debugger.detach() }
      win.webContents.setZoomFactor(1)
      await js('window.odkShellReady')
      assert.equal(JSON.stringify(await js('[innerWidth, innerHeight, devicePixelRatio]')), JSON.stringify([...size, 1]))
      if (surfaceReplacement) {
        assert.equal(await js("window.odkPlugins.catalog().find(record => record.manifest.id === 'odk.tile.weather').manifest.version"), signed ? surfaceRevision || '2.0.0' : '1.0.0')
        if (surfaceRevision) assert.equal(await js("document.querySelector('[data-widget=\"odk.tile.weather\"]').dataset.fixtureSurfaceRevision || null"), signed && surfaceRevision !== '1.0.0' ? surfaceRevision : null)
        assert.equal(await js("document.querySelector('[data-widget=\"odk.tile.weather\"]').dataset.fixtureSurface || null"), signed && surfaceRevision !== '1.0.0' ? 'independent-weather' : null)
      }
      await js(`window.odkTheme.set(${JSON.stringify(theme)});
        const page = document.querySelector('[data-widget="odk.tile.weather"]').closest('.page');
        document.querySelectorAll('#dots .dot')[Number(page.dataset.page)].click();
        document.querySelector('[data-widget="odk.tile.weather"]').scrollIntoView({ block: 'center', inline: 'nearest' })`)
      await wait('waiting')
      const results = [await collect()]
      assert.equal(results[0].number, '--')
      assert.equal(results[0].badge, 'Waiting')
      assert.equal(results[0].condition, 'No reading yet')
      release(response())
      release = null
      pending = null
      await wait('live')
      results.push(await collect())
      assert.equal(results[1].number, '-100')
      assert.equal(results[1].unit, '°C')
      assert.equal(results[1].badgeHidden, true)
      assert.equal(results[1].glyph, 'weather-thunder')
      assert.equal(results[1].condition, 'Thunderstorm with hail')
      assert.equal(results[1].low, '-100°')
      assert.equal(results[1].high, '100°')
      assert.deepEqual(results[1].labels, ['Low', 'High'])
      assert.equal(results[1].place, options.place)
      assert.equal(results[1].controls, 0)
      assert.match(results[1].font, theme === 'pixel' ? /Zpix/ : /Montserrat/)
      assert.equal(results[1].zpixLoaded, true)
      failed = true
      await js('window.odkPlatform.getWeatherStatus({ force: true })')
      await remount()
      await wait('stale')
      results.push(await collect())
      assert.equal(results[2].number, '-100')
      assert.equal(results[2].badge, 'Stale')
      await restart(true)
      await wait('unavailable')
      results.push(await collect())
      assert.equal(results[3].number, '--')
      assert.equal(results[3].badge, 'Unavailable')
      assert.equal(results[3].condition, 'No weather reading')
      assert.equal(results[3].unit, '°C')
      await restart(false)
      await wait('unconfigured')
      results.push(await collect())
      assert.equal(results[4].detail, 'Location not set')
      assert.equal(results[4].badge, 'Unconfigured')
      assert.equal(results[4].condition, 'No weather location')
      failed = false
      await restart(true)
      await wait('live')
      results.push(await collect())
      assert.deepEqual(results[5], results[1])
      const key = `${size.join('x')}/${theme}`
      if (signed && !restartVersion) assert.deepEqual(results, baseline.get(key), `Weather rendered parity ${key}`)
      else baseline.set(key, results)
    }
    if (persistentCache) {
      await js(`window.odkRendererRuntime.setEnabled(${JSON.stringify(widget)}, false)`)
      await host.setEnabled(id, false)
      assert.equal(handlers.size, 0)
      options.latitude = 1
      options.longitude = 2
      options.cacheFile = persistentCache
      failed = process.env.ODK_WEATHER_CACHE_OFFLINE === '1'
      pending = null
      providerCalls = 0
      await host.setEnabled(id, true)
      selected()
      const initial = structuredClone(host.get(DATA_PORTS.weather).snapshot())
      const initialProviderCalls = providerCalls
      const snapshot = await js('window.odkPlatform.getWeatherStatus({ force: true })')
      await js(`window.odkRendererRuntime.setEnabled(${JSON.stringify(widget)}, true)`)
      await wait(failed ? 'stale' : 'live')
      cacheReport = { initial, initialProviderCalls, snapshot, rendered: await collect(), health: host.get(healthPort(id)).snapshot() }
    }
    await js('window.odkRendererRuntime.stop()')
    await host.stop()
    assert.equal(handlers.size, 0)
    host = null
  }
  if (signedSurface) {
    await rendererHost.stop()
    assert.equal(protocol.isProtocolHandled(NATIVE_PLUGIN_SCHEME), false)
    await assert.rejects(js('window.odkRendererPluginBridge.list()'), /No handler registered/)
    nativeSurfaceAssets.close()
    if (surfaceEntries.length) assert.equal(nativeSurfaceAssets.response({ url: surfaceEntries[0].entryUrl }).status, 410)
  }
  console.log(JSON.stringify({ ok: true, actualPreload: true, signedIndependent: !restartVersion || restartVersion !== '1.0.0', themes: 3, sizes: 5, states: 6,
    ...(restartVersion ? { processRestart: true, pid: process.pid, version: executedVersion, consumers: [...baseline.entries()] } : {}),
    ...(surfaceReplacement ? { independentSurface: surfaceRevision !== '1.0.0', developmentLoaded: !signedSurface,
      ...(signedSurface ? { signedSurface: true, capturedSurfaceIntegrity: !surfaceRevision, assetLeaseReleased: true } : {}) } : {}),
    ...(surfaceRevision ? { surfaceProcessRestart: true, pid: process.pid, surfaceVersion: surfaceRevision, consumers: [...baseline.entries()] } : {}),
    ...(persistentCache ? { cache: cacheReport } : {}) }))
  await finish(0)
}).catch(error => { void finish(1, error) })
