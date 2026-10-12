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
const specs = ['connection', 'gamepad'].map(kind => ({kind, id:'odk.status.'+kind, selector:'[data-status-plugin="odk.status.'+kind+'"]'}))

const signed = process.env.ODK_INPUT_STATUS_SURFACE_NATIVE === '1'
const profile = process.env.ODK_INPUT_STATUS_SURFACE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
const assets = signed ? createNativeRendererAssets() : null
if (signed) require('../src/user-app-system').registerUserAppScheme(protocol)
let win, host, finishing
const timeout = setTimeout(() => { void finish(1, Error('Input status surface acceptance timed out')) }, 50000)
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
    window.inputOnline=true; window.inputGamepads=[];
    Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>window.inputOnline});
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>window.inputGamepads});
    window.inputConnections=new Set(); window.inputPads=new Set();
    window.inputMount=(mount,kind)=>function(element,context){
      const previous=window.inputMounting; window.inputMounting=kind;
      try{return mount.call(this,element,context);}finally{window.inputMounting=previous;}
    };
    let registry,services;
    Object.defineProperty(window,'odkPlugins',{configurable:true,get(){return registry;},set(value){
      registry=value;const register=value.register;
      value.register=function(definition){
        if(['odk.status.connection','odk.status.gamepad'].includes(definition.id))
          definition={...definition,mount:inputMount(definition.mount,definition.id.split('.').at(-1))};
        return register.call(this,definition);
      };
    }});
    Object.defineProperty(window,'odkServices',{configurable:true,get(){return services;},set(value){
      services=value;
      const gamepadSubscribe=value.gamepad.subscribe;
      value.gamepad.subscribe=function(callback){
        if(window.inputMounting!=='gamepad') return gamepadSubscribe.call(this,callback);
        inputPads.add(callback);const cancel=gamepadSubscribe.call(this,callback);
        return ()=>{cancel();inputPads.delete(callback);};
      };
      const subscribe=value.connection.subscribe;
      value.connection.subscribe=function(callback){
        if(window.inputMounting!=='connection') return subscribe.call(this,callback);
        inputConnections.add(callback);const cancel=subscribe.call(this,callback);
        return ()=>{cancel();inputConnections.delete(callback);};
      };
    }});
    const add=window.addEventListener,remove=window.removeEventListener;
    window.addEventListener=function(name,callback,...args){
      if(name==='odk-gamepad-state' && window.inputMounting==='gamepad') inputPads.add(callback);
      return add.call(this,name,callback,...args);
    };
    window.removeEventListener=function(name,callback,...args){
      const result=remove.call(this,name,callback,...args);
      if(name==='odk-gamepad-state') inputPads.delete(callback);
      return result;
    };
  })()` })
  let loads=0
  win.webContents.on('did-finish-load',()=>{loads++})
  await win.loadFile(path.resolve(__dirname,'../src/renderer/index.html'))
  win.webContents.setZoomFactor(1)
  const js=code=>win.webContents.executeJavaScript(code)
  await js('window.odkShellReady')
  assert.deepEqual(await js('[navigator.onLine,navigator.getGamepads().length,inputConnections.size,inputPads.size]'),[true,0,1,1])
  await js(`(()=>{
    window.inputDocument=document;window.inputConsumers=[];
    window.inputPeer=document.querySelector('[data-widget="odk.tile.year"]');
    for(const spec of ${JSON.stringify(specs)}) {
      const actual=document.querySelector(spec.selector);if(!actual) throw Error('Input status placement absent');
      const sample=document.createElement('div');sample.className=actual.className;document.body.append(sample);
      if(!window.odkPlugins.activate(window.odkPlugins.get(spec.id),sample,{connection:window.odkServices.connection,services:window.odkServices})) throw Error('Input comparison mount refused');
      inputConsumers.push({spec,actual,sample});
    }
    const sheet=new CSSStyleSheet();sheet.replaceSync('[data-status-plugin^="odk.status."], [data-status-plugin^="odk.status."] * {transition:none!important;animation:none!important}');
    document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];window.inputSheet=sheet;
  })()`)
  const active=`document===inputDocument && inputConnections.size===2 && inputPads.size===2
    && document.querySelector('[data-widget="odk.tile.year"]')===inputPeer
    && window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.year'),inputPeer)
    && inputConsumers.every(({spec,actual,sample})=>document.querySelector(spec.selector)===actual
      && window.odkPlugins.isActive(window.odkPlugins.get(spec.id),actual)
      && window.odkPlugins.isActive(window.odkPlugins.get(spec.id),sample))`
  const stateBaseline=[],baseline=[]
  for(const phase of ['default','independent','restored']) {
    await js(`(()=>{
      inputGamepads=[{connected:true,mapping:'standard',index:0,id:'Continuity fixture pad',buttons:[],axes:[]}];
      window.dispatchEvent(new Event('gamepadconnected'));
      if(!inputConsumers.filter(item=>item.spec.kind==='gamepad').every(({actual,sample})=>
        [actual,sample].every(node=>!node.querySelector('#sb-pad').hasAttribute('hidden'))))throw Error('Connected gamepad precondition absent');
    })()`)

    if(phase==='independent') {
      const config=readConfig(resolveConfigPath(process.env))
      entries=signed?await loadNativeRendererPlugins(config,{env:process.env,assets}):loadDevelopmentPlugins(config,{host:'electron-renderer'})
      assert.deepEqual(entries.map(entry=>entry.manifest.id).sort(),specs.map(spec=>spec.id).sort())
      await js(`(async()=>{
        for(const {spec} of inputConsumers) window.odkPlugins.get(spec.id).lifecycle.mount=()=>{throw Error('Default input status delegation refused');};
        const definitions=await window.odkRendererDevelopment.load({runtime:true});if(definitions.length!==2)throw Error('Input entries absent');
        for(const definition of definitions){definition.mount=inputMount(definition.mount,definition.id.split('.').at(-1));await window.odkRendererRuntime.replace(definition);}
      })()`)
    }else if(phase==='restored')for(const spec of specs)await js(`window.odkRendererRuntime.restoreDefault(${JSON.stringify(spec.id)})`)
    assert.equal(await js(active),true,'Input status resource or consumer ownership changed')
    assert.equal(await js(`inputConsumers.filter(item=>item.spec.kind==='gamepad').every(({actual,sample})=>
      [actual,sample].every(node=>!node.querySelector('#sb-pad').hasAttribute('hidden')
        &&node.querySelector('#sb-pad').getAttribute('aria-label')==='Gamepad connected: Continuity fixture pad'))`),true,'Retained gamepad state was not replayed after selection')

    for(const spec of specs)assert.equal(await js(`window.odkPlugins.get(${JSON.stringify(spec.id)}).manifest.version||'1.0.0'`),phase==='independent'?'2.0.0':'1.0.0')
    const states=[{online:false,pads:[]},{online:true,pads:[]},
      ...['standard','unknown','standard','unknown','standard'].slice(0,5).map((mapping,index)=>({online:true,
        pads:index===2?[]:[{connected:true,mapping,index:0,id:index===4?'Fixture pad 输入':'Fixture pad',buttons:[],axes:[]}]}))]
    for(let index=0;index<states.length;index++) {
      const state=states[index]
      const value=await js(`(()=>{
        inputOnline=${JSON.stringify(state.online)};inputGamepads=${JSON.stringify(state.pads)};
        window.dispatchEvent(new Event(inputOnline?'online':'offline'));window.dispatchEvent(new Event('gamepadconnected'));
        const expected=${JSON.stringify(state.pads.length?state.pads[0].mapping==='standard'?'true':'false':null)};
        const result=inputConsumers.map(({spec,actual,sample})=>{
          const collect=node=>{const indicator=node.querySelector('[role="img"]');return {hidden:indicator.hasAttribute('hidden'),
            online:indicator.dataset.online||null,readable:indicator.dataset.readable||null,aria:indicator.getAttribute('aria-label'),title:indicator.title,
            icons:[...indicator.querySelectorAll('svg')].map(svg=>({name:svg.dataset.tabler,hidden:svg.hasAttribute('hidden')}))};};
          const first=collect(actual),second=collect(sample);
          if(spec.kind==='connection' && first.online!==String(inputOnline))throw Error('Actual reachability event did not reach status');
          if(spec.kind==='gamepad' && (first.hidden!==(expected===null)||expected!==null&&first.readable!==expected))throw Error('Actual gamepad polling did not reach status');
          return {id:spec.id,actual:first,sample:second};
        });return result;
      })()`)
      for(const item of value)assert.deepEqual(item.actual,item.sample)
      if(phase==='default')stateBaseline.push(value);else assert.deepEqual(value,stateBaseline[index])
    }
    let index=0
    for(const theme of ['instrument','pixel','border-beam'])for(const [size,width,height] of [[168,320,480],[292,960,640],[400,1920,1280]]) {
      win.setContentSize(width,height)
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
      })
      await js(`window.odkTheme.set(${JSON.stringify(theme)})`)
      const views=await js(`(async()=>{
        for(const {sample} of inputConsumers)sample.style.cssText='position:fixed;display:flex;left:0;top:0;width:${size}px;height:44px;align-items:center';
        await Promise.all([document.fonts.load('700 32px "Montserrat"'),document.fonts.load('400 16px "Noto Sans SC"'),document.fonts.load('400 16px "Zpix"')]);
        await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(innerWidth!==${width}||innerHeight!==${height}||devicePixelRatio!==1||visualViewport.scale!==1||document.fonts.status!=='loaded'
          ||document.documentElement.dataset.theme!==${JSON.stringify(theme)})throw Error('Input measurement controls changed');
        const tree=node=>({tag:node.tagName,attributes:[...node.attributes].map(attr=>[attr.name,attr.value]).sort(([a],[b])=>a.localeCompare(b)),
          text:node.childElementCount?null:node.textContent.trim(),children:[...node.children].map(tree)});
        return inputConsumers.map(({spec,actual,sample})=>{
          const collect=container=>{const node=container.querySelector('[role="img"]'),frame=(container===sample?container:container.closest('#status-bar')).getBoundingClientRect(),box=node.getBoundingClientRect(),style=getComputedStyle(node);
            if(box.width<=0||box.height<=0||box.left<frame.left||box.right>frame.right+0.1||box.top<frame.top||box.bottom>frame.bottom+0.1)throw Error('Input indicator clipped or absent: '+JSON.stringify({id:spec.id,sample:container===sample,hidden:node.hasAttribute('hidden'),display:style.display,frame:frame.toJSON(),box:box.toJSON()}));
            return {markup:tree(node),width:box.width,height:box.height,left:box.left-frame.left,top:box.top-frame.top,color:style.color,
              display:style.display,opacity:style.opacity,font:style.fontFamily};};
          return {id:spec.id,actual:collect(actual),sample:collect(sample)};
        });
      })()`)
      if(phase==='default')baseline.push(views);else assert.deepEqual(views,baseline[index]);index++
    }
    for(const spec of specs){
      await js(`window.odkRendererRuntime.setEnabled(${JSON.stringify(spec.id)},false)`)
      assert.equal(await js(spec.kind==='connection'?'inputConnections.size':'inputPads.size'),0)
      await js(`window.odkRendererRuntime.setEnabled(${JSON.stringify(spec.id)},true)`)
      await js(`inputConsumers.find(item=>item.spec.id===${JSON.stringify(spec.id)}).actual=document.querySelector(${JSON.stringify(spec.selector)})`)
      assert.equal(await js(active),true,'Input status resource or consumer ownership changed')
      if(spec.kind==='gamepad')assert.equal(await js(`!inputConsumers.find(item=>item.spec.kind==='gamepad').actual.querySelector('#sb-pad').hasAttribute('hidden')`),true,'Retained gamepad state was not replayed after enable')
    }
  }
  await js('document.adoptedStyleSheets=document.adoptedStyleSheets.filter(sheet=>sheet!==inputSheet)')
  assert.equal(await js('document.adoptedStyleSheets.includes(inputSheet)'),false)
  await js(`(async () => {
    for (const kind of ['connection', 'gamepad']) {
      const id = 'odk.status.' + kind, service = window.odkServices[kind];
      const selected = kind === 'connection' ? false : { connected: true, readable: false, id: 'Selected controller' };
      const replacement = { labelFor: service.labelFor, snapshot: () => selected,
        subscribe(callback) { callback(selected); return () => {}; } };
      window.odkServices.registerService(kind, replacement);
      await window.odkRendererRuntime.setEnabled(id, false);
      await window.odkRendererRuntime.setEnabled(id, true);
      if (kind === 'connection') {
        if (document.querySelector('#sb-net').dataset.online !== 'false') throw Error('Connection consumer bypassed selected service');
        inputOnline = true; window.dispatchEvent(new Event('online'));
        if (document.querySelector('#sb-net').dataset.online !== 'false') throw Error('Default connection replaced selected reading');
      } else {
        if (document.querySelector('#sb-pad').getAttribute('aria-label') !== 'Gamepad connected, but the desk cannot read it: Selected controller')
          throw Error('Gamepad consumer bypassed selected service');
        inputGamepads = []; window.dispatchEvent(new Event('gamepaddisconnected'));
        if (document.querySelector('#sb-pad').hasAttribute('hidden')) throw Error('Default gamepad replaced selected reading');
      }
      window.odkServices.registerService(kind, service);
      await window.odkRendererRuntime.setEnabled(id, false);
      await window.odkRendererRuntime.setEnabled(id, true);
      if (kind === 'connection' && document.querySelector('#sb-net').dataset.online !== 'true') throw Error('Restored connection state is stale');
      if (kind === 'gamepad' && !document.querySelector('#sb-pad').hasAttribute('hidden')) throw Error('Restored gamepad state is stale');
    }
  })()`)
  await js('window.odkRendererRuntime.stop()')
  assert.deepEqual(await js('[inputConnections.size,inputPads.size]'),[0,0])
  await host.stop()
  assert.equal(ipcMain._invokeHandlers.has('odk-renderer-development-plugins'),false)
  if(signed)assert.equal(protocol.isProtocolHandled('odk-native-plugin'),false)
  assets?.close();if(signed)for(const entry of entries)assert.equal(assets.response({url:entry.entryUrl}).status,410)
  assert.equal(win.isDestroyed(),false,'Authority release must finish while the window remains alive')
  win.webContents.debugger.detach();win.destroy()
  clearTimeout(timeout)
  console.log(JSON.stringify({actualPreload:true,mode:signed?'native':'development',identities:specs.map(spec=>spec.id),documentLoads:loads,
    themes:3,sizes:3,comparisons:36,stateCases:7,lifecycleChanges:12,serviceSelections:4,retainedConsumers:true,restored:true,discoveryReleased:true,assetLeaseReleased:signed}))
  app.quit()
}).catch(error=>{void finish(1,error)})
