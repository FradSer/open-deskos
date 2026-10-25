'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { createShellOdkData } = require('../src/odk-data')
const mainRequire = createRequire(path.resolve(__dirname, '../src/main.js'))
const userAppRequire = createRequire(path.resolve(__dirname, '../src/user-app-system.js'))

// The wired main process is the seam where the tile, the installed packages and
// the Personal Agent meet. Only the launcher, the display and the store's bytes are
// stood in for: the user-application system that owns the publish handler and
// the catalog hook runs for real, or this file would test nothing.
function deferred() {
  let resolve
  const promise = new Promise(result => { resolve = result })
  return { promise, resolve }
}

function wireShell({ installed = [], host: hostOverride, env = {}, startupError = null, holdCatalogList = false, holdUserAppListen = false, holdOdkDataListen = false, holdNativeDiscovery = false } = {}) {
  env = { ODK_CONFIG_DIR: '/fixture/absent-plugin-config', ...env }
  const handlers = new Map()
  const frameEvents = new Map()
  const frameMessages = []
  const servicePushes = []
  const windowLoaded = deferred()
  let onHydraUpdate
  let mainCapabilities
  const hydraConnector = () => { throw Error('Controlled connector must not run during wiring inspection') }
  const odkLinkTransport = () => { throw Error('Controlled transport must not run during wiring inspection') }
  const win = { webContents: { setWindowOpenHandler() {}, on() {}, once: (event, callback) => frameEvents.set(event, callback), send: (...args) => frameMessages.push(args) }, loadFile(file, options) { win.loaded = true; win.loadOptions = options; windowLoaded.resolve() }, once() {} }
  const appListeners = new Map()
  const listen = (event, handler, once = false) => {
    const listeners = appListeners.get(event) || []
    listeners.push({ handler, once })
    appListeners.set(event, listeners)
  }
  const emit = (event, ...args) => {
    if (event === 'before-quit' && args.length === 0) args.push({ preventDefault() {} })
    const listeners = appListeners.get(event) || []
    appListeners.set(event, listeners.filter(listener => !listener.once))
    for (const listener of listeners) listener.handler(...args)
  }
  let appExitCode = null
  let startupCatchAttached = false
  const app = {
    on: (event, handler) => listen(event, handler),
    once: (event, handler) => listen(event, handler, true),
    removeListener: (event, handler) => appListeners.set(event, (appListeners.get(event) || []).filter(listener => listener.handler !== handler)),
    quit: () => emit('before-quit'),
    emit,
    commandLine: { appendSwitch() {} }, getPath: () => '/test',
    requestSingleInstanceLock: () => true,
    whenReady: startupError
      ? () => ({ then: handler => {
        const promise = Promise.resolve().then(handler)
        // Keep the RED fixture from producing an unrelated process-level
        // unhandled rejection before the lifecycle assertion observes it.
        promise.catch(() => {})
        return { catch: onRejected => { startupCatchAttached = true; promise.catch(onRejected) } }
      } })
      : () => Promise.resolve(),
    exit: code => { appExitCode = code },
  }
  const catalog = [...installed]
  let catalogError = null
  const catalogListGate = holdCatalogList ? deferred() : null
  const userAppListenGate = holdUserAppListen ? deferred() : null
  const odkDataListenGate = holdOdkDataListen ? deferred() : null
  const userAppListenEntered = deferred(), userAppListenClosed = deferred()
  const odkDataListenEntered = deferred(), odkDataListenClosed = deferred()
  let userAppCloseCount = 0
  let odkDataCloseCount = 0
  let catalogListWaiting = false
  let userAppListenWaiting = false
  let odkDataListenWaiting = false
  const nativeGate = holdNativeDiscovery ? deferred() : null
  let nativeWaiting = false
  const installedStore = {
    list: async () => {
      if (catalogListGate) {
        catalogListWaiting = true
        await catalogListGate.promise
      }
      if (catalogError) throw catalogError
      return catalog
    },
    desktop: async () => [],
    install: async (appId) => { catalog.push({ id: appId, name: appId, version: '1', kind: 'widget', revision: 'a'.repeat(32) }); return { ok: true } },
    rollback: async appId => ({ ok: true, app: { id: appId } }),
    remove: async appId => { const index = catalog.findIndex(entry => entry.id === appId); if (index >= 0) catalog.splice(index, 1); return { ok: true } },
    place: async appId => ({ ok: true, app: { id: appId } }),
    getContent: async () => ({ ok: false, error: 'not-found' }),
  }
  const hydraSnapshot = { configured: true, connected: true, updatedAt: 1_700_000_000_000, env: { tempC: 21.4, stale: false }, nodes: [{ id: 1, soilPercent: 30, soilUpdatedAt: 1_700_000_000_000, stale: false }] }
  const wired = []
  const host = hostOverride || {
    id: 'linux-arm64', isWindows: false, supported: true, stateDir: '/test/state',
    provisionsUserAppControl: false, provisionsOdkData: false, odkDataEndpoint: null,
    endpoint: () => null,
  }
  const intervals = []
  const timerHandles = []
  let intervalClearCount = 0
  let remoteStopCount = 0
  let hydraStopCount = 0
  let futuStopCount = 0
  let futuRefreshCount = 0
  let futuServices
  const storeOptions = []
  const modules = {
    electron: {
      app, BrowserWindow: Object.assign(function () { return win }, { getAllWindows: () => [win] }),
      ipcMain: { on() {}, removeListener() {}, handle: (id, handler) => handlers.set(id, handler), removeHandler: id => handlers.delete(id) },
      session: { defaultSession: {
        setPermissionRequestHandler() { if (startupError) throw startupError },
        setPermissionCheckHandler() {},
      } },
      protocol: { handle() {}, unhandle() {}, registerSchemesAsPrivileged() {} },
    },
    './platform': { resolveShellHost: () => host },
    './plugin-host': { ...require('../src/plugin-host'), createPluginHost(options) {
      mainCapabilities = options.capabilities
      return require('../src/plugin-host').createPluginHost(options)
    } },
    './frame-ready': require('../src/frame-ready'),
    './plugin-config': require('../src/plugin-config'),
    './native-renderer-assets': require('../src/native-renderer-assets'),
    './native-runtime-activation': require('../src/native-runtime-activation'),
    './native-renderer-activation': require('../src/native-renderer-activation'),
    './native-plugin-loader': nativeGate ? { ...require('../src/native-plugin-loader'), loadNativePlugins: async () => { nativeWaiting = true; await nativeGate.promise; return [] } } : require('../src/native-plugin-loader'),
    './development-plugins': require('../src/development-plugins'),
    './renderer/core/appearance-plugins': require('../src/renderer/core/appearance-plugins'),
    './plugins/main-composition': require('../src/plugins/main-composition'),
    './plugin-diagnostics': require('../src/plugin-diagnostics'),
    './plugin-shutdown': require('../src/plugin-shutdown'),
    './plugins/data-sources': require('../src/plugins/data-sources'),
    './plugins/system-channels': require('../src/plugins/system-channels'),
    './plugins/desk-runtime': require('../src/plugins/desk-runtime'),
    './platform/native-process-reader': { createNativeProcessReader: () => ({ reason: null }) },
    './user-app-api': require('../src/user-app-api'),
    './user-app-geometry': require('../src/user-app-geometry'),
    './user-app-control': require('../src/user-app-control'),
    './user-app-protocol': require('../src/user-app-protocol'),
    './user-app-content': require('../src/user-app-content'),
    './local-channel': require('../src/local-channel'),
    './panel': { KIOSK_WINDOW_LOCK: {}, enterPanel() {}, resolvePanelBounds: () => null },
    './remote-bridge-client': { resolveRemoteBridgeSocketPath: () => null, createRemoteBridgeClient: () => ({ onLinkState: () => () => {}, onNavigation: () => () => {}, onInput: () => () => {}, start() {}, stop() { remoteStopCount += 1 }, getLinkState: () => 'disconnected' }) },
    './personal-agent-client': { resolvePersonalAgentSocketPath: () => null, createPersonalAgentClient: () => ({ subscribe: () => () => {}, start() {}, stop() {}, servicePush: ids => servicePushes.push(ids), toggle: () => false, snapshot: () => ({ state: 'unavailable' }) }) },
    './odk-data-control': { listenOdkData: async () => {
      if (odkDataListenGate) {
        odkDataListenWaiting = true
        odkDataListenEntered.resolve()
        await odkDataListenGate.promise
      }
      return { close: async () => { odkDataCloseCount += 1; odkDataListenClosed.resolve() } }
    } },
    './user-app-store': { createUserAppStore: (options) => { storeOptions.push(options); return installedStore } },
    // The verifier is a construct-only dependency here: nothing is verified
    // because the store decides what is installed.
    './user-app-verifier': { createUserAppVerifier: () => ({ verify: () => true, close: async () => {} }) },
    './pi-sessions-source': { createPiSessionsSource: () => async () => ({ ok: true, sessions: [] }) },
    './pi-session-events-source': { createPiSessionEventsSource: () => async () => ({ ok: false }) },
    './pi-sessions': { readSessionEvents: () => ({ ok: false }) },
    './odk-link-client': { createOdkLinkClient: () => ({ machines: async () => [] }), createOdkLinkTransport: odkLinkTransport },
    './odk-link-host-adapter': require('../src/odk-link-host-adapter'),
    './hydra-mqtt': { connectHydraMqtt: hydraConnector, createHydraSource: options => { onHydraUpdate = options.onUpdate; return { snapshot: () => hydraSnapshot, stop() { hydraStopCount += 1 } } } },
    './hydra-espnow': { createHydraEspNowSource: options => { onHydraUpdate = options.onUpdate; return { snapshot: () => hydraSnapshot, stop() { hydraStopCount += 1 } } } },
    './device-bridge-source': require('../src/device-bridge-source'),
    './user-app-devices': require('../src/user-app-devices'),
    './weather-source': { createWeatherSource: () => ({ refresh: async () => ({ status: 'unconfigured' }) }) },
    './weread-source': { createWeReadSource: () => ({ refresh: async () => ({ status: 'unconfigured' }) }) },
    './futu-source': { createFutuSource: (options) => { futuServices = options.services; return { refreshServices: async () => { futuRefreshCount += 1 }, stop: async () => { futuStopCount += 1 }, snapshot: service => ({ state: 'live', service, snapshot: { positions: [] } }) } } },
    './app-manager-endpoint': { createAppManagerEndpoint: () => ({}) },
    './opencode-go': { resolveOpenCodeGoConfig: () => ({}), fetchOpenCodeGo: async () => ({ state: 'unconfigured' }) },
    './camera-source': { createCameraSource: () => ({ refresh: async () => {}, snapshot: () => ({}) }) },
    './odk-data': { createShellOdkData: sources => { const data = createShellOdkData(sources); wired.push(data); return data } },
  }
  if (holdUserAppListen) {
    const controlModule = modules['./user-app-control']
    modules['./user-app-control'] = {
      ...controlModule,
      listenUserAppControl: async () => {
        userAppListenWaiting = true
        userAppListenEntered.resolve()
        await userAppListenGate.promise
        return { close: async () => { userAppCloseCount += 1; userAppListenClosed.resolve() } }
      },
    }
  }
  // The user-application system runs for real here: only the store bytes and the
  // host naming are stood in for, so the publish handler and the catalog hook are
  // the shipped ones rather than a test's idea of them.
  const userAppSystem = { exports: {} }
  vm.runInNewContext(fs.readFileSync('src/user-app-system.js', 'utf8'), {
    require: (id) => modules[id] || userAppRequire(id),
    process: { env },
    module: userAppSystem, exports: userAppSystem.exports, __dirname: '/test', console,
  })
  modules['./user-app-system'] = userAppSystem.exports
  vm.runInNewContext(fs.readFileSync('src/main.js', 'utf8'), {
    require: (id) => modules[id] || mainRequire(id),
    process: { argv: [], env },
    module: { exports: {} }, __dirname: '/test', console, URLSearchParams,
    setInterval: (fn) => { const handle = { fn, unref() {} }; intervals.push(fn); timerHandles.push(handle); return handle },
    clearInterval: handle => { if (timerHandles.includes(handle)) intervalClearCount += 1 },
  })
  return {
    frameMessages, servicePushes,
    hydraConnector, hydraCapability: () => mainCapabilities['source.hydra'],
    odkLinkTransport, odkLinkCapability: () => mainCapabilities['source.odk-link'],
    finishFrame: () => frameEvents.get('did-finish-load')(),
    notifyHydra: () => onHydraUpdate(),
    handlers,
    catalog,
    setCatalogError: error => { catalogError = error },
    hydraSnapshot,
    app,
    intervals,
    futuServices: () => futuServices(),
    getCounts: () => ({ remote: remoteStopCount, hydra: hydraStopCount, futu: futuStopCount, futuRefresh: futuRefreshCount, intervalClear: intervalClearCount }),
    startupStatus: () => ({ catchAttached: startupCatchAttached, exitCode: appExitCode }),
    windowLoaded: () => win.loaded === true,
    windowOptions: () => win.loadOptions,
    intervalCount: () => intervals.length,
    waiting: () => ({ catalog: catalogListWaiting, userApp: userAppListenWaiting, odkData: odkDataListenWaiting }),
    nativeWaiting: () => nativeWaiting,
    releaseNative: () => nativeGate?.resolve(),
    releaseCatalogList: () => catalogListGate?.resolve(),
    userAppListenEntered: userAppListenEntered.promise,
    userAppListenClosed: userAppListenClosed.promise,
    odkDataListenEntered: odkDataListenEntered.promise,
    odkDataListenClosed: odkDataListenClosed.promise,
    releaseUserAppListen: () => userAppListenGate?.resolve(),
    releaseOdkDataListen: () => odkDataListenGate?.resolve(),
    getAsyncListenerCounts: () => ({ userApp: userAppCloseCount, odkData: odkDataCloseCount }),
    storeOptions,
    refreshCatalog: async () => {
      for (const interval of intervals) interval()
      for (let tick = 0; tick < 4; tick += 1) await new Promise(resolve => setTimeout(resolve, 0))
    },
    // The window is created after the registry is registered and the installed
    // catalog is read, so its load is what says the boot sequence finished.
    ready: async () => {
      let deadline
      try {
        await Promise.race([windowLoaded.promise, new Promise((_, reject) => {
          deadline = setTimeout(() => reject(Error('wired Shell did not load its window')), 10000)
        })])
      } finally { clearTimeout(deadline) }
      assert.equal(wired.length, 1, 'the wired shell must own one Open DeskOS Data registry')
      assert.equal(win.loaded, true, 'the desk window must be created after the readings are registered')
      return wired[0]
    },
  }
}

