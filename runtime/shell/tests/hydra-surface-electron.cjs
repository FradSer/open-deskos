'use strict'

require('node:child_process').execFile = () => { throw Error('Fixture subprocesses belong to parent') }
const { app, BrowserWindow, ipcMain, session, protocol } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { createPluginHost } = require('../src/plugin-host')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const profile = process.env.ODK_HYDRA_SURFACE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
const runtimeSurface = process.env.ODK_HYDRA_SURFACE_RUNTIME === '1'
const signedSurface = process.env.ODK_HYDRA_SURFACE_NATIVE === '1'
const surfaceRevision = process.env.ODK_HYDRA_SURFACE_REVISION
assert.ok(!surfaceRevision || ['1.0.0', '2.0.0', '3.0.0'].includes(surfaceRevision))
const consumerFile = process.env.ODK_HYDRA_SURFACE_CONSUMERS
if (consumerFile) {
  assert.ok(surfaceRevision && path.isAbsolute(consumerFile))
  assert.equal(path.dirname(consumerFile), profile)
}
const { createNativeRendererAssets, NATIVE_PLUGIN_SCHEME } = require('../src/native-renderer-assets')
const { capture, hydraSurfaceTimeouts } = require('./helpers/hydra-surface-selection')
const { serializeComputedStyle } = require('./helpers/hydra-style-snapshot')
const assets = signedSurface ? createNativeRendererAssets() : null
if (signedSurface) require('../src/user-app-system').registerUserAppScheme(protocol)
let win, host, finishing
app.on('window-all-closed', () => {})
// CM5 needs more time to compare every computed property across all phases.
const fixtureTimeout = hydraSurfaceTimeouts(runtimeSurface).fixture
const timer = setTimeout(() => { void finish(1, Error('HYDRA_SURFACE_TIMEOUT')) }, fixtureTimeout)
async function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(timer)
  if (error) console.error(error)
  finishing = (async () => {
    if (win && !win.isDestroyed()) {
      try { await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()') }
      finally { win.destroy() }
    }
    await host?.stop()
    assets?.close()
  })().then(() => app.exit(code), failure => { console.error(failure); app.exit(1) })
  return finishing
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
  installGeometryFixtures(ipcMain)
  ipcMain.removeHandler('odk-hydra-status')
  let snapshot
  let failed = false
  ipcMain.handle('odk-hydra-status', () => {
    if (failed) throw Error('Controlled Hydra IPC failure')
    return snapshot
  })
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  assert.equal(win.webContents.isOffscreen(), true)
  assert.equal(win.webContents.isPainting(), true)
  let documentLoads = 0
  win.webContents.on('did-finish-load', () => { documentLoads++ })
  let entries = []
  let capturedEntries = []
  ipcMain.removeHandler('odk-renderer-development-plugins')
  host = createPluginHost({ capabilities: { 'system.renderer-development': {
    ipc: ipcMain, protocol, nativeAssets: assets, runtimeNativeAssets: runtimeSurface, frames: () => [win.webContents], entries: () => entries,
  } } })
  host.register(createRendererDevelopmentPlugin())
  await host.start()
  const live = { configured: true, connected: true, mainOnline: true,
    env: { stale: false, tempC: -10.2, humidity: 79.8, pressureHpa: 1013.6, lux: 1234 },
    nodes: [{ id: 2, online: true, soilPercent: 44, pump: true }, { id: 1, online: true, soilPercent: 62 }] }
  const states = [live, { ...live, env: { ...live.env, stale: true } },
    { ...live, mainOnline: false, nodes: [{ id: 1, online: false, soilPercent: 80, pump: true }] },
    { ...live, connected: false }, { configured: false }, { ...live, env: null, nodes: [] },
    { ...live, env: { ...live.env, lux: 0.25 }, nodes: [{ id: 1, stale: true, pump: true, soilPercent: 49 }] }, live]
  const cells = [[619, 196], [1103, 730], [480, 340], [348, 724], [186, 400], [168, 336], [120, 240], [292, 292],
    [168, 168], [128, 128], [116, 120], [110, 260], [94, 94]]
  const themes = ['instrument', 'pixel', 'border-beam']
  const baseline = []
  let lastConsumers, executedVersion, entryCount
  const phases = runtimeSurface ? ['default', 'independent', 'restored'] : ['default', 'independent']
  for (const [phaseIndex, phase] of phases.entries()) {
    const independent = phase === 'independent'
    const compare = phaseIndex > 0
    if (independent && signedSurface) {
      if (!runtimeSurface) await host.stop()
      entries = await capture(process.env, process.env.ODK_NATIVE_KEYRING, assets, { productionPolicy: true, mutate: !surfaceRevision })
      capturedEntries = entries
      if (!runtimeSurface) await host.start()
      assert.equal(protocol.isProtocolHandled(NATIVE_PLUGIN_SCHEME), surfaceRevision !== '1.0.0')
    } else entries = independent ? loadDevelopmentPlugins(readConfig(resolveConfigPath(process.env)), { host: 'electron-renderer' }) : []
    assert.equal(entries.length, independent && surfaceRevision !== '1.0.0' ? 1 : 0)
    if (independent) entryCount = entries.length
    snapshot = live
    if (!runtimeSurface || phaseIndex === 0) {
      await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
      win.webContents.setZoomFactor(1)
      await win.webContents.executeJavaScript('window.odkShellReady')
      if (runtimeSurface) await win.webContents.executeJavaScript(`(() => {
        const def = window.odkPlugins.get('odk.tile.hydra');
        const mount = def.lifecycle.mount;
        window.odkHydraDefaultMounts = 0;
        def.lifecycle.mount = function (...args) { window.odkHydraDefaultMounts++; return mount.apply(this, args); };
        window.odkHydraRuntimeDefault = { ...def, manifest: { ...def.manifest }, lifecycle: { ...def.lifecycle } };
        window.odkHydraRuntimeDesktop = document.querySelector('[data-widget="odk.tile.hydra"]');
        if (!window.odkHydraRuntimeDesktop) throw Error('Hydra desktop placement absent');
        window.odkHydraRuntimeDocument = document;
      })()`)
    } else if (independent) {
      if (signedSurface) {
        const route = await win.webContents.executeJavaScript(`fetch(${JSON.stringify(entries[0].entryUrl)}).then(response => response.status).catch(error => String(error))`)
        assert.equal(route, 200, 'Runtime captured native route must be available')
      }
      await win.webContents.executeJavaScript(`(async () => {
        window.odkHydraMountsBeforeReplacement = window.odkHydraDefaultMounts;
        const replacements = await window.odkRendererDevelopment.load({ runtime: true });
        if (replacements.length !== 1) throw Error('Runtime Hydra entry absent');
        await window.odkRendererRuntime.replace(replacements[0]);
      })()`)
    } else {
      await win.webContents.executeJavaScript('window.odkRendererRuntime.replace(window.odkHydraRuntimeDefault)')
    }
    if (runtimeSurface) {
      assert.equal(documentLoads, 1)
      assert.equal(await win.webContents.executeJavaScript(`document === window.odkHydraRuntimeDocument
        && document.querySelector('[data-widget="odk.tile.hydra"]') === window.odkHydraRuntimeDesktop
        && window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.hydra'), window.odkHydraRuntimeDesktop)`), true)
    }
    assert.equal(await win.webContents.executeJavaScript("window.odkPlugins.catalog().find(record => record.manifest.id === 'odk.tile.hydra').manifest.version"), independent ? surfaceRevision || '2.0.0' : '1.0.0')
    if (independent && signedSurface) {
      executedVersion = await win.webContents.executeJavaScript('window.odkHydraSurfaceRevision || null')
      assert.equal(executedVersion, surfaceRevision === '1.0.0' ? null : surfaceRevision || '2.0.0')
    }
    const result = []
    for (const theme of themes) for (const cell of cells) {
      await win.webContents.executeJavaScript(`window.odkTheme.set(${JSON.stringify(theme)})`)
      await win.webContents.executeJavaScript(`(async () => {
        await document.fonts.ready;
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('#hydra-acceptance *, #hydra-acceptance { transition:none!important; animation:none!important }');
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        window.odkHydraAcceptanceSheet = sheet;
        const tile = document.createElement('div'); tile.id = 'hydra-acceptance';
        tile.className = 'widget widget-display-only w-hydra';
        tile.style.cssText = 'position:fixed;left:0;top:0;width:${cell[0]}px;height:${cell[1]}px;--cell-dim:${Math.min(...cell)}px;--odk-widget-inset:clamp(16px,calc(var(--cell-dim)*0.08),28px)';
        document.body.append(tile);
      })()`)
      for (const [index, state] of states.entries()) {
        snapshot = state
        assert.deepEqual(await win.webContents.executeJavaScript('window.odkPlatform.getHydraStatus()'), state)
        if (index > 0) await win.webContents.executeJavaScript("window.odkPlugins.deactivate(window.odkPlugins.get('odk.tile.hydra'), document.getElementById('hydra-acceptance'))")
        const view = await win.webContents.executeJavaScript(`(async () => {
          const serializeComputedStyle = ${serializeComputedStyle.toString()};
          if (devicePixelRatio !== 1 || visualViewport.scale !== 1) {
            throw Error('Hydra comparison rendering scale changed: ' + JSON.stringify({ devicePixelRatio, zoom: visualViewport.scale }));
          }
          const tile = document.getElementById('hydra-acceptance');
          let tick;
          if (!window.odkPlugins.activate(window.odkPlugins.get('odk.tile.hydra'), tile, { onTick(callback) { tick = callback; return () => { tick = null } } })) throw Error('Hydra mount refused');
          const expected = ${JSON.stringify(!state.configured ? 'Unconfigured' : !state.connected ? 'Waiting' : state.mainOnline === false ? 'Offline' : state.env?.stale !== false ? 'Stale env' : 'Live')};
          const deadline = performance.now() + 3000;
          while (tile.querySelector('#hydra-badge')?.textContent !== expected) {
            if (performance.now() > deadline) throw Error('Hydra reading did not render');
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          await document.fonts.ready;
          for (const meter of tile.querySelectorAll('.hydra-meter-fill')) {
            const style = getComputedStyle(meter);
            if (style.transitionDuration !== '0s' || style.animationName !== 'none') throw Error('Hydra static measurement motion suppression did not apply');
          }
          const box = tile.getBoundingClientRect();
          const nodes = [tile, ...tile.querySelectorAll('*')].map(node => {
            const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
            return { attributes: [...node.attributes].map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => a.localeCompare(b)),
              computed: serializeComputedStyle(css),
              className: node.getAttribute('class'), text: node.children.length ? null : node.textContent,
              hidden: node.hidden, shape: node.dataset.shape || null, title: node.title,
              font: css.fontFamily, fontSize: css.fontSize, color: css.color, opacity: css.opacity,
              display: css.display, transform: css.transform,
              bounds: [rect.x-box.x, rect.y-box.y, rect.width, rect.height].map(value => Math.round(value*100)/100) };
          });
          const escaping = nodes.filter(node => node.bounds[2] > 0 && node.bounds[3] > 0
            && (node.bounds[0] < -1 || node.bounds[1] < -1 || node.bounds[0]+node.bounds[2] > box.width+1 || node.bounds[1]+node.bounds[3] > box.height+1));
          const belowFloor = [...tile.querySelectorAll('*')].filter(node => {
            const rect = node.getBoundingClientRect();
            if (node.children.length || !node.textContent.trim() || rect.width <= 0 || rect.height <= 0) return false;
            const floor = node.matches('.hydra-env-value,.hydra-plant-soil') ? 14 : 12;
            return Number.parseFloat(getComputedStyle(node).fontSize) < floor;
          }).map(node => node.className);
          const controls = tile.querySelectorAll('button:not(.widget-launch),input,select,textarea,a').length;
          return { nodes, escaping, belowFloor, controls, shape:tile.querySelector('.hydra-body').dataset.shape };
        })()`)
        assert.equal(view.controls, 0)
        assert.deepEqual(view.belowFloor, [])
        assert.deepEqual(view.escaping, [], JSON.stringify({ independent, theme, cell, index, shape: view.shape }))
        if (compare) assert.deepEqual(view, baseline[result.length], JSON.stringify({ phase, theme, cell, index }))
        result.push(view)
      }
      await win.webContents.executeJavaScript(`(async () => {
        const tile = document.getElementById('hydra-acceptance');
        await window.odkPlugins.deactivate(window.odkPlugins.get('odk.tile.hydra'), tile);
        tile.remove();
        const sheet = window.odkHydraAcceptanceSheet;
        document.adoptedStyleSheets = document.adoptedStyleSheets.filter(current => current !== sheet);
        if (document.adoptedStyleSheets.includes(sheet)) throw Error('Hydra measurement stylesheet retained');
        window.odkHydraAcceptanceSheet = null;
      })()`)
    }
    if (phaseIndex === 0) baseline.push(...result)
    else lastConsumers = result
    assert.equal(result.length, themes.length * cells.length * states.length)
    failed = true
    await assert.rejects(win.webContents.executeJavaScript('window.odkPlatform.getHydraStatus()'), /Controlled Hydra IPC failure/)
    failed = false
    if (runtimeSurface && independent) {
      assert.equal(await win.webContents.executeJavaScript('window.odkHydraDefaultMounts === window.odkHydraMountsBeforeReplacement'), true)
    }
    if (runtimeSurface && phase === 'restored') {
      assert.equal(await win.webContents.executeJavaScript('window.odkHydraDefaultMounts > window.odkHydraMountsBeforeReplacement'), true)
    }
    if (!runtimeSurface || phaseIndex === phases.length - 1) await win.webContents.executeJavaScript('window.odkRendererRuntime.stop()')
  }
  await host.stop()
  if (signedSurface) {
    assert.equal(protocol.isProtocolHandled(NATIVE_PLUGIN_SCHEME), false)
    assets.close()
    if (capturedEntries.length) assert.equal(assets.response({ url: capturedEntries[0].entryUrl }).status, 410)
  }
  await assert.rejects(win.webContents.executeJavaScript('window.odkRendererPluginBridge.list()'), /No handler registered/)
  ipcMain.removeHandler('odk-hydra-status')
  const report = { ok: true, pid: process.pid, actualPreload: true, developmentLoaded: !signedSurface,
    ...(signedSurface ? { signedSurface: surfaceRevision !== '1.0.0', capturedSurfaceIntegrity: !surfaceRevision, assetLeaseReleased: true } : {}),
    ...(surfaceRevision ? { surfaceProcessRestart: true, surfaceVersion: surfaceRevision, executedVersion, entryCount } : {}),
    independentSurface: surfaceRevision !== '1.0.0', themes: themes.length, cells: cells.length, states: states.length, comparisons: themes.length * cells.length * states.length * (runtimeSurface ? 2 : 1), discoveryReleased: true,
    ...(runtimeSurface ? { runtimeSurface: true, documentLoads, restoredDefault: true, retainedDesktop: true, defaultDelegationRefused: true } : {}) }
  if (consumerFile) fs.writeFileSync(consumerFile, JSON.stringify(lastConsumers))
  await new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(report)}\n`, error => error ? reject(error) : resolve()))
  await finish(0)
}).catch(error => { void finish(1, error) })
