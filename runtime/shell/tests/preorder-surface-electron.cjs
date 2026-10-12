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

const signed = process.env.ODK_PREORDER_SURFACE_NATIVE === '1'
const profile = process.env.ODK_PREORDER_SURFACE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
// Keep raster comparisons on one backend; GPU presentation has separate host acceptance.
app.disableHardwareAcceleration()
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
const assets = signed ? createNativeRendererAssets() : null
if (signed) require('../src/user-app-system').registerUserAppScheme(protocol)
let win, host, finishing
const timeout = setTimeout(() => { void finish(1, Error('Pre-order surface acceptance timed out')) }, 45000)
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
  assert.equal(app.isHardwareAccelerationEnabled(), false)
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
    window.preorderTime = ActualDate.UTC(2026,9,9,12);
    window.Date = class extends ActualDate {
      constructor(...args) { super(...(args.length ? args : [window.preorderTime])); }
      static now() { return window.preorderTime; }
    };
    window.preorderTicks = new Set(); window.preorderPaints = new WeakMap();window.preorderPendingImages=new Set();window.preorderDrawInputs=new WeakMap();
    const imageSource=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    Object.defineProperty(HTMLImageElement.prototype,'src',{...imageSource,set(value){
      if(String(value).endsWith('assets/hero-preorder.jpg')) {
        preorderPendingImages.add(this);
        this.addEventListener('load',()=>preorderPendingImages.delete(this),{once:true});
        this.addEventListener('error',()=>preorderPendingImages.delete(this),{once:true});
      }
      return imageSource.set.call(this,value);
    }});
    window.observePreorderMount = mount => function(element, context) {
      const previous=window.preorderMounting;window.preorderMounting=true;
      try{return mount.call(this,element,context);}finally{window.preorderMounting=previous;}
    };
    let registry,services;
    Object.defineProperty(window,'odkPlugins',{configurable:true,get(){return registry;},set(value){
      registry=value; const register=value.register;
      value.register=function(definition){
        if(definition.id==='odk.tile.preorder') definition={...definition,mount:observePreorderMount(definition.mount)};
        return register.call(this,definition);
      };
    }});
    Object.defineProperty(window,'odkServices',{configurable:true,get(){return services;},set(value){
      services=value;const onTick=value.onTick;
      value.onTick=function(callback){
        if(!window.preorderMounting)return onTick.call(this,callback);
        preorderTicks.add(callback);const cancel=onTick.call(this,callback);
        return ()=>{cancel();preorderTicks.delete(callback);};
      };
    }});
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(...args) {
      const result = draw.apply(this,args);
      preorderPaints.set(this.canvas,(preorderPaints.get(this.canvas)||0)+1);
      preorderDrawInputs.set(this.canvas,{source:[args[0].naturalWidth,args[0].naturalHeight],crop:args.slice(1),theme:window.odkTheme?.get()});
      return result;
    };
  })()` })
  let loads = 0
  win.webContents.on('did-finish-load', () => { loads++ })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  win.webContents.setZoomFactor(1)
  const js = code => win.webContents.executeJavaScript(code)
  await js('window.odkShellReady')
  assert.equal(await js('preorderTicks.size'), 1)
  await js(`(() => {
    window.preorderDocument=document;
    window.preorderPeer=document.querySelector('[data-widget="odk.tile.year"]');
    window.preorderDesktop=document.querySelector('[data-widget="odk.tile.preorder"]');
    if(!preorderDesktop)throw Error('Pre-order desktop placement absent');
    document.querySelector('#dots .dot[aria-label$="Reading"]').click();
    const tile=document.createElement('div');tile.id='preorder-acceptance';tile.className=preorderDesktop.className;
    document.body.append(tile);window.preorderTile=tile;
    const sheet=new CSSStyleSheet();
    sheet.replaceSync('#preorder-acceptance,#preorder-acceptance * {transition:none!important;animation:none!important}');
    document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];window.preorderSheet=sheet;
    if(!odkPlugins.activate(odkPlugins.get('odk.tile.preorder'),tile,{onTick:odkServices.onTick}))throw Error('Pre-order comparison mount refused');
    if(preorderTicks.size!==2)throw Error('Initial Pre-order subscriptions absent');
  })()`)
  const baseline = []
  for (const phase of ['default', 'independent', 'restored']) {
    if (phase === 'independent') {
      const config = readConfig(resolveConfigPath(process.env))
      entries = signed ? await loadNativeRendererPlugins(config, { env: process.env, assets })
        : loadDevelopmentPlugins(config, { host: 'electron-renderer' })
      assert.equal(entries.length, 1)
      await js(`(async () => {
        odkPlugins.get('odk.tile.preorder').lifecycle.mount=()=>{throw Error('Default Pre-order delegation refused');};
        const definitions=await odkRendererDevelopment.load({runtime:true});
        if(definitions.length!==1)throw Error('Pre-order entry absent');
        definitions[0].mount=observePreorderMount(definitions[0].mount);
        await odkRendererRuntime.replace(definitions[0]);
      })()`)
    } else if (phase === 'restored') await js("odkRendererRuntime.restoreDefault('odk.tile.preorder')")
    assert.equal(await js("odkPlugins.get('odk.tile.preorder').manifest.version||'1.0.0'"), phase === 'independent' ? '2.0.0' : '1.0.0')
    assert.equal(await js('preorderTicks.size'), 2, 'Pre-order subscriptions not retained')
    assert.equal(await js(`document===preorderDocument && preorderTicks.size===2
      && document.querySelector('[data-widget="odk.tile.preorder"]')===preorderDesktop
      && [preorderDesktop,preorderTile].every(node=>odkPlugins.isActive(odkPlugins.get('odk.tile.preorder'),node))`), true)
    await js("odkPlugins.setEnabled('odk.tile.preorder',false)")
    assert.equal(await js('preorderTicks.size'), 0)
    await js("odkPlugins.setEnabled('odk.tile.preorder',true)")
    assert.equal(await js('preorderTicks.size'), 2)
    assert.equal(await js("document.querySelector('[data-widget=\"odk.tile.year\"]')===preorderPeer && odkPlugins.isActive(odkPlugins.get('odk.tile.year'),preorderPeer)"), true)
    let index = 0
    for (const theme of ['instrument', 'pixel', 'border-beam']) for (const [width, height, size] of [[320,480,186],[960,640,292],[1920,1280,400]]) {
      win.setContentSize(width, height)
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
      })
      await js(`(async()=>{
        const until=performance.now()+4000;
        while(innerWidth!==${width}||innerHeight!==${height}||window.__odkGrid?.width!==${width}||window.__odkGrid?.height!==${height}) {
          if(performance.now()>until)throw Error('Shell geometry did not reach the Pre-order viewport');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
      })()`)
      // A distinct preceding theme forces the existing theme-driven image draw after layout changes.
      await js(`(async()=>{
        preorderTile.style.cssText='position:fixed;left:0;top:0;width:${size}px;height:${size}px;--cell-dim:${size}px;--odk-widget-inset:clamp(16px,calc(var(--cell-dim)*0.08),28px)';
        const until=performance.now()+4000;
        while(preorderPendingImages.size) {
          if(performance.now()>until)throw Error('Pending Pre-order image did not settle');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        for(const selected of [${JSON.stringify(theme === 'instrument' ? 'pixel' : 'instrument')},${JSON.stringify(theme)}]) {
          if(odkTheme.get()===selected)continue;
          const canvases=[preorderDesktop,preorderTile].map(node=>node.querySelector('canvas'));
          const before=canvases.map(canvas=>preorderPaints.get(canvas)||0);
          odkTheme.set(selected);
          while([...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>!link.sheet)) {
            if(performance.now()>until)throw Error('Pre-order theme stylesheet did not load');
            await new Promise(resolve=>setTimeout(resolve,10));
          }
          await Promise.all([document.fonts.load('700 32px "Montserrat"'),document.fonts.load('400 16px "Noto Sans SC"'),document.fonts.load('400 16px "Zpix"')]);
          await document.fonts.ready;
          // Static comparisons drive the observed callbacks; later countdown checks use the actual shared timer.
          for(const callback of preorderTicks)callback(new Date());
          while(preorderPendingImages.size||canvases.some((canvas,i)=>(preorderPaints.get(canvas)||0)<=before[i])) {
            if(performance.now()>until)throw Error('Pre-order theme draw did not complete');
            await new Promise(resolve=>setTimeout(resolve,10));
          }
        }
      })()`)
      const view = await js(`(async()=>{
        await Promise.all([document.fonts.load('700 32px "Montserrat"'),document.fonts.load('400 16px "Noto Sans SC"'),document.fonts.load('400 16px "Zpix"')]);
        await document.fonts.ready;
        if(innerWidth!==${width}||innerHeight!==${height}||devicePixelRatio!==1||visualViewport.scale!==1
          ||document.fonts.status!=='loaded'||document.documentElement.dataset.theme!==${JSON.stringify(theme)})throw Error('Pre-order measurement inputs changed');
        const values=[];
        for(const node of [preorderDesktop,preorderTile]) {
          const frame=node.getBoundingClientRect();
          for(const reading of node.querySelectorAll('.preorder-count,.preorder-label,.preorder-num,.preorder-unit')) {
            const box=reading.getBoundingClientRect(),style=getComputedStyle(reading);
            if(box.width<=0||box.height<=0||parseFloat(style.fontSize)<12||box.left<frame.left-0.1||box.right>frame.right+0.1
              ||box.top<frame.top-0.1||box.bottom>frame.bottom+0.1)throw Error('Pre-order reading is clipped or below its text floor');
          }
          const canvas=node.querySelector('canvas'),figure=node.querySelector('.preorder-figure');
          if(canvas.width!==Math.round(figure.clientWidth)||canvas.height!==Math.round(figure.clientHeight))throw Error('Pre-order canvas does not fit its figure: '+JSON.stringify({sample:node===preorderTile,canvas:[canvas.width,canvas.height],figure:[figure.clientWidth,figure.clientHeight],theme:document.documentElement.dataset.theme}));
          const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
          if(!data.some((value,i)=>i%4===3&&value>0))throw Error('Pre-order canvas is empty');
          if(${JSON.stringify(theme)}==='pixel')for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {
            const origin=(Math.floor(y/4)*4*canvas.width+Math.floor(x/4)*4)*4,offset=(y*canvas.width+x)*4;
            for(let channel=0;channel<4;channel++)if(data[offset+channel]!==data[origin+channel])throw Error('Pre-order Pixel block is not uniform');
          }
          const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(value=>value.toString(16).padStart(2,'0')).join('');
          values.push({text:node.querySelector('.preorder-count').textContent,width:canvas.width,height:canvas.height,digest,draw:preorderDrawInputs.get(canvas)});
        }
        return values;
      })()`)
      if (phase === 'default') baseline.push(view)
      else assert.deepEqual(view, baseline[index], 'Pre-order comparison: '+phase+'/'+theme+'/'+size)
      index++
    }
    for (const [time, expected] of [[Date.UTC(2026,9,16,12),'Open now'],[Date.UTC(2026,9,9,12),'7d0h']]) {
      await js(`(async()=>{
        preorderTime=${time};const until=performance.now()+3000;
        while([preorderDesktop,preorderTile].some(node=>node.querySelector('.preorder-count').textContent!==${JSON.stringify(expected)})) {
          if(performance.now()>until)throw Error('Shared Tick did not update Pre-order consumers');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
      })()`)
    }
  }
  await js('document.adoptedStyleSheets=document.adoptedStyleSheets.filter(sheet=>sheet!==preorderSheet)')
  assert.equal(await js('document.adoptedStyleSheets.includes(preorderSheet)'), false)
  await js('odkRendererRuntime.stop()')
  assert.equal(await js('preorderTicks.size'), 0)
  await host.stop()
  assert.equal(win.isDestroyed(), false)
  assert.equal(ipcMain._invokeHandlers.has('odk-renderer-development-plugins'), false)
  if (signed) assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
  assets?.close()
  if (signed) assert.equal(assets.response({ url: entries[0].entryUrl }).status, 410)
  win.webContents.debugger.detach()
  win.destroy()
  clearTimeout(timeout)
  console.log(JSON.stringify({ actualPreload: true, mode: signed ? 'native' : 'development', documentLoads: loads,
    themes: 3, sizes: 3, comparisons: 18, sharedTickUpdates: 6, retainedDesktop: true, canvasPixels: true, actualViewports: 3, enableCycles: 3, softwareRaster: true,
    restored: true, discoveryReleased: true, assetLeaseReleased: signed }))
  app.quit()
}).catch(error => { void finish(1, error) })