test('the tile and the spoken answer read one source through the wired shell', async () => {
  const shell = wireShell()
  const odkData = await shell.ready()
  const tile = shell.handlers.get('odk-hydra-status')
  const reading = (await odkData.control.dispatch({ command: 'read', readingId: 'odk.tile.hydra' })).reading
  // One source, two readers: the tile draws the source's own payload and the
  // reader gets its spoken projection, and both carry the same measurement.
  assert.equal(tile().nodes[0].soilPercent, reading.value.plants[0].soilPercent)
  assert.equal(reading.value.plants[0].soilPercent, 30)
  assert.equal(reading.value.asOf, new Date(shell.hydraSnapshot.updatedAt ?? 0).toISOString())
  assert.ok(odkData.registry.list().some(entry => entry.id === 'odk.tile.hydra'))
})

test('a disabled data-source plugin withdraws only its reading and endpoint', async () => {
  const shell = wireShell({ env: { ODK_DISABLED_PLUGINS: 'odk.source.weather' } })
  const odkData = await shell.ready()
  assert.equal(shell.handlers.has('odk-weather-status'), false)
  assert.equal(odkData.registry.list().some(entry => entry.id === 'odk.tile.weather'), false)
  assert.equal(shell.handlers.get('odk-hydra-status')().nodes[0].soilPercent, 30)
  assert.equal(odkData.registry.list().some(entry => entry.id === 'odk.tile.hydra'), true)
})

