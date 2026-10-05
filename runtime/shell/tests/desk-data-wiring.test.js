'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { createShellDeskData } = require('../src/desk-data')

// The wired main process is the seam where the tile, the installed packages and
// the Personal Bot meet. Only the launcher, the display and the store's bytes are
// stood in for: the user-application system that owns the publish handler and
// the catalog hook runs for real, or this file would test nothing.
function deferred() {
  let resolve
  const promise = new Promise(result => { resolve = result })
  return { promise, resolve }
}

function wireShell({ installed = [], host: hostOverride, env = {}, startupError = null, holdCatalogList = false, holdUserAppListen = false, holdDeskDataListen = false } = {}) {
  const handlers = new Map()
  const win = { webContents: { setWindowOpenHandler() {}, on() {}, once() {}, send() {} }, loadFile() { win.loaded = true }, once() {} }
  const appListeners = new Map()
  const listen = (event, handler, once = false) => {
    const listeners = appListeners.get(event) || []
    listeners.push({ handler, once })
    appListeners.set(event, listeners)
  }
  const emit = (event, ...args) => {
    const listeners = appListeners.get(event) || []
    appListeners.set(event, listeners.filter(listener => !listener.once))
    for (const listener of listeners) listener.handler(...args)
  }
  let appExitCode = null
  let startupCatchAttached = false
  const app = {
    on: (event, handler) => listen(event, handler),
    once: (event, handler) => listen(event, handler, true),
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
  const deskDataListenGate = holdDeskDataListen ? deferred() : null
  let userAppCloseCount = 0
  let deskDataCloseCount = 0
  let catalogListWaiting = false
  let userAppListenWaiting = false
  let deskDataListenWaiting = false
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
    provisionsUserAppControl: false, provisionsDeskData: false, deskDataEndpoint: null,
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
      ipcMain: { handle: (id, handler) => handlers.set(id, handler) },
      session: { defaultSession: {
        setPermissionRequestHandler() { if (startupError) throw startupError },
        setPermissionCheckHandler() {},
      } },
      protocol: { handle() {}, registerSchemesAsPrivileged() {} },
    },
    './platform': { resolveShellHost: () => host },
    './platform/native-process-reader': { createNativeProcessReader: () => ({ reason: null }) },
    './user-app-control': require('../src/user-app-control'),
    './user-app-protocol': require('../src/user-app-protocol'),
    './user-app-content': require('../src/user-app-content'),
    './local-channel': require('../src/local-channel'),
    './panel': { KIOSK_WINDOW_LOCK: {}, enterPanel() {}, resolvePanelBounds: () => null },
    './remote-bridge-client': { resolveRemoteBridgeSocketPath: () => null, createRemoteBridgeClient: () => ({ onLinkState() {}, onNavigation() {}, onInput() {}, start() {}, stop() { remoteStopCount += 1 }, getLinkState: () => 'disconnected' }) },
    './personal-bot-client': { resolvePersonalBotSocketPath: () => null, createPersonalBotClient: () => ({ subscribe() {}, start() {}, stop() {}, servicePush() {}, toggle: () => false, snapshot: () => ({ state: 'unavailable' }) }) },
    './desk-data-control': { listenDeskData: async () => {
      if (deskDataListenGate) {
        deskDataListenWaiting = true
        await deskDataListenGate.promise
      }
      return { close: async () => { deskDataCloseCount += 1 } }
    } },
    './user-app-store': { createUserAppStore: (options) => { storeOptions.push(options); return installedStore } },
    // The verifier is a construct-only dependency here: nothing is verified
    // because the store decides what is installed.
    './user-app-verifier': { createUserAppVerifier: () => ({ verify: () => true }) },
    './pi-sessions-source': { createPiSessionsSource: () => async () => ({ ok: true, sessions: [] }) },
    './pi-session-events-source': { createPiSessionEventsSource: () => async () => ({ ok: false }) },
    './pi-sessions': { readSessionEvents: () => ({ ok: false }) },
    './desk-link-client': { createDeskLinkClient: () => ({ machines: async () => [] }) },
    './hydra-mqtt': { createHydraSource: () => ({ snapshot: () => hydraSnapshot, stop() { hydraStopCount += 1 } }) },
    './weather-source': { createWeatherSource: () => ({ refresh: async () => ({ status: 'unconfigured' }) }) },
    './weread-source': { createWeReadSource: () => ({ refresh: async () => ({ status: 'unconfigured' }) }) },
    './futu-source': { createFutuSource: (options) => { futuServices = options.services; return { refreshServices: async () => { futuRefreshCount += 1 }, stop: async () => { futuStopCount += 1 }, snapshot: service => ({ state: 'live', service, snapshot: { positions: [] } }) } } },
    './app-manager-endpoint': { createAppManagerEndpoint: () => ({}) },
    './opencode-go': { resolveOpenCodeGoConfig: () => ({}), fetchOpenCodeGo: async () => ({ state: 'unconfigured' }) },
    './camera-source': { createCameraSource: () => ({ refresh: async () => {}, snapshot: () => ({}) }) },
    './desk-data': { createShellDeskData: sources => { const data = createShellDeskData(sources); wired.push(data); return data } },
  }
  if (holdUserAppListen) {
    const controlModule = modules['./user-app-control']
    modules['./user-app-control'] = {
      ...controlModule,
      listenUserAppControl: async () => {
        userAppListenWaiting = true
        await userAppListenGate.promise
        return { close: async () => { userAppCloseCount += 1 } }
      },
    }
  }
  // The user-application system runs for real here: only the store bytes and the
  // host naming are stood in for, so the publish handler and the catalog hook are
  // the shipped ones rather than a test's idea of them.
  const userAppSystem = { exports: {} }
  vm.runInNewContext(fs.readFileSync('src/user-app-system.js', 'utf8'), {
    require: (id) => modules[id] || require(id),
    process: { env },
    module: userAppSystem, exports: userAppSystem.exports, __dirname: '/test', console,
  })
  modules['./user-app-system'] = userAppSystem.exports
  vm.runInNewContext(fs.readFileSync('src/main.js', 'utf8'), {
    require: (id) => modules[id] || require(id),
    process: { argv: [], env },
    module: { exports: {} }, __dirname: '/test', console, URLSearchParams,
    setInterval: (fn) => { const handle = { fn, unref() {} }; intervals.push(fn); timerHandles.push(handle); return handle },
    clearInterval: handle => { if (timerHandles.includes(handle)) intervalClearCount += 1 },
  })
  return {
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
    intervalCount: () => intervals.length,
    waiting: () => ({ catalog: catalogListWaiting, userApp: userAppListenWaiting, deskData: deskDataListenWaiting }),
    releaseCatalogList: () => catalogListGate?.resolve(),
    releaseUserAppListen: () => userAppListenGate?.resolve(),
    releaseDeskDataListen: () => deskDataListenGate?.resolve(),
    getAsyncListenerCounts: () => ({ userApp: userAppCloseCount, deskData: deskDataCloseCount }),
    storeOptions,
    refreshCatalog: async () => {
      for (const interval of intervals) interval()
      for (let tick = 0; tick < 4; tick += 1) await new Promise(resolve => setTimeout(resolve, 0))
    },
    // The window is created after the registry is registered and the installed
    // catalog is read, so its load is what says the boot sequence finished.
    ready: async () => {
      for (let tick = 0; tick < 40 && !(wired.length === 1 && win.loaded); tick += 1) await new Promise(resolve => setTimeout(resolve, 0))
      assert.equal(wired.length, 1, 'the wired shell must own one Desk Data registry')
      assert.equal(win.loaded, true, 'the desk window must be created after the readings are registered')
      return wired[0]
    },
  }
}

