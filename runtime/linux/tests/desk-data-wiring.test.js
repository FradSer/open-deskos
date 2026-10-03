'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createShellDeskData } = require('../src/desk-data')

// The wired main process is the seam where the tile, the installed packages and
// the Personal Bot meet. Only the launcher, the display and the store's bytes are
// stood in for: the user-application system that owns the publish handler and
// the catalog hook runs for real, or this file would test nothing.
function wireShell({ installed = [] } = {}) {
  const handlers = new Map()
  const win = { webContents: { setWindowOpenHandler() {}, on() {}, once() {}, send() {} }, loadFile() { win.loaded = true }, once() {} }
  const app = {
    on() {}, once() {}, commandLine: { appendSwitch() {} }, getPath: () => '/test',
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(),
  }
  const catalog = [...installed]
  const installedStore = {
    list: async () => catalog,
    desktop: async () => [],
    install: async (appId) => { catalog.push({ id: appId, name: appId, version: '1', kind: 'widget', revision: 'a'.repeat(32) }); return { ok: true } },
    rollback: async appId => ({ ok: true, app: { id: appId } }),
    remove: async appId => { const index = catalog.findIndex(entry => entry.id === appId); if (index >= 0) catalog.splice(index, 1); return { ok: true } },
    place: async appId => ({ ok: true, app: { id: appId } }),
    getContent: async () => ({ ok: false, error: 'not-found' }),
  }
  const hydraSnapshot = { configured: true, connected: true, updatedAt: 1_700_000_000_000, env: { tempC: 21.4, stale: false }, nodes: [{ id: 1, soilPercent: 30, soilUpdatedAt: 1_700_000_000_000, stale: false }] }
  const wired = []
  const host = {
    id: 'linux-arm64', isWindows: false, supported: true, stateDir: '/test/state',
    provisionsUserAppControl: false, provisionsDeskData: false, deskDataEndpoint: null,
    endpoint: () => null,
  }
  const modules = {
    electron: {
      app, BrowserWindow: Object.assign(function () { return win }, { getAllWindows: () => [win] }),
      ipcMain: { handle: (id, handler) => handlers.set(id, handler) },
      session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
      protocol: { handle() {}, registerSchemesAsPrivileged() {} },
    },
    './platform': { resolveShellHost: () => host },
    './user-app-control': require('../src/user-app-control'),
    './user-app-protocol': require('../src/user-app-protocol'),
    './user-app-content': require('../src/user-app-content'),
    './local-channel': require('../src/local-channel'),
    './panel': { KIOSK_WINDOW_LOCK: {}, enterPanel() {}, resolvePanelBounds: () => null },
    './remote-bridge-client': { resolveRemoteBridgeSocketPath: () => null, createRemoteBridgeClient: () => ({ onLinkState() {}, onNavigation() {}, onInput() {}, start() {}, getLinkState: () => 'disconnected' }) },
    './personal-bot-client': { resolvePersonalBotSocketPath: () => null, createPersonalBotClient: () => ({ subscribe() {}, start() {}, stop() {}, servicePush() {}, toggle: () => false, snapshot: () => ({ state: 'unavailable' }) }) },
    './desk-data-control': { listenDeskData: async () => ({ close: async () => {} }) },
    './user-app-store': { createUserAppStore: () => installedStore },
    // The verifier is a construct-only dependency here: nothing is verified
    // because the store decides what is installed.
    './user-app-verifier': { createUserAppVerifier: () => ({ verify: () => true }) },
    './pi-sessions-source': { createPiSessionsSource: () => async () => ({ ok: true, sessions: [] }) },
    './pi-session-events-source': { createPiSessionEventsSource: () => async () => ({ ok: false }) },
    './pi-sessions': { readSessionEvents: () => ({ ok: false }) },
    './desk-link-client': { createDeskLinkClient: () => ({ machines: async () => [] }) },
    './hydra-mqtt': { createHydraSource: () => ({ snapshot: () => hydraSnapshot }) },
    './weather-source': { createWeatherSource: () => ({ refresh: async () => ({ status: 'unconfigured' }) }) },
    './weread-source': { createWeReadSource: () => ({ refresh: async () => ({ status: 'unconfigured' }) }) },
    './futu-source': { createFutuSource: () => ({ refreshServices: async () => {}, snapshot: service => ({ state: 'live', service, snapshot: { positions: [] } }) }) },
    './app-manager-endpoint': { createAppManagerEndpoint: () => ({}) },
    './opencode-go': { resolveOpenCodeGoConfig: () => ({}), fetchOpenCodeGo: async () => ({ state: 'unconfigured' }) },
    './camera-source': { createCameraSource: () => ({ refresh: async () => {}, snapshot: () => ({}) }) },
    './desk-data': { createShellDeskData: sources => { const data = createShellDeskData(sources); wired.push(data); return data } },
  }
  // The user-application system runs for real here: only the store bytes and the
  // host naming are stood in for, so the publish handler and the catalog hook are
  // the shipped ones rather than a test's idea of them.
  const userAppSystem = { exports: {} }
  vm.runInNewContext(fs.readFileSync('src/user-app-system.js', 'utf8'), {
    require: (id) => modules[id] || require(id),
    process: { env: {} },
    module: userAppSystem, exports: userAppSystem.exports, __dirname: '/test', console,
  })
  modules['./user-app-system'] = userAppSystem.exports
  vm.runInNewContext(fs.readFileSync('src/main.js', 'utf8'), {
    require: (id) => modules[id] || require(id),
    process: { argv: [], env: {} },
    module: { exports: {} }, __dirname: '/test', console, URLSearchParams, setInterval, clearInterval,
  })
  return {
    handlers,
    catalog,
    hydraSnapshot,
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