test('a disabled Personal Agent plugin leaves direct data and package controls available', async () => {
  const shell = wireShell({ env: { ODK_DISABLED_PLUGINS: 'odk.system.personal-agent' } })
  const odkData = await shell.ready()
  assert.equal(shell.handlers.has('odk-personal-agent-toggle'), false)
  assert.equal(shell.handlers.has('odk-personal-agent-status'), false)
  assert.equal(shell.handlers.has('odk-user-apps-dispatch'), true)
  assert.equal(shell.handlers.get('odk-hydra-status')().nodes[0].soilPercent, 30)
  assert.equal(odkData.registry.list().some(entry => entry.id === 'odk.tile.hydra'), true)
})

test('a package publishes through the shell handler, and only what it declared', async () => {
  const shell = wireShell({
    installed: [{ id: 'pomodoro', name: 'Pomodoro', version: '1', kind: 'widget', revision: 'a'.repeat(32), data: { fields: { remaining_seconds: { type: 'number' } } } }],
  })
  const odkData = await shell.ready()
  const publish = shell.handlers.get('odk-user-apps-publish')
  const read = async id => (await odkData.control.dispatch({ command: 'read', readingId: id })).reading

  assert.equal((await read('pomodoro')).state, 'unconfigured', 'a package answers nothing before it publishes')
  assert.deepEqual(publish({}, { appId: 'pomodoro', data: { remaining_seconds: 90 } }), { ok: true })
  assert.equal((await read('pomodoro')).value.remaining_seconds, 90)

  assert.deepEqual(publish({}, { appId: 'pomodoro', data: { not_declared: 1 } }), { ok: false, error: 'undeclared-data' })
  assert.deepEqual(publish({}, { appId: 'notes', data: { remaining_seconds: 1 } }), { ok: false, error: 'unknown-reading' })
  assert.deepEqual(publish({}, { data: { remaining_seconds: 1 } }), { ok: false, error: 'unknown-reading' })
  assert.equal((await read('pomodoro')).value.remaining_seconds, 90, 'a refused publish must not disturb the reading that stands')
})

