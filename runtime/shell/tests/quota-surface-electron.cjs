'use strict'

const { app, BrowserWindow, ipcMain, session, protocol } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const { createPluginHost } = require('../src/plugin-host')
const { createRendererDevelopmentPlugin } = require('../src/plugins/renderer-development')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { quotaPagePlacementSource } = require('./helpers/quota-page-placement')
const { loadNativeRendererPlugins } = require('../src/native-plugin-loader')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { createNativeRendererAssets } = require('../src/native-renderer-assets')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const id = 'odk.page.quota'

const live = {state:'available',snapshot:{accounts:[
  {id:'work',provider:'codex',fileName:'Long English 与中文订阅 <safe>.json',account:'fixture@example.test',plan:'Pro',
    resetCredits:{available:2,expiresAt:['2027-01-01T00:00:00Z']},groups:[{title:'Usage 工作配额',description:'Measured windows',quotas:[
      {label:'Weekly',remainingPct:58.4,resetAt:'2027-01-01T00:00:00Z'},
      {label:'<img src=x onerror=alert(1)>',remainingPct:null,resetAt:'provider-time'}]}]},
  {id:'failed',provider:'xai',fileName:'Failed account.json',error:'Fixture account unavailable',groups:[]}
]}}
const signed = process.env.ODK_QUOTA_SURFACE_NATIVE === '1'
const profile = process.env.ODK_QUOTA_SURFACE_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
if (process.platform === 'darwin') app.dock.hide()
const assets = signed ? createNativeRendererAssets() : null
if (signed) require('../src/user-app-system').registerUserAppScheme(protocol)
let win, host, finishing
const timeout = setTimeout(() => { void finish(1, Error('Quota surface acceptance timed out')) }, 50000)
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
    await release()
  })().then(() => app.exit(code), failure => { console.error(failure); app.exit(1) })
  return finishing
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_window, _permission, callback) => callback(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, callback) => callback({ cancel: true }))
  installGeometryFixtures(ipcMain)
  let entries = []
  let status = live
  ipcMain.removeHandler('odk-opencode-go-status')
  ipcMain.handle('odk-opencode-go-status', () => status)
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
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const ActualDate=Date, epoch=new ActualDate(2026,0,1,12,0).getTime();
    window.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:[epoch]))}static now(){return epoch}};
    ${quotaPagePlacementSource}
    let services;
    window.quotaCallbacks=[];window.quotaSubscriptions=new Set();
    Object.defineProperty(window,'odkServices',{configurable:true,get(){return services},set(value){
      services=value;const sub=value.subscription,subscribe=sub.subscribe.bind(sub),refresh=sub.refresh.bind(sub);
      window.realQuotaRefresh=refresh;
      sub.subscribe=callback=>{
        window.quotaCallbacks.push(callback);window.quotaSubscriptions.add(callback);const cancel=subscribe(callback);
        return ()=>{if(window.quotaFailRelease){throw Error('Controlled Quota release failure')}
          cancel();window.quotaSubscriptions.delete(callback)};
      };
      sub.refresh=()=>window.quotaPending?window.quotaPending.promise:window.quotaRejectRefresh?Promise.reject(Error('Controlled refresh rejection')):refresh();
    }});
  })()` })
  let loads = 0
  win.webContents.on('did-finish-load', () => { loads++ })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  win.webContents.setZoomFactor(1)
  const js = code => win.webContents.executeJavaScript(code)
  const settle = () => js(`(async()=>{const deadline=performance.now()+4000;
    while([...document.querySelectorAll('#quota-refresh')].some(node=>node.disabled)){
      if(performance.now()>deadline)throw Error('Quota refresh did not settle');await new Promise(resolve=>setTimeout(resolve,10))}
  })()`)
  await js('window.odkShellReady'); await settle()
  assert.equal(await js('window.quotaSubscriptions.size'), 1)
  await js(`(()=>{
    window.quotaDocument=document;window.quotaActual=document.querySelector('.page[data-page-id="quota"]');
    window.quotaPeer=document.querySelector('[data-widget="odk.tile.year"]');
    const sample=document.createElement('main');sample.id='quota-comparison';sample.className=window.quotaActual.className;
    sample.style.cssText='position:fixed;left:0;top:0;width:100%;height:100%;--odk-app-inset:24px';document.body.append(sample);window.quotaSample=sample;
    if(!window.odkPlugins.activate(window.odkPlugins.get('odk.page.quota'),sample,{subscription:window.odkServices.subscription}))throw Error('Quota comparison mount refused');
    window.quotaContainers=()=>[window.quotaActual,window.quotaSample];
    const sheet=new CSSStyleSheet();sheet.replaceSync('#quota-comparison,#quota-comparison *{transition:none!important;animation:none!important}');
    document.adoptedStyleSheets=[...document.adoptedStyleSheets,sheet];window.quotaSheet=sheet;
  })()`)
  await settle()
  const active = `document===window.quotaDocument&&window.quotaSubscriptions.size===2
    &&document.querySelector('.page[data-page-id="quota"]')===window.quotaActual
    &&document.getElementById('quota-comparison')===window.quotaSample
    &&document.querySelector('[data-widget="odk.tile.year"]')===window.quotaPeer
    &&window.odkPlugins.isActive(window.odkPlugins.get('odk.tile.year'),window.quotaPeer)
    &&window.quotaContainers().every(node=>window.odkPlugins.isActive(window.odkPlugins.get('odk.page.quota'),node))`
  const publish = async value => { status = value; await js('window.realQuotaRefresh()'); await settle() }
  const collect = () => js(`(()=>{
    const tree=node=>({tag:node.tagName,attrs:[...node.attributes].filter(attr=>attr.name!=='open').map(attr=>[attr.name,attr.name==='style'?node.style.cssText:attr.value]).sort(),
      text:[...node.childNodes].filter(child=>child.nodeType===3).map(child=>child.textContent.trim()).filter(Boolean).join(''),children:[...node.children].map(tree)});
    return window.quotaContainers().map(container=>{
      if(container.querySelector('img,script'))throw Error('Provider text became executable markup');const button=container.querySelector('#quota-refresh');
      return {tree:tree(container.firstElementChild),disabled:button.disabled,busy:button.getAttribute('aria-busy'),expanded:[...container.querySelectorAll('.provider-details')].map(node=>node.open)};
    });
  })()`)
  const states = [live, { ...live, state: 'unavailable' }, { state: 'unauthorized' }, { state: 'unconfigured' },
    { state: 'available', snapshot: { accounts: [] } }, { state: 'unavailable', reason: 'Fixture transport unavailable' },
    ...[0, 12, 80, null, undefined, NaN, Infinity, -1, 101, '58'].map(value => ({ state: 'available', snapshot: { accounts: [{ ...live.snapshot.accounts[0],
      groups: [{ title: 'Limits', quotas: [{ label: 'Weekly', remainingPct: value, resetAt: null }] }] }] } })),
    { state: 'available', snapshot: { accounts: [{ provider: 'unknown', fileName: 'Empty windows.json', groups: [] }, { provider: 'xai', error: 'Failed without groups' }] } }]
  for (const values of [[0, null, 12, 80], [null, 12, 80]]) states.push({ state: 'available', snapshot: { accounts: [{ ...live.snapshot.accounts[0], groups: [{ title:'Mixed windows', quotas:values.map(remainingPct=>({label:'Window',remainingPct})) }] }] } })
  const displayedWindows = { state: 'available', snapshot: { accounts: [
    { ...live.snapshot.accounts[0], provider: 'codex', plan: 'Pro', groups: [{ title: 'Limits', quotas: [
      { label: '5 hour limit', horizon: 'short', remainingPct: 0 }, { label: 'Weekly limit', horizon: 'long', remainingPct: 80 },
    ] }] },
    { ...live.snapshot.accounts[0], provider: 'antigravity', groups: [{ title: 'Models', quotas: [
      { label: '5 hour limit', horizon: 'short', remainingPct: 80 },
    ] }] },
  ] } }
  states.push(displayedWindows)
  const baseline = []
  for (const phase of ['default', 'independent', 'restored']) {
    await publish(live)
    if (phase === 'independent') {
      const config = readConfig(resolveConfigPath(process.env))
      entries = signed ? await loadNativeRendererPlugins(config, { env: process.env, assets }) : loadDevelopmentPlugins(config, { host: 'electron-renderer' })
      assert.deepEqual(entries.map(entry => entry.manifest.id), [id])
      await js(`(async()=>{
        window.odkPlugins.get('odk.page.quota').lifecycle.mount=()=>{throw Error('Default Quota delegation refused')};
        const definitions=await window.odkRendererDevelopment.load({runtime:true});if(definitions.length!==1)throw Error('Quota entry absent');
        await window.odkRendererRuntime.replace(definitions[0]);
      })()`)
    } else if (phase === 'restored') await js("window.odkRendererRuntime.restoreDefault('odk.page.quota')")
    await settle()
    const version = phase === 'independent' ? '2.0.0' : '1.0.0'
    assert.equal(await js("window.odkPlugins.get('odk.page.quota').manifest.version||'1.0.0'"), version)
    assert.equal(await js(active), true)
    let index = 0
    for (const theme of ['instrument', 'pixel', 'border-beam']) for (const size of [[960, 640], [320, 480]]) {
      win.setContentSize(...size)
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false,
      })
      await js(`window.odkTheme.set(${JSON.stringify(theme)});window.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))`)
      await js(`(async()=>{await Promise.all([document.fonts.load('700 32px "Montserrat"'),document.fonts.load('400 16px "Noto Sans SC"'),document.fonts.load('400 16px "Zpix"')]);await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))})()`)
      const geometry = await js(`(()=>{try{
        if(innerWidth!==${size[0]}||innerHeight!==${size[1]}||devicePixelRatio!==1||visualViewport.scale!==1||document.fonts.status!=='loaded'||document.documentElement.dataset.theme!==${JSON.stringify(theme)})throw Error('Quota measurement inputs changed');
        return window.quotaContainers().map(container=>{
          const card=container.querySelector('.quota-card'),bounds=card.getBoundingClientRect();if(bounds.width<=0||bounds.height<=0)throw Error('Quota geometry absent');
          card.scrollTop=card.scrollHeight;if(card.lastElementChild.getBoundingClientRect().bottom>bounds.bottom+1)throw Error('Quota last account unreachable');card.scrollTop=0;
          return [...container.querySelectorAll('#quota-refresh,.provider-quota-value,.provider-quota-account')].map(node=>{
            const box=node.getBoundingClientRect(),style=getComputedStyle(node);
            if(box.width<=0||box.height<=0||box.left<bounds.left-1||box.right>bounds.right+1)throw Error('Quota reading outside surface');
            if(parseFloat(style.fontSize)<14)throw Error('Quota reading below type floor');
            return {text:node.textContent,width:box.width,height:box.height,left:box.left-bounds.left,top:box.top-bounds.top,font:style.fontFamily,size:style.fontSize,color:style.color};
          });
        });
      }catch(error){return {error:error.message}}})()`)
      assert.ok(!geometry.error, JSON.stringify({size,theme,geometry}))
      const view = await collect()
      if (phase === 'default') baseline.push({ geometry, view })
      else assert.deepEqual({ geometry, view }, baseline[index])
      index++
    }
    const observed = []
    for (const value of states) {
      await publish(value); observed.push(await collect())
      const expected = value === displayedWindows ? ['80', '80'] : (value.snapshot?.accounts || []).filter(account=>!account.error)
        .flatMap(account=>account.groups.flatMap(group=>group.quotas)).filter(quota=>Number.isFinite(quota.remainingPct)&&quota.remainingPct>=0&&quota.remainingPct<=100).map(quota=>String(quota.remainingPct))
      assert.deepEqual(await js("window.quotaContainers().map(node=>[...node.querySelectorAll('[role=\"meter\"]')].map(meter=>meter.getAttribute('aria-valuenow')))"), [expected,expected])
      if (value === displayedWindows) {
        const expectedStates = ['Available', 'Quota unknown']
        assert.deepEqual(await js("window.quotaContainers().map(node=>[...node.querySelectorAll('.provider-quota-availability')].map(state=>state.textContent))"), [expectedStates, expectedStates])
      }
    }
    if (phase === 'default') baseline.push(observed)
    else assert.deepEqual(observed, baseline[6])
    await publish(live)
    await js("window.quotaContainers().forEach(node=>node.querySelector('.provider-details').open=true);window.quotaActual.querySelector('summary').focus()")
    const changed = structuredClone(live); changed.snapshot.accounts[0].groups[0].quotas[0].remainingPct = 37
    await publish(changed)
    assert.equal(await js("document.activeElement===window.quotaActual.querySelector('summary')&&window.quotaContainers().every(node=>node.querySelector('.provider-details').open)"), true)
    await js("window.quotaSample.querySelector('summary').focus()"); await publish(live)
    assert.equal(await js("document.activeElement===window.quotaSample.querySelector('summary')"), true)
    await js(`window.quotaPending={};window.quotaPending.promise=new Promise(resolve=>window.quotaPending.resolve=resolve);window.quotaContainers().forEach(node=>node.querySelector('#quota-refresh').click())`)
    assert.equal((await collect()).every(view => view.disabled && view.busy === 'true'), true)
    assert.equal(await js("window.quotaContainers().every(node=>node.querySelector('#quota-feedback').textContent==='Refreshing quotas…'&&node.querySelector('.provider-quota-value').textContent==='58%')"), true)
    await js('window.quotaPending.resolve();window.quotaPending=null'); await settle()
    await js("window.quotaRejectRefresh=true;window.quotaContainers().forEach(node=>node.querySelector('#quota-refresh').click())"); await settle()
    assert.equal(await js("window.quotaContainers().every(node=>node.querySelector('#quota-feedback').textContent.startsWith('Refresh failed.')&&node.querySelector('.provider-quota-value').textContent==='58%')"), true)
    await js('window.quotaRejectRefresh=false'); await publish(live)
    await js("(()=>{window.quotaKeyboardRefresh=false;const button=window.quotaActual.querySelector('#quota-refresh');button.addEventListener('click',event=>{window.quotaKeyboardRefresh=event.isTrusted},{once:true});button.focus()})()")
    assert.equal(await js("document.activeElement===window.quotaActual.querySelector('#quota-refresh')"), true)
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {type:'char',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'})
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await js(`(async()=>{const deadline=performance.now()+2000;while(!window.quotaKeyboardRefresh){if(performance.now()>deadline)throw Error('Keyboard refresh did not activate');await new Promise(resolve=>setTimeout(resolve,10))}})()`)
    await settle()
    await js(`window.quotaPending={};window.quotaPending.promise=new Promise(resolve=>window.quotaPending.resolve=resolve);window.quotaContainers().forEach(node=>node.querySelector('#quota-refresh').click());
      window.quotaOld=window.quotaContainers().map(node=>({button:node.querySelector('#quota-refresh'),metrics:node.querySelector('#quota-metrics')}));window.quotaFailRelease=true;`)
    await js("window.odkRendererRuntime.setEnabled('odk.page.quota',false).catch(()=>{})")
    assert.equal(await js("window.odkPlugins.catalog().find(record=>record.manifest.id==='odk.page.quota').state"), 'cleanup-failed')
    assert.equal(await js('window.quotaSubscriptions.size'), 2)
    assert.equal(await js("window.odkPlugins.activate(window.odkPlugins.get('odk.page.quota'),document.createElement('main'),{subscription:window.odkServices.subscription})"), false)
    await js('window.quotaFailRelease=false')
    await js("window.odkRendererRuntime.setEnabled('odk.page.quota',false)")
    assert.equal(await js('window.quotaSubscriptions.size'), 0)
    await js(`window.quotaOld.forEach(record=>{record.before=record.metrics.innerHTML;record.buttonBefore=record.button.outerHTML});window.quotaCallbacks.forEach(callback=>callback({state:'unauthorized'}));window.quotaPending.resolve();window.quotaPending=null;`)
    await js('new Promise(resolve=>queueMicrotask(resolve))')
    assert.equal(await js('window.quotaOld.every(record=>record.metrics.innerHTML===record.before&&record.button.outerHTML===record.buttonBefore)'), true)
    await js("window.odkRendererRuntime.setEnabled('odk.page.quota',true).then(()=>{window.quotaActual=document.querySelector('.page[data-page-id=\"quota\"]')})")
    await settle()
    assert.equal(await js(active), true)
    assert.equal(await js("window.odkPlugins.get('odk.page.quota').manifest.version||'1.0.0'"), version)
    await js(`(async () => {
      const services = window.odkServices;
      window.quotaSelectedOriginal = services.subscription;
      window.quotaSelectedCallbacks = new Set();
      window.quotaSelectedRefreshes = 0;
      const reading = ${JSON.stringify(live)};
      reading.snapshot.accounts[0].groups[0].quotas[0].remainingPct = 23;
      const selected = {
        status: () => reading,
        lastCheck: () => 'Selected subscription checked',
        refresh: async () => { window.quotaSelectedRefreshes++; return reading; },
        subscribe(callback) {
          window.quotaSelectedCallbacks.add(callback); callback(reading);
          return () => window.quotaSelectedCallbacks.delete(callback);
        },
      };
      services.registerService('subscription', selected);
      ${process.env.ODK_QUOTA_SERVICE_BYPASS === '1' ? "Object.defineProperty(services, 'subscription', { get: () => window.quotaSelectedOriginal });" : ''}
      await window.odkRendererRuntime.setEnabled('odk.page.quota', false);
      await window.odkRendererRuntime.setEnabled('odk.page.quota', true);
      window.quotaActual = document.querySelector('.page[data-page-id="quota"]');
    })()`)
    await settle()
    assert.equal(await js(`window.quotaSelectedCallbacks.size === 1 && window.quotaSelectedRefreshes >= 1
      && window.quotaActual.querySelector('.provider-quota-value').textContent === '23%'
      && window.quotaActual.querySelector('#quota-checked').textContent === 'Selected subscription checked'`), true,
    'Quota consumer bypassed selected subscription service')
    await publish(live)
    assert.equal(await js("window.quotaActual.querySelector('.provider-quota-value').textContent"), '23%',
      'Default subscription overwrote selected Quota reading')
    const refreshes = await js('window.quotaSelectedRefreshes')
    await js("window.quotaActual.querySelector('#quota-refresh').click()")
    await settle()
    assert.equal(await js('window.quotaSelectedRefreshes'), refreshes + 1)
    assert.equal(await js('window.quotaSubscriptions.size'), 1, 'Comparison retains its explicit default service')
    await js(`(async () => {
      await window.odkRendererRuntime.setEnabled('odk.page.quota', false);
      if (window.quotaSelectedCallbacks.size) throw Error('Selected Quota subscription leaked');
      window.odkServices.registerService('subscription', window.quotaSelectedOriginal);
      await window.odkRendererRuntime.setEnabled('odk.page.quota', true);
      window.quotaActual = document.querySelector('.page[data-page-id="quota"]');
    })()`)
    await settle()
    assert.equal(await js(active), true)
    assert.equal(await js("window.quotaActual.querySelector('.provider-quota-value').textContent"), '58%')
  }
  await js('document.adoptedStyleSheets=document.adoptedStyleSheets.filter(sheet=>sheet!==window.quotaSheet)')
  assert.equal(await js('document.adoptedStyleSheets.includes(window.quotaSheet)'), false)
  await js('window.odkRendererRuntime.stop()')
  assert.equal(await js('window.quotaSubscriptions.size'), 0)
  win.webContents.debugger.detach(); win.destroy(); await host.stop(); assets?.close()
  assert.equal(ipcMain._invokeHandlers.has('odk-renderer-development-plugins'), false)
  if (signed) {
    assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
    for (const entry of entries) assert.equal(assets.response({ url: entry.entryUrl }).status, 410)
  }
  clearTimeout(timeout)
  console.log(JSON.stringify({ actualPreload: true, mode: signed ? 'native' : 'development', documentLoads: loads, comparisons: 12, states: states.length,
    retainedConsumers: true, lifecycleRecovery: true, selectedServiceConsumers: 3, subscriptionsReleased: true, discoveryReleased: true, assetLeaseReleased: signed }))
  app.quit()
}).catch(error => { void finish(1, error) })