test('the tile and the spoken answer read one source through the wired shell', async () => {
  const shell = wireShell()
  const deskData = await shell.ready()
  const tile = shell.handlers.get('odk-hydra-status')
  const reading = (await deskData.control.dispatch({ command: 'read', readingId: 'odk.tile.hydra' })).reading
  // One source, two readers: the tile draws the source's own payload and the
  // reader gets its spoken projection, and both carry the same measurement.
  assert.equal(tile().nodes[0].soilPercent, reading.value.plants[0].soilPercent)
  assert.equal(reading.value.plants[0].soilPercent, 30)
  assert.equal(reading.value.asOf, new Date(shell.hydraSnapshot.updatedAt ?? 0).toISOString())
  assert.ok(deskData.registry.list().some(entry => entry.id === 'odk.tile.hydra'))
})

test('a package publishes through the shell handler, and only what it declared', async () => {
  const shell = wireShell({
    installed: [{ id: 'pomodoro', name: 'Pomodoro', version: '1', kind: 'widget', revision: 'a'.repeat(32), data: { fields: { remaining_seconds: { type: 'number' } } } }],
  })
  const deskData = await shell.ready()
  const publish = shell.handlers.get('odk-user-apps-publish')
  const read = async id => (await deskData.control.dispatch({ command: 'read', readingId: id })).reading

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
  const deskData = await shell.ready()
  const dispatch = shell.handlers.get('odk-user-apps-dispatch')
  const read = async id => deskData.control.dispatch({ command: 'read', readingId: id })

  assert.deepEqual(await read('notes'), { ok: false, error: 'unknown-reading' }, 'a package that declares nothing has nothing to answer with')

  assert.deepEqual(await dispatch({}, { command: 'install', appId: 'notes' }), { ok: true })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(await read('notes'), { ok: false, error: 'unknown-reading' }, 'a package with no declaration still has nothing to answer with')

  shell.catalog.push({ id: 'timer', name: 'Timer', version: '1', kind: 'widget', revision: 'b'.repeat(32), data: { fields: { remaining_seconds: { type: 'number' } } } })
  assert.deepEqual(await dispatch({}, { command: 'remove', appId: 'notes' }), { ok: true })
  await new Promise(resolve => setTimeout(resolve, 0))
  const timer = (await read('timer')).reading
  assert.equal(timer.state, 'unconfigured', 'an installed revision that declares data becomes answerable')
  assert.equal(deskData.registry.publish('timer', { remaining_seconds: 60 }).ok, true)

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
  const deskData = await shell.ready()
  await shell.refreshCatalog()
  assert.deepEqual({ ...shell.futuServices()['futu-poller'] }, { revision: 'r2', endpoint: 'new.sock', label: 'New Futu' }, 'the last declaration keeps existing ownership semantics')
  assert.ok(deskData.registry.list().some(reading => reading.id === 'futu-poller'))

  shell.catalog.length = 0
  await shell.refreshCatalog()
  assert.equal(shell.futuServices()['futu-poller'], undefined, 'a successful catalog refresh withdraws a removed declaration')
  assert.equal(deskData.registry.list().some(reading => reading.id === 'futu-poller'), false, 'Desk Data withdraws the removed service')
})

