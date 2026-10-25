const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
const mainFile = path.resolve(__dirname, '../src/main.js')
const mainRequire = createRequire(mainFile)

test('Remote MIC requests a Shell decision and main rejects busy or duplicate capture toggles', async () => {
  let onInput
  let onRemoteMic
  let toggles = 0
  let connected = true
  let state = 'idle'
  let publishStatus
  const sent = []
  const handlers = new Map()
  const win = {
    webContents: { setWindowOpenHandler() {}, on() {}, once() {}, send: (...args) => sent.push(args) },
    loadFile() {}, once() {},
  }
  const app = {
    on() {}, once() {}, commandLine: { appendSwitch() {} },
    getPath: () => '/test',
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
  }
  const modules = {
    electron: {
      app, BrowserWindow: Object.assign(function () { return win }, { getAllWindows: () => [win] }),
      ipcMain: { on() {}, removeListener() {}, handle: (id, fn) => handlers.set(id, fn), removeHandler: id => handlers.delete(id) },
      session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    },
    './platform': { resolveShellHost: () => ({ id: 'win32-x64', isWindows: true, supported: true, stateDir: '/test/state/odk', endpoint: () => null, provisionsUserAppControl: false }) },
    './plugin-host': require('../src/plugin-host'),
    './frame-ready': require('../src/frame-ready'),
    './plugin-config': require('../src/plugin-config'),
    './native-renderer-assets': require('../src/native-renderer-assets'),
    './native-runtime-activation': require('../src/native-runtime-activation'),
    './native-renderer-activation': require('../src/native-renderer-activation'),
    './native-plugin-loader': require('../src/native-plugin-loader'),
    './development-plugins': require('../src/development-plugins'),
    './renderer/core/appearance-plugins': require('../src/renderer/core/appearance-plugins'),
    './plugins/main-composition': require('../src/plugins/main-composition'),
    './plugin-diagnostics': require('../src/plugin-diagnostics'),
    './plugin-shutdown': require('../src/plugin-shutdown'),
    './plugins/data-sources': require('../src/plugins/data-sources'),
    './plugins/system-channels': require('../src/plugins/system-channels'),
    './plugins/desk-runtime': require('../src/plugins/desk-runtime'),
    './platform/native-process-reader': { createNativeProcessReader: () => ({ reader: null, reason: 'process reader unavailable: not built' }) },
    './remote-bridge-client': {
      resolveRemoteBridgeSocketPath: () => null,
      createRemoteBridgeClient: (options) => {
        onRemoteMic = options.onRemoteMic
        return {
          onLinkState: () => () => {}, onNavigation: () => () => {}, onInput: (fn) => { onInput = fn; return () => {} }, start() {}, stop() {}, getLinkState: () => 'disconnected',
        }
      },
    },
    './personal-agent-client': {
      resolvePersonalAgentSocketPath: () => '/test.sock',
      createPersonalAgentClient: () => ({ subscribe(fn) { publishStatus = fn; return () => {} }, start() {}, stop() {}, toggle: () => { toggles++; return connected }, snapshot: () => ({ state: connected ? state : 'unavailable' }) }),
    },
    './user-app-system': { registerUserAppScheme() {}, async startUserAppSystem() {}, resolveUserAppSurface: () => ({ stateDir: '/test/state/odk/user-apps' }) },
    './pi-sessions-source': { createPiSessionsSource: () => () => { throw new Error('MIC must not scan or control the monitor') } },
    './pi-sessions': { readSessionEvents: () => { throw new Error('MIC must not read monitor session events') } },
    './pi-session-events-source': { createPiSessionEventsSource: () => () => { throw new Error('MIC must not read monitor session events') } },
    './odk-link-client': { createOdkLinkClient: () => ({ machines: async () => [], snapshot: async () => null, sessionEvents: async () => ({ ok: false }) }) },
    './odk-link-service': { SESSION_LOG_MISSING: 'session-log-missing' },
    './odk-link-host-adapter': require('../src/odk-link-host-adapter'),
    // The panel module is only reached by a kiosk launch, and this harness is
    // not one; it is named here so a new dependency in main.js is a stated
    // choice rather than a module that silently fails to resolve.
    './panel': { KIOSK_WINDOW_LOCK: {}, enterPanel() {}, resolvePanelBounds: () => null },
    './hydra-mqtt': { createHydraSource: () => ({ snapshot() {} }) },
    './weread-source': { createWeReadSource: () => ({ refresh: async () => {}, snapshot: () => ({ status: 'unconfigured' }) }) },
    './weather-source': { createWeatherSource: () => ({ refresh: async () => ({ status: 'unconfigured' }), snapshot: () => ({ status: 'unconfigured' }) }) },
    './futu-source': { createFutuSource: () => ({ refreshServices: async () => {}, snapshot: () => ({ state: 'unconfigured' }) }), STALE_MS: 60000 },
    './app-manager-endpoint': { createAppManagerEndpoint: () => ({}) },
    './odk-data': {
      createShellOdkData: () => ({
        registry: { publish: () => ({ ok: false, error: 'unknown-reading' }) },
        control: { dispatch: async () => ({ ok: false, error: 'invalid-command' }) },
        syncPackages: async () => {},
        syncServices: () => {},
      }),
    },
    './odk-data-control': { listenOdkData: async () => ({ close: async () => {} }) },
    './user-app-store': { createUserAppStore: () => ({ list: async () => [] }) },
    './user-app-geometry': require('../src/user-app-geometry'),
    './user-app-verifier': { createUserAppVerifier: () => ({ verify: async () => true, drain: async () => {}, close: async () => {} }) },
    './opencode-go': {},
    './camera-source': { createCameraSource: () => ({ refresh: async () => {}, snapshot: () => ({ status: 'unavailable' }) }) },
  }
  vm.runInNewContext(fs.readFileSync(mainFile, 'utf8'), {
    require: (id) => modules[id] || mainRequire(id), process: { argv: [], env: { ODK_CONFIG_DIR: '/fixture/absent-plugin-config' } },
    module: { exports: {} }, __dirname: '/test', console, URLSearchParams, setInterval, clearInterval,
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(sent, [
    ['odk-personal-agent-status', { state: 'unavailable' }],
    ['odk-personal-agent-status', { state: 'idle' }],
  ], 'Provider startup revokes the previous view before publishing its snapshot')
  sent.length = 0
  onRemoteMic()
  assert.equal(toggles, 0)
  assert.equal(sent[0][0], 'odk-personal-agent-mic')
  sent.length = 0
  const toggle = handlers.get('odk-personal-agent-toggle')
  const result = toggle()
  assert.equal(result.accepted, true)
  assert.equal(sent[0][1].state, 'starting')
  assert.equal(toggles, 1)
  assert.equal(toggle().accepted, false)
  assert.equal(toggles, 1, 'Pending start is not toggled twice')
  sent.length = 0
  publishStatus({ state: 'idle' })
  assert.equal(sent.length, 0, 'Immediate old idle acknowledgement cannot hide Preparing')
  assert.equal(toggle().accepted, false)
  for (const busy of ['transcribing', 'thinking']) {
    state = busy
    publishStatus({ state, transcript: 'Input', message: 'Partial' })
    sent.length = 0
    assert.equal(toggle().accepted, false)
    assert.equal(toggles, 1)
    assert.equal(sent.length, 0, 'Busy request is not replaced by Preparing')
  }
  state = 'recording'
  publishStatus({ state })
  sent.length = 0
  assert.equal(toggle().accepted, true)
  assert.equal(sent[0][1].state, 'sending')
  assert.equal(toggle().accepted, false)
  sent.length = 0
  publishStatus({ state: 'recording' })
  assert.equal(sent.length, 0, 'Immediate old recording acknowledgement cannot reopen Listening')
  assert.equal(toggle().accepted, false)
  assert.equal(toggles, 2)
  state = 'idle'
  publishStatus({ state, message: 'Complete' })
  sent.length = 0
  connected = false
  assert.equal(toggle().accepted, false)
  assert.equal(sent[0][1].state, 'unavailable')
  assert.equal(sent[0][1].activated, true)
  sent.length = 0
  onInput('right')
  assert.equal(sent[0][0], 'odk-remote-input')
  assert.equal(sent[0][1].input, 'right')
})


// Actual text-only preload and renderer behavior is covered by agent-home.cjs --composer-text-only.
