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
const id = 'odk.status.pi-sessions'

const signed = process.env.ODK_PI_STATUS_SURFACE_NATIVE === '1'
const profile = process.env.ODK_PI_STATUS_SURFACE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
const assets = signed ? createNativeRendererAssets() : null
if (signed) require('../src/user-app-system').registerUserAppScheme(protocol)
let win, host, finishing
const timeout = setTimeout(() => { void finish(1, Error('Pi status surface acceptance timed out')) }, 50000)
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
  let reading = { ok:true, source:{label:"Fixture Pi source"}, summary:{running:2,settled:1,workspacesCount:1} }
  ipcMain.removeHandler("odk-pi-sessions")
  ipcMain.handle("odk-pi-sessions", () => reading)
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
    window.piTicks = new Set(); window.piWrites = new Map();
    window.piMount = mount => function(element, context) {
      const previous = window.mountingPi;
      window.mountingPi = true;
      const briefing=context.briefing;
      const guarded=new Proxy(context,{get(target,key){
        if(key!=='briefing') return Reflect.get(target,key);
        return {...briefing,contribute(value){
          window.piWrites.set(element,(window.piWrites.get(element)||0)+1);
          return briefing.contribute(value);
        }};
      }});
      try { return mount.call(this,element,guarded); } finally { window.mountingPi = previous; }
    };
    let registry, services;
    Object.defineProperty(window,'odkPlugins',{configurable:true,get(){return registry;},set(value){
      registry=value; const register=value.register;
      value.register=function(definition){
        if(definition.id==='odk.status.pi-sessions') definition={...definition,mount:window.piMount(definition.mount)};
        return register.call(this,definition);
      };
    }});
    Object.defineProperty(window,'odkServices',{configurable:true,get(){return services;},set(value){
      services=value; const subscribe=value.onTick;
      value.onTick=function(callback){
        if(!window.mountingPi) return subscribe.call(this,callback);
        window.piTicks.add(callback);
        const cancel=subscribe.call(this,callback);
        return () => { cancel(); window.piTicks.delete(callback); };
      };
    }});
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
  assert.equal(await js('window.piTicks.size'), 1, 'Observe the initial actual acquisition')
  await js(`(() => {
    window.piDocument=document;
    window.piActual=document.querySelector('[data-status-plugin="odk.status.pi-sessions"]');
    window.piPeer=document.querySelector('[data-widget="odk.tile.year"]');
    if(!window.piActual || !window.piPeer) throw Error('Pi status or peer placement absent');
    window.piSample=document.createElement('div'); piSample.className=piActual.className; document.body.append(piSample);
    window.piStatements=[]; window.piNavigation=[];
    window.piUI={onTick:callback=>window.odkServices.onTick(callback),
      navigateToPage:page=>window.piNavigation.push(page),
      briefing:{contribute:value=>window.piStatements.push(value)}};
    if(!window.odkPlugins.activate(window.odkPlugins.get('${id}'),piSample,piUI)) throw Error('Pi comparison mount refused');
    const sheet=new CSSStyleSheet(); sheet.replaceSync('.sb-pi-status,.sb-pi-status *{transition:none!important;animation:none!important}');
    document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet]; window.piSheet=sheet;
  })()`)
  const active = `document===window.piDocument && window.piTicks.size===2
    && document.querySelector('[data-status-plugin="${id}"]')===window.piActual
    && document.querySelector('[data-widget="odk.tile.year"]')===window.piPeer
    && window.odkPlugins.isActive(window.odkPlugins.get('${id}'),piActual)
    && window.odkPlugins.isActive(window.odkPlugins.get('${id}'),piSample)
    && window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.year'),piPeer)`
  async function scan(value, expected) {
    reading = value
    await js(`(async()=>{
      const before=[piActual,piSample].map(node=>window.piWrites.get(node)||0);
      for(let index=0;index<3;index++) for(const callback of window.piTicks) callback();
      const deadline=performance.now()+3000;
      while(![piActual,piSample].every((node,index)=>(window.piWrites.get(node)||0)>before[index] && node.querySelector('#sb-pi-count').textContent===${JSON.stringify(expected)})){
        if(performance.now()>deadline) throw Error('Controlled scan did not reach consumers: '+JSON.stringify({expected:${JSON.stringify(expected)},actual:[piActual,piSample].map(node=>({text:node.querySelector('#sb-pi-count').textContent,writes:window.piWrites.get(node),version:odkPlugins.get('odk.status.pi-sessions').manifest.version})),before}));
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    })()`)
  }
  const live = reading
  const cases = [live, {...live,summary:{running:1,settled:0,workspacesCount:1}},
    ...[0,1,2].map(settled=>({...live,summary:{running:0,settled,workspacesCount:0}})),
    {ok:false,source:{label:'Unavailable fixture'}}, null, {ok:true}]
  const baseline = [], stateBaseline = []
  for (const phase of ['default','independent','restored']) {
    if(phase==='independent') {
      const config=readConfig(resolveConfigPath(process.env))
      entries=signed ? await loadNativeRendererPlugins(config,{env:process.env,assets})
        : loadDevelopmentPlugins(config,{host:'electron-renderer'})
      assert.deepEqual(entries.map(entry=>entry.manifest.id),[id])
      await js(`(async()=>{
        window.odkPlugins.get('${id}').lifecycle.mount=()=>{throw Error('Default Pi status delegation refused');};
        const definitions=await window.odkRendererDevelopment.load({runtime:true});
        if(definitions.length!==1) throw Error('Pi replacement entry absent');
        const definition=definitions[0]; definition.mount=window.piMount(definition.mount);
        await window.odkRendererRuntime.replace(definition);
      })()`)
    } else if(phase==='restored') await js(`window.odkRendererRuntime.restoreDefault('${id}')`)
    assert.equal(await js(active),true,'Pi subscriptions or consumer ownership changed')
    assert.equal(await js(`window.odkPlugins.get('${id}').manifest.version || '1.0.0'`),phase==='independent'?'2.0.0':'1.0.0')
    for(let index=0;index<cases.length;index++) {
      const value=cases[index]
      await scan(value,!value || value.ok===false || !Number.isInteger(value.summary?.running)?'Unavailable':String(value.summary.running))
      const snapshot=await js(`(()=>{
        const collect=node=>{const button=node.querySelector('button');return {count:node.querySelector('#sb-pi-count').textContent,
          dot:node.querySelector('.sb-pi-dot').className,button:button.className,title:button.title,aria:button.getAttribute('aria-label')};};
        return {actual:collect(piActual),sample:collect(piSample),
          statement:window.odkServices.briefing.list().find(item=>item.id==='odk.briefing.pi-sessions'),
          sampleStatement:piStatements.at(-1)};
      })()`)
      assert.deepEqual(snapshot.actual,snapshot.sample)
      if(phase==='default') stateBaseline.push(snapshot)
      else assert.deepEqual(snapshot,stateBaseline[index])
    }
    await scan(live,'2')
    let index=0
    for(const theme of ['instrument','pixel','border-beam']) for(const size of [168,292,400]) {
      await js(`window.odkTheme.set(${JSON.stringify(theme)})`)
      const view=await js(`(async()=>{
        piSample.style.cssText='position:fixed;display:flex;left:0;top:0;width:${size}px;height:44px;align-items:center';
        await Promise.all([document.fonts.load('700 32px "Montserrat"'),document.fonts.load('400 16px "Noto Sans SC"'),document.fonts.load('400 16px "Zpix"')]);
        await document.fonts.ready; await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(innerWidth!==1920 || innerHeight!==1280 || devicePixelRatio!==1 || visualViewport.scale!==1
          || document.fonts.status!=='loaded' || document.documentElement.dataset.theme!==${JSON.stringify(theme)}) throw Error('Pi measurement inputs changed');
        const collect=(container,relative)=>{
          const frame=container.getBoundingClientRect();
          return ['button','.sb-pi-dot','.sb-pi-label','.sb-pi-count'].map(selector=>{
            const node=container.querySelector(selector),box=node.getBoundingClientRect(),style=getComputedStyle(node);
            if(box.width<=0 || box.height<=0) throw Error('Pi reading has no geometry');
            if(relative && (box.left<frame.left || box.right>frame.right+0.1 || box.top<frame.top || box.bottom>frame.bottom+0.1)) throw Error('Pi reading is clipped: '+JSON.stringify({selector,frame:frame.toJSON(),box:box.toJSON()}));
            return {text:node.textContent,classes:node.className,width:box.width,height:box.height,left:box.left-frame.left,top:box.top-frame.top,
              font:style.fontFamily,fontSize:style.fontSize,color:style.color,spacing:style.letterSpacing,aria:node.getAttribute('aria-label')};
          });
        };return {actual:collect(piActual,false),sample:collect(piSample,true)};
      })()`)
      if(phase==='default') baseline.push(view)
      else assert.deepEqual(view,baseline[index])
      index++
    }
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    await js('document.activeElement?.blur()')
    for(const type of ['keyDown','keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',
      {type,key:'Home',code:'Home',windowsVirtualKeyCode:36})
    assert.equal(await js(`document.getElementById('page-context').textContent.startsWith('Pi Sessions')`),false,'Keyboard precondition must leave Pi Sessions')
    await js(`(()=>{const button=piActual.querySelector('button'); window.piTrustedClick=false;
      button.addEventListener('click',event=>{window.piTrustedClick=event.isTrusted;},{once:true});button.focus();
      if(document.activeElement!==button) throw Error('Pi button focus absent');})()`)
    for(const type of ['keyDown','char','keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',
      {type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
    assert.equal(await js(`window.piTrustedClick && document.getElementById('page-context').textContent.startsWith('Pi Sessions')`),true,'Pi keyboard did not navigate from another page')
    await js(`window.odkRendererRuntime.setEnabled('${id}',false)`)
    assert.equal(await js('window.piTicks.size'),0)
    await js(`window.odkRendererRuntime.setEnabled('${id}',true)`)
    await js(`piActual=document.querySelector('[data-status-plugin="${id}"]')`)
    assert.equal(await js(active),true,'Pi subscriptions or consumer ownership changed')
    await js(`(async () => {
      window.piOriginalBriefing = window.odkServices.briefing;
      window.piRetainedBriefing = JSON.stringify(piOriginalBriefing.list());
      window.piSelectedStatements = [];
      window.odkServices.registerService('briefing', {
        contribute(statement) { window.piSelectedStatements.push(statement); return true; },
      });
      ${process.env.ODK_PI_BRIEFING_BYPASS === '1' ? "Object.defineProperty(window.odkServices, 'briefing', { get: () => piOriginalBriefing });" : ''}
      await window.odkRendererRuntime.setEnabled('${id}', false);
      await window.odkRendererRuntime.setEnabled('${id}', true);
      piActual = document.querySelector('[data-status-plugin="${id}"]');
    })()`)
    for (const value of [
      { ...live, summary: { running: 7, settled: 0, workspacesCount: 4 } },
      { ...live, summary: { running: 0, settled: 2, workspacesCount: 0 } },
      { ok: false, source: { label: 'Selected service unavailable' } },
    ]) {
      const before = await js('window.piSelectedStatements.length')
      await scan(value, value.ok === false ? 'Unavailable' : String(value.summary.running))
      assert.equal(await js('window.piSelectedStatements.length > ' + before), true,
        'Pi consumer bypassed selected briefing service')
      assert.deepEqual(await js('window.piSelectedStatements.at(-1)'), await js('window.piStatements.at(-1)'))
      assert.equal(await js('JSON.stringify(window.piOriginalBriefing.list()) === window.piRetainedBriefing'), true,
        'Deselected default briefing store changed')
    }
    const retained = await js('JSON.stringify(window.piSelectedStatements)')
    await js(`window.odkRendererRuntime.setEnabled('${id}', false)`)
    assert.equal(await js('window.piTicks.size'), 0)
    assert.equal(await js('JSON.stringify(window.piSelectedStatements)'), retained)
    await js(`(async () => {
      window.odkServices.registerService('briefing', window.piOriginalBriefing);
      await window.odkRendererRuntime.setEnabled('${id}', true);
      piActual = document.querySelector('[data-status-plugin="${id}"]');
    })()`)
    await scan(live, '2')
    assert.equal(await js(active), true, 'Pi subscriptions or consumer ownership changed')
    assert.equal(await js('JSON.stringify(window.piSelectedStatements)'), retained)
    assert.deepEqual(await js("window.odkServices.briefing.list().find(item => item.id === 'odk.briefing.pi-sessions')"), stateBaseline[0].statement)
  }
  await js('document.adoptedStyleSheets=document.adoptedStyleSheets.filter(sheet=>sheet!==window.piSheet)')
  assert.equal(await js('document.adoptedStyleSheets.includes(window.piSheet)'),false)
  await js('window.odkRendererRuntime.stop()')
  assert.equal(await js('window.piTicks.size'),0)
  win.webContents.debugger.detach();win.destroy();await host.stop()
  assert.equal(ipcMain._invokeHandlers.has('odk-renderer-development-plugins'),false)
  if(signed) assert.equal(protocol.isProtocolHandled('odk-native-plugin'),false)
  assets?.close()
  if(signed) for(const entry of entries) assert.equal(assets.response({url:entry.entryUrl}).status,410)
  clearTimeout(timeout)
  console.log(JSON.stringify({actualPreload:true,mode:signed?'native':'development',identities:[id],documentLoads:loads,
    themes:3,sizes:3,comparisons:18,stateCases:8,lifecycleChanges:6,keyboardNavigation:true,
    retainedConsumers:true,selectedBriefingConsumers:3,restored:true,discoveryReleased:true,assetLeaseReleased:signed}))
  app.quit()
}).catch(error=>{void finish(1,error)})
