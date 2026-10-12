'use strict'
const { app, BrowserWindow, ipcMain, session, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const { builtinViewTimeouts } = require('./helpers/builtin-view-selection')
const { createPluginHost } = require('../src/plugin-host')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const development = process.env.ODK_BUILTIN_VIEWS_MODE === 'development'
const native = process.env.ODK_BUILTIN_VIEWS_MODE === 'native'
const external = development || native
const { loadNativeRendererPlugins } = require('../src/native-plugin-loader')
const { createNativeRendererAssets, NATIVE_PLUGIN_SCHEME } = require('../src/native-renderer-assets')
const assets = native ? createNativeRendererAssets() : null
if (native) require('../src/user-app-system').registerUserAppScheme(protocol)
const { runtime, CHANNELS } = require('./helpers/app-manager')
const profile = process.env.ODK_BUILTIN_VIEWS_PROFILE
const traceStarted = Date.now()
const checkpoint = phase => {
  if (process.env.ODK_BUILTIN_VIEWS_TRACE === '1') console.error(`Built-in views ${Date.now() - traceStarted}ms ${phase}`)
}
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile); app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
let win, manager, discoveryHost, rendererReady = false, entries = [], finishing, catalogFailure = false, catalogEmpty = false, loads = 0, catalogGate, pointerBack = 0, lateReplies = 0, gatedReads = 0, keySequence = 0, keyboardLoops = 0, keyboardSearches = 0, keyboardReloads = 0, keyboardBack = 0
const timeout = setTimeout(() => { void finish(1, Error('Built-in view acceptance timed out')) }, builtinViewTimeouts(process.env.ODK_BUILTIN_VIEWS_MODE).fixture)
function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(timeout); if (error) console.error(error)
  finishing = (async () => {
    try { if (rendererReady && win && !win.isDestroyed()) await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()') }
    finally { win?.destroy(); try { await manager?.host.stop() } finally { try { await discoveryHost?.stop() } finally { assets?.close() } } }
  })().then(() => code ? app.exit(code) : app.quit(), error => { console.error(error); app.exit(1) })
  return finishing
}
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_win, _permission, done) => done(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => done({ cancel: true }))
  installGeometryFixtures(ipcMain)
  for (const channel of CHANNELS) ipcMain.removeHandler(channel)
  manager = await runtime({ after() {} }, [], { ipc: ipcMain })
  const list = manager.handlers.get(CHANNELS[0]); ipcMain.removeHandler(CHANNELS[0])
  ipcMain.handle(CHANNELS[0], event => { if (catalogGate) { gatedReads++; return catalogGate } if (catalogFailure) throw Error('Controlled catalog failure'); return catalogEmpty ? [] : list(event) })
  win = new BrowserWindow({ show: false, width: 1920, height: 1280, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true,
  } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  ipcMain.removeHandler('odk-renderer-development-plugins')
  discoveryHost = createPluginHost({ capabilities: { 'system.renderer-development': {
    ipc: ipcMain, frames: () => [win.webContents], entries: () => entries,
    ...(native ? { protocol, nativeAssets: assets, runtimeNativeAssets: true } : {}),
  } } })
  discoveryHost.register(createRendererDevelopmentPlugin())
  await discoveryHost.start()
  await win.loadURL('about:blank'); win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  // Observe keyboard focus without showing a window or taking desktop focus.
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  let replacements = fs.readFileSync(path.join(__dirname, 'fixtures/builtin-view-replacements.js'), 'utf8')
  if (process.env.ODK_BUILTIN_VIEWS_INVALID) replacements = replacements.replace("text(value, reading); value.dateTime = reading", "text(value, 'wrong'); value.dateTime = reading")
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: (external ? '' : replacements) + `;
    window.viewExternalEntries=[];
    (()=>{const OriginalDate=Date;window.viewTime=new OriginalDate(2026,0,1,12,34).getTime();
      window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[viewTime]))}static now(){return viewTime}};
      window.viewTicks=new Set();window.viewTickIntervals=new Set();let acquiringTick=false;
      const startInterval=window.setInterval.bind(window),stopInterval=window.clearInterval.bind(window);
      window.setInterval=(callback,delay,...args)=>{const id=startInterval(callback,delay,...args);
        if(acquiringTick&&delay===1000)viewTickIntervals.add(id);return id};
      window.clearInterval=id=>{viewTickIntervals.delete(id);return stopInterval(id)};
      let services;Object.defineProperty(window,'odkServices',{configurable:true,get(){return services},set(value){
        services=value;const subscribe=value.onTick;value.onTick=callback=>{
          const previous=acquiringTick;acquiringTick=true;let cancel;
          try{cancel=subscribe(callback)}finally{acquiringTick=previous}viewTicks.add(callback);
          return ()=>{viewTicks.delete(callback);cancel()}};
      }});
    })();` })
  win.webContents.on('did-finish-load', () => { loads++ })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  win.setContentSize(1920, 1280)
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false,
  })
  win.webContents.setZoomFactor(1)
  const js = async source => {
    const result = await win.webContents.executeJavaScript(`(async()=>{try{return {ok:true,value:await (${source})}}catch(error){return {ok:false,message:String(error?.message||error).slice(0,512)}}})()`)
    if (!result.ok) throw Error(result.message)
    return result.value
  }
  const wait = condition => js(`(async()=>{const deadline=performance.now()+2000;while(!(${condition})){if(performance.now()>deadline)throw Error('View state did not settle');await new Promise(resolve=>setTimeout(resolve,10))}})()`)
  await js('window.odkShellReady'); rendererReady = true
  checkpoint('Shell ready')
  assert.equal(await js('document.hasFocus()'), true, 'Hidden-window focus emulation was not applied')
  if (process.env.ODK_BUILTIN_VIEWS_FOCUS_INVALID) await win.webContents.insertCSS('#app-back:focus-visible{outline:none!important;box-shadow:none!important}')
  assert.equal(await js('viewTicks.size>0'), true, 'Tick observations missed initial acquisition')
  assert.equal(await js('viewTickIntervals.size'), 1, 'Shared Tick interval acquisition was not observed')
  await js(`(()=>{window.viewDocument=document;window.viewPeer=document.querySelector('[data-widget="odk.tile.clock"]');
    window.viewPageContext=document.querySelector('#page-context').textContent;
    window.viewStateSubscriptions=0;const subscribe=odkAppPlatform.subscribeAppState;
    odkAppPlatform.subscribeAppState=callback=>{const cancel=subscribe(callback);viewStateSubscriptions++;return()=>{cancel();viewStateSubscriptions--}};
  })()`)
  const ids = ['calendar', 'clock', 'pomodoro', 'year', 'app-manager'], baseline = new Map()
  const tick = parts => js(`(()=>{viewTime=new Date(...${JSON.stringify(parts)}).getTime();for(const callback of [...viewTicks])callback(new Date())})()`)
  const snapshot = () => js(`Array.from(document.querySelectorAll('#app-runtime .runtime-app,#app-runtime .runtime-app *'),node=>({
    tag:node.tagName,classes:node.className,text:node.children.length?null:node.textContent,dateTime:node.getAttribute('datetime'),
    hidden:node.hidden,role:node.getAttribute('role'),live:node.getAttribute('aria-live'),label:node.getAttribute('aria-label')}))`)
  const back = async () => {
    const point = await js("(()=>{const r=document.querySelector('#app-back').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()")
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    await wait("!odkAppPlatform.active()&&document.querySelector('#app-view').hidden")
    pointerBack++
  }
  const key = async (keyCode, modifiers = [], count = 1) => {
    const sequence = keySequence += count
    await js(`(()=>{let remaining=${count};const observed=()=>{if(--remaining===0){
      window.viewKeySequence=${sequence};window.removeEventListener('keyup',observed)}};
      window.addEventListener('keyup',observed)})()`)
    for (let index = 0; index < count; index++) {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      // Chromium button activation also needs the Enter character event.
      if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }
    await wait(`window.viewKeySequence===${sequence}`)
  }
  const focusBaseline = new Map()
  let focusChecks = 0
  const focus = async (selector, phase, id) => {
    checkpoint(`focus ${phase} ${id} ${selector} start`)
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      const measured = await js(`(async()=>{
        await odkTheme.ready;odkTheme.set(${JSON.stringify(theme)});
        await document.fonts.ready;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const el=document.querySelector(${JSON.stringify(selector)});
        await Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{})));
        const style=getComputedStyle(el),rect=el.getBoundingClientRect();
        return{theme:odkTheme.get(),focused:document.activeElement===el&&el.matches(':focus-visible'),active:document.activeElement?.id,visible:el.matches(':focus-visible'),hasFocus:document.hasFocus(),
          inside:rect.width>0&&rect.height>0&&rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,
          marker:(style.outlineStyle!=='none'&&parseFloat(style.outlineWidth)>=2&&style.outlineColor!=='rgba(0, 0, 0, 0)')||style.boxShadow.includes('0px 0px 0px 2px'),
          styles:{outline:style.outline,offset:style.outlineOffset,border:style.border,shadow:style.boxShadow,
            width:Math.round(rect.width*100)/100,height:Math.round(rect.height*100)/100}};
      })()`)
      assert.equal(measured.theme, theme)
      assert.equal(measured.focused, true, `${theme} ${id} ${selector} lost keyboard focus: ${JSON.stringify(measured)}`)
      assert.equal(measured.inside, true, `${theme} ${id} ${selector} escaped the viewport`)
      assert.equal(measured.marker, true, `Keyboard focus marker absent: ${theme} ${id} ${selector}`)
      const key = `${theme}:${id}:${selector}`
      if (phase === 'default') focusBaseline.set(key, measured.styles)
      else assert.deepEqual(measured.styles, focusBaseline.get(key), `${phase} ${key} focus changed`)
      focusChecks++
    }
    checkpoint(`focus ${phase} ${id} ${selector} end`)
  }
  const phases = native ? ['default', 'independent', 'updated', 'rolled-back', 'restored'] : ['default', 'independent', 'restored']
  const revisions = [], firstRevisions = new Map()
  for (const phase of phases) {
    checkpoint(`phase ${phase}`)
    if (['independent', 'updated', 'rolled-back'].includes(phase)) {
      const version = phase === 'updated' ? '3.0.0' : '2.0.0'
      if (native && phase !== 'independent') {
        for (const appId of ids) {
          const id = `odk.app.${appId}`
          const before = readConfig(resolveConfigPath(process.env))
          const peers = config => Object.fromEntries(Object.entries(config.plugins).filter(([key]) => key !== id))
          const args = phase === 'updated'
            ? ['update', id, path.join(profile, `${appId}-3.0.0`), '--keyring', process.env.ODK_NATIVE_KEYRING, '--trust']
            : ['rollback', id, '--keyring', process.env.ODK_NATIVE_KEYRING]
          const receipt = JSON.parse((await runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'),
            'native', ...args], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000 })).stdout)
          assert.equal(receipt.effect, 'selection-only')
          const after = readConfig(resolveConfigPath(process.env))
          assert.deepEqual(peers(after), peers(before), `${phase} changed another plugin preference`)
          assert.notEqual(after.plugins[id].native.revision, before.plugins[id].native.revision)
          if (phase === 'rolled-back') assert.equal(after.plugins[id].native.revision, firstRevisions.get(id))
        }
      }
      if (external) {
        const config = readConfig(resolveConfigPath(process.env))
        if (native && phase === 'independent') for (const appId of ids) {
          const id = `odk.app.${appId}`
          firstRevisions.set(id, config.plugins[id].native.revision)
        }
        entries = native ? await loadNativeRendererPlugins(config, { env: process.env, assets })
          : loadDevelopmentPlugins(config, { host: 'electron-renderer' })
        assert.equal(entries.length, ids.length)
        if (native) for (const entry of entries) {
          assert.match(entry.entryUrl, /^odk-native-plugin:\/\/[a-f0-9]{32}\/.+\.js$/)
          assert.equal(assets.response(new Request(entry.entryUrl)).status, 200)
        }
      }
      await js(`(async()=>{
        const definitions=${external ? 'await odkRendererDevelopment.load({runtime:true})' : 'odkBuiltinViewReplacements'};
        if(definitions.length!==5)throw Error('Independent App entries absent');
        for(const definition of definitions){
          odkPlugins.get(definition.id).lifecycle.mount=()=>{throw Error('Default App delegation refused')};
          await odkRendererRuntime.replace(definition);
          if(odkPlugins.get(definition.id).manifest.version!==${JSON.stringify(version)})throw Error('Independent App selection absent');
        }
      })()`)
      assert.deepEqual(await js('viewExternalEntries.slice(-5).sort()'), external ? ids.map(id => 'odk.app.' + id).sort() : [])
      if (external) assert.deepEqual(await js(`${JSON.stringify(ids)}.map(id=>viewExecutedVersions['odk.app.'+id])`), ids.map(() => version))
      if (native) {
        revisions.push(version)
        assert.equal(await js('viewExternalEntries.length'), revisions.length * ids.length)
      }
    }
    if (phase === 'restored') {
      const saved = native ? fs.readFileSync(resolveConfigPath(process.env)) : null
      await js(`(async()=>{for(const id of ${JSON.stringify(ids)})await odkRendererRuntime.restoreDefault('odk.app.'+id)})()`)
      if (native) assert.deepEqual(fs.readFileSync(resolveConfigPath(process.env)), saved)
    }
    for (const id of ids) {
      checkpoint(`${phase} ${id} start`)
      await tick([2026, 0, 1, 12, 34])
      const subscriptions = await js('viewTicks.size')
      await js(`(()=>{window.viewFocusOrigin=document.querySelector('.dot.active');viewFocusOrigin.focus()})()`)
      assert.equal(await js('document.activeElement===viewFocusOrigin'), true)
      assert.equal(await js(`odkAppPlatform.openApp({appId:${JSON.stringify(id)}})`), true)
      assert.equal(await js("document.activeElement===document.querySelector('#app-back')"), true)
      if (id === 'app-manager') await wait("document.querySelector('#app-runtime .app-list li')")
      await key('Tab', ['shift'])
      assert.equal(await js(`document.activeElement===document.querySelector(${JSON.stringify(id === 'app-manager' ? '#app-search' : '#app-back')})`), true)
      await key('Tab')
      assert.equal(await js("document.activeElement===document.querySelector('#app-back')"), true)
      await focus('#app-back', phase, id)
      keyboardLoops++
      const states = []
      if (id === 'clock' || id === 'calendar' || id === 'year') {
        const dates = id === 'clock' ? [[2026,0,1,23,59], [2026,0,2,0,0]]
          : id === 'calendar' ? [[2028,1,29,12,34], [2028,2,1,12,34]] : [[2026,11,31,23,59], [2027,0,1,0,0]]
        for (const date of dates) { await tick(date); states.push(await snapshot()) }
        assert.equal(await js('viewTicks.size'), subscriptions + 1)
      } else if (id === 'app-manager') {
        await wait("document.querySelector('#app-runtime .app-list li')")
        await key('Tab')
        assert.equal(await js("document.activeElement===document.querySelector('#app-search')"), true)
        await focus('#app-search', phase, id)
        await win.webContents.insertText(' CLOCK ')
        await wait("document.querySelectorAll('#app-runtime .app-list li').length===1&&document.querySelector('#app-runtime .app-list strong').textContent==='Clock'")
        await key('Backspace', [], ' CLOCK '.length)
        await wait("document.querySelector('#app-search').value===''&&document.querySelectorAll('#app-runtime .app-list li').length>1")
        await key('Tab')
        assert.equal(await js("document.activeElement===document.querySelector('#app-back')"), true)
        keyboardSearches++
        for (const query of [' CLOCK ', 'missing', '']) {
          await js(`(()=>{const input=document.querySelector('#app-search');input.value=${JSON.stringify(query)};input.dispatchEvent(new Event('input'))})()`)
          states.push(await snapshot())
        }
        catalogFailure = true
        await js("document.querySelector('.app-manager-retry').click()")
        await wait("!document.querySelector('.app-manager-retry').hidden")
        states.push(await snapshot())
        catalogFailure = false; catalogEmpty = true
        await key('Tab', ['shift'])
        assert.equal(await js("document.activeElement===document.querySelector('.app-manager-retry')"), true)
        await focus('.app-manager-retry', phase, id)
        await key('Enter')
        keyboardReloads++
        await wait("document.querySelector('.app-manager-status').textContent==='No built-in views available.'")
        states.push(await snapshot()); catalogEmpty = false
        assert.equal(await js('viewStateSubscriptions'), 1)
      } else states.push(await snapshot())
      if (phase === 'default') baseline.set(id, states)
      else assert.deepEqual(states, baseline.get(id), `${phase} ${id} reading changed`)
      if (id === 'clock') assert.equal(await js("document.querySelector('#app-runtime time').dateTime"), '00:00')
      if (id === 'calendar') assert.equal(await js("document.querySelector('#app-runtime time').dateTime"), '2028-03-01')
      if (id === 'year') assert.equal(await js("document.querySelector('#app-runtime .runtime-value').textContent"), '0%')
      if (id === 'pomodoro') {
        assert.equal(await js("document.querySelector('#app-runtime .runtime-state').textContent"), 'Timer unavailable')
        assert.equal(await js("document.querySelectorAll('#app-runtime button').length"), 0)
      }
      await back()
      assert.equal(await js('document.activeElement===viewFocusOrigin'), true)
      assert.equal(await js(`odkAppPlatform.openApp({appId:${JSON.stringify(id)}})`), true)
      if (id === 'app-manager') await wait("document.querySelector('#app-runtime .app-list li')")
      await key('Escape')
      await wait("!odkAppPlatform.active()&&document.querySelector('#app-view').hidden")
      assert.equal(await js('document.activeElement===viewFocusOrigin'), true)
      keyboardBack++
      if (id === 'app-manager') {
        for (const failure of [false, true]) {
          let settle
          const previousReads = gatedReads
          catalogGate = new Promise((resolve, reject) => { settle = failure ? () => reject(Error('Late catalog failure')) : () => resolve([{name:'Old catalog',appId:'old'}]) })
          await js("(()=>{window.catalogList=odkAppPlatform.listApps;odkAppPlatform.listApps=(...args)=>{window.closedCatalogRead=catalogList(...args);return closedCatalogRead}})()")
          assert.equal(await js("odkAppPlatform.openApp({appId:'app-manager'})"), true)
          await js("void(odkAppPlatform.listApps=catalogList)")
          await js("(()=>{window.closedCatalog=document.querySelector('#app-runtime .runtime-app');window.closedSearch=closedCatalog.querySelector('input');window.closedRetry=closedCatalog.querySelector('button')})()")
          await back()
          assert.equal(gatedReads, previousReads + 1, 'Old catalog request did not enter the controlled gate')
          catalogGate = null
          assert.equal(await js("odkAppPlatform.openApp({appId:'app-manager'})"), true)
          await wait("document.querySelector('#app-runtime .app-list li')")
          const current = await snapshot()
          const closed = await js('closedCatalog.outerHTML')
          settle()
          await js('closedCatalogRead.catch(()=>{})')
          assert.equal(await js('closedCatalog.outerHTML'), closed, `${phase} late reply changed the released catalog`)
          await js("(()=>{closedSearch.value='missing';closedSearch.dispatchEvent(new Event('input'));closedRetry.click()})()")
          await js('odkAppPlatform.listApps()')
          assert.equal(await js('closedCatalog.outerHTML'), closed, `${phase} released catalog changed after late ${failure ? 'failure' : 'success'}`)
          assert.deepEqual(await snapshot(), current, `${phase} reopened catalog changed after old reply`)
          lateReplies++
          await back()
        }
      }
      assert.equal(await js('viewTicks.size'), subscriptions)
      assert.equal(await js('viewStateSubscriptions'), 0)
      assert.equal(await js("document.querySelector('#page-context').textContent===viewPageContext"), true)
      assert.equal(await js("document===viewDocument&&viewPeer===document.querySelector('[data-widget=\"odk.tile.clock\"]')"), true)
    }
  }
  await js('odkRendererRuntime.stop()'); assert.equal(await js('viewTicks.size'), 0)
  assert.equal(await js('viewTickIntervals.size'), 0, 'Shared Tick interval survived Renderer shutdown')
  await manager.host.stop(); assert.equal(manager.handlers.size, 0)
  await discoveryHost.stop()
  assert.equal(await js('odkRendererPluginBridge.list().then(()=>false,()=>true)'), true)
  if (native) assert.equal(await protocol.isProtocolHandled(NATIVE_PLUGIN_SCHEME), false)
  console.log(JSON.stringify({ views: 5, phases: phases.length, focusChecks, externalEntries: external ? await js('viewExternalEntries.length') : 0, ...(native ? { protocolReleased: true, revisions } : {}), discoveryReleased: true, actualPreload: true, documentLoads: loads, pointerBack, lateReplies, keyboard: { loops: keyboardLoops, searches: keyboardSearches, reloads: keyboardReloads, back: keyboardBack }, subscriptionsReleased: true, tickTimerReleased: true }))
  await finish(0)
}).catch(error => { void finish(1, error) })
