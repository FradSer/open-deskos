'use strict'

const { app, BrowserWindow, ipcMain, session, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const { clockMainTimeouts } = require('./helpers/clock-main-timeouts')
const { resolveConfigPath } = require('../src/plugin-config')
const root = process.env.ODK_CLOCK_MAIN_ROOT
assert.ok(root && path.isAbsolute(root), 'Clock acceptance requires private parent-owned state')
assert.notEqual(process.platform, 'win32', 'Clock acceptance requires private Unix listeners')
const mode = process.env.ODK_CLOCK_MAIN_MODE
if (mode === 'calendar') app.disableHardwareAcceleration()
const selectedControl = ['selected', 'missing'].includes(process.env.ODK_CLOCK_MAIN_CONTROL)
const bridgeControl = ['bridge', 'missing-bridge'].includes(process.env.ODK_CLOCK_MAIN_CONTROL)
let defaultControlCalls = 0
if (selectedControl) {
  const composition = require('../src/plugins/main-composition')
  const createPlugins = composition.createMainPlugins
  composition.createMainPlugins = options => createPlugins(options).map(plugin => {
    if (plugin.manifest.id !== 'odk.system.renderer-control' || plugin.manifest.version !== '1.0.0') return plugin
    return { ...plugin, create() { defaultControlCalls++; throw Error('Default Renderer control refused') } }
  })
}
app.setPath('userData', path.join(root, 'profile'))
app.setPath('sessionData', path.join(root, 'profile'))
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
require('./helpers/app-manager-composition-isolation').isolateComposition(root)
const configPath = resolveConfigPath(process.env)
const selectedConfiguration = fs.readFileSync(configPath)
if (mode !== 'signed') {
  const config = JSON.parse(selectedConfiguration)
  delete config.plugins['odk.status.clock'].native
  if (mode === 'calendar') for (const spec of [...require('./helpers/calendar-surfaces').filter(spec => spec.id !== 'odk.status.clock'), ...require('./helpers/desk-tool-surfaces')]) delete config.plugins[spec.id].native
  fs.writeFileSync(configPath, JSON.stringify(config))
}

const hostModule = require('../src/plugin-host')
const createHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  const result = createHost(options)
  if (options?.capabilities?.['system.app-manager']) host = result
  return result
}
const handlers = new Set()
const handle = ipcMain.handle.bind(ipcMain)
const remove = ipcMain.removeHandler.bind(ipcMain)
ipcMain.handle = (channel, callback) => { handle(channel, callback); handlers.add(channel) }
ipcMain.removeHandler = channel => { remove(channel); handlers.delete(channel) }
let win, failed = false, report, loads = 0, primingLoads = 0, stage = 'startup'
const deadline = setTimeout(() => { void fail(Error(`Clock production acceptance timed out at ${stage}`)) }, clockMainTimeouts(mode).fixture)
async function fail(error) {
  if (failed) return
  failed = true
  clearTimeout(deadline)
  console.error(error)
  try {
    if (win && !win.isDestroyed() && win.webContents.getURL().startsWith('file:')) await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
  } catch (cleanupError) { console.error(cleanupError) }
  try { await host?.stop() } finally { app.exit(1) }
}

