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
const { runtime: createManagerRuntime, CHANNELS } = require('./helpers/app-manager')

const signed = process.env.ODK_DASHBOARD_SURFACE_NATIVE === '1'
const profile = process.env.ODK_DASHBOARD_SURFACE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
const assets = signed ? createNativeRendererAssets() : null
if (signed) require('../src/user-app-system').registerUserAppScheme(protocol)
let win, host, manager, finishing
const timeout = setTimeout(() => { void finish(1, Error('Dashboard surface acceptance timed out')) }, 45000)
async function release() {
  try { if (win && !win.isDestroyed()) await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()') }
  finally {
    if (win && !win.isDestroyed() && win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
    win?.destroy()
    await host?.stop()
    await manager?.host.stop()
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
  for (const channel of CHANNELS) ipcMain.removeHandler(channel)
  manager = await createManagerRuntime({ after() {} }, [], { ipc: ipcMain })
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
  // Freeze Date before initial subscriptions; retain ordinary Date construction with explicit arguments.
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const ActualDate = Date;
    window.dashboardFixedTime = new ActualDate(2026, 0, 1, 12, 34).getTime();
    window.Date = class extends ActualDate {
      constructor(...args) { super(...(args.length ? args : [window.dashboardFixedTime])); }
      static now() { return window.dashboardFixedTime; }
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
  const js = async code => {
    const result = await win.webContents.executeJavaScript(`(async () => {
      try { return { ok: true, value: await (${code}) }; }
      catch (error) { return { ok: false, message: String(error?.message || error).slice(0,512) }; }
    })()`)
    if (!result.ok) throw Error(result.message)
    return result.value
  }
  await js('window.odkShellReady')
  assert.equal(await js('new Date().getHours() * 100 + new Date().getMinutes()'), 1234)
  await js(`(() => {
    window.dashboardDocument = document;
    window.dashboardPage = document.querySelector('[data-plugin="odk.page.dashboard"]');
    window.dashboardPeer = document.querySelector('[data-widget="odk.tile.year"]');
    if (!dashboardPage || !dashboardPeer) throw Error('Dashboard placement absent');
    const element = document.createElement('section'); element.id = 'dashboard-acceptance';
    element.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:640px';
    document.body.append(element); window.dashboardElement = element;
    window.dashboardSubscriptions = 0;
    window.dashboardCallbacks = []; window.dashboardTicks = [];
    const ui = { homeBriefing: {
      snapshot: () => window.odkServices.homeBriefing.snapshot(),
      subscribe(callback) {
        dashboardCallbacks.push(callback);
        const cancel = window.odkServices.homeBriefing.subscribe(callback); dashboardSubscriptions++;
        return () => { cancel(); dashboardSubscriptions--; };
      },
    }, onTick(callback) { dashboardTicks.push(callback); return window.odkServices.onTick(callback); } };
    if (!window.odkPlugins.activate(window.odkPlugins.get('odk.page.dashboard'), element, ui)) throw Error('Dashboard mount refused');
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('#dashboard-acceptance, #dashboard-acceptance * {transition:none!important;animation:none!important}');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; window.dashboardSheet = sheet;
  })()`)
  const source = { id: 'desk', label: 'Desk readings', state: 'live', updatedAt: 1767270840000 }
  const item = segments => ({ text: segments.map(segment => segment.text).join(''), segments, sources: [source] })
  const facts = [item([{ text: 'Weather 25°C. ', icon: 'weather' }, { text: '3 active sessions. ', icon: 'sessions' },
    { text: '+1.23% Futu holdings.', icon: 'portfolio' }])]
  const frame = (state, items = [], omittedSources = 0) => ({ state, items, generatedAt: 1767270840000, omittedSources })
  const frames = [frame('empty'), frame('unavailable'), frame('error'), frame('live', facts), frame('loading', facts),
    frame('stale', facts), frame('live', [item([{ text: '-100.00% Futu holdings.', icon: 'portfolio' }])]),
    frame('live', [item([{ text: '0.00% Futu holdings.', icon: 'portfolio' }])]),
    frame('live', [{ text: '<img src=x onerror=alert(1)> 中文 remains literal.', sources: [source] }]), frame('empty', [], 2)]
  const baseline = []
  await js('window.dashboardFormerNodes = []')
  await js(`(async () => {
    if (!await window.odkAppPlatform.openApp({ appId: 'year' })) throw Error('Clock App did not open');
    window.dashboardForeground = document.querySelector('#app-runtime').firstElementChild;
    window.dashboardPageContext = document.querySelector('#page-context').textContent;
  })()`)
  for (const phase of ['default', 'independent', 'restored']) {
    if (phase !== 'default') await js(`(() => {
      for (const placement of [dashboardElement, dashboardPage]) {
        for (const node of placement.querySelectorAll('#dash-wd,#dash-md,#dash-y,#dash-narrative')) {
          dashboardFormerNodes.push({ node, text: node.textContent });
        }
      }
    })()`)
    if (phase === 'independent') {
      const config = readConfig(resolveConfigPath(process.env))
      entries = signed ? await loadNativeRendererPlugins(config, { env: process.env, assets })
        : loadDevelopmentPlugins(config, { host: 'electron-renderer' })
      assert.equal(entries.length, 1)
      await js(`(async () => {
        window.odkPlugins.get('odk.page.dashboard').lifecycle.mount = () => { throw Error('Default Dashboard delegation refused'); };
        const definitions = await window.odkRendererDevelopment.load({ runtime: true });
        if (definitions.length !== 1) throw Error('Dashboard entry absent');
        await window.odkRendererRuntime.replace(definitions[0]);
      })()`)
    } else if (phase === 'restored') await js("window.odkRendererRuntime.restoreDefault('odk.page.dashboard')")
    assert.equal(await js("window.odkPlugins.get('odk.page.dashboard').manifest.version || '1.0.0'"), phase === 'independent' ? '2.0.0' : '1.0.0')
    assert.equal(await js(`document === dashboardDocument && dashboardSubscriptions === 1
      && document.querySelector('[data-plugin="odk.page.dashboard"]') === dashboardPage
      && document.querySelector('[data-widget="odk.tile.year"]') === dashboardPeer
      && document.querySelector('#app-runtime').firstElementChild === dashboardForeground
      && window.odkAppPlatform.active()?.appId === 'year'
      && document.querySelector('#page-context').textContent === dashboardPageContext
      && window.odkPlugins.isActive(window.odkPlugins.get('odk.page.dashboard'), dashboardPage)`), true)
    await js(`(() => {
      const before = dashboardElement.innerHTML;
      for (const callback of dashboardCallbacks.slice(0,-1)) callback({ state:'error', items:[], generatedAt:0, omittedSources:0 });
      for (const callback of dashboardTicks.slice(0,-1)) callback(new Date(2099,0,1));
      if (dashboardElement.innerHTML !== before) throw Error('Released implementation changed the active placement');
      if (dashboardFormerNodes.some(entry => entry.node.textContent !== entry.text)) throw Error('Released implementation changed former nodes');
    })()`)
    let index = 0
    for (const theme of ['instrument', 'pixel', 'border-beam']) for (const current of frames) {
      await js(`window.odkTheme.set(${JSON.stringify(theme)})`)
      win.webContents.send('odk-personal-agent-status', { state: 'idle', message: '', briefing: current })
      const view = await js(`(async () => {
        const expected = ${JSON.stringify(current)};
        const deadline = performance.now() + 3000;
        while (JSON.stringify(window.odkServices.homeBriefing.snapshot()) !== JSON.stringify(expected)) {
          if (performance.now() > deadline) throw Error('Controlled briefing did not reach the public service');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        await Promise.all([document.fonts.load('700 32px "Montserrat"'), document.fonts.load('400 16px "Noto Sans SC"'), document.fonts.load('400 16px "Zpix"')]);
        await document.fonts.ready;
        const element = dashboardElement;
        const narrative = element.querySelector('#dash-narrative');
        if (narrative.querySelector('img,script')) throw Error('Briefing text became executable markup');
        if (expected.items.length && [...narrative.querySelectorAll('[data-briefing]')].map(node => node.textContent).join(' ') !== expected.items.map(item => item.text).join(' ')) throw Error('Briefing literal text changed');
        for (const change of element.querySelectorAll('.dash-change')) {
          const value = parseFloat(change.textContent);
          const direction = expected.state === 'live' && value && /^[+-]/.test(change.textContent) ? (value > 0 ? 'up' : 'down') : undefined;
          if (change.dataset.direction !== direction) throw Error('Portfolio state changed');
        }
        if (element.querySelector('.dash-foot, details, summary, #dash-agent-status, #dash-source-list')) throw Error('Removed metadata controls returned');
        if (innerWidth !== 1920 || innerHeight !== 1280 || devicePixelRatio !== 1 || document.fonts.status !== 'loaded') throw Error('Measurement inputs changed');
        const box = element.getBoundingClientRect();
        const semantic = placement => [...placement.querySelectorAll('.dash, .dash *')].map(node => ({
          tag: node.tagName, className: node.getAttribute('class') || '',
          text: !node.children.length || node.id === 'dash-narrative' ? node.textContent : null,
          data: { ...node.dataset }, hidden: node.hidden, role: node.getAttribute('role'),
          aria: node.getAttribute('aria-live'), paths: node.tagName.toLowerCase() === 'svg' ? node.innerHTML : null,
        }));
        if (JSON.stringify(semantic(dashboardPage)) !== JSON.stringify(semantic(element))) throw Error('Dashboard actual placement differs from controlled placement');
        return [...element.querySelectorAll('.dash, .dash *')].map(node => {
          const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
          return { tag: node.tagName, className: node.getAttribute('class') || '',
            text: !node.children.length || node.id === 'dash-narrative' ? node.textContent : null,
            data: { ...node.dataset }, hidden: node.hidden, role: node.getAttribute('role'),
            aria: node.getAttribute('aria-live'), paths: node.tagName.toLowerCase() === 'svg' ? node.innerHTML : null,
            bounds: [rect.x-box.x, rect.y-box.y, rect.width, rect.height].map(value => Math.round(value*1000)/1000),
            font: style.fontFamily, size: style.fontSize, color: style.color, display: style.display };
        });
      })()`)
      if (phase === 'default') baseline.push(view)
      else assert.deepEqual(view, baseline[index], `${phase} ${theme} ${index} parity`)
      index++
    }
    const back = await js(`(() => {
      const rect = document.querySelector('#app-back').getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw Error('Back target absent');
      return { x: Math.round(rect.x + rect.width/2), y: Math.round(rect.y + rect.height/2) };
    })()`)
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...back })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...back })
    await js(`(async () => {
      const deadline = performance.now()+3000;
      while (window.odkAppPlatform.active()) {
        if (performance.now()>deadline) throw Error('Back did not close Clock');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (document.querySelector('#page-context').textContent !== dashboardPageContext) throw Error('Back changed selected page');
    })()`)
    await js(`(async () => {
      const deadline = performance.now()+3000;
      if (dashboardPage.querySelector('details, summary, .dash-foot')) throw Error('Removed source controls returned');
      dashboardFixedTime = new Date(2027, 1, 2, 12, 34).getTime();
      while ([dashboardElement,dashboardPage].some(element => element.querySelector('#dash-y').textContent !== '2027')) {
        if (performance.now()>deadline) throw Error('Shared Tick did not update Dashboard');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if ([dashboardElement,dashboardPage].some(element => element.querySelector('#dash-md').textContent !== 'February 2')) throw Error('Dashboard date format changed');
      dashboardFixedTime = new Date(2026, 0, 1, 12, 34).getTime();
      while ([dashboardElement,dashboardPage].some(element => element.querySelector('#dash-y').textContent !== '2026')) {
        if (performance.now()>deadline) throw Error('Backward Tick did not update Dashboard');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (!await window.odkAppPlatform.openApp({ appId: 'year' })) throw Error('Clock App did not reopen');
      dashboardForeground = document.querySelector('#app-runtime').firstElementChild;
    })()`)
  }
  await js('window.odkAppPlatform.closeApp()')
  await js('document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== dashboardSheet)')
  assert.equal(await js('document.adoptedStyleSheets.includes(dashboardSheet)'), false)
  await js('window.odkRendererRuntime.stop()')
  assert.equal(await js('dashboardSubscriptions'), 0)
  win.webContents.debugger.detach()
  win.destroy()
  await host.stop()
  await manager.host.stop()
  assert.equal(manager.handlers.size, 0)
  assert.equal(ipcMain._invokeHandlers.has('odk-renderer-development-plugins'), false)
  if (signed) assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
  const entryUrl = entries[0].entryUrl
  assets?.close()
  if (signed) assert.equal(assets.response({ url: entryUrl }).status, 410)
  clearTimeout(timeout)
  console.log(JSON.stringify({ actualPreload: true, mode: signed ? 'native' : 'development', documentLoads: loads,
    themes: 3, frames: 10, comparisons: 60, retainedPage: true, retainedForeground: true,
    pointerBack: 3, noSourceControls: 3, dateTransitions: 6, restored: true,
    discoveryReleased: true, assetLeaseReleased: signed }))
  app.quit()
}).catch(error => { void finish(1, error) })
