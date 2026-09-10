const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

test('Remote MIC reaches the independent agent once, never the Pi monitor or renderer navigation', async () => {
  let onInput
  let toggles = 0
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
      createRemoteBridgeClient: () => ({
        onLinkState() {}, onNavigation() {}, onInput: (fn) => { onInput = fn }, start() {}, getLinkState: () => 'disconnected',
      }),
    },
    './voice-agent-client': {
      resolveVoiceSocketPath: () => '/test.sock',
      createVoiceAgentClient: () => ({ subscribe() {}, start() {}, stop() {}, toggle: () => { toggles++; return true }, snapshot: () => ({ state: 'idle' }) }),
    },
    './user-app-system': { registerUserAppScheme() {}, async startUserAppSystem() {} },
    './pi-sessions-source': { createPiSessionsSource: () => () => { throw new Error('MIC must not scan or control the monitor') } },
    './hydra-mqtt': { createHydraSource: () => ({ snapshot() {} }) },
    './weread-source': { createWeReadSource: () => ({ refresh: async () => {}, snapshot: () => ({ status: 'unconfigured' }) }) },
    './app-manager-endpoint': { createAppManagerEndpoint: () => ({}) },
    './opencode-go': {}, './face-agent-status': {},
  }
  vm.runInNewContext(fs.readFileSync('src/main.js', 'utf8'), {
    require: (id) => modules[id] || require(id), process: { argv: [], env: {} },
    module: { exports: {} }, __dirname: '/test', console, URLSearchParams,
  })
  await new Promise(resolve => setImmediate(resolve))
  onInput('mic')
  assert.equal(toggles, 1)
  assert.deepEqual(sent, [])
  onInput('right')
  assert.equal(sent[0][0], 'odk-remote-input')
  assert.equal(sent[0][1].input, 'right')
})
