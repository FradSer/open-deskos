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
const specs = require('./helpers/desk-tool-surfaces')

const signed = process.env.ODK_DESK_TOOL_SURFACE_NATIVE === '1'
const profile = process.env.ODK_DESK_TOOL_SURFACE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
const assets = signed ? createNativeRendererAssets() : null
if (signed) require('../src/user-app-system').registerUserAppScheme(protocol)
let win, host, finishing
const timeout = setTimeout(() => { void finish(1, Error('Desk tool surface acceptance timed out')) }, 50000)
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
  finishing = (async () => {
    if (error && win && !win.isDestroyed()) {
      const observed = await win.webContents.executeJavaScript('window.toolDependencyViolations || []').catch(() => [])
      if (observed.includes('connection')) console.error('Static tool dependency observed: connection')
    }
    await release()
  })().then(() => app.exit(code), failure => { console.error(failure); app.exit(1) })
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
    const identities = ${JSON.stringify(specs.map(spec => spec.id))};
    window.toolDependencyViolations = [];
    window.guardToolMount = mount => function(element, context) {
      const guarded = new Proxy(context, { get(_target, key) {
        if (['focus', 'onTick', 'trackCleanup'].includes(key)) return context[key];
        if (window.toolDependencyViolations.length < 6) window.toolDependencyViolations.push(String(key));
        throw Error('Static tool dependency observed: ' + String(key));
      } });
      return mount.call(this, element, guarded);
    };
    let registry;
    Object.defineProperty(window, 'odkPlugins', { configurable:true, get() { return registry; }, set(value) {
      registry = value;
      const register = value.register;
      value.register = function(definition) {
        if (identities.includes(definition.id)) definition = {...definition, mount:window.guardToolMount(definition.mount)};
        return register.call(this,definition);
      };
    } });
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
  assert.deepEqual(await js('window.toolDependencyViolations'), [])
  await js(`(() => {
    window.toolDocument = document; window.toolConsumers = [];
    window.toolPeer = document.querySelector('[data-widget="odk.tile.year"]');
    if (!window.toolPeer) throw Error('Independent Year peer absent');
    for (const spec of ${JSON.stringify(specs)}) {
      const actual = document.querySelector('[data-widget="' + spec.id + '"]');
      if (!actual) throw Error('Desk tool placement absent: ' + spec.id);
      const sample = document.createElement('div'); sample.id = 'tool-' + spec.file;
      sample.className = actual.className; document.body.append(sample);
      const ui = { focus:window.odkServices.get('odk.service.focus'), onTick:window.odkServices.onTick };
      if (!window.odkPlugins.activate(window.odkPlugins.get(spec.id), sample, ui)) throw Error('Desk tool mount refused');
      window.toolConsumers.push({ spec, actual, sample, ui });
    }
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('[id^="tool-"], [id^="tool-"] * {transition:none!important;animation:none!important}');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; window.toolSheet = sheet;
  })()`)
  const activeConsumers = `document === window.toolDocument && document.querySelector('[data-widget="odk.tile.year"]') === window.toolPeer
    && window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.year'), window.toolPeer)
    && window.toolConsumers.every(({spec, actual, sample}) => document.querySelector('[data-widget="' + spec.id + '"]') === actual
      && document.getElementById('tool-' + spec.file) === sample
      && window.odkPlugins.isActive(window.odkPlugins.get(spec.id), actual)
      && window.odkPlugins.isActive(window.odkPlugins.get(spec.id), sample))`
  const baseline = []
  let lifecycleChanges = 0
  for (const phase of ['default', 'independent', 'restored']) {
    if (phase === 'independent') {
      const config = readConfig(resolveConfigPath(process.env))
      entries = signed ? await loadNativeRendererPlugins(config, { env: process.env, assets })
        : loadDevelopmentPlugins(config, { host: 'electron-renderer' })
      assert.deepEqual(entries.map(entry => entry.manifest.id).sort(), specs.map(spec => spec.id).sort())
      await js(`(async () => {
        for (const {spec} of window.toolConsumers) window.odkPlugins.get(spec.id).lifecycle.mount = () => { throw Error('Default desk tool delegation refused'); };
        const definitions = await window.odkRendererDevelopment.load({ runtime: true });
        if (definitions.length !== ${specs.length}) throw Error('Desk tool entries absent');
        for (const definition of definitions) {
          definition.mount = window.guardToolMount(definition.mount);
          await window.odkRendererRuntime.replace(definition);
          if (!(${activeConsumers})) throw Error('Replacement changed consumer ownership');
        }
      })()`)
    } else if (phase === 'restored') for (const spec of specs) {
      await js(`window.odkRendererRuntime.restoreDefault(${JSON.stringify(spec.id)})`)
      assert.equal(await js(activeConsumers), true)
    }
    const version = phase === 'independent' ? '2.0.0' : '1.0.0'
    for (const spec of specs) assert.equal(await js(`window.odkPlugins.get(${JSON.stringify(spec.id)}).manifest.version || '1.0.0'`), version)
    assert.equal(await js(activeConsumers), true)
    let index = 0
    for (const theme of ['instrument', 'pixel', 'border-beam']) for (const size of [186, 292, 400]) {
      await js(`window.odkTheme.set(${JSON.stringify(theme)})`)
      const views = await js(`(async () => {
        for (const {sample} of window.toolConsumers) sample.style.cssText = 'position:fixed;left:0;top:0;width:${size}px;height:${size}px;--cell-dim:${size}px;--odk-widget-inset:clamp(16px,calc(var(--cell-dim)*0.08),28px)';
        await Promise.all([document.fonts.load('700 32px "Montserrat"'), document.fonts.load('400 16px "Noto Sans SC"'), document.fonts.load('400 16px "Zpix"')]);
        await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (innerWidth !== 1920 || innerHeight !== 1280 || devicePixelRatio !== 1 || visualViewport.scale !== 1
          || document.fonts.status !== 'loaded' || document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) throw Error('Tool measurement inputs changed');
        const tree = node => ({ tag: node.tagName, attributes: [...node.attributes].map(attr=>[attr.name,attr.value]).sort(),
          text: [...node.childNodes].filter(child=>child.nodeType===3).map(child=>child.textContent.trim()).filter(Boolean).join(''),
          children: [...node.children].map(tree) });
        return window.toolConsumers.map(({spec,actual,sample}) => {
          const frame = sample.getBoundingClientRect();
          const collect = (container, relative) => {
            if (container.querySelector('button:not(.widget-launch),input,select,textarea,a[href],[tabindex],[contenteditable="true"]')) throw Error('Display-only tool gained controls');
            const readings = spec.readings.map((selector,index) => {
              const node = container.querySelector(selector), box = node.getBoundingClientRect(), style = getComputedStyle(node);
              if (node.textContent !== spec.text[index]) throw Error('Tool state changed: ' + spec.id);
              if (box.width <= 0 || box.height <= 0) throw Error('Tool reading has no geometry');
              if (relative && (box.left < frame.left || box.right > frame.right + 0.1 || box.top < frame.top || box.bottom > frame.bottom + 0.1)) throw Error('Tool reading is clipped');
              return { text: node.textContent, classes: node.className, width: box.width, height: box.height,
                left: relative ? box.left-frame.left : box.left, top: relative ? box.top-frame.top : box.top,
                font: style.fontFamily, fontSize: style.fontSize, weight: style.fontWeight, color: style.color,
                spacing: style.letterSpacing, animation: style.animationName, transition: style.transitionDuration };
            });
            return { tree: [...container.children].map(tree), readings };
          };
          return { id:spec.id, sample:collect(sample,true), actual:collect(actual,false) };
        });
      })()`)
      for (const view of views) for (const reading of view.sample.readings) {
        assert.equal(reading.animation, 'none')
        assert.equal(reading.transition, '0s')
      }
      if (phase === 'default') baseline.push(views)
      else assert.deepEqual(views, baseline[index])
      index++
    }
    for (const spec of specs) {
      const id = JSON.stringify(spec.id)
      await js(`window.odkRendererRuntime.setEnabled(${id}, false)`)
      lifecycleChanges++
      assert.equal(await js(`(() => {
        const target = window.toolConsumers.find(({spec})=>spec.id===${id});
        return !document.querySelector('[data-widget="' + target.spec.id + '"]')
          && !window.odkPlugins.isActive(window.odkPlugins.get(target.spec.id),target.sample)
          && window.toolConsumers.filter(record=>record!==target).every(({spec,actual,sample})=>
            document.querySelector('[data-widget="'+spec.id+'"]')===actual
            && window.odkPlugins.isActive(window.odkPlugins.get(spec.id),actual)
            && window.odkPlugins.isActive(window.odkPlugins.get(spec.id),sample));
      })()`),true)
      await js(`window.odkRendererRuntime.setEnabled(${id}, true)`)
      lifecycleChanges++
      await js(`(() => {
        const target = window.toolConsumers.find(({spec})=>spec.id===${id});
        target.actual = document.querySelector('[data-widget="' + target.spec.id + '"]');
        for (const node of [target.actual,target.sample]) for (let i=0;i<target.spec.readings.length;i++) {
          if (node.querySelector(target.spec.readings[i]).textContent!==target.spec.text[i]) throw Error('Enabled tool state changed');
        }
      })()`)
      assert.equal(await js(`window.odkPlugins.get(${id}).manifest.version || '1.0.0'`), version)
      assert.equal(await js(activeConsumers), true)
    }
  }
  assert.deepEqual(await js('window.toolDependencyViolations'), [])
  await js('document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== window.toolSheet)')
  assert.equal(await js('document.adoptedStyleSheets.includes(window.toolSheet)'), false)
  await js('window.odkRendererRuntime.stop()')
  assert.equal(await js('window.toolConsumers.every(({spec,actual,sample})=>!window.odkPlugins.isActive(window.odkPlugins.get(spec.id),actual)&&!window.odkPlugins.isActive(window.odkPlugins.get(spec.id),sample))'), true)
  win.webContents.debugger.detach(); win.destroy()
  await host.stop()
  assert.equal(ipcMain._invokeHandlers.has('odk-renderer-development-plugins'), false)
  if (signed) assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
  assets?.close()
  if (signed) for (const entry of entries) assert.equal(assets.response({url:entry.entryUrl}).status,410)
  clearTimeout(timeout)
  console.log(JSON.stringify({ actualPreload:true, mode:signed?'native':'development', identities:specs.map(spec=>spec.id), documentLoads:loads,
    themes:3, sizes:3, comparisons:specs.length * 18, lifecycleChanges, retainedConsumers:true, restored:true, discoveryReleased:true, assetLeaseReleased:signed }))
  app.quit()
}).catch(error => { void finish(1,error) })