test('the installed revision drives which packages may answer', async () => {
  const shell = wireShell()
  const odkData = await shell.ready()
  const dispatch = shell.handlers.get('odk-user-apps-dispatch')
  const read = async id => odkData.control.dispatch({ command: 'read', readingId: id })

  assert.deepEqual(await read('notes'), { ok: false, error: 'unknown-reading' }, 'a package that declares nothing has nothing to answer with')

  assert.deepEqual(await dispatch({}, { command: 'install', appId: 'notes' }), { ok: true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(await read('notes'), { ok: false, error: 'unknown-reading' }, 'a package with no declaration still has nothing to answer with')

  shell.catalog.push({ id: 'timer', name: 'Timer', version: '1', kind: 'widget', revision: 'b'.repeat(32), data: { fields: { remaining_seconds: { type: 'number' } } } })
  assert.deepEqual(await dispatch({}, { command: 'remove', appId: 'notes' }), { ok: true })
  await new Promise(resolve => setTimeout(resolve, 0))
  const timer = (await read('timer')).reading
  assert.equal(timer.state, 'unconfigured', 'an installed revision that declares data becomes answerable')
  assert.equal(odkData.registry.publish('timer', { remaining_seconds: 60 }).ok, true)

  assert.deepEqual(await dispatch({}, { command: 'remove', appId: 'timer' }), { ok: true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(await read('timer'), { ok: false, error: 'unknown-reading' }, 'a removed package stops answering')
})

test('a readable catalog replacement withdraws removed services and preserves last duplicate ownership', async () => {
  const shell = wireShell({
    installed: [
      { id: 'futu-old', name: 'Old Futu', revision: 'r1', service: { id: 'futu-poller', endpoint: 'old.sock' } },
      { id: 'futu-new', name: 'New Futu', revision: 'r2', service: { id: 'futu-poller', endpoint: 'new.sock' } },
    ],
  })
  const odkData = await shell.ready()
  await shell.refreshCatalog()
  assert.deepEqual({ ...shell.futuServices()['futu-poller'] }, { revision: 'r2', endpoint: 'new.sock', label: 'New Futu' }, 'the last declaration keeps existing ownership semantics')
  assert.ok(odkData.registry.list().some(reading => reading.id === 'futu-poller'))

  shell.catalog.length = 0
  await shell.refreshCatalog()
  assert.equal(shell.futuServices()['futu-poller'], undefined, 'a successful catalog refresh withdraws a removed declaration')
  assert.equal(odkData.registry.list().some(reading => reading.id === 'futu-poller'), false, 'Open DeskOS Data withdraws the removed service')
})

test('service refresh uses the resolved cross-platform user-app state directory', async () => {
  const shell = wireShell({
    host: {
      id: 'win32-x64', isWindows: true, supported: true, stateDir: 'C:\\Users\\desk\\AppData\\Local\\OpenDeskOS',
      provisionsUserAppControl: false, provisionsOdkData: false, odkDataEndpoint: null,
      endpoint: () => null,
    },
    installed: [{ id: 'futu', name: 'Futu', revision: 'r1', service: { id: 'futu-poller', endpoint: 'futu.sock' } }],
  })
  await shell.ready()
  await shell.refreshCatalog()
  assert.equal(shell.storeOptions.length, 1, 'Main and the installed runtime use the selected catalog instance')
  assert.match(shell.storeOptions[0].stateDir, /user-apps$/)
  assert.equal(shell.futuServices()['futu-poller'].endpoint, 'futu.sock')
})

test('an unreadable catalog retains the last successful service declarations', async () => {
  const shell = wireShell({ installed: [
    { id: 'futu', name: 'Futu', revision: 'r1', service: { id: 'futu-poller', endpoint: 'futu.sock' } },
  ] })
  const odkData = await shell.ready()
  await shell.refreshCatalog()
  const previous = shell.futuServices()['futu-poller']
  shell.setCatalogError(new Error('catalog-corrupt'))
  await shell.refreshCatalog()
  assert.deepEqual(shell.futuServices()['futu-poller'], previous)
  assert.ok(odkData.registry.list().some(reading => reading.id === 'futu-poller'))
})

test('before-quit stops each main-process source once', async () => {
  const shell = wireShell()
  await shell.ready()
  shell.app.emit('before-quit')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(shell.getCounts(), { remote: 1, hydra: 1, futu: 1, futuRefresh: 1, intervalClear: 1 })
  shell.app.emit('before-quit')
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(shell.getCounts(), { remote: 1, hydra: 1, futu: 1, futuRefresh: 1, intervalClear: 1 }, 'quit cleanup is registered once')
})

test('startup rejection is observed and exits the Shell', async () => {
  const shell = wireShell({ startupError: new Error('startup failed') })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(shell.startupStatus(), { catchAttached: true, exitCode: 1 })
})

test('quit during catalog synchronization prevents later startup resources', async () => {
  const shell = wireShell({ holdCatalogList: true })
  for (let tick = 0; tick < 20 && !shell.waiting().catalog; tick += 1) await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(shell.waiting().catalog, true)
  shell.app.emit('before-quit')
  shell.releaseCatalogList()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(shell.windowLoaded(), false, 'quit startup must not create a window after catalog sync')
  assert.equal(shell.intervalCount(), 0, 'quit startup must not install the service refresh timer')
})

test('a user-app control listener that finishes after quit closes immediately', { timeout: 5000 }, async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-startup-'))
  try {
    const shell = wireShell({
      holdUserAppListen: true,
      host: {
        id: 'linux-arm64', isWindows: false, supported: true, stateDir,
        provisionsUserAppControl: true, provisionsOdkData: false, odkDataEndpoint: null,
        endpoint: name => name === 'user-app-control' ? path.join(stateDir, 'user-app-control.sock') : null,
      },
    })
    await shell.userAppListenEntered
    assert.equal(shell.waiting().userApp, true)
    shell.app.emit('before-quit')
    shell.releaseUserAppListen()
    await shell.userAppListenClosed
    assert.deepEqual(shell.getAsyncListenerCounts(), { userApp: 1, odkData: 0 })
    assert.equal(shell.windowLoaded(), false, 'quit startup must not create a window after control listen')
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true })
  }
})

test('a Open DeskOS Data listener that finishes after quit closes immediately', { timeout: 5000 }, async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-data-'))
  try {
    const shell = wireShell({
      holdOdkDataListen: true,
      host: {
        id: 'linux-arm64', isWindows: false, supported: true, stateDir,
        provisionsUserAppControl: false, provisionsOdkData: true,
        odkDataEndpoint: path.join(stateDir, 'odk-data.sock'), endpoint: () => null,
      },
    })
    await shell.odkDataListenEntered
    assert.equal(shell.waiting().odkData, true)
    shell.app.emit('before-quit')
    shell.releaseOdkDataListen()
    await shell.odkDataListenClosed
    assert.deepEqual(shell.getAsyncListenerCounts(), { userApp: 0, odkData: 1 })
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true })
  }
})


