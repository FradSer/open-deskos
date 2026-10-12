'use strict'

const { app, BrowserWindow, ipcMain, session, nativeImage, protocol } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createPluginHost } = require('../src/plugin-host')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const { createNativeRendererAssets, NATIVE_PLUGIN_SCHEME } = require('../src/native-renderer-assets')
const { capture } = require('./helpers/camera-surface-selection')
const { DEFAULTS, collectWidgetContent, measureDensity } = require('./helpers/widget-density')
const signed = process.env.ODK_CAMERA_SURFACE_NATIVE === '1'
const assets = signed ? createNativeRendererAssets() : null
if (signed) require('../src/user-app-system').registerUserAppScheme(protocol)
const profile = process.env.ODK_CAMERA_SURFACE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'linux') app.disableHardwareAcceleration()
if (process.platform === 'darwin') app.dock.hide()
let win, host, finishing
const timer = setTimeout(() => { void finish(1, Error('CAMERA_SURFACE_TIMEOUT')) }, 45000)
async function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(timer)
  if (error) console.error(error)
  finishing = (async () => {
    try {
      if (win && !win.isDestroyed()) await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
    } finally {
      if (win && !win.isDestroyed() && win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
      win?.destroy()
      await host?.stop()
      assets?.close()
    }
  })().then(() => app.exit(code), failure => { console.error(failure); app.exit(1) })
  return finishing
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
  installGeometryFixtures(ipcMain)
  ipcMain.removeHandler('odk-camera-frame')
  let reading = { status: 'unavailable' }
  ipcMain.handle('odk-camera-frame', () => reading)
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let loads = 0
  win.webContents.on('did-finish-load', () => { loads++ })
  let entries = []
  ipcMain.removeHandler('odk-renderer-development-plugins')
  host = createPluginHost({ capabilities: { 'system.renderer-development': {
    ipc: ipcMain, protocol, nativeAssets: assets, runtimeNativeAssets: signed,
    frames: () => [win.webContents], entries: () => entries,
  } } })
  host.register(createRendererDevelopmentPlugin())
  await host.start()
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  win.webContents.setZoomFactor(1)
  await win.webContents.executeJavaScript('window.odkShellReady')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  // BGRA bitmap: red left half, blue right half, with a non-square intrinsic ratio.
  const pixels = Buffer.from([0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255,
    0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 0, 255, 255, 0, 0, 255])
  const image = nativeImage.createFromBitmap(pixels, { width: 4, height: 2 }).toDataURL()
  const states = [{ status: 'live', frame: image, capturedAt: 1700000000000 },
    { status: 'unavailable', frame: null }, { status: 'live', frame: image, capturedAt: 'invalid' },
    { status: 'live', frame: image, capturedAt: 1700000000000 }]
  await win.webContents.executeJavaScript(`(() => {
    window.cameraDocument = document;
    window.cameraDesktop = document.querySelector('[data-widget="odk.tile.camera"]');
    if (!window.cameraDesktop) throw Error('Camera desktop placement absent');
    const tile = document.createElement('div'); tile.id = 'camera-acceptance';
    tile.className = 'widget widget-display-only w-camera';
    document.body.append(tile);
    window.cameraTile = tile;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('#camera-acceptance, #camera-acceptance *, [data-widget="odk.tile.camera"], [data-widget="odk.tile.camera"] * {transition:none!important;animation:none!important}');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    window.cameraSheet = sheet;
    if (!window.odkPlugins.activate(window.odkPlugins.get('odk.tile.camera'), tile,
      { camera: window.odkServices.camera, onTick: window.odkServices.onTick })) throw Error('Camera mount refused');
  })()`)
  const baseline = []
  const densityBaseline = []
  let densityMeasurements = 0
  const viewports = [[1920, 1280], [1920, 1080], [960, 640], [480, 854], [320, 480]]
  const viewport = async (width, height) => {
    win.setContentSize(width, height)
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await win.webContents.executeJavaScript(`(async () => {
      window.dispatchEvent(new Event('resize'));
      const home = window.DESKTOP_LAYOUT.pages.findIndex(page => page.id === 'home');
      document.querySelectorAll('.dot')[home].click();
      const deadline = performance.now() + 5000;
      while (window.__odkGrid?.width !== ${width} || window.__odkGrid?.height !== ${height}
        || Math.abs(document.querySelector('.page[data-page="' + home + '"]').getBoundingClientRect().left) >= 1) {
        if (performance.now() > deadline) throw Error('Camera desktop viewport did not settle');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      await Promise.all([document.fonts.load('700 32px "Montserrat"'),
        document.fonts.load('400 16px "Noto Sans SC"'), document.fonts.load('400 16px "Zpix"')]);
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (innerWidth !== ${width} || innerHeight !== ${height} || devicePixelRatio !== 1 || visualViewport.scale !== 1)
        throw Error('Camera desktop measurement inputs changed');
    })()`)
  }
  await viewport(1920, 1280)
  for (const phase of ['default', 'independent', 'restored']) {
    if (phase === 'independent') {
      entries = signed ? await capture(process.env, process.env.ODK_NATIVE_KEYRING, assets, { productionPolicy: true })
        : loadDevelopmentPlugins(readConfig(resolveConfigPath(process.env)), { host: 'electron-renderer' })
      assert.equal(entries.length, 1)
      await win.webContents.executeJavaScript(`(async () => {
        window.odkPlugins.get('odk.tile.camera').lifecycle.mount = () => { throw Error('Default Camera delegation refused'); };
        const definitions = await window.odkRendererDevelopment.load({ runtime: true });
        if (definitions.length !== 1) throw Error('Camera entry absent');
        await window.odkRendererRuntime.replace(definitions[0]);
      })()`)
      if (signed) assert.equal(await win.webContents.executeJavaScript('window.odkCameraSurfaceRevision'), '2.0.0')
    } else if (phase === 'restored') {
      await win.webContents.executeJavaScript("window.odkRendererRuntime.restoreDefault('odk.tile.camera')")
    }
    assert.equal(await win.webContents.executeJavaScript("window.odkPlugins.catalog().find(record => record.manifest.id === 'odk.tile.camera').manifest.version"), phase === 'independent' ? '2.0.0' : '1.0.0')
    assert.equal(await win.webContents.executeJavaScript(`document === window.cameraDocument
      && document.querySelector('[data-widget="odk.tile.camera"]') === window.cameraDesktop
      && document.getElementById('camera-acceptance') === window.cameraTile
      && window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.camera'), window.cameraTile)`), true)
    let index = 0
    for (const theme of ['instrument', 'pixel', 'border-beam']) for (const size of [168, 292, 400]) {
      await win.webContents.executeJavaScript(`window.odkTheme.set(${JSON.stringify(theme)})`)
      for (const state of states) {
        reading = state
        assert.deepEqual(await win.webContents.executeJavaScript('window.odkPlatform.getCameraFrame()'), state)
        const view = await win.webContents.executeJavaScript(`(async () => {
          const tile = window.cameraTile;
          tile.style.cssText = 'position:fixed;left:0;top:0;width:${size}px;height:${size}px;--cell-dim:${size}px;--odk-widget-inset:clamp(16px,calc(var(--cell-dim)*0.08),28px)';
          await window.odkServices.camera.refresh();
          await document.fonts.ready;
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          if (devicePixelRatio !== 1 || visualViewport.scale !== 1) throw Error('Camera comparison scale changed');
          const image = tile.querySelector('img');
          let decoded = null;
          if (!image.hidden) {
            await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 2;
            const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
            decoded = { ratio: image.naturalWidth / image.naturalHeight,
              left: [...context.getImageData(0, 0, 1, 1).data], right: [...context.getImageData(3, 0, 1, 1).data] };
          } else if (image.hasAttribute('src')) throw Error('Unavailable Camera retained its frame');
          const box = tile.getBoundingClientRect();
          const nodes = [tile, ...tile.querySelectorAll('*')].map(node => {
            const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
            if (css.transitionDuration !== '0s' || css.animationName !== 'none') throw Error('Camera comparison motion control absent');
            return { attributes: [...node.attributes].map(attr => [attr.name, attr.value]).sort(([a], [b]) => a.localeCompare(b)),
              text: node.children.length ? null : node.textContent,
              computed: Object.fromEntries([...css].sort().map(property => [property, css.getPropertyValue(property)])),
              bounds: [rect.x-box.x, rect.y-box.y, rect.width, rect.height] };
          });
          if (tile.querySelector('button,input,a,select,textarea')) throw Error('Camera is display-only');
          for (const node of nodes) if (node.bounds[2] > 0 && node.bounds[3] > 0) {
            if (node.bounds[0] < -1 || node.bounds[1] < -1 || node.bounds[0]+node.bounds[2] > box.width+1
              || node.bounds[1]+node.bounds[3] > box.height+1) throw Error('Camera content escapes its cell');
          }
          for (const node of tile.querySelectorAll('span')) if (parseFloat(getComputedStyle(node).fontSize) < 12) throw Error('Camera text below readable floor');
          return { nodes, decoded, objectFit: getComputedStyle(image).objectFit };
        })()`)
        assert.equal(view.objectFit, 'cover')
        assert.deepEqual(view.decoded, state.status === 'live' ? { ratio: 2, left: [255, 0, 0, 255], right: [0, 0, 255, 255] } : null)
        if (phase === 'default') baseline.push(view)
        else assert.deepEqual(view, baseline[index], JSON.stringify({ phase, theme, size, index }))
        index++
      }
    }
    let densityIndex = 0
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      await win.webContents.executeJavaScript(`window.odkTheme.set(${JSON.stringify(theme)})`)
      for (const [width, height] of viewports) {
        await viewport(width, height)
        for (const state of states.slice(0, 2)) {
          reading = state
          const widget = await win.webContents.executeJavaScript(`(async () => {
            await window.odkServices.camera.refresh();
            await document.fonts.ready;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const tile = document.querySelector('[data-widget="odk.tile.camera"]');
            if (document !== window.cameraDocument || tile !== window.cameraDesktop
              || !window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.camera'), tile)) throw Error('Camera desktop ownership changed');
            if (innerWidth !== ${width} || innerHeight !== ${height} || devicePixelRatio !== 1 || visualViewport.scale !== 1
              || document.fonts.status !== 'loaded' || document.documentElement.dataset.theme !== ${JSON.stringify(theme)})
              throw Error('Camera density measurement inputs changed');
            for (const node of [tile, ...tile.querySelectorAll('*')]) {
              const css = getComputedStyle(node);
              if (css.transitionDuration !== '0s' || css.animationName !== 'none') throw Error('Camera density motion control absent');
            }
            const image = tile.querySelector('img');
            if (image.hidden !== ${JSON.stringify(state.status !== 'live')}) throw Error('Camera density reading did not render');
            if (!image.hidden) await image.decode();
            return (${collectWidgetContent.toString()})().find(widget => widget.id === 'odk.tile.camera');
          })()`)
          assert.ok(widget, 'Camera desktop density content absent')
          assert.equal(widget.clipped, false, JSON.stringify({ phase, theme, width, height, state: state.status }))
          const result = measureDensity(widget.frame, widget.boxes, DEFAULTS)
          assert.deepEqual(result.violations, [], JSON.stringify({ phase, theme, width, height, state: state.status, result }))
          if (phase === 'default') densityBaseline.push({ widget, result })
          else assert.deepEqual({ widget, result }, densityBaseline[densityIndex], JSON.stringify({ phase, theme, width, height, state: state.status }))
          densityIndex++
          densityMeasurements++
        }
      }
    }
    await viewport(1920, 1280)
  }
  assert.equal(loads, 1)
  await win.webContents.executeJavaScript(`(async () => {
    await window.odkPlugins.deactivate(window.odkPlugins.get('odk.tile.camera'), window.cameraTile);
    window.cameraTile.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== window.cameraSheet);
    if (document.adoptedStyleSheets.includes(window.cameraSheet)) throw Error('Camera comparison stylesheet retained');
  })()`)
  reading = states[0]
  await win.webContents.executeJavaScript(`(async () => {
    const id = 'odk.tile.camera';
    const original = window.odkServices.camera;
    let subscriptions = 0, releases = 0, refreshes = 0;
    const replacement = {
      subscribe(callback) {
        subscriptions++;
        callback({ status: 'live', frame: ${JSON.stringify(image)}, capturedAt: 1700000060000 });
        return () => { releases++; };
      },
      refresh() { refreshes++; return Promise.resolve(); },
    };
    window.odkServices.registerService('odk.service.camera', replacement);
    await window.odkRendererRuntime.setEnabled(id, false);
    await window.odkRendererRuntime.setEnabled(id, true);
    if (subscriptions !== 1 || refreshes !== 1) throw Error('Remounted Camera retained the old shared service');
    const selectedFrame = document.querySelector('[data-widget="odk.tile.camera"] .w-camera-frame');
    if (selectedFrame.hidden || selectedFrame.src !== ${JSON.stringify(image)}) throw Error('Selected Camera reading absent');
    await window.odkRendererRuntime.setEnabled(id, false);
    if (releases !== 1) throw Error('Selected Camera subscription retained');
    window.odkServices.registerService('odk.service.camera', original);
    await original.refresh();
    await window.odkRendererRuntime.setEnabled(id, true);
    const restoredFrame = document.querySelector('[data-widget="odk.tile.camera"] .w-camera-frame');
    if (restoredFrame.hidden || restoredFrame.src !== ${JSON.stringify(image)}) throw Error('Original Camera reading not restored');
    if (subscriptions !== 1 || releases !== 1) throw Error('Original Camera reused the replacement subscription');
  })()`)
  await host.stop()
  assert.equal(await win.webContents.executeJavaScript('window.odkRendererPluginBridge.list().then(() => false, () => true)'), true)
  if (signed) {
    assert.equal(protocol.isProtocolHandled(NATIVE_PLUGIN_SCHEME), false)
    assets.close()
    assert.equal(assets.response({ url: entries[0].entryUrl }).status, 410)
  }
  console.log(JSON.stringify({ actualPreload: true, developmentLoaded: !signed,
    ...(signed ? { signedSurface: true, capturedIntegrity: true, assetLeaseReleased: true } : {}), documentLoads: loads,
    themes: 3, sizes: 3, states: 4, comparisons: 72, decodedRegions: true, restored: true, discoveryReleased: true, selectedServiceOnRemount: true,
    density: { themes: 3, viewports: viewports.length, states: 2, measurements: densityMeasurements, comparisons: densityBaseline.length * 2, violations: 0 } }))
  await finish(0)
}).catch(error => { void finish(1, error) })
