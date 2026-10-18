'use strict'

const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const { resolveConfigPath } = require('../src/plugin-config')
const profile = process.env.ODK_PI_BOOTSTRAP_PROFILE
assert.ok(profile && path.isAbsolute(profile), 'Pi bootstrap requires a private parent-owned profile')
assert.ok(process.env.ODK_PI_MAIN_ROOT && path.isAbsolute(process.env.ODK_PI_MAIN_ROOT), 'Pi composition requires private parent-owned state')
require('./helpers/app-manager-composition-isolation').isolateComposition(process.env.ODK_PI_MAIN_ROOT)
process.env.ODK_LINK_SOCKET = path.join(process.env.ODK_PI_MAIN_ROOT, 'link.sock')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
const version = process.env.ODK_PI_BOOTSTRAP_VERSION
assert.ok(['1.0.0', '2.0.0', '3.0.0'].includes(version))
const signed = version !== '1.0.0'
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), layout)
const surfaces = layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin])
process.env.ODK_DISABLED_PLUGINS += ',' + surfaces.filter(id => id !== 'odk.page.pi-sessions').join(',')
if (signed) {
  const loadFile = BrowserWindow.prototype.loadFile
  BrowserWindow.prototype.loadFile = async function (...args) {
    await this.loadURL('about:blank')
    this.webContents.debugger.attach('1.3')
    await this.webContents.debugger.sendCommand('Page.enable')
    const guard = `(() => {
      window.piPackagedViewMounts = 0;
      let registry;
      Object.defineProperty(window, 'odkPlugins', { configurable: true, get() { return registry; }, set(value) {
        registry = value;
        const register = value.register;
        value.register = function(definition) {
          if (['odk.app.pi-sessions', 'odk.page.pi-sessions'].includes(definition.id)) {
            const mount = definition.lifecycle?.mount || definition.mount;
            const refuse = function (...args) {
              if (!window.piAllowPackagedViewMounts) {
                window.piPackagedViewMounts++; throw Error('Production Pi view called a packaged mount');
              }
              return mount.apply(this, args);
            };
            definition = { ...definition, mount: refuse, lifecycle: { ...definition.lifecycle, mount: refuse } };
          }
          return register.call(this, definition);
        };
      } });
    })()`
    new vm.Script(guard)
    await this.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: guard })
    return loadFile.apply(this, args)
  }
}
const defaults = { sessions: 0, events: 0 }
const blockedLocal = () => { throw Error('Controlled reported sessions must not invoke local or SSH providers') }
const sessionsModule = require('../src/pi-sessions-source')
const createSessions = sessionsModule.createPiSessionsSource
const configureSessions = sessionsModule.createConfiguredPiSessionReader
sessionsModule.createPiSessionsSource = options => {
  defaults.sessions++
  assert.equal(signed, false, 'Signed startup must not construct default Pi Sessions')
  return createSessions({ ...options, scanLocal: blockedLocal, execute: blockedLocal })
}
sessionsModule.createConfiguredPiSessionReader = options => {
  const configured = configureSessions({ ...options, scanLocal: blockedLocal, execute: blockedLocal })
  return { ...configured, read: blockedLocal }
}
const localModule = require('../src/pi-sessions')
localModule.readSessionEvents = blockedLocal
const eventsModule = require('../src/pi-session-events-source')
const createEvents = eventsModule.createPiSessionEventsSource
eventsModule.createPiSessionEventsSource = options => {
  defaults.events++
  assert.equal(signed, false, 'Signed startup must not construct default Pi Events')
  return createEvents({ ...options, readLocal: blockedLocal })
}
const hostModule = require('../src/plugin-host')
const createHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  const result = createHost(options)
  if (options?.capabilities?.['source.pi-sessions']) host = result
  return result
}
const handlers = new Set()
const handle = ipcMain.handle.bind(ipcMain)
const remove = ipcMain.removeHandler.bind(ipcMain)
ipcMain.handle = (channel, handler) => { handle(channel, handler); handlers.add(channel) }
ipcMain.removeHandler = channel => { remove(channel); handlers.delete(channel) }
let report
let failed = false
let stage = 'startup'
const deadline = setTimeout(() => { void fail(Error('PI_MAIN_BOOTSTRAP_TIMEOUT')) }, 45000)
async function fail(error) {
  if (failed) return
  failed = true
  clearTimeout(deadline)
  console.error(`Pi production acceptance failed at ${stage}`)
  console.error(error)
  try { await host?.stop() } finally { app.exit(1) }
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.setBackgroundThrottling(false)
  win.webContents.on('did-finish-load', () => {
    if (win.webContents.getURL() === 'about:blank') return
    void (async () => {
      assert.ok(host)
      stage = 'shell-ready'
      await win.webContents.executeJavaScript('window.odkShellReady')
      if (signed) assert.equal(await win.webContents.executeJavaScript('window.piPackagedViewMounts'), 0,
        'Production Pi default mount guard must execute before startup')
      const names = ['pi-sessions', 'pi-events']
      const executedVersions = names.map(name => {
        const selected = host.list().find(record => record.manifest.id === `odk.source.${name}`)
        assert.equal(selected.state, 'running')
        assert.equal(selected.manifest.version, version)
        const source = host.get(`odk:source/${name}/v1`)
        assert.equal(source.fixtureRevision, signed ? version : undefined)
        return signed ? source.fixtureRevision : selected.manifest.version
      })
      assert.ok(host.list().every(record => record.enabled && record.state === 'running'))
      stage = 'preload-consumers'
      const consumer = await win.webContents.executeJavaScript(`(async () => {
        const sessions = await window.odkPlatform.getPiSessions();
        const events = await window.odkPlatform.getPiSessionEvents({sessionId:'fixture',hostedPi:true});
        if (!sessions.ok || !events.ok) throw Error('Actual preload Pi consumers unavailable');
        return {sessions,events};
      })()`)
      const js = source => win.webContents.executeJavaScript(source)
      stage = 'selected-views'
      const viewVersions = await js("['odk.app.pi-sessions', 'odk.page.pi-sessions'].map(id => odkPlugins.get(id).manifest.version || '1.0.0')")
      assert.deepEqual(viewVersions, [version, version])
      if (signed) {
        assert.deepEqual(await js('window.piExternalExecutions'), { 'odk.app.pi-sessions': 1, 'odk.page.pi-sessions': 1 })
        assert.deepEqual(await js('window.piExternalVersions'), { 'odk.app.pi-sessions': version, 'odk.page.pi-sessions': version })
      }
      const readView = selector => js(`(async () => {
        const deadline = performance.now() + 4000;
        while (true) {
          const root = document.querySelector(${JSON.stringify(selector)});
          const paths = root ? [...root.querySelectorAll('.pi-overview-path')].map(node => node.textContent) : [];
          const events = root?.querySelector('#pi-events-host')?.textContent || '';
          if (paths.length === 1 && events.includes('Reported event')) return { paths, events };
          if (performance.now() > deadline) throw Error('Production Pi view did not receive selected source readings');
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      })()`)
      const viewConsumers = []
      for (const theme of ['instrument', 'pixel', 'border-beam']) {
        stage = `${theme}:page`
        await js(`odkTheme.set(${JSON.stringify(theme)})`)
        assert.equal(await js('document.documentElement.dataset.theme'), theme)
        const page = await readView('.page[data-page-id="pi-sessions"]')
        assert.ok(page.paths[0].includes('/fixture'))
        stage = `${theme}:app`
        assert.equal(await js("odkAppPlatform.openApp({appId:'pi-sessions'})"), true)
        assert.deepEqual(await readView('#app-runtime'), page)
        stage = `${theme}:close`
        await js('odkAppPlatform.closeApp()')
        assert.equal(await js('odkAppPlatform.active()'), null)
        assert.deepEqual(await readView('.page[data-page-id="pi-sessions"]'), page)
        viewConsumers.push(page)
      }
      const defaultViewMounts = await js('window.piPackagedViewMounts || 0')
      assert.equal(defaultViewMounts, 0)
      let runtimeChanges = 0
      if (signed) {
        stage = 'runtime-ownership'
        const configPath = resolveConfigPath(process.env)
        const peerPorts = host.list().flatMap(plugin => plugin.manifest.provides.map(port => [port.interface, host.get(port.interface)]))
        await js(`window.piOriginalDocument = document;
          window.piOriginalPage = document.querySelector('.page[data-page-id="pi-sessions"]');`)
        const saved = fs.readFileSync(configPath)
        const command = args => runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), ...args],
          { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 10000, maxBuffer: 65536 })
        const change = async (action, kind, expectedVersion) => {
          stage = `${action}:${kind}`
          const executions = await js('({...window.piExternalExecutions})')
          const receipt = JSON.parse((await command([action, `odk.${kind}.pi-sessions`, '--runtime'])).stdout)
          assert.equal(receipt.scope, 'electron-renderer')
          assert.equal(receipt.version, expectedVersion)
          assert.deepEqual(fs.readFileSync(configPath), saved)
          assert.equal(await js(`odkPlugins.get('odk.${kind}.pi-sessions').manifest.version || '1.0.0'`), expectedVersion)
          if (action === 'activate') {
            assert.deepEqual(await js('window.piExternalExecutions'), { ...executions,
              [`odk.${kind}.pi-sessions`]: executions[`odk.${kind}.pi-sessions`] + 1 })
            assert.equal(await js(`window.piExternalVersions['odk.${kind}.pi-sessions']`), expectedVersion)
          } else assert.deepEqual(await js('window.piExternalExecutions'), executions)
          assert.equal(await js('document === piOriginalDocument && document.querySelector(\'.page[data-page-id="pi-sessions"]\') === piOriginalPage'), true)
          runtimeChanges++
        }
        const compareViews = async () => {
          let index = 0
          for (const theme of ['instrument', 'pixel', 'border-beam']) {
            await js(`odkTheme.set(${JSON.stringify(theme)})`)
            const page = await readView('.page[data-page-id="pi-sessions"]')
            assert.deepEqual(page, viewConsumers[index++])
            assert.deepEqual(await readView('#app-runtime'), page)
          }
        }
        assert.equal(await js("odkAppPlatform.openApp({appId:'pi-sessions'})"), true)
        await compareViews()
        await js("window.piOwnedAppNode = document.querySelector('#app-runtime').firstElementChild")
        const foreground = host.get('odk:system/app-manager/v1').captureState()
        await assert.rejects(command(['restore-default', 'odk.app.pi-sessions', '--runtime']), /restoration-failed/)
        assert.equal(await js("document.querySelector('#app-runtime').firstElementChild === piOwnedAppNode && odkAppPlatform.active()?.appId === 'pi-sessions'"), true)
        assert.deepEqual(host.get('odk:system/app-manager/v1').captureState(), foreground)
        assert.deepEqual(fs.readFileSync(configPath), saved)
        await compareViews()
        await js('(async () => { await odkAppPlatform.closeApp(); window.piAllowPackagedViewMounts = true })()')
        await change('restore-default', 'app', '1.0.0')
        assert.equal(await js("odkAppPlatform.openApp({appId:'pi-sessions'})"), true)
        await compareViews()
        await js("window.piOwnedAppNode = document.querySelector('#app-runtime').firstElementChild")
        await change('restore-default', 'page', '1.0.0')
        await compareViews()
        assert.equal(await js("document.querySelector('#app-runtime').firstElementChild === piOwnedAppNode"), true)
        await js('window.piAllowPackagedViewMounts = false')
        await change('activate', 'page', version)
        await compareViews()
        assert.equal(await js("document.querySelector('#app-runtime').firstElementChild === piOwnedAppNode"), true)
        await js('odkAppPlatform.closeApp()')
        await js('window.piAllowPackagedViewMounts = false')
        await change('activate', 'app', version)
        assert.equal(await js("odkAppPlatform.openApp({appId:'pi-sessions'})"), true)
        await compareViews()
        await js('odkAppPlatform.closeApp()')
        for (const [name, value] of peerPorts) assert.equal(host.get(name), value)
        assert.equal(await js('window.piPackagedViewMounts'), 0)
      }
      report = { productionMain: true, actualPreload: true, pid: process.pid, version, executedVersions,
        defaultConstructions: defaults, hidden: !win.isVisible(), consumer,
        viewVersions, viewConsumers, defaultViewMounts, themeChecks: viewConsumers.length, mainPlugins: host.list().length, runtimeChanges }
      await win.webContents.executeJavaScript('window.odkRendererRuntime?.stop()')
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
      app.quit()
    })().catch(fail)
  })
})
app.on('will-quit', () => {
  if (failed) return
  try {
    assert.ok(report)
    assert.equal(handlers.has('odk-pi-sessions'), false)
    assert.equal(handlers.has('odk-pi-session-events'), false)
    for (const channel of ['odk-app-manager-list', 'odk-app-manager-state', 'odk-app-manager-intent', 'odk-renderer-development-plugins']) assert.equal(handlers.has(channel), false)
    assert.equal(protocol.isProtocolHandled('odk-native-plugin'), false)
    for (const name of ['odk-link', 'pi-sessions', 'pi-events']) {
      assert.equal(host.list().find(record => record.manifest.id === `odk.source.${name}`).state, 'stopped')
    }
    clearTimeout(deadline)
    console.log(JSON.stringify({ ...report, handlersReleased: true, protocolReleased: true }))
  } catch (error) { console.error(error); app.exit(1) }
})
assert.equal(process.argv.includes('--smoke'), false)
require('../src/main')
