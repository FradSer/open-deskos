const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')

const source = fs.readFileSync('src/renderer/core/app-platform.js', 'utf8')

function createHarness({ targetFails = false, targetRejected = false, clockFailsAfterStart = false, actionAccepted = true, dispatchIntent, releaseGate, releaseCallback } = {}) {
  const endpoint = createAppManagerEndpoint({ apps: [
    { appId: 'clock', name: '时钟', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
    { appId: 'target', name: '目标', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  ] })
  const calls = []
  const rootElement = { replaceChildren() { calls.push(['replace-children']) } }
  let clockMounts = 0
  const plugins = [
    { id: 'app-clock', appId: 'clock', kind: 'app', app: '时钟', name: '时钟',
      mount() { clockMounts += 1; if (clockFailsAfterStart && clockMounts > 1) throw new Error('clock remount failed') }, handleAction: () => true },
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
    odkPlatform: {
      dispatchIntent: dispatchIntent || ((intent) => endpoint.dispatch(intent)),
      listApps: () => endpoint.list(),
    },
    odkPlugins: {
      byKind: (kind) => kind === 'app' ? plugins : [],
      activate(plugin, element, context) {
        calls.push(['activate', plugin.appId])
        if (targetRejected && plugin.appId === 'target') return false
        plugin.mount?.(element, context)
      },
      deactivate(plugin) {
        calls.push(['deactivate', plugin.appId])
        return releaseCallback ? releaseCallback(plugin) : releaseGate
      },
    },
  }
  const context = vm.createContext({ window: root, structuredClone, globalThis: root })
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
  assert.equal(calls.some(([type]) => type === 'runtime-error'), true)
})

test('clears endpoint foreground when target and foreground restoration both fail', async () => {
  const { endpoint, platform, calls } = createHarness({ targetFails: true, clockFailsAfterStart: true })
  assert.equal(await platform.openApp({ appId: 'clock' }), true)
  assert.equal(await platform.openApp({ appId: 'target' }), false)
  assert.equal(platform.active(), null)
  assert.equal(endpoint.foreground(), null)
  assert.equal(calls.some(([type]) => type === 'runtime-error'), true)
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

test('a registry activation refusal rolls back the endpoint and reports unavailable', async () => {
  const { endpoint, platform, calls } = createHarness({ targetRejected: true })
  assert.equal(await platform.openApp({ appId: 'target' }), false)
  assert.equal(platform.active(), null)
  assert.equal(endpoint.foreground(), null)
  assert.equal(endpoint.get('target').state, 'installed')
  assert.equal(calls.some(([type]) => type === 'runtime-error'), true)
})

test('switching Apps waits for the previous surface release', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { platform, calls } = createHarness({ releaseGate: gate })
  await platform.openApp({ appId: 'clock' })
  const opening = platform.openApp({ appId: 'target' })
  await new Promise(setImmediate)
  const mountedBeforeRelease = calls.some(([type, id]) => type === 'activate' && id === 'target')
  release()
  assert.equal(await opening, true)
  assert.equal(mountedBeforeRelease, false)
})

test('consecutive App switches preserve request order while surface release is pending', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { platform, endpoint } = createHarness({ releaseGate: gate })
  await platform.openApp({ appId: 'clock' })
  const target = platform.openApp({ appId: 'target' })
  const clock = platform.openApp({ appId: 'clock' })
  await new Promise(setImmediate)
  release()
  assert.deepEqual(await Promise.all([target, clock]), [true, true])
  assert.equal(platform.active()?.appId, 'clock')
  assert.equal(endpoint.foreground()?.appId, 'clock')
})

test('a failed replacement mount drains real registry cleanup before foreground restoration', async () => {
  const { createPluginHost } = require('../src/plugin-host')
  let release
  let entered
  const gate = new Promise(resolve => { release = resolve })
  const mounted = new Promise(resolve => { entered = resolve })
  const endpoint = createAppManagerEndpoint({ apps: [
    { appId: 'clock', name: 'Clock', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
    { appId: 'target', name: 'Target', kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [] },
  ] })
  const root = { odkPluginHost: { createPluginHost }, odkPlatform: { dispatchIntent: intent => endpoint.dispatch(intent) } }
  const context = vm.createContext({ window: root, structuredClone, console: { error() {} } })
  vm.runInContext(fs.readFileSync('src/renderer/core/registry.js', 'utf8'), context)
  vm.runInContext(source, context)
  const clock = { id: 'odk.app.clock', appId: 'clock', kind: 'app', manifest: { schemaVersion: 1 }, mount() {} }
  const target = { id: 'odk.app.target', appId: 'target', kind: 'app', manifest: { schemaVersion: 1 }, mount() {} }
  root.odkPlugins.register(clock)
  root.odkPlugins.register(target)
  await root.odkPlugins.start({ replacements: [{ ...target, lifecycle: undefined, mount(_el, ctx) {
    ctx.trackCleanup(() => gate)
    entered()
    throw Error('fixture mount failed')
  } }] })
  const element = { replaceChildren() {} }
  const platform = root.odkAppPlatform.create({ host: {
    context: () => ({ onTick: () => () => {} }), runtimeRoot: () => element,
    openAppFrame() {}, closeAppFrame() {}, openMissingApp() {}, openRuntimeUnavailable() {},
  } })
  assert.equal(await platform.openApp({ appId: 'clock' }), true)
  let completed = false
  const opening = platform.openApp({ appId: 'target' }).then(result => { completed = true; return result })
  await mounted
  await new Promise(setImmediate)
  const beforeRelease = completed
  release()
  assert.equal(await opening, false)
  assert.equal(beforeRelease, false)
  assert.equal(platform.active()?.appId, 'clock')
  assert.equal(endpoint.foreground()?.appId, 'clock')
  await root.odkPlugins.stop()
})


for (const operation of ['close', 'switch']) {
  test(`failed App ${operation} retains runtime ownership for a close retry`, async () => {
    let fail = true
    let attempts = 0
    const { platform, endpoint, calls } = createHarness({ releaseCallback() {
      attempts++
      if (fail) return Promise.reject(Error('surface retained'))
    } })
    assert.equal(await platform.openApp({ appId: 'clock' }), true)
    const closedBefore = calls.filter(([type]) => type === 'close-frame').length
    assert.equal(await (operation === 'close' ? platform.closeApp() : platform.openApp({ appId: 'target' })), false)
    assert.equal(platform.active()?.appId, 'clock')
    assert.equal(endpoint.foreground()?.appId, 'clock')
    assert.equal(calls.some(([type, id]) => type === 'activate' && id === 'target'), false)
    assert.equal(calls.filter(([type]) => type === 'close-frame').length, closedBefore)
    assert.equal(attempts, 1)
    fail = false
    assert.equal(await platform.closeApp(), true)
    assert.equal(attempts, 2)
    assert.equal(platform.active(), null)
    assert.equal(endpoint.foreground(), null)
  })
}


for (const operation of ['close', 'switch']) {
  test(`real registry retains failed cleanup during App ${operation} and drains the retry`, async () => {
    const { createPluginHost } = require('../src/plugin-host')
    const endpoint = createAppManagerEndpoint({ apps: ['clock', 'target'].map(appId => ({
      appId, name: appId, kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [],
    })) })
    const root = { odkPluginHost: { createPluginHost }, odkPlatform: { dispatchIntent: intent => endpoint.dispatch(intent) } }
    const context = vm.createContext({ window: root, structuredClone, console: { error() {} } })
    vm.runInContext(fs.readFileSync('src/renderer/core/registry.js', 'utf8'), context)
    vm.runInContext(source, context)
    let fail = true
    let cleanups = 0
    let targetMounts = 0
    let framesClosed = 0
    const clock = { id: 'odk.app.clock', appId: 'clock', kind: 'app', manifest: { schemaVersion: 1 },
      mount(_el, ctx) { ctx.trackCleanup(async () => { cleanups++; if (fail) throw Error('retry owned resource') }) },
    }
    root.odkPlugins.register(clock)
    root.odkPlugins.register({ id: 'odk.app.target', appId: 'target', kind: 'app', manifest: { schemaVersion: 1 },
      mount() { targetMounts++ },
    })
    await root.odkPlugins.start()
    const element = { replaceChildren() {} }
    const platform = root.odkAppPlatform.create({ host: {
      context: () => ({ onTick: () => () => {} }), runtimeRoot: () => element,
      openAppFrame() {}, closeAppFrame() { framesClosed++ }, openMissingApp() {},
      openRuntimeUnavailable() {}, openAppActionError() {},
    } })
    assert.equal(await platform.openApp({ appId: 'clock' }), true)
    assert.equal(await (operation === 'close' ? platform.closeApp() : platform.openApp({ appId: 'target' })), false)
    assert.equal(platform.active()?.appId, 'clock')
    assert.equal(endpoint.foreground()?.appId, 'clock')
    assert.equal(targetMounts, 0)
    assert.equal(framesClosed, 0)
    assert.equal(cleanups, 1)
    fail = false
    assert.equal(await platform.closeApp(), true)
    assert.equal(cleanups, 2)
    assert.equal(framesClosed, 1)
    assert.equal(platform.active(), null)
    assert.equal(endpoint.foreground(), null)
    await root.odkPlugins.stop()
  })
}


test('the close error Retry drains retained runtime ownership', async () => {
  let fail = true
  let attempts = 0
  const { platform, endpoint, calls } = createHarness({ releaseCallback() {
    attempts++
    if (fail) throw Error('retained')
  } })
  await platform.openApp({ appId: 'clock' })
  assert.equal(await platform.closeApp(), false)
  const retry = calls.find(([type]) => type === 'app-error').at(-1)
  fail = false
  assert.equal(await retry(), true)
  assert.equal(attempts, 2)
  assert.equal(platform.active(), null)
  assert.equal(endpoint.foreground(), null)
})

test('a failed partial mount remains the owned foreground until close Retry succeeds', async () => {
  let fail = true
  let attempts = 0
  const { platform, endpoint, calls } = createHarness({ targetFails: true, releaseCallback(plugin) {
    if (plugin.appId === 'target') { attempts++; if (fail) throw Error('partial resource retained') }
  } })
  await platform.openApp({ appId: 'clock' })
  assert.equal(await platform.openApp({ appId: 'target' }), false)
  assert.equal(platform.active()?.appId, 'target')
  assert.equal(platform.active()?.state, 'failed')
  assert.equal(endpoint.foreground()?.appId, 'target')
  const before = attempts
  fail = false
  assert.equal(await platform.closeApp(), true)
  assert.equal(attempts, before + 1)
  assert.equal(platform.active(), null)
  assert.equal(endpoint.foreground(), null)
  assert.equal(calls.filter(([type, id]) => type === 'activate' && id === 'clock').length, 1)
})


test('real failed partial mount keeps its endpoint and releases resources through the dialog Retry', async () => {
  const { createPluginHost } = require('../src/plugin-host')
  const endpoint = createAppManagerEndpoint({ apps: ['clock', 'target'].map(appId => ({
    appId, name: appId, kind: 'ui', version: 'builtin', source: 'builtin', capabilities: [],
  })) })
  const root = { odkPluginHost: { createPluginHost }, odkPlatform: { dispatchIntent: intent => endpoint.dispatch(intent) } }
  const context = vm.createContext({ window: root, structuredClone, console: { error() {} } })
  vm.runInContext(fs.readFileSync('src/renderer/core/registry.js', 'utf8'), context)
  vm.runInContext(source, context)
  let fail = true
  let cleanups = 0
  let clockMounts = 0
  let retry
  root.odkPlugins.register({ id: 'odk.app.clock', appId: 'clock', kind: 'app', manifest: { schemaVersion: 1 },
    mount() { clockMounts++ },
  })
  root.odkPlugins.register({ id: 'odk.app.target', appId: 'target', kind: 'app', manifest: { schemaVersion: 1 },
    mount(_el, ctx) {
      ctx.trackCleanup(async () => { cleanups++; if (fail) throw Error('partial retained') })
      throw Error('mount failed')
    },
  })
  await root.odkPlugins.start()
  const element = { replaceChildren() {} }
  const platform = root.odkAppPlatform.create({ host: {
    context: () => ({ onTick: () => () => {} }), runtimeRoot: () => element,
    openAppFrame() {}, closeAppFrame() {}, openMissingApp() {}, openRuntimeUnavailable() {},
    openAppActionError(_intent, _reason, callback) { retry = callback },
  } })
  await platform.openApp({ appId: 'clock' })
  assert.equal(await platform.openApp({ appId: 'target' }), false)
  assert.equal(platform.active()?.appId, 'target')
  assert.equal(platform.active()?.state, 'failed')
  assert.equal(endpoint.foreground()?.appId, 'target')
  assert.equal(clockMounts, 1)
  assert.equal(await platform.closeApp(), false)
  const attempts = cleanups
  fail = false
  assert.equal(await retry(), true)
  assert.equal(cleanups, attempts + 1)
  assert.equal(platform.active(), null)
  assert.equal(endpoint.foreground(), null)
  assert.equal(await platform.openApp({ appId: 'clock' }), true)
  await platform.closeApp()
  await root.odkPlugins.stop()
})