test('saved preferences reach Main and renderer through one boot snapshot', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-boot-preferences-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'plugins.json')
  fs.writeFileSync(file, JSON.stringify({ version: 1, plugins: {
    'odk.source.weather': { enabled: false }, 'odk.tile.clock': { enabled: false },
  } }))
  const shell = wireShell({ env: { ODK_CONFIG_DIR: dir }, holdCatalogList: true })
  for (let tick = 0; tick < 40 && !shell.waiting().catalog; tick += 1) await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(shell.waiting().catalog, true)
  fs.writeFileSync(file, JSON.stringify({ version: 1, plugins: {} }))
  shell.releaseCatalogList()
  await shell.ready()
  assert.equal(shell.handlers.has('odk-weather-status'), false)
  assert.equal(new URLSearchParams(shell.windowOptions().search.slice(1)).get('disabledPlugins'), 'odk.source.weather,odk.tile.clock,odk.system.plugin-diagnostics,odk.system.plugin-control,odk.system.renderer-control')
})


test('Main dispatches frame readiness and source notifications through the default plugins', async () => {
  const shell = wireShell()
  await shell.ready()
  shell.frameMessages.length = 0
  shell.servicePushes.length = 0
  shell.finishFrame()
  assert.deepEqual(shell.frameMessages, [
    ['odk-personal-agent-status', { state: 'unavailable' }],
    ['odk-remote-link-state', { state: 'disconnected', sequence: 0 }],
  ])
  shell.notifyHydra()
  shell.odkLinkCapability().options.onCompletion()
  assert.deepEqual(shell.servicePushes.map(ids => Array.from(ids)), [['odk.tile.hydra'], ['odk.app.pi-sessions.completed']])
  shell.app.emit('before-quit')
  await new Promise(resolve => setImmediate(resolve))
  const frames = shell.frameMessages.length
  const pushes = shell.servicePushes.length
  shell.finishFrame()
  shell.notifyHydra()
  assert.equal(shell.frameMessages.length, frames)
  assert.equal(shell.servicePushes.length, pushes)
})


