'use strict'
const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const vm = require('node:vm')
const { exerciseNavigation } = require('./helpers/app-manager-navigation')
const base = path.resolve(__dirname, '..')
const profile = process.env.ODK_APP_MANAGER_MAIN_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Main acceptance requires a parent-owned private profile')
assert.notEqual(process.platform, 'win32', 'Windows Main acceptance requires private named-pipe isolation')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.getAppPath = () => base
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
const expectedVersion = process.env.ODK_APP_MANAGER_MAIN_VERSION
const liveHandoff = process.env.ODK_APP_MANAGER_MAIN_LIVE === '1'
const rejectHandoff = process.env.ODK_APP_MANAGER_MAIN_REJECT === '1'
const fullComposition = process.env.ODK_APP_MANAGER_MAIN_COMPOSITION === '1'
delete process.env.ODK_DEVICE_GATEWAY_CONFIG
const diagnosticMain = process.env.ODK_DIAGNOSTIC_MAIN_MODE
  ? require('./helpers/diagnostic-main-consumers').prepareDiagnosticMain(process.env.ODK_DIAGNOSTIC_MAIN_MODE) : null
if (diagnosticMain) assert.ok(fullComposition)
const viewVersion = process.env.ODK_BUILTIN_MAIN_VERSION
const desktopVersion = process.env.ODK_INSTALLED_DESKTOP_MAIN_VERSION
if (desktopVersion) {
  assert.ok(fullComposition && ['1.0.0', '2.0.0'].includes(desktopVersion))
  const loadFile = BrowserWindow.prototype.loadFile
  BrowserWindow.prototype.loadFile = async function (...args) {
    await this.loadURL('about:blank')
    this.webContents.debugger.attach('1.3')
    await this.webContents.debugger.sendCommand('Page.enable')
    if (desktopVersion === '2.0.0') await this.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: `(()=>{let original;Object.defineProperty(window,'odkUserAppDesktop',{configurable:true,get(){return original},set(value){
        original=value;value.mount=()=>{throw Error('Default desktop delegation refused')};}})})();`,
    })
    return loadFile.apply(this, args)
  }
}
if (viewVersion) {
  assert.ok(fullComposition && ['1.0.0', '2.0.0'].includes(viewVersion))
  const loadFile = BrowserWindow.prototype.loadFile
  BrowserWindow.prototype.loadFile = async function (...args) {
    await this.loadURL('about:blank')
    this.webContents.debugger.attach('1.3')
    await this.webContents.debugger.sendCommand('Page.enable')
    const source = `(() => {
      const OriginalDate=Date;
      window.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[2026,0,1,12,34]))}static now(){return new OriginalDate(2026,0,1,12,34).getTime()}};
      window.builtinDefaultMounts=0;
      window.builtinAllowDefaults=false;
      if (${viewVersion === '1.0.0'}) return;
      const identities=new Set(['pomodoro','year','app-manager'].map(id=>'odk.app.'+id));
      let registry;
      Object.defineProperty(window,'odkPlugins',{configurable:true,get(){return registry},set(value){
        registry=value;const register=value.register;
        value.register=function(definition){
          if(identities.has(definition.id)){
            const mount=definition.lifecycle?.mount||definition.mount;
            const guarded=function(...args){
              if(!window.builtinAllowDefaults){window.builtinDefaultMounts++;throw Error('Default built-in view delegation refused')}
              return mount.apply(this,args);
            };
            definition={...definition,mount:guarded,lifecycle:{...definition.lifecycle,mount:guarded}};
          }
          return register.call(this,definition);
        };
      }});
    })()`
    new vm.Script(source)
    await this.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source })
    return loadFile.apply(this,args)
  }
}
const isolatedSources = fullComposition
  ? require('./helpers/app-manager-composition-isolation').isolateComposition(path.dirname(profile)) : null