// Install deterministic time and acquisition observations before the real document loads.
const loadFile = BrowserWindow.prototype.loadFile
BrowserWindow.prototype.loadFile = async function (...args) {
  try {
    stage = 'prime-renderer'
    await this.loadURL('about:blank')
    stage = 'install-time-observation'
    this.webContents.debugger.attach('1.3')
    await this.webContents.debugger.sendCommand('Page.enable')
    await this.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const ActualDate=Date;
      window.clockFixedTime=new ActualDate(2026,0,1,12,34).getTime();
      window.Date=class extends ActualDate {
        constructor(...args){super(...(args.length?args:[window.clockFixedTime]));}
        static now(){return window.clockFixedTime;}
      };
      window.clockTickOwners=0; window.clockTickAcquisitions=0;
      if(${mode === 'calendar'}) {
        window.localCanvasPaints=new WeakMap();
        const draw=CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage=function(...args){
          const result=draw.apply(this,args);
          localCanvasPaints.set(this.canvas,(localCanvasPaints.get(this.canvas)||0)+1);
          return result;
        };
      }
      let services;
      Object.defineProperty(window,'odkServices',{configurable:true,enumerable:true,
        get(){return services},set(value){
          const subscribe=value.onTick;
          value.onTick=callback=>{
            const cancel=subscribe.call(value,callback);
            window.clockTickOwners++; window.clockTickAcquisitions++;
            let released=false;
            return ()=>{if(released)return;cancel();released=true;window.clockTickOwners--;};
          };services=value;
        }
      });
    })()` })
    stage = 'load-document'
    return await loadFile.apply(this, args)
  } catch (error) { await fail(error) }
}
app.on('browser-window-created', (_event, window) => {
  assert.equal(win, undefined, 'Clock fixture requires one Shell window')
  win = window
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('did-finish-load', () => {
    if (win.webContents.getURL() === 'about:blank') { primingLoads++; return }
    loads++
    if (loads === 1) void exercise().catch(fail)
  })
})
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
}).catch(fail)

async function exercise() {
  stage = 'await-shell-ready'
  const js = source => win.webContents.executeJavaScript(source)
  await js('window.odkShellReady')
  if (bridgeControl) {
    await js('window.odkRendererDiagnosis.ready')
    if (process.env.ODK_CLOCK_MAIN_CONTROL === 'bridge') {
      const { independentControlBridge } = require('./fixtures/renderer-bridge-control-replacement')
      await js(`(async()=>{
        const runtime=window.odkRendererDiagnosis;
        const manifest=runtime.catalog().find(plugin=>plugin.manifest.id==='odk.renderer.plugin-control').manifest;
        window.clockBridgeReleased=new Promise(resolve=>{window.clockReleaseBridge=resolve});
        const definition=(${independentControlBridge.toString()})(window,{...manifest,version:'2.0.0'});
        const create=definition.create;
        definition.create=ctx=>{
          ctx.onCleanup(()=>window.clockReleaseBridge());
          return create(ctx);
        };
        await runtime.replace(definition);
      })()`)
    }
    assert.equal(await js("odkRendererDiagnosis.catalog().find(plugin=>plugin.manifest.id==='odk.renderer.plugin-control').manifest.version"),
      '2.0.0', 'Selected Renderer bridge missing')
  }
  stage = 'initial-state'
  assert.equal(win.isVisible(), false)
  assert.equal(defaultControlCalls, 0, 'Selected Renderer control missing')
  const controlVersion = host.list().find(plugin => plugin.manifest.id === 'odk.system.renderer-control').manifest.version
  assert.equal(controlVersion, selectedControl ? '2.0.0' : '1.0.0')
  if (selectedControl) assert.equal(globalThis.clockSelectedControlEntry, true)
  assert.ok(host.list().every(plugin => plugin.enabled && plugin.state === 'running'))
  assert.equal(await js("odkPlugins.get('odk.status.clock').manifest.version || '1.0.0'"), mode === 'signed' ? '2.0.0' : '1.0.0')
  assert.equal(await js("odkAppPlatform.openApp({appId:'year'})"), true)
  await js(`window.clockDocument=document;
    window.clockPlacement=document.querySelector('[data-status-plugin="odk.status.clock"]');
    window.clockForeground=document.querySelector('#app-runtime').firstElementChild;
    window.clockPeerNodes=[...document.querySelectorAll('[data-widget], [data-status-plugin]')].filter(node=>node!==clockPlacement);
    if(!clockPlacement||clockTickOwners<=0||clockTickAcquisitions<=0)throw Error('Clock acquisition observation missing');`)
  const peerPorts = host.list().flatMap(plugin => plugin.manifest.provides.map(port => [port.interface, host.get(port.interface)]))
  const managerState = host.get('odk:system/app-manager/v1').captureState()
  const subscriptions = await js('clockTickOwners')
  const baseline = []
  async function measure(theme) {
    stage = `measure-${theme}`
    await js(`odkTheme.set(${JSON.stringify(theme)})`)
    return js(`(async()=>{
      const sheet=new CSSStyleSheet();
      sheet.replaceSync('[data-status-plugin="odk.status.clock"], [data-status-plugin="odk.status.clock"] * {transition:none!important;animation:none!important}');
      document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];
      try {
      await Promise.all([document.fonts.load('700 32px "Montserrat"'),document.fonts.load('400 16px "Noto Sans SC"'),document.fonts.load('400 16px "Zpix"')]);
      await document.fonts.ready;
      if(devicePixelRatio!==1||visualViewport.scale!==1||innerWidth!==1920||innerHeight!==1280)throw Error('Clock measurement inputs changed');
      const time=clockPlacement.querySelector('.sb-time'),bounds=time.getBoundingClientRect(),frame=document.getElementById('status-bar').getBoundingClientRect(),style=getComputedStyle(time);
      if(style.transitionDuration!=='0s'||style.animationName!=='none')throw Error('Clock comparison motion control failed');
      if(bounds.width<=0||bounds.height<=0||bounds.left<frame.left||bounds.right>frame.right||bounds.top<frame.top||bounds.bottom>frame.bottom)throw Error('Clock time clipped');
      if(time.textContent!=='12:34')throw Error('Clock time differs');
      return {markup:clockPlacement.innerHTML,text:time.textContent,dateTime:time.dateTime,width:bounds.width,height:bounds.height,
        left:bounds.left-frame.left,top:bounds.top-frame.top,font:style.fontFamily,size:style.fontSize,weight:style.fontWeight,color:style.color};
      } finally {
        document.adoptedStyleSheets=document.adoptedStyleSheets.filter(value=>value!==sheet);
        if(document.adoptedStyleSheets.includes(sheet))throw Error('Clock comparison sheet retained');
      }
    })()`)
  }
  for (const theme of ['instrument', 'pixel', 'border-beam']) baseline.push(await measure(theme))
  fs.writeFileSync(configPath, selectedConfiguration)
  const command = args => runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), ...args],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, maxBuffer: 65536 })
  if (bridgeControl) {
    await js("odkTheme.set('pixel')")
    const disabled = JSON.parse((await command(['disable', 'odk.theme.pixel', '--runtime'])).stdout)
    assert.equal(disabled.state, 'disabled')
    assert.deepEqual(await js("({theme:odkTheme.get(),saved:localStorage.getItem('odk.theme')})"),
      { theme: 'instrument', saved: 'pixel' })
    const enabled = JSON.parse((await command(['enable', 'odk.theme.pixel', '--runtime'])).stdout)
    assert.equal(enabled.state, 'running')
    assert.equal(await js('odkTheme.get()'), 'pixel')
    assert.deepEqual(fs.readFileSync(configPath), selectedConfiguration)
  }
  const versions = []
  let themeComparisons = 0, tickTransitions = 0
  async function probe(version) {
    versions.push(version)
    assert.equal(await js("odkPlugins.get('odk.status.clock').manifest.version || '1.0.0'"), version)
    if (version !== '1.0.0') assert.equal(await js('clockExecutedRevision'), version)
    assert.equal(await js('clockTickOwners'), subscriptions, 'Clock Tick subscription changed')
    assert.equal(await js(`document===clockDocument&&document.querySelector('[data-status-plugin="odk.status.clock"]')===clockPlacement
      &&odkPlugins.isActive(odkPlugins.get('odk.status.clock'),clockPlacement)&&clockPeerNodes.every(node=>node.isConnected)
      &&document.querySelector('#app-runtime').firstElementChild===clockForeground&&odkAppPlatform.active()?.appId==='year'`), true)
    assert.deepEqual(host.get('odk:system/app-manager/v1').captureState(), managerState)
    for (const [name, value] of peerPorts) assert.equal(host.get(name), value)
    let index = 0
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      assert.deepEqual(await measure(theme), baseline[index++]); themeComparisons++
    }
    for (const minute of [35, 34]) {
      await js(`(async()=>{
        clockFixedTime=new Date(2026,0,1,12,${minute}).getTime();
        const until=performance.now()+3000;
        while(clockPlacement.querySelector('.sb-time').textContent!=='12:${minute}'){
          if(performance.now()>until)throw Error('Clock shared Tick did not update');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
      })()`)
      tickTransitions++
    }
  }
  const activate = async version => {
    stage = `activate-${version}`
    const saved = fs.readFileSync(configPath)
    const receipt = JSON.parse((await command(['activate', 'odk.status.clock', '--runtime'])).stdout)
    assert.equal(receipt.scope, 'electron-renderer')
    assert.equal(receipt.version, version)
    assert.equal(receipt.revision, JSON.parse(saved).plugins['odk.status.clock'].native.revision)
    assert.deepEqual(fs.readFileSync(configPath), saved)
    await probe(version)
  }
  await activate('2.0.0')
  const saved = fs.readFileSync(configPath)
  const policyPath = process.env.ODK_NATIVE_KEYRING
  const policy = fs.readFileSync(policyPath)
  const broken = Buffer.from('{ controlled malformed configuration')
  const revoked = Buffer.from(JSON.stringify({ schemaVersion: 1, publishers: {} }))
  fs.writeFileSync(configPath, broken); fs.writeFileSync(policyPath, revoked)
  try {
    const restored = JSON.parse((await command(['restore-default', 'odk.status.clock', '--runtime'])).stdout)
    assert.equal(restored.implementation, 'built-in')
    assert.equal(restored.version, '1.0.0')
    assert.deepEqual(fs.readFileSync(configPath), broken)
    assert.deepEqual(fs.readFileSync(policyPath), revoked)
    await probe('1.0.0')
  } finally { fs.writeFileSync(configPath, saved); fs.writeFileSync(policyPath, policy) }
  await activate('2.0.0')
  const updated = JSON.parse((await command(['native', 'update', 'odk.status.clock', path.join(root, 'bundle-3.0.0'), '--keyring', policyPath, '--trust'])).stdout)
  assert.equal(updated.effect, 'selection-only')
  await activate('3.0.0')
  let calendar, deskTools
  if (mode === 'calendar') {
    async function selectLocalSurface(spec, phase) {
      stage = `local-${phase}-${spec.id}`
      const saved = fs.readFileSync(configPath)
      if (phase === 'signed') {
        await js(`odkPlugins.get(${JSON.stringify(spec.id)}).lifecycle.mount=()=>{throw Error('Default local surface delegation refused')}; void 0;`)
        const receipt = JSON.parse((await command(['activate', spec.id, '--runtime'])).stdout)
        assert.equal(receipt.version, '2.0.0')
        assert.equal(receipt.scope, 'electron-renderer')
        assert.equal(await js(`localExecutedVersions[${JSON.stringify(spec.id)}]`), '2.0.0')
      } else if (phase === 'restored') {
        const receipt = JSON.parse((await command(['restore-default', spec.id, '--runtime'])).stdout)
        assert.equal(receipt.version, '1.0.0')
        assert.equal(receipt.implementation, 'built-in')
      }
      assert.equal(await js(`odkPlugins.get(${JSON.stringify(spec.id)}).manifest.version||'1.0.0'`), phase === 'signed' ? '2.0.0' : '1.0.0')
      assert.deepEqual(fs.readFileSync(configPath), saved)
    }
    async function assertUnchangedShell() {
      assert.equal(await js('clockTickOwners'), subscriptions, `Tick ownership changed at ${stage}`)
      assert.deepEqual(host.get('odk:system/app-manager/v1').captureState(), managerState)
      for (const [name, value] of peerPorts) assert.equal(host.get(name), value)
      assert.equal(await js(`document===clockDocument&&clockPeerNodes.every(node=>node.isConnected)
        &&document.querySelector('[data-status-plugin="odk.status.clock"]')===clockPlacement
        &&document.querySelector('#app-runtime').firstElementChild===clockForeground&&odkAppPlatform.active()?.appId==='year'`), true)
    }
    const specs = require('./helpers/calendar-surfaces').filter(spec => spec.id !== 'odk.status.clock')
    const calendarBaseline = []
    await js(`window.calendarProductionConsumers=${JSON.stringify(specs)}.map(spec=>({spec,node:document.querySelector(spec.selector)}));
      if(calendarProductionConsumers.some(({node})=>!node))throw Error('Production calendar placement missing'); void 0;`)
    for (const phase of ['default', 'signed', 'restored']) {
      for (const spec of specs) await selectLocalSurface(spec, phase)
      let index = 0
      for (const parts of [[2024, 1, 29, 12, 35], [2026, 11, 31, 23, 59], [2027, 0, 1, 0, 0], [2026, 0, 1, 12, 34]]) {
        const date = new Date(...parts)
        const ratio = (date - new Date(parts[0], 0, 1)) / (new Date(parts[0] + 1, 0, 1) - new Date(parts[0], 0, 1))
        const expected = [`${Math.round(ratio * 100)}%`]
        const views = await js(`(async()=>{
          clockFixedTime=new Date(...${JSON.stringify(parts)}).getTime();
          const until=performance.now()+3000, expected=${JSON.stringify(expected)};
          const readings=()=>calendarProductionConsumers.flatMap(({spec,node})=>spec.readings.filter(selector=>selector!=='.year-context'&&selector!=='.meter-fill').map(selector=>node.querySelector(selector).textContent));
          while(JSON.stringify(readings())!==JSON.stringify(expected)){
            if(performance.now()>until)throw Error('Production calendar Tick readings changed: '+JSON.stringify(readings()));
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          if(calendarProductionConsumers.some(({spec,node})=>document.querySelector(spec.selector)!==node||!odkPlugins.isActive(odkPlugins.get(spec.id),node)))throw Error('Production calendar consumer ownership changed');
          return calendarProductionConsumers.map(({node})=>node.innerHTML);
        })()`)
        if (phase === 'default') calendarBaseline.push(views)
        else assert.deepEqual(views, calendarBaseline[index])
        index++
        await assertUnchangedShell()
      }
    }
    calendar = { identities: specs.map(spec => spec.id), phases: 3, dateTransitions: 12 }
    const tools = require('./helpers/desk-tool-surfaces')
    let toolBaseline
    await js(`window.productionToolConsumers=${JSON.stringify(tools)}.map(spec=>({spec,node:document.querySelector('[data-widget="'+spec.id+'"]')}));
      if(productionToolConsumers.some(({node})=>!node))throw Error('Production tool placement missing'); void 0;`)
    for (const phase of ['default', 'signed', 'restored']) {
      for (const spec of tools) await selectLocalSurface(spec, phase)
      const views = await js(`(async () => {
        await document.fonts.ready;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        const tree=node=>({tag:node.tagName,attributes:Object.fromEntries([...node.attributes].map(attribute=>[attribute.name,attribute.value])),
          text:[...node.childNodes].filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent.trim()).filter(Boolean).join(''),children:[...node.children].map(tree)});
        return productionToolConsumers.map(({spec,node})=>{
          if(document.querySelector('[data-widget="'+spec.id+'"]')!==node||!odkPlugins.isActive(odkPlugins.get(spec.id),node))throw Error('Production tool ownership changed');
          if(node.querySelector('button:not(.widget-launch),input,select,textarea,a[href],[tabindex],[contenteditable="true"]'))throw Error('Production tool gained controls');
          if(spec.readings.some((selector,index)=>node.querySelector(selector)?.textContent!==spec.text[index]))throw Error('Production tool state changed');
          return [...node.children].map(tree);
        });
      })()`)
      if (phase === 'default') toolBaseline = views
      else assert.deepEqual(views, toolBaseline)
      await assertUnchangedShell()
    }
    deskTools = { identities: tools.map(spec => spec.id), phases: 3 }
    assert.equal(app.isHardwareAccelerationEnabled(), false)

  }
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await js(`(async()=>{const until=performance.now()+3000;while(odkAppPlatform.active()){
    if(performance.now()>until)throw Error('Clock foreground did not close');await new Promise(resolve=>setTimeout(resolve,10));}})()`)
  assert.equal(host.get('odk:system/app-manager/v1').foreground(), null)
  await js('odkRendererRuntime.stop()')
  assert.equal(await js('clockTickOwners'), 0)
  if (bridgeControl) await js(`(async()=>{
    window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));
    await window.clockBridgeReleased;
  })()`)
  report = { productionMain: true, mode, controlVersion, documentLoads: loads, primingLoads, mainPlugins: host.list().length,
    ...(bridgeControl ? { bridgeControlSelection: { version: '2.0.0', lifecycleReceipts: 2, subscriptionReleased: true } } : {}),
    themeComparisons, tickTransitions, versions, subscriptionsReleased: true, ...(calendar ? { calendar, deskTools } : {}) }
  win.webContents.debugger.detach()
  app.quit()
}
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report)
    assert.equal(handlers.size, 0)
    assert.equal(ipcMain.listenerCount('odk-renderer-control-report'), 0)
    assert.ok(host.list().every(plugin => plugin.state === 'stopped'))
    assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
    clearTimeout(deadline)
    console.log(JSON.stringify({ ...report, handlersReleased: true, protocolReleased: true }))
  } catch (error) { console.error(error); app.exit(1) }
})
// Preserve production Main while giving its single hidden test window an offscreen render target.
const Module = require('node:module')
const loadModule = Module._load
class AcceptanceWindow extends BrowserWindow {
  constructor(options) {
    super({ ...options, webPreferences: { ...options.webPreferences, offscreen: true } })
  }
}
Module._load = function (request, parent, ...args) {
  if (request === 'electron' && parent?.filename === require.resolve('../src/main')) {
    return { ...require('electron'), BrowserWindow: AcceptanceWindow }
  }
  return loadModule.call(this, request, parent, ...args)
}
try { require('../src/main') } finally { Module._load = loadModule }
