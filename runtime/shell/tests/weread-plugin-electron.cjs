'use strict'

const { app, BrowserWindow, ipcMain, session, nativeImage, protocol } = require('electron')
if (process.platform === 'darwin') app.dock.hide()
if (process.platform === 'linux') app.disableHardwareAcceleration()
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const profile = process.env.ODK_WEREAD_FIXTURE_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'WeRead fixture needs its parent-owned absolute profile')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createWeReadSource } = require('../src/weread-source')
const { healthPort } = require('../src/plugins/health')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { install } = require('./helpers/weread-selection')
const surfaceReplacement = process.env.ODK_WEREAD_SURFACE_REPLACEMENT === '1'
const surfaceRevision = process.env.ODK_WEREAD_SURFACE_REVISION
assert.ok(!surfaceRevision || ['1.0.0', '2.0.0', '3.0.0'].includes(surfaceRevision), 'Invalid WeRead surface process revision')
const signedSurface = surfaceReplacement && process.env.ODK_WEREAD_SURFACE_NATIVE === '1'
const { createNativeRendererAssets, NATIVE_PLUGIN_SCHEME } = require('../src/native-renderer-assets')
const { capture: captureSignedSurface } = require('./helpers/weread-surface-selection')
const nativeSurfaceAssets = signedSurface ? createNativeRendererAssets() : null
if (signedSurface) require('../src/user-app-system').registerUserAppScheme(protocol)
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
let rendererHost
let surfaceEntries = []
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { loadNativePlugins } = require('../src/native-plugin-loader')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const { surfaceTimeouts } = require('./helpers/weread-selection')
const { WEREAD_PROFILE, measureDensity, collectWidgetContent } = require('./helpers/widget-density')
const id = 'odk.source.weread'
const widget = 'odk.tile.weread'
const channel = 'odk-weread-highlight'
const restartVersion = process.env.ODK_WEREAD_RESTART_VERSION
assert.ok(!restartVersion || ['1.0.0', '2.0.0', '3.0.0'].includes(restartVersion), 'Invalid WeRead process fixture version')
const persistentCache = process.env.ODK_WEREAD_PERSISTENT_CACHE
if (persistentCache) {
  assert.ok(surfaceRevision && path.isAbsolute(persistentCache), 'Persistent highlights require surface revision mode')
  assert.equal(path.dirname(persistentCache), path.dirname(profile), 'Persistent highlights must stay in the parent fixture root')
}
const timestamp = 1791504000000
const baseText = 'Keep the complete English reading 与中文摘录.\nSecond line <img src=x onerror="window.fixtureUnsafe=true">'
const markText = surfaceReplacement ? `${baseText}\n`.repeat(150) : baseText
const densityText = '把每一次微小的改变累积起来，最终会带来意想不到的结果。'
const coverBitmap = Buffer.from([
  ...Array(4).fill([0, 0, 255, 255]).flat(),
  ...Array(4).fill([255, 0, 0, 255]).flat(),
])
const coverBytes = nativeImage.createFromBitmap(coverBitmap, { width: 2, height: 4 }).toPNG()
assert.ok(coverBytes.length)
let win
let host
let finishing
let releaseNotebook
app.on('window-all-closed', () => {})
const deadline = setTimeout(() => { void finish(1, Error('WEREAD_ELECTRON_TIMEOUT')) }, restartVersion ? 45000 : surfaceTimeouts().fixture)
function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(deadline)
  if (error) console.error(error)
  releaseNotebook?.({ ok: true, json: async () => ({ books: [] }) })
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
  assert.equal(app.getPath('userData'), profile)
  assert.equal(app.getPath('sessionData'), profile)
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
  const js = source => win.webContents.executeJavaScript(source)
  const wait = predicate => js(`(async () => {
    const deadline = performance.now() + 4000;
    while (!(${predicate})) {
      if (performance.now() > deadline) throw Error('WeRead consumer did not settle: ' + ${JSON.stringify(predicate)});
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await document.fonts.load('16px "Zpix"');
    await document.fonts.load('16px "Montserrat"');
    await document.fonts.load('16px "Noto Sans SC"');
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`)
  const setWidget = async enabled => {
    await js(`window.odkRendererRuntime.setEnabled(${JSON.stringify(widget)}, ${enabled})`)
    assert.equal(await js('window.__wereadObservers.size'), enabled ? 1 : 0, 'Each mounted WeRead owns exactly one observer')
  }
  const remount = async () => { await setWidget(false); await setWidget(true) }
  const checkKeyboardScroll = async () => {
    const pageBefore = await js(`document.querySelector('.w-weread').closest('.page').dataset.page`)
    win.webContents.debugger.attach('1.3')
    try {
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
      const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument')
      const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '.weread-text' })
      await win.webContents.debugger.sendCommand('DOM.focus', { nodeId })
      assert.equal(await js(`document.activeElement === document.querySelector('.weread-text')`), true)
      for (const key of ['End', 'Home']) {
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: key })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: key })
        await wait(key === 'End'
          ? `document.querySelector('.weread-text').scrollTop + document.querySelector('.weread-text').clientHeight >= document.querySelector('.weread-text').scrollHeight - 1`
          : `document.querySelector('.weread-text').scrollTop === 0`)
        assert.equal(await js(`document.activeElement === document.querySelector('.weread-text')`), true)
        assert.equal(await js(`document.querySelectorAll('#dots .dot')[${Number(pageBefore)}].getAttribute('aria-current')`), 'page')
      }
    } finally {
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false })
      win.webContents.debugger.detach()
    }
  }
  const collect = async () => {
    const result = await js(`(() => { try {
    const tile = document.querySelector('.w-weread');
    const page = tile.closest('.page');
    const bounds = page.getBoundingClientRect();
    const frame = tile.getBoundingClientRect();
    if (bounds.right <= 0 || bounds.left >= innerWidth || frame.width <= 0) throw Error('WeRead page is not visible');
    if (frame.left < bounds.left - 1 || frame.right > bounds.right + 1) throw Error('WeRead Widget outside its page');
    const text = tile.querySelector('.weread-text');
    const wrap = tile.querySelector('.weread-cover-wrap');
    const canvas = tile.querySelector('canvas');
    for (const node of tile.querySelectorAll('.weread-text, .weread-title, .weread-author, .weread-date, .weread-cover-wrap')) {
      if (node.hidden) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.left < frame.left - 1 || rect.right > frame.right + 1
        || rect.top < frame.top - 1 || rect.bottom > frame.bottom + 1) throw Error('WeRead content outside Widget: ' + node.className
          + ' ' + JSON.stringify({ rect: rect.toJSON(), frame: frame.toJSON() }));
    }
    const overflow = text.scrollHeight > text.clientHeight + 1;
    if (overflow) {
      if (getComputedStyle(text).overflowY !== 'auto' || text.tabIndex !== 0) throw Error('WeRead excerpt has no accessible scroll path');
      const previous = text.scrollTop;
      text.scrollTop = text.scrollHeight;
      const range = document.createRange();
      range.setStart(text.firstChild, text.textContent.length - 1);
      range.setEnd(text.firstChild, text.textContent.length);
      const tail = range.getBoundingClientRect();
      const region = text.getBoundingClientRect();
      if (text.scrollTop <= 0 || tail.top < region.top - 1 || tail.bottom > region.bottom + 1) throw Error('WeRead excerpt tail is not reachable');
      text.scrollTop = previous;
    }
    if (parseFloat(getComputedStyle(text).fontSize) < 14) throw Error('WeRead excerpt is too small');
    return {
      theme: document.documentElement.dataset.theme,
      title: tile.querySelector('.weread-title').textContent,
      author: tile.querySelector('.weread-author').textContent,
      authorHidden: tile.querySelector('.weread-author').hidden,
      date: tile.querySelector('.weread-date').textContent,
      dateHidden: tile.querySelector('.weread-date').hidden,
      text: text.textContent, textHtml: text.innerHTML,
      font: getComputedStyle(text).fontFamily,
      scrollable: overflow,
      coverHidden: wrap.hidden,
      cover: wrap.hidden ? null : { width: canvas.width, height: canvas.height,
        ratio: canvas.style.aspectRatio, pixels: canvas.toDataURL(),
        samples: [0.1, 0.9].map(ratio => [...canvas.getContext('2d')
          .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * ratio), 1, 1).data]) },
      unsafe: Boolean(window.fixtureUnsafe),
      controls: tile.querySelectorAll('button, input, a').length,
    };
    } catch (error) { return { fixtureError: error.message }; }
  })()`)
    assert.equal(result.fixtureError, undefined, result.fixtureError)
    return result
  }
  const baseline = new Map()
  let executedVersion
  let cacheReport
  let primingProviderCalls
  for (const signed of restartVersion ? [restartVersion !== '1.0.0'] : [false, true]) {
    const env = restartVersion || surfaceRevision ? { ...process.env } : { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(profile, 'config'),
      XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state') }
    const native = signed && !restartVersion && !surfaceReplacement ? await install(profile, env) : null
    const replacements = restartVersion || (surfaceReplacement && signed) ? await loadNativePlugins(readConfig(resolveConfigPath(env)), { env }) : native ? await native.load() : []
    assert.deepEqual(replacements.map(plugin => plugin.manifest.id), signed ? [id] : [])
    if (native) native.mutate()
    if (surfaceReplacement && signed) {
      if (signedSurface) {
        await rendererHost.stop()
        surfaceEntries = await captureSignedSurface(env, process.env.ODK_WEREAD_SURFACE_KEYRING, nativeSurfaceAssets, { mutate: !surfaceRevision, productionPolicy: Boolean(surfaceRevision) })
        await rendererHost.start()
        assert.equal(protocol.isProtocolHandled(NATIVE_PLUGIN_SCHEME), surfaceRevision !== '1.0.0')
      } else surfaceEntries = loadDevelopmentPlugins(readConfig(resolveConfigPath(env)), { host: 'electron-renderer' })
      assert.equal(surfaceEntries.length, surfaceRevision === '1.0.0' ? 0 : 1)
      if (surfaceEntries.length) assert.equal(surfaceEntries[0].manifest.id, widget)
    }
    const cacheFile = path.join(profile, 'fixture-highlights.json')
    let clock = timestamp
    let state = {}
    let pendingNotebook
    let providerCalls = 0
    const books = () => state.empty ? [] : [{ bookId: 'fixture-book', noteCount: 1,
      book: { title: state.density ? '习惯的力量：微习惯的复利' : state.missing ? '《》' : '《Long English 与中文书名》',
        author: state.missing || state.density ? '' : 'Fixture Author 与中文作者',
        coverUrl: state.noCover || state.density ? '' : 'https://fixture.invalid/cover.png' } }]
    const options = { apiKey: 'controlled-key', cacheFile, now: () => clock, random: () => 0,
      fetchImpl: async (_url, request) => {
        providerCalls++
        if (state.fail) throw Error('Fixture synchronization unavailable')
        if (!request.body) return { ok: true, headers: { get: () => state.rejectedCover ? 'text/html' : 'image/png' }, arrayBuffer: async () => coverBytes }
        const body = JSON.parse(request.body)
        if (body.api_name === '/user/notebooks') return pendingNotebook || { ok: true, json: async () => ({ books: books() }) }
        return { ok: true, json: async () => ({ updated: [{ type: 1, markText: state.density ? densityText : markText, range: 'Fixture chapter', createTime: state.missing || state.density ? 0 : timestamp }] }) }
      } }
    const handlers = new Set()
    host = createPluginHost({ capabilities: {
      ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); ipcMain.handle(name, handler); handlers.add(name) },
        removeHandler(name) { ipcMain.removeHandler(name); handlers.delete(name) } },
      'source.weread': { options, create(configuration) {
        assert.equal(signed, false, 'Signed WeRead cannot call the default factory')
        return createWeReadSource(configuration)
      } },
    } })
    host.register(createMainPlugins({ replacementPlugins: replacements }).find(plugin => plugin.manifest.id === id))
    await host.start()
    const assertSource = () => {
      assert.equal(host.list()[0].state, 'running')
      const expectedVersion = restartVersion || (signed ? '2.0.0' : '1.0.0')
      assert.equal(host.list()[0].manifest.version, expectedVersion)
      assert.equal(host.get(DATA_PORTS.weread).fixtureRevision, signed ? expectedVersion : undefined)
      executedVersion = host.get(DATA_PORTS.weread).fixtureRevision || host.list()[0].manifest.version
    }
    assertSource()
    for (const size of [[1920, 1280], [1920, 1080], [960, 640], [480, 854], [320, 480]]) for (const theme of ['instrument', 'pixel', 'border-beam']) {
      await host.setEnabled(id, false)
      assert.equal(handlers.size, 0)
      assert.equal(host.list()[0].state, 'disabled')
      fs.rmSync(cacheFile, { force: true })
      clock = timestamp
      options.apiKey = 'controlled-key'
      state = {}
      pendingNotebook = new Promise(resolve => { releaseNotebook = resolve })
      await host.setEnabled(id, true)
      assertSource()
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
        assert.equal(await js("window.odkPlugins.catalog().find(record => record.manifest.id === 'odk.tile.weread').manifest.version"), signed ? surfaceRevision || '2.0.0' : '1.0.0')
        assert.equal(await js("document.querySelector('.w-weread').dataset.fixtureSurface || null"), signed && surfaceRevision !== '1.0.0' ? 'independent-weread' : null)
        if (surfaceRevision) assert.equal(await js("document.querySelector('.w-weread').dataset.fixtureSurfaceRevision || null"), signed && surfaceRevision !== '1.0.0' ? surfaceRevision : null)
      }
      await js(`window.__wereadObservers = new Set();
        const NativeObserver = window.ResizeObserver;
        window.ResizeObserver = class extends NativeObserver {
          observe(element, options) {
            super.observe(element, options);
            if (element.matches('.w-weread')) window.__wereadObservers.add(this);
          }
          disconnect() { super.disconnect(); window.__wereadObservers.delete(this); }
        }; void 0;`)
      await remount()
      await js(`window.odkTheme.set(${JSON.stringify(theme)});
        const page = document.querySelector('.w-weread').closest('.page');
        document.querySelectorAll('#dots .dot')[Number(page.dataset.page)].click()`)
      await wait(`document.querySelector('.weread-title')?.textContent === 'Loading'`)
      const results = [await collect()]
      assert.equal(results[0].text, 'Syncing highlights...')
      releaseNotebook({ ok: true, json: async () => ({ books: books() }) })
      releaseNotebook = null
      pendingNotebook = null
      await wait(`document.querySelector('.weread-title').textContent === 'Long English 与中文书名' && !document.querySelector('.weread-cover-wrap').hidden`)
      results.push(await collect())
      assert.equal(results[1].text, markText)
      assert.equal(results[1].unsafe, false)
      assert.equal(results[1].controls, 0)
      assert.deepEqual(results[1].cover.samples, [[255, 0, 0, 255], [0, 0, 255, 255]])
      assert.equal(results[1].cover.height, results[1].cover.width * 2)
      assert.equal(results[1].cover.ratio, '2 / 4')
      assert.match(results[1].textHtml, /&lt;img/)
      assert.equal(results[1].authorHidden, false)
      assert.equal(results[1].dateHidden, false)
      assert.match(results[1].date, /^\d{4}-\d{2}-\d{2}$/)
      assert.match(results[1].font, theme === 'pixel' ? /Zpix/ : /Noto Sans SC/)
      if (surfaceReplacement) assert.equal(results[1].scrollable, true, 'Independent surface acceptance must exercise actual overflow keys')
      if (results[1].scrollable) await checkKeyboardScroll()
      for (const next of [
        { state: { empty: true }, title: 'No highlights', text: 'No highlights available' },
        { state: { fail: true }, title: 'Sync unavailable', text: 'Fixture synchronization unavailable' },
        { state: {}, title: 'Long English 与中文书名', text: markText },
        { state: { missing: true, rejectedCover: true }, title: 'WeRead', text: markText },
      ]) {
        state = next.state
        clock += 30 * 60 * 1000
        await remount()
        assertSource()
        assert.equal(handlers.size, 1, 'Widget release cannot stop the shared source')
        await wait(`document.querySelector('.weread-title').textContent === ${JSON.stringify(next.title)} && document.querySelector('.weread-text').textContent === ${JSON.stringify(next.text)}${!next.state.empty && !next.state.fail && !next.state.rejectedCover ? " && !document.querySelector('.weread-cover-wrap').hidden" : ''}`)
        const result = await collect()
        assert.equal(result.coverHidden, Boolean(next.state.empty || next.state.fail || next.state.rejectedCover))
        if (next.state.missing) { assert.equal(result.authorHidden, true); assert.equal(result.dateHidden, true) }
        results.push(result)
      }
      state = { density: true }
      clock += 30 * 60 * 1000
      await remount()
      await wait(`document.querySelector('.weread-text').textContent === ${JSON.stringify(densityText)} && document.querySelector('.weread-cover-wrap').hidden`)
      const densityConsumer = await collect()
      assert.equal(densityConsumer.scrollable, false, `Short density excerpt must be fully visible: ${size.join('x')}/${theme}`)
      const measured = await js(`(${collectWidgetContent.toString()})().find(widget => widget.id === 'odk.tile.weread')`)
      assert.ok(measured, 'Density collector must observe the selected WeRead tile')
      const density = measureDensity(measured.frame, measured.boxes, WEREAD_PROFILE)
      assert.equal(measured.clipped, false, `WeRead density clipping: ${size.join('x')}/${theme}`)
      assert.deepEqual(density.violations, [], `WeRead density: ${size.join('x')}/${theme}`)
      results.push({ ...densityConsumer, density: { fill: density.fill, occupied: density.occupied, emptyBand: density.emptyBand } })
      await setWidget(false)
      await host.setEnabled(id, false)
      assert.equal(handlers.size, 0)
      fs.rmSync(cacheFile, { force: true })
      options.apiKey = ''
      const before = providerCalls
      await host.setEnabled(id, true)
      assertSource()
      await setWidget(true)
      await wait(`document.querySelector('.weread-title').textContent === 'Not configured'`)
      results.push(await collect())
      assert.equal(providerCalls, before, 'Unconfigured source cannot contact the provider')
      assert.equal(results.at(-1).text, 'Set WEREAD_API_KEY to sync')
      const key = `${size.join('x')}/${theme}`
      if (!signed || restartVersion) baseline.set(key, results)
      else assert.deepEqual(results, baseline.get(key), `WeRead rendered parity ${key}`)
    }
    if (persistentCache) {
      await setWidget(false)
      await host.setEnabled(id, false)
      assert.equal(handlers.size, 0)
      clock = timestamp
      state = { noCover: true }
      pendingNotebook = null
      options.cacheFile = persistentCache
      options.apiKey = process.env.ODK_WEREAD_CACHE_ONLY === '1' ? '' : 'controlled-key'
      providerCalls = 0
      await host.setEnabled(id, true)
      assertSource()
      const initial = structuredClone(host.get(DATA_PORTS.weread).snapshot())
      const initialProviderCalls = providerCalls
      const snapshot = await js('window.odkPlatform.getWeReadHighlight()')
      await setWidget(true)
      await wait("document.querySelector('.weread-title').textContent === 'Long English 与中文书名'")
      if (!signed) primingProviderCalls = providerCalls
      cacheReport = { initial, initialProviderCalls, snapshot, providerCalls, primingProviderCalls, rendered: await collect(),
        health: host.get(healthPort(id)).snapshot() }
    }
    await js('window.odkRendererRuntime.stop()')
    assert.equal(await js('window.__wereadObservers.size'), 0)
    await host.stop()
    assert.equal(handlers.size, 0)
    assert.equal(host.list().some(record => ['cleanup-failed', 'cleanup-blocked'].includes(record.state)), false)
    host = null
  }
  if (signedSurface) {
    await rendererHost.stop()
    assert.equal(protocol.isProtocolHandled(NATIVE_PLUGIN_SCHEME), false)
    assert.match(await js("(async () => { try { await window.odkRendererPluginBridge.list(); return 'accepted' } catch (error) { return String(error) } })()"), /No handler registered/)
    nativeSurfaceAssets.close()
    if (surfaceEntries.length) assert.equal(nativeSurfaceAssets.response({ url: surfaceEntries[0].entryUrl }).status, 410)
  }
  const report = { ok: true, actualPreload: true, signedIndependent: !restartVersion || restartVersion !== '1.0.0', themes: 3, sizes: 5, decodedCovers: true,
    ...(surfaceReplacement ? { independentSurface: surfaceRevision !== '1.0.0', developmentLoaded: !signedSurface,
      ...(signedSurface ? { signedSurface: true, capturedSurfaceIntegrity: !surfaceRevision, assetLeaseReleased: true } : {}) } : {}),
    ...(surfaceRevision ? { surfaceProcessRestart: true, surfaceVersion: surfaceRevision, pid: process.pid, consumers: [...baseline.entries()] } : {}),
    ...(persistentCache ? { cache: cacheReport } : {}),
    ...(restartVersion ? { processRestart: true, pid: process.pid, version: executedVersion, consumers: [...baseline.entries()] } : {}) }
  await new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(report)}\n`, error => error ? reject(error) : resolve()))
  await finish(0)
}).catch(error => { void finish(1, error) })