let allowDefault = expectedVersion === '1.0.0'
const { resolveConfigPath } = require('../src/plugin-config')
const configPath = resolveConfigPath(process.env)
let savedConfiguration
if (liveHandoff) {
  savedConfiguration = fs.readFileSync(configPath)
  const startup = JSON.parse(savedConfiguration)
  delete startup.plugins['odk.system.app-manager'].native
  fs.writeFileSync(configPath, JSON.stringify(startup))
}
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(base, 'src/renderer/config/desktop_layout.js'), 'utf8'), layout)
if (!fullComposition) process.env.ODK_DISABLED_PLUGINS += ',' + layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin]).join(',')
const endpointModule = require(path.join(base, 'src/app-manager-endpoint'))
const originalCreate = endpointModule.createAppManagerEndpoint
let defaultConstructions = 0
endpointModule.createAppManagerEndpoint = options => {
  defaultConstructions++
  assert.equal(allowDefault, true, 'Selected independent manager must own construction')
  return originalCreate(options)
}
const hostModule = require(path.join(base, 'src/plugin-host'))
const originalHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  const result = originalHost(options)
  if (options?.capabilities?.['system.app-manager']) host = result
  return result
}
const handlers = new Set()
const handle = ipcMain.handle.bind(ipcMain)
const remove = ipcMain.removeHandler.bind(ipcMain)
ipcMain.handle = (channel, callback) => { handle(channel, callback); handlers.add(channel) }
ipcMain.removeHandler = channel => { remove(channel); handlers.delete(channel) }
let failed = false
let report
const deadline = setTimeout(() => { void fail(Error('APP_MANAGER_MAIN_TIMEOUT')) }, 25000)
async function fail(error) {
  if (failed) return
  failed = true
  clearTimeout(deadline)
  console.error(error)
  try { await host?.stop() } finally { app.exit(1) }
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('did-finish-load', () => {
    if (win.webContents.getURL() === 'about:blank') return
    void (async () => {
      await win.webContents.executeJavaScript('window.odkShellReady')
      assert.ok(host, 'Production Main must construct its Host')
      diagnosticMain?.assertNoFallback()
      assert.equal(win.isVisible(), false)
      const record = host.list().find(plugin => plugin.manifest.id === 'odk.system.app-manager')
      assert.equal(record.state, 'running')
      assert.equal(record.manifest.version, expectedVersion)
      assert.equal(defaultConstructions, expectedVersion === '1.0.0' ? 1 : 0)
      if (fullComposition) {
        const gateway = await win.webContents.executeJavaScript('odkPlatform.getDeviceGateway()')
        assert.equal(gateway.status, 'disconnected', 'Production Shell main frame must pass the device IPC gate without a Bridge service')
        assert.ok(host.list().every(plugin => plugin.enabled && plugin.state === 'running'), 'Every Main plugin must run')
        assert.equal(Object.keys(isolatedSources).length, 6, 'All controlled source boundaries must execute')
        assert.ok(await win.webContents.executeJavaScript('document.querySelectorAll("[data-widget]").length>0'), 'Desktop surfaces must mount')
      } else assert.ok(host.list().filter(plugin => !['odk.system.app-manager', 'odk.system.renderer-development', ...(liveHandoff ? ['odk.system.plugin-control'] : [])].includes(plugin.manifest.id))
        .every(plugin => plugin.state === 'disabled'), 'Unrelated Main plugins must stay disabled')
      if (viewVersion) assert.equal(await win.webContents.executeJavaScript('window.builtinDefaultMounts'), 0,
        'Production built-in fallback guard must initialize before navigation')
      let consumer
      try { consumer = await exerciseNavigation(win, host) }
      catch (error) {
        if (viewVersion && await win.webContents.executeJavaScript('window.builtinDefaultMounts') > 0) {
          throw Error('Production built-in fallback guard triggered')
        }
        throw error
      }
      const builtinViews = viewVersion ? await require('./helpers/builtin-main-consumers').exerciseBuiltinMainViews(win, host,
        { version: viewVersion, configPath }) : null
      const diagnostics = diagnosticMain ? await diagnosticMain.exercise(win, host, configPath) : null
      let installedDesktop
      if (desktopVersion) {
        const js = source => win.webContents.executeJavaScript(source)
        assert.equal(await js('Boolean(window.desktopExternalEntryExecuted)'), desktopVersion === '2.0.0', 'Production desktop entry execution missing')
        assert.equal(await js('odkUserAppDesktopRuntime.catalog()[0].manifest.version'), desktopVersion)
        const wait = expression => js(`(async()=>{const deadline=performance.now()+3000;while(!(${expression})){
          if(performance.now()>deadline)throw Error('Production installed desktop consumer did not settle');
          await new Promise(resolve=>setTimeout(resolve,10));}})()`)
        await wait(`document.querySelectorAll('[data-user-app-id][data-state="ready"]').length===2`)
        assert.equal(await js(`document.querySelector('[data-user-app-id="note"]').dataset.col`), '2')
        assert.equal(await js(`document.querySelector('[data-user-app-id="note"] iframe').getAttribute('sandbox')`), 'allow-scripts')
        assert.equal(await js(`document.querySelector('[data-user-app-id="counter"]').dataset.surface`), 'app')
        const counterFrame = win.webContents.mainFrame.frames.find(frame => frame.url.includes('/counter/'))
        assert.ok(counterFrame, 'Production protocol must load the installed App document')
        await counterFrame.executeJavaScript('counter.click()')
        await js(`window.desktopRetainedDocument=document;window.desktopRetainedCounter=document.querySelector('[data-user-app-id="counter"] iframe');
          window.desktopRetainedClock=document.querySelector('[data-widget="odk.tile.year"]');`)
        assert.equal(await js(`odkAppPlatform.openApp({appId:'year'})`), true)
        await js('window.desktopRetainedForeground=document.querySelector("#app-runtime").firstElementChild')
        const managerState = host.get('odk:system/app-manager/v1').captureState()
        const desktop = await js(`odkUserApps.dispatch({command:'desktop'})`)
        const grid = desktop.pages?.find(page => page.id === 'desk')
        assert.ok(desktop.ok && grid?.columns >= 2 && grid.rows >= 3, `Production grid unavailable: ${JSON.stringify(desktop)}`)
        const moved = { pageId: grid.id, col: '1 / 3', row: String(grid.rows) }
        const outside = { ...moved, col: String(grid.columns + 1) }
        assert.equal((await js(`odkUserApps.dispatch(${JSON.stringify({ command: 'place', appId: 'note', placement: outside })})`)).ok, false)
        assert.equal((await js(`odkUserApps.dispatch(${JSON.stringify({ command: 'place', appId: 'note', placement: moved })})`)).ok, true)
        await wait(`document.querySelector('[data-user-app-id="note"]').dataset.col==='1 / 3'`)
        const retained = async () => {
          assert.equal(await js(`document===desktopRetainedDocument&&desktopRetainedCounter.isConnected&&
            document.querySelector('[data-user-app-id="counter"] iframe')===desktopRetainedCounter&&desktopRetainedClock.isConnected&&
            document.querySelector('#app-runtime').firstElementChild===desktopRetainedForeground`), true)
          assert.equal(await counterFrame.executeJavaScript('counter.textContent'), '1')
          assert.deepEqual(host.get('odk:system/app-manager/v1').captureState(), managerState)
        }
        await retained()
        assert.equal((await js(`odkUserApps.dispatch({command:'remove',appId:'note'})`)).ok, true)
        await wait(`document.querySelector('[data-user-app-id="note"]')===null`)
        await retained()
        const listed = await js('odkUserApps.list()')
        assert.deepEqual(listed.apps.map(app => app.id), ['counter'])
        installedDesktop = { version: desktopVersion, realCatalog: true, retainedAppState: true, foregroundPreserved: true, packageCommands: 2 }
      }
      if (diagnostics) {
        await exerciseNavigation(win, host)
        diagnostics.navigationRechecked = true
      }
      if (liveHandoff) {
        const js = source => win.webContents.executeJavaScript(source)
        fs.writeFileSync(configPath, savedConfiguration)
        const { runCommand } = require('./helpers/hydra-wire-lifecycle')
        const command = args => runCommand(process.execPath, [path.join(base, 'scripts/odk-plugin-cli.js'), ...args],
          { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, maxBuffer: 65536 })
        assert.equal(await js("odkAppPlatform.openApp({appId:'year'})"), true)
        assert.equal((await js("odkPlatform.dispatchIntent({type:'remove-app',appId:'pomodoro'})")).ok, true)
        await js('window.retainedManagerDocument=document; window.retainedClockSurface=document.querySelector("#app-runtime").firstElementChild')
        const before = host.get('odk:system/app-manager/v1').captureState()
        const peers = fullComposition ? host.list().filter(plugin => plugin.manifest.id !== 'odk.system.app-manager') : []
        const peerPorts = peers.flatMap(plugin => plugin.manifest.provides.map(port => [port.interface, host.get(port.interface)]))
        if (fullComposition) await js('window.retainedDesktopNodes=[...document.querySelectorAll("[data-widget], [data-status-plugin], [data-built-by=composer]")]')
        const retained = async () => {
          assert.deepEqual(host.get('odk:system/app-manager/v1').captureState(), before)
          assert.equal(await js('document===retainedManagerDocument && document.querySelector("#app-runtime").firstElementChild===retainedClockSurface && odkAppPlatform.active()?.appId==="year" && !document.querySelector("#app-view").hidden'), true)
          assert.equal((await js("odkPlatform.getAppState('year')")).state, 'running')
          assert.equal((await js("odkPlatform.getAppState('pomodoro')")).state, 'removed')
          assert.deepEqual(fs.readFileSync(configPath), savedConfiguration)
          if (fullComposition) {
            assert.deepEqual(host.list().filter(plugin => plugin.manifest.id !== 'odk.system.app-manager'), peers)
            for (const [name, value] of peerPorts) assert.equal(host.get(name), value)
            assert.equal(await js('retainedDesktopNodes.length>0 && retainedDesktopNodes.every(node=>node.isConnected)'), true)
          }
        }
        allowDefault = rejectHandoff
        if (rejectHandoff) {
          await assert.rejects(command(['activate', 'odk.system.app-manager', '--runtime']), /activation-failed/)
          assert.equal(host.definition('odk.system.app-manager').manifest.version, '1.0.0')
          await retained()
        } else {
          const receipt = JSON.parse((await command(['activate', 'odk.system.app-manager', '--runtime'])).stdout)
          assert.equal(receipt.version, '2.0.0')
          assert.equal(receipt.state, 'running')
          assert.equal(defaultConstructions, 1)
          await retained()
          allowDefault = true
          const restored = JSON.parse((await command(['restore-default', 'odk.system.app-manager', '--runtime'])).stdout)
          assert.equal(restored.version, '1.0.0')
          assert.equal(restored.implementation, 'built-in')
          await retained()
        }
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
        await js(`(async()=>{
          const until=performance.now()+3000;
          while(odkAppPlatform.active()||!document.querySelector('#app-view').hidden){
            if(performance.now()>until)throw Error('Retained foreground did not close');
            await new Promise(resolve=>setTimeout(resolve,10));
          }
        })()`)
        assert.equal(host.get('odk:system/app-manager/v1').foreground(), null)
      }
      await win.webContents.executeJavaScript('window.odkRendererRuntime.stop()')
      if (desktopVersion) assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll("[data-user-app-id]").length'), 0)
      report = { productionMain: true, actualPreload: true, version: record.manifest.version, defaultConstructions,
        hidden: true, consumer, pid: process.pid, ...(fullComposition ? { fullComposition: true, mainPlugins: host.list().length } : {}),
        ...(liveHandoff ? { runtimeHandoff: true, rejected: rejectHandoff } : {}), ...(builtinViews ? { builtinViews } : {}),
        ...(diagnostics ? { diagnostics } : {}), ...(installedDesktop ? { installedDesktop } : {}) }
      app.quit()
    })().catch(fail)
  })
})
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report, 'Navigation acceptance must finish before quitting')
    assert.equal(handlers.size, 0, 'Production Main shutdown must remove its handlers')
    assert.ok(host.list().every(plugin => ['stopped', 'disabled'].includes(plugin.state)))
    if (diagnosticMain) {
      assert.equal(ipcMain.listenerCount('odk-plugin-runtime-report'), 0)
      assert.equal(ipcMain.listenerCount('odk-renderer-control-report'), 0)
      report.diagnostics.listenersReleased = true
    }
    clearTimeout(deadline)
    if (viewVersion) assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
    console.log(JSON.stringify({ ...report, handlersReleased: true, ...(viewVersion ? { protocolReleased: true } : {}) }))
  } catch (error) { console.error(error); app.exit(1) }
})
require(path.join(base, 'src/main'))