test('Main starts a replacement with its linked provider beside a missing link and rejects changed dependencies before execution', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-main-replacement-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { main } = require('../scripts/odk-plugin-cli')
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const original = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.weather')
  const providerPort = 'odk:test-weather-source/v1'
  const manifest = { ...original.manifest, entry: 'entry.cjs', requires: [{ interface: providerPort }] }
  const manifestPath = path.join(root, 'manifest.json')
  const marker = path.join(root, 'executed')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest))
  fs.writeFileSync(path.join(root, 'entry.cjs'), `
    require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');
    exports.create = ctx => {
      const source = ctx.get('${providerPort}');
      const original = require(${JSON.stringify(path.resolve('src/plugins/data-sources.js'))}).createDataSourcePlugins().find(plugin => plugin.manifest.id === 'odk.source.weather');
      return original.create({ ...ctx, capability: name => name === 'source.weather' ? { create: () => source, options: {} } : ctx.capability(name) });
    };
  `)
  const env = { ODK_CONFIG_DIR: path.join(root, 'config') }
  const provider = path.join(root, 'provider')
  fs.mkdirSync(provider)
  fs.writeFileSync(path.join(provider, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'odk.test.weather-source', name: 'Weather source fixture', version: '1.0.0',
    host: 'electron-main', kind: 'service', entry: 'entry.cjs', provides: [{ interface: providerPort }], requires: [], permissions: [] }))
  fs.writeFileSync(path.join(provider, 'entry.cjs'), `exports.create = () => { const source = { snapshot: () => ({ status: 'live', current: { temperature: 24 } }), refresh: async () => source.snapshot() };
    return { ports: { '${providerPort}': source } }; };`)
  assert.equal(main(['link', provider, '--trust'], env), 0)
  assert.equal(main(['link', root, '--trust', '--replace', '--grant', 'source.weather', '--grant', 'ipc'], env), 0)
  const broken = path.join(root, 'broken')
  fs.mkdirSync(broken)
  fs.writeFileSync(path.join(broken, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'odk.test.broken', name: 'Broken fixture', version: '1.0.0',
    host: 'electron-main', kind: 'service', entry: 'entry.cjs', provides: [], requires: [], permissions: [] }))
  fs.writeFileSync(path.join(broken, 'entry.cjs'), 'throw Error("missing link must not execute")')
  assert.equal(main(['link', broken, '--trust'], env), 0)
  fs.rmSync(broken, { recursive: true })
  const replaced = wireShell({ env })
  const data = await replaced.ready()
  assert.equal((await replaced.handlers.get('odk-weather-status')(null, {})).current.temperature, 24)
  assert.equal((await data.control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })).reading.value.temperatureC, 24)
  replaced.app.emit('before-quit')
  await new Promise(resolve => setImmediate(resolve))
  fs.rmSync(marker)
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, requires: [{ interface: 'odk:absent/v1' }] }))
  const fallback = wireShell({ env })
  await fallback.ready()
  assert.equal((await fallback.handlers.get('odk-weather-status')(null, {})).status, 'unconfigured')
  assert.equal(fs.existsSync(marker), false)
  fallback.app.emit('before-quit')
  await new Promise(resolve => setImmediate(resolve))
})