test('service refresh uses the resolved cross-platform user-app state directory', async () => {
  const shell = wireShell({
    host: {
      id: 'win32-x64', isWindows: true, supported: true, stateDir: 'C:\\Users\\desk\\AppData\\Local\\OpenDeskOS',
      provisionsUserAppControl: false, provisionsDeskData: false, deskDataEndpoint: null,
      endpoint: () => null,
    },
    installed: [{ id: 'futu', name: 'Futu', revision: 'r1', service: { id: 'futu-poller', endpoint: 'futu.sock' } }],
  })
  await shell.ready()
  await shell.refreshCatalog()
  assert.equal(shell.storeOptions.length >= 2, true)
  assert.equal(shell.storeOptions[0].stateDir, shell.storeOptions[1].stateDir, 'main and user-app lifecycle share one resolved state directory')
  assert.match(shell.storeOptions[0].stateDir, /user-apps$/)
})

test('an unreadable catalog retains the last successful service declarations', async () => {
  const shell = wireShell({ installed: [
    { id: 'futu', name: 'Futu', revision: 'r1', service: { id: 'futu-poller', endpoint: 'futu.sock' } },
  ] })
  const deskData = await shell.ready()
  await shell.refreshCatalog()
  const previous = shell.futuServices()['futu-poller']
  shell.setCatalogError(new Error('catalog-corrupt'))
  await shell.refreshCatalog()
  assert.deepEqual(shell.futuServices()['futu-poller'], previous)
  assert.ok(deskData.registry.list().some(reading => reading.id === 'futu-poller'))
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

test('a user-app control listener that finishes after quit closes immediately', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-startup-'))
  try {
    const shell = wireShell({
      holdUserAppListen: true,
      host: {
        id: 'linux-arm64', isWindows: false, supported: true, stateDir,
        provisionsUserAppControl: true, provisionsDeskData: false, deskDataEndpoint: null,
        endpoint: () => path.join(stateDir, 'user-app-control.sock'),
      },
    })
    for (let tick = 0; tick < 20 && !shell.waiting().userApp; tick += 1) await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(shell.waiting().userApp, true)
    shell.app.emit('before-quit')
    shell.releaseUserAppListen()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(shell.getAsyncListenerCounts(), { userApp: 1, deskData: 0 })
    assert.equal(shell.windowLoaded(), false, 'quit startup must not create a window after control listen')
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true })
  }
})

test('a Desk Data listener that finishes after quit closes immediately', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odesk-desk-data-'))
  try {
    const shell = wireShell({
      holdDeskDataListen: true,
      host: {
        id: 'linux-arm64', isWindows: false, supported: true, stateDir,
        provisionsUserAppControl: false, provisionsDeskData: true,
        deskDataEndpoint: path.join(stateDir, 'desk-data.sock'), endpoint: () => null,
      },
    })
    for (let tick = 0; tick < 20 && !shell.waiting().deskData; tick += 1) await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(shell.waiting().deskData, true)
    shell.app.emit('before-quit')
    shell.releaseDeskDataListen()
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.deepEqual(shell.getAsyncListenerCounts(), { userApp: 0, deskData: 1 })
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true })
  }
})
