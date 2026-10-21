'use strict'

const { app, BrowserWindow, ipcMain, session, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const { resolveConfigPath } = require('../src/plugin-config')
const root = process.env.ODK_DASHBOARD_MAIN_ROOT
assert.ok(root && path.isAbsolute(root), 'Dashboard acceptance requires private parent-owned state')
assert.notEqual(process.platform, 'win32', 'Dashboard acceptance requires private Unix listeners')
const mode = process.env.ODK_DASHBOARD_MAIN_MODE
if (process.platform === 'linux') app.disableHardwareAcceleration()
app.setPath('userData', path.join(root, 'profile'))
app.setPath('sessionData', path.join(root, 'profile'))
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
require('./helpers/app-manager-composition-isolation').isolateComposition(root)
// Injected frames own this comparison; an absent transport must not publish reconnect states over them.
const botModule = require('../src/personal-bot-client')
const createBot = botModule.createPersonalBotClient
let botClients = 0
botModule.createPersonalBotClient = options => {
  botClients++
  return createBot({ ...options, socketPath: null })
}
const configPath = resolveConfigPath(process.env)
const selectedConfiguration = fs.readFileSync(configPath)
if (mode !== 'signed') {
  const config = JSON.parse(selectedConfiguration)
  delete config.plugins['odk.page.dashboard'].native
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
const deadline = setTimeout(() => { void fail(Error(`Dashboard production acceptance timed out at ${stage}`)) }, 40000)
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
    await this.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1280, deviceScaleFactor: 1, mobile: false,
    })
    this.webContents.setZoomFactor(1)
    await this.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const ActualDate=Date;
      window.dashboardFixedTime=new ActualDate(2026,0,1,12,34).getTime();
      window.Date=class extends ActualDate {
        constructor(...args){super(...(args.length?args:[window.dashboardFixedTime]));}
        static now(){return window.dashboardFixedTime;}
      };
      window.dashboardTickOwners=0; window.dashboardTickAcquisitions=0;
      window.dashboardBriefingOwners=0; window.dashboardBriefingAcquisitions=0;
      let services;
      Object.defineProperty(window,'odkServices',{configurable:true,enumerable:true,
        get(){return services},set(value){
          const subscribe=value.onTick;
          value.onTick=callback=>{
            const cancel=subscribe.call(value,callback);
            window.dashboardTickOwners++; window.dashboardTickAcquisitions++;
            let released=false;
            return ()=>{if(released)return;cancel();released=true;window.dashboardTickOwners--;};
          };
          const homeSubscribe=value.homeBriefing.subscribe;
          value.homeBriefing.subscribe=callback=>{
            const cancel=homeSubscribe.call(value.homeBriefing,callback);
            window.dashboardBriefingOwners++; window.dashboardBriefingAcquisitions++;
            let released=false;
            return ()=>{if(released)return;cancel();released=true;window.dashboardBriefingOwners--;};
          };services=value;
        }
      });
    })()` })
    stage = 'load-document'
    return await loadFile.apply(this, args)
  } catch (error) { await fail(error) }
}
app.on('browser-window-created', (_event, window) => {
  assert.equal(win, undefined, 'Dashboard fixture requires one Shell window')
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
  const js = async source => {
    const result = await win.webContents.executeJavaScript(`(async()=>{
      try { return {ok:true,value:await (${source})}; }
      catch(error) { return {ok:false,message:String(error?.message||error).slice(0,512)}; }
    })()`)
    if (!result.ok) throw Error(result.message)
    return result.value
  }
  await js('window.odkShellReady')
  stage = 'initial-state'
  assert.equal(win.isVisible(), false)
  assert.equal(win.webContents.isOffscreen(), true)
  assert.equal(botClients, 1)
  assert.ok(host.list().every(plugin => plugin.enabled && plugin.state === 'running'))
  assert.equal(await js("odkPlugins.get('odk.page.dashboard').manifest.version || '1.0.0'"), mode === 'signed' ? '2.0.0' : '1.0.0')
  assert.equal(await js("odkAppPlatform.openApp({appId:'year'})"), true)
  await js(`(()=>{window.dashboardDocument=document;
    window.dashboardPlacement=document.querySelector('[data-plugin="odk.page.dashboard"]');
    window.dashboardForeground=document.querySelector('#app-runtime').firstElementChild;
    window.dashboardPeerNodes=[...document.querySelectorAll('[data-widget], [data-status-plugin]')].filter(node=>node!==dashboardPlacement);
    window.dashboardPageContext=document.querySelector('#page-context').textContent;
    if(!dashboardPlacement||dashboardTickOwners<=0||dashboardTickAcquisitions<=0||dashboardBriefingOwners<=0||dashboardBriefingAcquisitions<=0)throw Error('Dashboard acquisition observation missing');})()`)
  const peerPorts = host.list().flatMap(plugin => plugin.manifest.provides.map(port => [port.interface, host.get(port.interface)]))
  const managerState = host.get('odk:system/app-manager/v1').captureState()
  const subscriptions = await js('dashboardTickOwners')
  const briefingSubscriptions = await js('dashboardBriefingOwners')
  const baseline = []
  const source = { id: 'desk', label: 'Desk readings', state: 'live', updatedAt: 1767270840000 }
  const item = segments => ({ text: segments.map(segment => segment.text).join(''), segments, sources: [source] })
  const facts = [item([{text:'Weather 25°C. ',icon:'weather'},{text:'3 active sessions. ',icon:'sessions'},
    {text:'+1.23% Futu holdings.',icon:'portfolio'}])]
  const frame = (state, items=[], omittedSources=0) => ({state,items,generatedAt:1767270840000,omittedSources})
  const frames = [frame('empty'),frame('unavailable'),frame('error'),frame('live',facts),frame('loading',facts),
    frame('stale',facts),frame('live',[item([{text:'-100.00% Futu holdings.',icon:'portfolio'}])]),
    frame('live',[item([{text:'0.00% Futu holdings.',icon:'portfolio'}])]),
    frame('live',[{text:'<img src=x onerror=alert(1)> 中文 remains literal.',sources:[source]}]),frame('empty',[],2)]
  async function measure(theme) {
    stage = `measure-${theme}`
    await js(`odkTheme.set(${JSON.stringify(theme)})`)
    const views=[]
    for (const current of frames) {
      win.webContents.send('odk-personal-bot-status',{state:'idle',message:'',briefing:current})
      views.push(await js(`(async()=>{
        const expected=${JSON.stringify(current)},until=performance.now()+3000;
        while(JSON.stringify(odkServices.homeBriefing.snapshot())!==JSON.stringify(expected)){
          if(performance.now()>until)throw Error('Dashboard controlled briefing did not reach the public service');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        const sheet=new CSSStyleSheet();
        sheet.replaceSync('[data-plugin="odk.page.dashboard"], [data-plugin="odk.page.dashboard"] * {transition:none!important;animation:none!important}');
        document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];
        try {
          await Promise.all([document.fonts.load('700 32px "Montserrat"'),document.fonts.load('400 28px "Montserrat"'),document.fonts.load('400 16px "Noto Sans SC"'),document.fonts.load('400 16px "Zpix"')]);
          await document.fonts.ready;
          if(JSON.stringify(odkServices.homeBriefing.snapshot())!==JSON.stringify(expected))throw Error('Dashboard controlled briefing was displaced during measurement');
          if(devicePixelRatio!==1||visualViewport.scale!==1||innerWidth!==1920||innerHeight!==1280)throw Error('Dashboard measurement inputs changed');
          const narrative=dashboardPlacement.querySelector('#dash-narrative');
          if(!narrative||narrative.querySelector('img,script'))throw Error('Dashboard literal rendering failed');
          if(expected.items.length&&[...narrative.querySelectorAll('[data-briefing]')].map(node=>node.textContent).join(' ')!==expected.items.map(item=>item.text).join(' '))throw Error('Dashboard literal text changed');
          const bounds=narrative.getBoundingClientRect(),box=dashboardPlacement.getBoundingClientRect();
          if(bounds.width<=0||bounds.height<=0||bounds.left<box.left||bounds.right>box.right||bounds.top<box.top||bounds.bottom>box.bottom)throw Error('Dashboard narrative clipped');
          for(const change of dashboardPlacement.querySelectorAll('.dash-change')){
            const value=parseFloat(change.textContent),direction=expected.state==='live'&&value&&/^[+-]/.test(change.textContent)?(value>0?'up':'down'):undefined;
            if(change.dataset.direction!==direction)throw Error('Dashboard portfolio state changed');
          }
          if(dashboardPlacement.querySelector('.dash-foot,details,summary,#dash-agent-status,#dash-source-list'))throw Error('Removed metadata controls returned');
          return [...dashboardPlacement.querySelectorAll('.dash, .dash *')].map(node=>{
            const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
            return {tag:node.tagName,className:node.getAttribute('class')||'',
              text:!node.children.length||node.id==='dash-narrative'?node.textContent:null,
              data:{...node.dataset},hidden:node.hidden,role:node.getAttribute('role'),aria:node.getAttribute('aria-live'),
              paths:node.tagName.toLowerCase()==='svg'?node.innerHTML:null,
              bounds:[rect.x-box.x,rect.y-box.y,rect.width,rect.height],
              font:style.fontFamily,size:style.fontSize,color:style.color,display:style.display};
          });
        } finally {
          document.adoptedStyleSheets=document.adoptedStyleSheets.filter(value=>value!==sheet);
          if(document.adoptedStyleSheets.includes(sheet))throw Error('Dashboard comparison sheet retained');
        }
      })()`))
    }
    return views
  }
  for (const theme of ['instrument', 'pixel', 'border-beam']) baseline.push(await measure(theme))
  fs.writeFileSync(configPath, selectedConfiguration)
  const command = args => runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), ...args],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, maxBuffer: 65536 })
  const versions = []
  let themeComparisons = 0, tickTransitions = 0, frameComparisons = 0
  async function probe(version) {
    versions.push(version)
    assert.equal(await js("odkPlugins.get('odk.page.dashboard').manifest.version || '1.0.0'"), version)
    if (version !== '1.0.0') assert.equal(await js('dashboardExecutedRevision'), version)
    assert.equal(await js('dashboardBriefingOwners'), briefingSubscriptions, 'Dashboard briefing subscription changed')
    assert.equal(await js('dashboardTickOwners'), subscriptions, 'Dashboard Tick subscription changed')
    assert.equal(await js(`document===dashboardDocument&&document.querySelector('[data-plugin="odk.page.dashboard"]')===dashboardPlacement
      &&odkPlugins.isActive(odkPlugins.get('odk.page.dashboard'),dashboardPlacement)&&dashboardPeerNodes.every(node=>node.isConnected)
      &&document.querySelector('#app-runtime').firstElementChild===dashboardForeground&&odkAppPlatform.active()?.appId==='year'
      &&document.querySelector('#page-context').textContent===dashboardPageContext`), true)
    assert.deepEqual(host.get('odk:system/app-manager/v1').captureState(), managerState)
    for (const [name, value] of peerPorts) assert.equal(host.get(name), value)
    let index = 0
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      assert.deepEqual(await measure(theme), baseline[index++]); themeComparisons++; frameComparisons += frames.length
    }
    for (const next of [{year:2027,month:1,day:2,label:'February 2'},{year:2026,month:0,day:1,label:'January 1'}]) {
      await js(`(async()=>{
        dashboardFixedTime=new Date(${next.year},${next.month},${next.day},12,34).getTime();
        const until=performance.now()+3000;
        while(dashboardPlacement.querySelector('#dash-y').textContent!==${JSON.stringify(String(next.year))}){
          if(performance.now()>until)throw Error('Dashboard shared Tick did not update');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
        if(dashboardPlacement.querySelector('#dash-md').textContent!==${JSON.stringify(next.label)})throw Error('Dashboard date format changed');
      })()`)
      tickTransitions++
    }
  }

  const activate = async version => {
    stage = `activate-${version}`
    const saved = fs.readFileSync(configPath)
    const receipt = JSON.parse((await command(['activate', 'odk.page.dashboard', '--runtime'])).stdout)
    assert.equal(receipt.scope, 'electron-renderer')
    assert.equal(receipt.version, version)
    assert.equal(receipt.revision, JSON.parse(saved).plugins['odk.page.dashboard'].native.revision)
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
    const restored = JSON.parse((await command(['restore-default', 'odk.page.dashboard', '--runtime'])).stdout)
    assert.equal(restored.implementation, 'built-in')
    assert.equal(restored.version, '1.0.0')
    assert.deepEqual(fs.readFileSync(configPath), broken)
    assert.deepEqual(fs.readFileSync(policyPath), revoked)
    await probe('1.0.0')
  } finally { fs.writeFileSync(configPath, saved); fs.writeFileSync(policyPath, policy) }
  await activate('2.0.0')
  const updated = JSON.parse((await command(['native', 'update', 'odk.page.dashboard', path.join(root, 'bundle-3.0.0'), '--keyring', policyPath, '--trust'])).stdout)
  assert.equal(updated.effect, 'selection-only')
  await activate('3.0.0')
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await js(`(async()=>{const until=performance.now()+3000;while(odkAppPlatform.active()){
    if(performance.now()>until)throw Error('Dashboard foreground did not close');await new Promise(resolve=>setTimeout(resolve,10));}})()`)
  assert.equal(host.get('odk:system/app-manager/v1').foreground(), null)
  await js('odkRendererRuntime.stop()')
  assert.equal(await js('dashboardTickOwners'), 0)
  assert.equal(await js('dashboardBriefingOwners'), 0)
  report = { productionMain: true, mode, documentLoads: loads, primingLoads, mainPlugins: host.list().length,
    themeComparisons, frameComparisons, tickTransitions, versions, subscriptionsReleased: true }
  win.webContents.debugger.detach()
  app.quit()
}
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report)
    assert.equal(handlers.size, 0)
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