test('Main starts an installed signed revision and retains default features after corrupt revision rejection', async t => {
  const crypto = require('node:crypto')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-main-native-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  fs.mkdirSync(source)
  const keys = crypto.generateKeyPairSync('ed25519')
  const manifest = { schemaVersion: 1, id: 'odk.test.signed', name: 'Signed Main fixture', version: '1.0.0',
    host: 'electron-main', kind: 'service', entry: 'entry.cjs', permissions: ['ipc'], provides: [], requires: [] }
  const marker = path.join(root, 'executed')
  fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(source, 'entry.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');
    exports.create = ctx => { const ipc = ctx.capability('ipc'); ipc.handle('signed-fixture', () => 42);
      ctx.onCleanup(() => ipc.removeHandler('signed-fixture')); return {}; };`)
  const files = ['entry.cjs', 'manifest.json'].map(name => ({ path: name,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(source, name))).digest('hex') }))
  const payload = { schemaVersion: 1, keyId: 'fixture', replace: false, files }
  fs.writeFileSync(path.join(source, 'bundle.json'), JSON.stringify({ ...payload,
    signature: crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64') }))
  const policy = path.join(root, 'publishers.json')
  fs.writeFileSync(policy, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), identities: [manifest.id], hosts: [manifest.host],
  } } }))
  const env = { ODK_CONFIG_DIR: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
    LOCALAPPDATA: path.join(root, 'state'), ODK_NATIVE_KEYRING: policy }
  const { main: nativeCli } = require('../scripts/odk-plugin-cli')
  assert.equal(await nativeCli(['native', 'install', source, '--keyring', policy, '--trust', '--grant', 'ipc'], env), 0)
  assert.equal(fs.existsSync(marker), false)
  const shell = wireShell({ env })
  await shell.ready()
  assert.equal(shell.handlers.get('signed-fixture')(), 42)
  assert.equal((await shell.handlers.get('odk-weather-status')(null, {})).status, 'unconfigured')
  shell.app.emit('before-quit')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(shell.handlers.has('signed-fixture'), false)
  fs.rmSync(marker)
  const { readConfig, resolveConfigPath } = require('../src/plugin-config')
  const revision = readConfig(resolveConfigPath(env)).plugins[manifest.id].native.revision
  const { resolveShellHost } = require('../src/platform')
  fs.writeFileSync(path.join(resolveShellHost({ env }).stateDir, 'plugins', 'native', 'revisions', revision, 'entry.cjs'), 'unverified')
  const fallback = wireShell({ env })
  await fallback.ready()
  assert.equal(fallback.handlers.has('signed-fixture'), false)
  assert.equal(fs.existsSync(marker), false)
  assert.equal((await fallback.handlers.get('odk-weather-status')(null, {})).status, 'unconfigured')
  fallback.app.emit('before-quit')
  await new Promise(resolve => setImmediate(resolve))
})

test('quitting during native discovery cannot start factories or create a window', async () => {
  const shell = wireShell({ holdNativeDiscovery: true })
  for (let turn = 0; turn < 20 && !shell.nativeWaiting(); turn++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(shell.nativeWaiting(), true)
  shell.app.emit('before-quit')
  shell.releaseNative()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(shell.windowLoaded(), false)
  assert.equal(shell.handlers.size, 0)
  assert.equal(shell.intervalCount(), 0)
})


test('Main retains the explicit legacy connector but defaults Hydra to the Bridge constructor', async () => {
  const shell = wireShell({ env: { ODK_HYDRA_MQTT_URL: 'mqtts://old-broker.invalid:8883' } })
  await shell.ready()
  assert.equal(shell.hydraCapability().connect, shell.hydraConnector)
  assert.equal(typeof shell.hydraCapability().create, 'function')
  assert.equal(typeof shell.hydraCapability().createDefault, 'function')
  assert.notEqual(shell.hydraCapability().createDefault, shell.hydraCapability().create)
  assert.equal(shell.hydraCapability().options.url, 'mqtts://old-broker.invalid:8883')
  assert.ok(path.isAbsolute(shell.hydraCapability().options.profileFile))
  assert.equal(typeof shell.hydraCapability().options.onUpdate, 'function')
  shell.app.emit('before-quit')
})

test('Main grants Open DeskOS Link raw transport alongside the existing factory', async () => {
  const shell = wireShell()
  await shell.ready()
  assert.equal(shell.odkLinkCapability().createTransport, shell.odkLinkTransport)
  assert.equal(typeof shell.odkLinkCapability().create, 'function')
  shell.app.emit('before-quit')
})
