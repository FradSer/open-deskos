'use strict'
const { app, BrowserWindow, ipcMain, protocol, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const { runtime: createManager, CHANNELS } = require('./helpers/app-manager')
const { buildUserAppDocument, USER_APP_CSP } = require('../src/user-app-content')
const { registerUserAppScheme } = require('../src/user-app-system')
const { createPluginHost } = require('../src/plugin-host')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { loadNativeRendererPlugins } = require('../src/native-plugin-loader')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { createNativeRendererAssets } = require('../src/native-renderer-assets')
const profile = process.env.ODK_INSTALLED_DESKTOP_PROFILE, mode = process.env.ODK_INSTALLED_DESKTOP_MODE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile); app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
registerUserAppScheme(protocol)
let win, manager, discovery, assets, finishing, failure = false, apps = [], loads = 0
let discoveryReply, discoveryReadCount = 0
const external = mode.startsWith('development') || mode.startsWith('native')
const timer = setTimeout(() => { void finish(1, Error('Installed desktop acceptance timed out')) }, 45000)
async function finish(code, error) {
  if (finishing) return finishing
  clearTimeout(timer)
  if (error) console.error(error)
  finishing = (async () => {
    try { if (win && !win.isDestroyed()) await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()') }
    finally { win?.destroy(); await manager?.host.stop(); await discovery?.stop(); assets?.close(); protocol.unhandle('odk-user-app') }
  })().then(() => { if (code) app.exit(code); else app.quit() }, failure => { console.error(failure); app.exit(1) })
  return finishing
}
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => done({ cancel: true }))
  session.defaultSession.setPermissionRequestHandler((_win, _permission, done) => done(false))
  installGeometryFixtures(ipcMain)
  ipcMain.removeHandler('odk-user-apps-list')
  ipcMain.handle('odk-user-apps-list', () => failure ? { ok:false, error:'offline' } : { ok:true, apps })
  for (const channel of CHANNELS) ipcMain.removeHandler(channel)
  manager = await createManager({ after() {} }, [], { ipc: ipcMain })
  protocol.handle('odk-user-app', request => {
    const url = new URL(request.url), id = decodeURIComponent(url.pathname.split('/')[1])
    const current = apps.find(app => app.id === id)
    if (!current) return new Response('missing', { status:404 })
    return new Response(buildUserAppDocument({ manifest: current, revision:current.revision,
      html:'<button id="counter">0</button><script>counter.onclick=()=>counter.textContent=Number(counter.textContent)+1</script>' },
    { token:url.searchParams.get('token'), theme:url.searchParams.get('theme') }),
    { headers:{ 'content-type':'text/html', 'content-security-policy':USER_APP_CSP } })
  })
  win = new BrowserWindow({ show:false, width:1920, height:1280, webPreferences:{
    preload:path.resolve(__dirname,'../src/preload.js'), sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false, offscreen:true } })
  win.webContents.setWindowOpenHandler(() => ({ action:'deny' }))
  if (external) {
    const config = readConfig(resolveConfigPath(process.env))
    assets = createNativeRendererAssets()
    const entries = mode.startsWith('native') ? await loadNativeRendererPlugins(config, { env: process.env, assets })
      : loadDevelopmentPlugins(config, { host: 'electron-renderer' })
    assert.equal(entries.length, 1)
    ipcMain.removeHandler('odk-renderer-development-plugins')
    discovery = createPluginHost({ capabilities: { 'system.renderer-development': {
      ipc: ipcMain, protocol, nativeAssets: assets, frames: () => [win.webContents], entries: () => entries,
    } } })
    discovery.register(createRendererDevelopmentPlugin())
    const originalHandle = ipcMain.handle
    if (mode.endsWith('discovery-shutdown')) ipcMain.handle = function(channel, handler) {
      return originalHandle.call(this, channel, channel === 'odk-renderer-development-plugins' ? event => {
        const result = handler(event)
        // Appearance and surface discovery precede the desktop consumer.
        if (++discoveryReadCount === 3) return new Promise(resolve => { discoveryReply = () => resolve(result) })
        return result
      } : handler)
    }
    try { await discovery.start() } finally { ipcMain.handle = originalHandle }
  }
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  let source = ''
  if (external && !mode.endsWith('definition-rejected')) {
    source = `(()=>{let original;Object.defineProperty(window,'odkUserAppDesktop',{configurable:true,get(){return original},set(value){
      original=value;value.mount=()=>{throw Error('Default desktop delegation refused')};}})})();`
  }
  if (mode === 'initial-startup-shutdown') {
    source = `window.desktopInitialMounts=0;window.desktopInitialReleases=0;
      window.odkUserAppDesktopReplacements=[{manifest:{schemaVersion:1,id:'odk.system.user-app-desktop',name:'Gated startup',version:'2.0.0',kind:'system',host:'electron-renderer',
      provides:[{interface:'odk:system/user-app-desktop/v1'}],requires:[],permissions:[]},create(context){
        context.onCleanup(()=>{desktopInitialReleases++});return {ports:{'odk:system/user-app-desktop/v1':{mount(){desktopInitialMounts++;return {refresh(){},dispose(){}}}}},
        start(){return new Promise(resolve=>{window.desktopReleaseGate=resolve})}}}}];`
  } else if (mode === 'independent' || mode === 'wrong-role') {
    source = fs.readFileSync(path.join(__dirname,'fixtures/user-app-desktop-replacement/entry.js'),'utf8')
    if (mode === 'wrong-role') source = source.replace("surface: 'app'", "surface: 'display'")
    source += `\n(() => { let original; Object.defineProperty(window,'odkUserAppDesktop',{
      configurable:true,get(){return original},set(value){original=value;value.mount=()=>{throw Error('Default desktop delegation refused')};}
    }); })();`
  } else if (mode === 'invalid-contract' || mode === 'retained-cleanup' || mode === 'retry-shutdown' || mode === 'retry-startup-shutdown') {
    source = `window.desktopReleaseAttempts=0;window.desktopBadFactoryCreates=0;
      window.odkUserAppDesktopReplacements=[{manifest:{schemaVersion:1,id:'odk.system.user-app-desktop',name:'Controlled candidate',version:'2.0.0',kind:'system',host:'electron-renderer',
      provides:[{interface:'${mode === 'invalid-contract' ? 'odk:system/wrong-desktop/v1' : 'odk:system/user-app-desktop/v1'}'}],requires:[],permissions:[]},
      create(context){desktopBadFactoryCreates++;context.onCleanup(()=>{if(++desktopReleaseAttempts<=2)throw Error('Controlled retained cleanup');${mode === 'retry-shutdown' ? 'if(desktopReleaseAttempts===3)return new Promise(resolve=>{window.desktopReleaseGate=resolve})' : ''}});
        return {ports:{'odk:system/user-app-desktop/v1':{mount(){throw Error('Invalid candidate mount')}}},start(){throw Error('Controlled startup failure')}};
      }}];`
  }
  if (source) await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source})
  win.webContents.on('did-finish-load',()=>{loads++})
  await win.loadFile(path.resolve(__dirname,'../src/renderer/index.html'))
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
  const wait = expression => js(`(async()=>{const until=performance.now()+3000;while(!(${expression})){
    if(performance.now()>until)throw Error('Installed desktop state did not settle');await new Promise(resolve=>setTimeout(resolve,10));}})()`)
  if (mode.endsWith('discovery-shutdown')) {
    await wait('Boolean(window.odkRendererRuntime)')
    assert.equal(discoveryReadCount, 3)
    assert.equal(typeof discoveryReply, 'function')
    await js('odkRendererRuntime.stop()')
    assert.equal(await js('Boolean(window.desktopExternalEntryExecuted)'), false)
    discoveryReply()
    await js('window.odkShellReady')
    assert.equal(await js('Boolean(window.desktopExternalEntryExecuted)'), false)
    assert.equal(await js('odkUserAppDesktopRuntime.catalog()[0].state'), 'registered')
    assert.equal(await js('odkUserAppDesktopRuntime.catalog()[0].manifest.version'), '1.0.0')
    assert.equal(await js("document.querySelectorAll('[data-user-app-id]').length"), 0)
    console.log(JSON.stringify({mode,documentLoads:loads,recoveryDrained:true,released:true}))
    await finish(0)
    return
  }
  if (mode === 'initial-startup-shutdown') {
    await wait('typeof desktopReleaseGate === "function"')
    await js("window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}))")
    await js('desktopReleaseGate()')
    await js('window.odkShellReady')
    assert.equal(await js('desktopInitialMounts'), 0, 'Initial startup mounted after page shutdown')
    await js('odkRendererRuntime.stop()')
    assert.equal(await js('desktopInitialReleases'), 1)
    console.log(JSON.stringify({mode,documentLoads:loads,recoveryDrained:true,released:true}))
    await finish(0)
    return
  }
  await js('window.odkShellReady')
  if (external) assert.equal(await js('window.desktopExternalEntryExecuted'), true, 'External entry execution marker missing')
  if (mode === 'retry-shutdown' || mode === 'retry-startup-shutdown') {
    await js(`(()=>{const create=odkUserAppDesktopPlugins.create;window.desktopRecoveryCreates=0;
      window.desktopRecoveryMounts=0;
      odkUserAppDesktopPlugins.create=(...args)=>{desktopRecoveryCreates++;const service=create(...args);window.desktopRecoveringService=service;
        const mount=service.mount;service.mount=(...options)=>{desktopRecoveryMounts++;return mount(...options)};
        ${mode === 'retry-startup-shutdown' ? 'const start=service.start;service.start=async()=>{await start();await new Promise(resolve=>{window.desktopReleaseGate=resolve})};' : ''}
        return service};
      document.querySelector('#user-app-desktop-notice button').click()})()`)
    await wait('typeof desktopReleaseGate === "function"')
    await js('(()=>{window.desktopShutdownDone=false;window.desktopShutdown=odkRendererRuntime.stop().then(()=>{desktopShutdownDone=true})})()')
    assert.equal(await js('desktopShutdownDone'), false)
    await js('desktopReleaseGate()')
    await js('desktopShutdown')
    assert.equal(await js('desktopRecoveryCreates'), mode === 'retry-shutdown' ? 0 : 1, 'Recovery constructed a service after shutdown began')
    assert.equal(await js('desktopRecoveryMounts'), 0, 'Recovery mounted after shutdown began')
    if (mode === 'retry-startup-shutdown') assert.equal(await js('desktopRecoveringService.catalog()[0].state'), 'stopped')
    assert.equal(await js('desktopBadFactoryCreates'), 1)
    assert.equal(await js("document.querySelectorAll('[data-user-app-id]').length"), 0)
    console.log(JSON.stringify({mode,documentLoads:loads,recoveryDrained:true,released:true}))
    await finish(0)
    return
  }
  if (mode === 'retained-cleanup') {
    assert.equal(await js("document.querySelector('#user-app-desktop-status').dataset.state"),'unavailable')
    assert.equal(await js('desktopReleaseAttempts'),2)
    assert.equal(await js("odkAppPlatform.openApp({appId:'year'})"),true)
    await js('odkAppPlatform.closeApp()')
    await js("document.querySelector('#user-app-desktop-notice button').click()")
  }
  await wait("document.querySelector('#user-app-desktop-status').dataset.state==='ready'")
  assert.equal(await js('odkUserAppDesktopRuntime.catalog()[0].manifest.version'), mode==='independent'||mode==='wrong-role'||external&&!mode.endsWith('definition-rejected')?'2.0.0':'1.0.0')
  if (mode==='invalid-contract') assert.equal(await js('desktopBadFactoryCreates'),0)
  if (mode==='retained-cleanup') assert.equal(await js('desktopReleaseAttempts'),3)
  await js("(()=>{window.installedDocument=document;window.installedBuiltin=document.querySelector('[data-widget=\"odk.tile.year\"]');})()")
  const widget = revision => ({ id:'note',name:'Notes 笔记',version:'1',kind:'widget',revision,placement:{pageId:'reading',col:'4',row:'3'} })
  const counter = { id:'counter',name:'Counter',version:'1',kind:'app',revision:'r1' }
  const update = next => { apps=next;win.webContents.send('odk-user-apps-changed') }
  update([widget('r1'),counter])
  await wait("document.querySelectorAll('[data-user-app-id][data-state=\"ready\"]').length===2")
  assert.equal(await js("document.querySelector('[data-user-app-id=\"counter\"]').dataset.surface"),'app','Installed App surface role changed')
  assert.equal(await js("document.querySelector('[data-user-app-id=\"note\"] iframe').getAttribute('sandbox')"),'allow-scripts')
  assert.equal(await js("document.querySelector('[data-user-app-id=\"note\"] iframe').inert"),true)
  await js("(()=>{window.installedCounter=document.querySelector('[data-user-app-id=\"counter\"] iframe');window.installedOldWidget=document.querySelector('[data-user-app-id=\"note\"] iframe');})()")
  const counterFrame = win.webContents.mainFrame.frames.find(frame=>frame.url.includes('/counter/'))
  await counterFrame.executeJavaScript('counter.click()')
  assert.equal(await js("odkAppPlatform.openApp({appId:'year'})"),true)
  await js("window.installedForeground=document.querySelector('#app-runtime').firstElementChild")
  update([widget('r2'),counter])
  await wait("document.querySelector('[data-user-app-id=\"note\"] iframe')?.dataset.revision==='r2'")
  assert.equal(await js("!installedOldWidget.isConnected&&installedCounter===document.querySelector('[data-user-app-id=\"counter\"] iframe')&&installedBuiltin===document.querySelector('[data-widget=\"odk.tile.year\"]')&&installedForeground===document.querySelector('#app-runtime').firstElementChild"),true)
  assert.equal(await counterFrame.executeJavaScript('counter.textContent'),'1')
  failure=true;update(apps)
  await wait("document.querySelector('#user-app-desktop-status').dataset.state==='unavailable'")
  assert.match(await js("document.querySelector('#user-app-desktop-status').textContent"),/stale/)
  assert.equal(await js("installedCounter===document.querySelector('[data-user-app-id=\"counter\"] iframe')"),true)
  const back = await js("(()=>{const r=document.querySelector('#app-back').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()")
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...back})
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...back})
  await wait("!odkAppPlatform.active()&&document.querySelector('#app-view').hidden")
  for (const theme of ['instrument','pixel','border-beam']) {
    await js(`odkTheme.set(${JSON.stringify(theme)})`)
    assert.equal(await js('installedDocument===document&&installedCounter.isConnected'),true)
    assert.equal(await counterFrame.executeJavaScript('counter.textContent'),'1')
  }
  failure=false;update([widget('r2'),counter])
  await wait("document.querySelector('#user-app-desktop-status').dataset.state==='ready'")
  await js('odkRendererRuntime.stop()')
  assert.equal(await js("document.querySelectorAll('[data-user-app-id]').length"),0)
  assert.equal(await js('odkUserAppDesktopRuntime.catalog()[0].state'),'stopped')
  await manager.host.stop();assert.equal(manager.handlers.size,0)
  if (external) {
    await discovery.stop()
    await assert.rejects(win.webContents.executeJavaScript('odkRendererPluginBridge.list()'))
    assets.close()
    assert.equal(assets.hasEntries(), false)
  }
  console.log(JSON.stringify({mode,documentLoads:loads,actualPreload:true,retainedFrames:true,pointerBack:true,themes:3,released:true}))
  await finish(0)
}).catch(error=>{void finish(1,error)})
