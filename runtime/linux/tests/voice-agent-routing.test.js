const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

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
      ipcMain: { handle: (id, fn) => handlers.set(id, fn) },
      session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    },
    './remote-bridge-client': {
      resolveRemoteBridgeSocketPath: () => null,
      createRemoteBridgeClient: (options) => {
        onRemoteMic = options.onRemoteMic
        return {
          onLinkState() {}, onNavigation() {}, onInput: (fn) => { onInput = fn }, start() {}, getLinkState: () => 'disconnected',
        }
      },
    },
    './voice-agent-client': {
      resolveVoiceSocketPath: () => '/test.sock',
      createVoiceAgentClient: () => ({ subscribe(fn) { publishStatus = fn }, start() {}, stop() {}, toggle: () => { toggles++; return connected }, snapshot: () => ({ state: connected ? state : 'unavailable' }) }),
    },
    './user-app-system': { registerUserAppScheme() {}, async startUserAppSystem() {} },
    './pi-sessions-source': { createPiSessionsSource: () => () => { throw new Error('MIC must not scan or control the monitor') } },
    './pi-sessions': { readSessionEvents: () => { throw new Error('MIC must not read monitor session events') } },
    './hydra-mqtt': { createHydraSource: () => ({ snapshot() {} }) },
    './weread-source': { createWeReadSource: () => ({ refresh: async () => {}, snapshot: () => ({ status: 'unconfigured' }) }) },
    './app-manager-endpoint': { createAppManagerEndpoint: () => ({}) },
    './opencode-go': {},
    './camera-source': { createCameraSource: () => ({ refresh: async () => {}, snapshot: () => ({ status: 'unavailable' }) }) },
  }
  vm.runInNewContext(fs.readFileSync('src/main.js', 'utf8'), {
    require: (id) => modules[id] || require(id), process: { argv: [], env: {} },
    module: { exports: {} }, __dirname: '/test', console, URLSearchParams,
  })
  await new Promise(resolve => setImmediate(resolve))
  onRemoteMic()
  assert.equal(toggles, 0)
  assert.equal(sent[0][0], 'odk-voice-mic')
  sent.length = 0
  const toggle = handlers.get('odk-voice-toggle')
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
