const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')

const source = fs.readFileSync('src/renderer/core/app-platform.js', 'utf8')

function createHarness({ targetFails = false, actionAccepted = true, dispatchIntent } = {}) {
  const endpoint = createAppManagerEndpoint({ apps: [
    { appId: 'clock', name: '时钟', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
    { appId: 'target', name: '目标', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  ] })
  const calls = []
  const rootElement = { replaceChildren() { calls.push(['replace-children']) } }
  const plugins = [
    { id: 'app-clock', appId: 'clock', kind: 'app', app: '时钟', name: '时钟',
      mount() {}, handleAction: () => true },
    { id: 'app-target', appId: 'target', kind: 'app', app: '目标', name: '目标',
      mount() { if (targetFails) throw new Error('mount failed') },
      handleAction: () => actionAccepted },
  ]
  const host = {
    context: () => ({ onTick: () => () => {} }),
    runtimeRoot: () => rootElement,
    closeAppFrame: () => calls.push(['close-frame']),
    openAppFrame: ({ plugin }) => calls.push(['open-frame', plugin.appId]),
    openMissingApp: (appId) => calls.push(['missing', appId]),
    openRuntimeUnavailable: (...args) => calls.push(['runtime-error', ...args]),
    openAppActionError: (...args) => calls.push(['app-error', ...args]),
    showAppError: (...args) => calls.push(['app-error', ...args]),
  }
  const root = {
    odkCompanion: {
      dispatchIntent: dispatchIntent || ((intent) => endpoint.dispatch(intent)),
      listApps: () => endpoint.list(),
    },
    odkPlugins: {
      byKind: (kind) => kind === 'app' ? plugins : [],
      activate(plugin, element, context) {
        calls.push(['activate', plugin.appId])
        plugin.mount?.(element, context)
      },
      deactivate(plugin) {
        calls.push(['deactivate', plugin.appId])
      },
    },
  }
  const context = vm.createContext({ window: root, globalThis: root })
  vm.runInContext(source, context)
  return { endpoint, platform: root.odkAppPlatform.create({ host }), calls }
}

test('rolls back endpoint and local foreground after runtime startup failure', async () => {
  const { endpoint, platform, calls } = createHarness({ targetFails: true })
  assert.equal(await platform.openApp({ appId: 'clock' }), true)
  assert.equal(await platform.openApp({ appId: 'target' }), false)
  assert.equal(platform.active()?.appId, 'clock')
  assert.equal(endpoint.foreground().appId, 'clock')
  assert.equal(endpoint.get('clock').state, 'running')
  assert.equal(endpoint.get('target').state, 'installed')
  assert.equal(calls.some(([type]) => type === 'app-error'), true)
})

test('rolls back endpoint state when runtime rejects an action', async () => {
  const { endpoint, platform, calls } = createHarness({ actionAccepted: false })
  assert.equal(await platform.openApp({ appId: 'target' }), true)
  assert.equal(await platform.emitIntent({ type: 'action', appId: 'target', action: 'pause' }), false)
  assert.equal(endpoint.get('target').state, 'running')
  assert.equal(calls.some(([type]) => type === 'app-error'), true)
})

test('reports endpoint action failure without closing the current App', async () => {
  const { platform, calls } = createHarness({
    dispatchIntent(intent) {
      if (intent.type === 'open-app') return { ok: true, trace: [] }
      return { ok: false, error: 'endpoint-failed', trace: [] }
    },
  })
  assert.equal(await platform.openApp({ appId: 'clock' }), true)
  assert.equal(await platform.emitIntent({ type: 'action', appId: 'clock', action: 'start' }), false)
  assert.equal(platform.active().appId, 'clock')
  assert.equal(calls.some(([type]) => type === 'app-error'), true)
})

test('waits for endpoint stop before closing the App frame', async () => {
  let resolveStop
  const { platform, calls } = createHarness({
    dispatchIntent(intent) {
      if (intent.type === 'open-app') return { ok: true, trace: [] }
      if (intent.action === 'stop') return new Promise((resolve) => { resolveStop = resolve })
      return { ok: true, trace: [] }
    },
  })
  assert.equal(await platform.openApp({ appId: 'clock' }), true)
  const closing = platform.closeApp()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.some(([type]) => type === 'close-frame'), false)
  resolveStop({ ok: true, transition: { previousState: 'running', previousForegroundAppId: 'clock' }, trace: [] })
  assert.equal(await closing, true)
  assert.equal(calls.some(([type]) => type === 'close-frame'), true)
})

test('fails listApps instead of silently using the renderer catalog', async () => {
  const { platform } = createHarness({
    dispatchIntent: () => ({ ok: true, trace: [] }),
  })
  platform.listApps = async () => { throw new Error('endpoint-unavailable') }
  await assert.rejects(platform.listApps(), /endpoint-unavailable/)
})
