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
const specs = require('./helpers/calendar-surfaces')

const signed = process.env.ODK_CALENDAR_SURFACE_NATIVE === '1'
const profile = process.env.ODK_CALENDAR_SURFACE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
const assets = signed ? createNativeRendererAssets() : null
if (signed) require('../src/user-app-system').registerUserAppScheme(protocol)
let win, host, finishing
const timeout = setTimeout(() => { void finish(1, Error('Calendar surface acceptance timed out')) }, 50000)
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
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
  installGeometryFixtures(ipcMain)
  let entries = []
  ipcMain.removeHandler('odk-renderer-development-plugins')
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  host = createPluginHost({ capabilities: { 'system.renderer-development': {
    ipc: ipcMain, protocol, nativeAssets: assets, runtimeNativeAssets: signed,
    frames: () => [win.webContents], entries: () => entries,
  } } })
  host.register(createRendererDevelopmentPlugin())
  await host.start()
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const ActualDate = Date;
    window.calendarTime = new ActualDate(2026, 0, 1, 12, 34).getTime();
    window.Date = class extends ActualDate {
      constructor(...args) { super(...(args.length ? args : [window.calendarTime])); }
      static now() { return window.calendarTime; }
    };
  })()` })
  let loads = 0
  win.webContents.on('did-finish-load', () => { loads++ })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  win.setContentSize(1920, 1280)
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false,
  })
  win.webContents.setZoomFactor(1)
  const js = code => win.webContents.executeJavaScript(code)
  await js('window.odkShellReady')
  assert.equal(await js('new Date().getFullYear() * 10000 + new Date().getMonth() * 100 + new Date().getDate()'), 20260001)
  await js(`(() => {
    window.calendarDocument = document; window.calendarConsumers = []; window.calendarSubscriptions = 0;
    for (const spec of ${JSON.stringify(specs)}) {
      const actual = document.querySelector(spec.selector);
      if (!actual) throw Error('Time surface placement absent: ' + spec.id);
      const sample = document.createElement('div'); sample.id = 'calendar-' + spec.file;
      sample.className = spec.className; document.body.append(sample);
      const ui = { onTick(callback) {
        const cancel = window.odkServices.onTick(callback); window.calendarSubscriptions++;
        return () => { cancel(); window.calendarSubscriptions--; };
      } };
      if (!window.odkPlugins.activate(window.odkPlugins.get(spec.id), sample, ui)) throw Error('Time surface mount refused');
      window.calendarConsumers.push({ spec, actual, sample });
    }
    if (window.calendarSubscriptions !== 2) throw Error('Initial Tick subscriptions not observed');
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('[id^="calendar-"], [id^="calendar-"] * {transition:none!important;animation:none!important}');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; window.calendarSheet = sheet;
  })()`)
  const activeConsumers = `document === window.calendarDocument && window.calendarSubscriptions === 2
    && window.calendarConsumers.every(({spec, actual, sample}) => document.querySelector(spec.selector) === actual
      && document.getElementById('calendar-' + spec.file) === sample
      && window.odkPlugins.isActive(window.odkPlugins.get(spec.id), actual)
      && window.odkPlugins.isActive(window.odkPlugins.get(spec.id), sample))`
  const baseline = []
  for (const phase of ['default', 'independent', 'restored']) {
    if (phase === 'independent') {
      const config = readConfig(resolveConfigPath(process.env))
      entries = signed ? await loadNativeRendererPlugins(config, { env: process.env, assets })
        : loadDevelopmentPlugins(config, { host: 'electron-renderer' })
      assert.deepEqual(entries.map(entry => entry.manifest.id).sort(), specs.map(spec => spec.id).sort())
      await js(`(async () => {
        for (const {spec} of window.calendarConsumers) window.odkPlugins.get(spec.id).lifecycle.mount = () => { throw Error('Default time surface delegation refused'); };
        const definitions = await window.odkRendererDevelopment.load({ runtime: true });
        if (definitions.length !== 2) throw Error('Time surface entries absent');
        for (const definition of definitions) {
          await window.odkRendererRuntime.replace(definition);
          if (!(${activeConsumers})) throw Error('Replacement changed independent consumer ownership');
        }
      })()`)
    } else if (phase === 'restored') for (const spec of specs) {
      await js(`window.odkRendererRuntime.restoreDefault(${JSON.stringify(spec.id)})`)
      assert.equal(await js(activeConsumers), true)
    }
    for (const spec of specs) assert.equal(await js(`window.odkPlugins.get(${JSON.stringify(spec.id)}).manifest.version || '1.0.0'`), phase === 'independent' ? '2.0.0' : '1.0.0')
    assert.equal(await js(activeConsumers), true)
    let index = 0
    for (const theme of ['instrument', 'pixel', 'border-beam']) for (const size of [168, 292, 400]) {
      await js(`window.odkTheme.set(${JSON.stringify(theme)})`)
      const views = await js(`(async () => {
        for (const {spec,sample} of window.calendarConsumers) sample.style.cssText = spec.kind === 'status'
          ? 'position:fixed;display:flex;left:0;top:0;width:${size}px;height:44px;align-items:center'
          : 'position:fixed;left:0;top:0;width:${size}px;height:${size}px;--cell-dim:${size}px;--odk-widget-inset:clamp(16px,calc(var(--cell-dim)*0.08),28px)';
        await Promise.all([document.fonts.load('700 32px "Montserrat"'), document.fonts.load('400 16px "Noto Sans SC"'), document.fonts.load('400 16px "Zpix"')]);
        await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (innerWidth !== 1920 || innerHeight !== 1280 || devicePixelRatio !== 1 || visualViewport.scale !== 1
          || document.fonts.status !== 'loaded' || new Date().getFullYear() !== 2026 || new Date().getMonth() !== 0
          || new Date().getDate() !== 1 || document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) throw Error('Time surface measurement inputs changed');
        return window.calendarConsumers.map(({spec,actual,sample}) => {
          const frame = sample.getBoundingClientRect();
          const collect = (container, relative) => spec.readings.map(selector => {
            const node = container.querySelector(selector), box = node.getBoundingClientRect(), style = getComputedStyle(node);
            if (box.width <= 0 || box.height <= 0) throw Error('Time surface reading has no geometry');
            if (relative && (box.left < frame.left || box.right > frame.right + 0.1 || box.top < frame.top || box.bottom > frame.bottom + 0.1)) throw Error('Time surface reading is clipped');
            return { text: node.textContent, classes: node.className, width: box.width, height: box.height,
              left: relative ? box.left-frame.left : box.left, top: relative ? box.top-frame.top : box.top,
              meter: node.style.width, font: style.fontFamily, fontSize: style.fontSize, weight: style.fontWeight,
              color: style.color, spacing: style.letterSpacing, animation: style.animationName, transition: style.transitionDuration };
          });
          return { id:spec.id, markup:sample.innerHTML, sample:collect(sample,true), actual:collect(actual,false) };
        });
      })()`)
      for (const view of views) for (const reading of view.sample) {
        assert.equal(reading.animation, 'none')
        assert.equal(reading.transition, '0s')
      }
      if (phase === 'default') baseline.push(views)
      else assert.deepEqual(views, baseline[index])
      index++
    }
    for (const parts of [[2024, 1, 29, 12, 35], [2026, 11, 31, 23, 59], [2027, 0, 1, 0, 0], [2026, 0, 1, 12, 34]]) {
      const date = new Date(...parts)
      const ratio = (date - new Date(parts[0], 0, 1)) / (new Date(parts[0]+1, 0, 1) - new Date(parts[0], 0, 1))
      const expected = { almanac: [date.toLocaleString('en-US',{weekday:'short'}),String(parts[2]),date.toLocaleString('en-US',{month:'short'})],
        year: [`${Math.round(ratio*100)}%`, `${(ratio*100).toFixed(2)}%`], clock: [parts[3],parts[4]].map(value=>String(value).padStart(2,'0')).join(':') }
      await js(`(async () => {
        window.calendarTime = new Date(...${JSON.stringify(parts)}).getTime();
        const expected = ${JSON.stringify(expected)}, deadline = performance.now()+3000;
        const normalized = document.createElement('div'); normalized.style.width = expected.year[1]; expected.year[1] = normalized.style.width;
        const matches = container => container.spec.file === 'almanac'
          ? ['.al-weekday','.al-day','.al-month'].every((selector,index)=>container.node.querySelector(selector).textContent===expected.almanac[index])
          : container.spec.file === 'year' ? container.node.querySelector('.year-pct').textContent===expected.year[0]
            && container.node.querySelector('.meter-fill').style.width===expected.year[1]
          : container.node.querySelector('.sb-time').textContent===expected.clock;
        while (!window.calendarConsumers.every(({spec,actual,sample})=>matches({spec,node:actual})&&matches({spec,node:sample}))) {
          if (performance.now()>deadline) throw Error('Shared Tick did not update all time surface consumers: '+JSON.stringify({expected,
            actual:window.calendarConsumers.map(({spec,actual,sample})=>({id:spec.id,
              containers:[actual,sample].map(node=>spec.readings.map(selector=>({text:node.querySelector(selector).textContent,width:node.querySelector(selector).style.width})))}))}));
          await new Promise(resolve=>setTimeout(resolve,10));
        }
      })()`)
    }
  }
  await js('document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== window.calendarSheet)')
  assert.equal(await js('document.adoptedStyleSheets.includes(window.calendarSheet)'), false)
  await js('window.odkRendererRuntime.stop()')
  assert.equal(await js('window.calendarSubscriptions'), 0)
  win.webContents.debugger.detach(); win.destroy()
  await host.stop()
  assert.equal(ipcMain._invokeHandlers.has('odk-renderer-development-plugins'), false)
  if (signed) assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
  assets?.close()
  if (signed) for (const entry of entries) assert.equal(assets.response({url:entry.entryUrl}).status,410)
  clearTimeout(timeout)
  console.log(JSON.stringify({ actualPreload:true, mode:signed?'native':'development', identities:specs.map(spec=>spec.id), documentLoads:loads,
    themes:3, sizes:3, comparisons:36, sharedTickChanges:12, retainedConsumers:true, restored:true, discoveryReleased:true, assetLeaseReleased:signed }))
  app.quit()
}).catch(error => { void finish(1,error) })
