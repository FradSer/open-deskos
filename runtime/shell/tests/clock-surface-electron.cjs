'use strict'

const { app, BrowserWindow, ipcMain, session, protocol } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createPluginHost } = require('../src/plugin-host')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { loadNativeRendererPlugins } = require('../src/native-plugin-loader')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { createNativeRendererAssets } = require('../src/native-renderer-assets')
const { installGeometryFixtures } = require('./helpers/live-fixtures')

const signed = process.env.ODK_CLOCK_SURFACE_NATIVE === '1'
const profile = process.env.ODK_CLOCK_SURFACE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
const assets = signed ? createNativeRendererAssets() : null
if (signed) require('../src/user-app-system').registerUserAppScheme(protocol)
let win, host, finishing
let phase = 'startup'
const checkpoint = name => { phase = name; if (process.env.ODK_CLOCK_SURFACE_TRACE === '1') console.error(`CLOCK_PHASE: ${name}`) }
const timeout = setTimeout(() => { void finish(1, Error(`Clock surface acceptance timed out during ${phase}`)) }, 45000)
async function release() {
  try { if (win && !win.isDestroyed()) await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()') }
  finally {
    if (win && !win.isDestroyed() && win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
    win?.destroy()
    await host?.stop()
    assets?.close()
  }
}
function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(timeout)
  if (error) console.error(error)
  finishing = release().then(() => app.exit(code), failure => { console.error(failure); app.exit(1) })
  return finishing
}

app.whenReady().then(async () => {
  checkpoint('ready')
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
  installGeometryFixtures(ipcMain)
  let entries = []
  ipcMain.removeHandler('odk-renderer-development-plugins')
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } })
  checkpoint('window-created')
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  host = createPluginHost({ capabilities: { 'system.renderer-development': {
    ipc: ipcMain, protocol, nativeAssets: assets, runtimeNativeAssets: signed,
    frames: () => [win.webContents], entries: () => entries,
  } } })
  host.register(createRendererDevelopmentPlugin())
  await host.start()
  checkpoint('blank-load')
  await win.loadURL('about:blank')
  checkpoint('debugger')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await require('./helpers/time-widget-layout').installTimeWidgetLayout(win)
  // Freeze Date before initial subscriptions; retain ordinary Date construction with explicit arguments.
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const ActualDate = Date;
    window.clockFixedTime = new ActualDate(2026, 0, 1, 12, 34).getTime();
    window.Date = class extends ActualDate {
      constructor(...args) { super(...(args.length ? args : [window.clockFixedTime])); }
      static now() { return window.clockFixedTime; }
    };
  })()` })
  let loads = 0
  win.webContents.on('did-finish-load', () => { loads++ })
  checkpoint('document-load')
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  checkpoint('content-size')
  win.setContentSize(1920, 1280)
  checkpoint('renderer-metrics')
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false,
  })
  checkpoint('zoom')
  win.webContents.setZoomFactor(1)
  const js = code => win.webContents.executeJavaScript(code)
  checkpoint('shell-ready')
  await js('window.odkShellReady')
  assert.equal(await js('new Date().getHours() * 100 + new Date().getMinutes()'), 1234)
  await js(`(() => {
    window.clockDocument = document;
    window.clockDesktop = document.querySelector('[data-widget="odk.tile.clock"]');
    if (!window.clockDesktop) throw Error('Clock desktop placement absent');
    const tile = document.createElement('div'); tile.id = 'clock-acceptance';
    tile.className = 'widget widget-display-only w-clock'; document.body.append(tile);
    window.clockTile = tile;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('#clock-acceptance, #clock-acceptance * {transition:none!important;animation:none!important}');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; window.clockSheet = sheet;
    window.clockSubscriptions = 0;
    const ui = { onTick(callback) {
      const cancel = window.odkServices.onTick(callback); window.clockSubscriptions++;
      return () => { cancel(); window.clockSubscriptions--; };
    } };
    if (!window.odkPlugins.activate(window.odkPlugins.get('odk.tile.clock'), tile, ui)) throw Error('Clock mount refused');
    if (window.clockSubscriptions !== 1) throw Error('Initial Clock subscription not observed');
  })()`)
  const baseline = []
  for (const phase of ['default', 'independent', 'restored']) {
    if (phase === 'independent') {
      const config = readConfig(resolveConfigPath(process.env))
      entries = signed ? await loadNativeRendererPlugins(config, { env: process.env, assets })
        : loadDevelopmentPlugins(config, { host: 'electron-renderer' })
      assert.equal(entries.length, 1)
      await js(`(async () => {
        window.odkPlugins.get('odk.tile.clock').lifecycle.mount = () => { throw Error('Default Clock delegation refused'); };
        const definitions = await window.odkRendererDevelopment.load({ runtime: true });
        if (definitions.length !== 1) throw Error('Clock entry absent');
        await window.odkRendererRuntime.replace(definitions[0]);
      })()`)
    } else if (phase === 'restored') await js("window.odkRendererRuntime.restoreDefault('odk.tile.clock')")
    assert.equal(await js("window.odkPlugins.get('odk.tile.clock').manifest.version || '1.0.0'"), phase === 'independent' ? '2.0.0' : '1.0.0')
    assert.equal(await js(`document === window.clockDocument && window.clockSubscriptions === 1
      && document.querySelector('[data-widget="odk.tile.clock"]') === window.clockDesktop
      && window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.clock'), window.clockDesktop)
      && window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.clock'), window.clockTile)`), true)
    let index = 0
    for (const theme of ['instrument', 'pixel', 'border-beam']) for (const size of [168, 292, 400]) {
      await js(`window.odkTheme.set(${JSON.stringify(theme)})`)
      checkpoint(`${phase}-${theme}-${size}`)
      const view = await js(`(async () => {
        const tile = window.clockTile;
        tile.style.cssText = 'position:fixed;left:0;top:0;width:${size}px;height:${size}px;--cell-dim:${size}px;--odk-widget-inset:clamp(16px,calc(var(--cell-dim)*0.08),28px)';
        await Promise.all([document.fonts.load('700 32px "Montserrat"'), document.fonts.load('400 16px "Noto Sans SC"'), document.fonts.load('400 16px "Zpix"')]);
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (innerWidth !== 1920 || innerHeight !== 1280 || devicePixelRatio !== 1 || visualViewport.scale !== 1
          || document.fonts.status !== 'loaded' || new Date().getHours() !== 12) throw Error('Clock measurement inputs changed: ' + JSON.stringify({ width: innerWidth, height: innerHeight, deviceScale: devicePixelRatio, zoom: visualViewport.scale, fonts: document.fonts.status, hour: new Date().getHours() }));
        const time = tile.querySelector('time'); const bounds = time.getBoundingClientRect(); const frame = tile.getBoundingClientRect();
        const style = getComputedStyle(time);
        if (bounds.width <= 0 || bounds.height <= 0 || bounds.left < frame.left || bounds.right > frame.right
          || bounds.top < frame.top || bounds.bottom > frame.bottom) throw Error('Clock time is clipped');
        return { text: time.textContent, dateTime: time.dateTime,
          desktopText: window.clockDesktop.querySelector('time').textContent,
          markup: tile.innerHTML, width: bounds.width, height: bounds.height,
          left: bounds.left - frame.left, top: bounds.top - frame.top,
          font: style.fontFamily, fontSize: style.fontSize, weight: style.fontWeight,
          color: style.color, spacing: style.letterSpacing, animation: style.animationName, transition: style.transitionDuration };
      })()`)
      assert.equal(view.text, '12:34')
      assert.equal(view.dateTime, '12:34')
      assert.equal(view.desktopText, '12:34')
      assert.equal(view.animation, 'none')
      assert.equal(view.transition, '0s')
      if (phase === 'default') baseline.push(view)
      else assert.deepEqual(view, baseline[index])
      index++
    }
    for (const minute of [35, 34]) {
      await js(`(async () => {
        window.clockFixedTime = new Date(2026, 0, 1, 12, ${minute}).getTime();
        const expected = '12:${minute}'; const deadline = performance.now() + 3000;
        while ([window.clockDesktop, window.clockTile].some(tile => {
          const time = tile.querySelector('time'); return time.textContent !== expected || time.dateTime !== expected;
        })) {
          if (performance.now() > deadline) throw Error('Shared Tick did not update both Clock containers');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      })()`)
    }
  }
  await js(`document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== window.clockSheet)`)
  assert.equal(await js('document.adoptedStyleSheets.includes(window.clockSheet)'), false)
  await js('window.odkRendererRuntime.stop()')
  assert.equal(await js('window.clockSubscriptions'), 0)
  win.webContents.debugger.detach()
  win.destroy()
  await host.stop()
  assert.equal(ipcMain._invokeHandlers.has('odk-renderer-development-plugins'), false)
  if (signed) assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
  const entryUrl = entries[0].entryUrl
  assets?.close()
  if (signed) assert.equal(assets.response({ url: entryUrl }).status, 410)
  clearTimeout(timeout)
  console.log(JSON.stringify({ actualPreload: true, mode: signed ? 'native' : 'development', documentLoads: loads,
    themes: 3, sizes: 3, comparisons: 18, sharedTickUpdates: 6, retainedDesktop: true, restored: true,
    discoveryReleased: true, assetLeaseReleased: signed }))
  app.quit()
}).catch(error => { void finish(1, error) })
