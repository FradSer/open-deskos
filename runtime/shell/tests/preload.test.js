const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')

const source = fs.readFileSync('src/preload.js', 'utf8')

function loadPreload(invoke) {
  const exposed = {}
  const listeners = new Map()
  const invokes = []
  const ipcRenderer = {
    invoke(channel, payload, ...extra) {
      invokes.push([channel, payload, ...extra])
      if (invoke) return invoke(channel, payload, ...extra)
      if (channel === 'odk-remote-link-state') {
        return Promise.resolve({ state: 'disconnected', sequence: 1 })
      }
      return Promise.resolve(true)
    },
    on(channel, callback) {
      listeners.set(channel, callback)
    },
    removeListener(channel, callback) {
      if (listeners.get(channel) === callback) listeners.delete(channel)
    },
  }
  vm.runInNewContext(source, {
    require(id) {
      assert.equal(id, 'electron')
      return {
        contextBridge: { exposeInMainWorld(name, value) { exposed[name] = value } },
        ipcRenderer,
      }
    },
  })
  return { exposed, listeners, invokes }
}

test('exposes platform actions and only narrow remote state APIs to the sandboxed renderer', async () => {
  const { exposed, listeners, invokes } = loadPreload()

  assert.deepEqual(Object.keys(exposed.odkPlatform).sort(), ['deviceGatewayAction', 'dispatchIntent', 'getAppState', 'getCameraFrame', 'getDeviceGateway', 'getFutuHoldings', 'getHydraDevice', 'getHydraStatus', 'getOpenCodeGoStatus', 'getPiSessionEvents', 'getPiSessions', 'getWeReadHighlight', 'getWeatherStatus', 'hydraDeviceAction', 'listApps'])
  await exposed.odkPlatform.getOpenCodeGoStatus()
  assert.deepEqual(invokes[0], ['odk-opencode-go-status', undefined])
  await exposed.odkPlatform.getCameraFrame()
  assert.deepEqual(invokes[1], ['odk-camera-frame', undefined])
  await exposed.odkPlatform.getPiSessions()
  assert.deepEqual(invokes[2], ['odk-pi-sessions', undefined])
  await exposed.odkPlatform.getPiSessionEvents({ cwd: '/workspace/one', sessionId: 'session-one' })
  assert.deepEqual(invokes[3], ['odk-pi-session-events', { cwd: '/workspace/one', sessionId: 'session-one' }])
  await exposed.odkRemote.publishPageState({ page: 1 })
  assert.deepEqual(invokes[4], ['odk-remote-publish-page-state', { page: 1 }])

  const states = []
  const unsubscribe = exposed.odkRemote.subscribeLinkState((state) => states.push(state))
  listeners.get('odk-remote-link-state')(null, { state: 'usb', sequence: 2 })
  await Promise.resolve()
  assert.deepEqual(states, ['usb'])

  const navigations = []
  const unsubscribeNavigation = exposed.odkRemote.subscribeNavigation((direction) => navigations.push(direction))
  listeners.get('odk-remote-navigation')(null, { direction: 'next' })
  assert.deepEqual(navigations, ['next'])

  const inputs = []
  const unsubscribeInput = exposed.odkRemote.subscribeInput((input) => inputs.push(input))
  listeners.get('odk-remote-input')(null, { input: 'primary' })
  assert.deepEqual(inputs, ['primary'])

  unsubscribe()
  unsubscribeNavigation()
  unsubscribeInput()
  assert.equal(listeners.has('odk-remote-link-state'), false)
  assert.equal(listeners.has('odk-remote-navigation'), false)
  assert.equal(listeners.has('odk-remote-input'), false)
})


test('Remote Link subscriptions read current state and fence initial replies after release', async () => {
  const { exposed, invokes } = loadPreload()
  const states = []
  const release = exposed.odkRemote.subscribeLinkState(state => states.push(state))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(invokes, [['odk-remote-link-state', undefined]])
  assert.deepEqual(states, ['disconnected'])
  release()
  const cancelled = []
  const stop = exposed.odkRemote.subscribeLinkState(state => cancelled.push(state))
  stop()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(cancelled, [])
})


test('session reply references cross the narrow preload bridge without adding target authority',async()=>{
 const {exposed,invokes}=loadPreload()
 const replyTo={messageId:'a'.repeat(64),sourceKey:'b'.repeat(64),sourceRevision:'c'.repeat(64)}
 assert.equal(exposed.odkPersonalAgent.supportsReplyTo,true)
 await exposed.odkPersonalAgent.sendText('继续',replyTo)
 assert.deepEqual(invokes.at(-1),['odk-personal-agent-text','继续',replyTo])
 await exposed.odkPersonalAgent.sendText('Ordinary')
 assert.deepEqual(invokes.at(-1),['odk-personal-agent-text','Ordinary'])
})

test('consumer readiness has a dedicated narrow bridge', async () => {
  const { exposed, invokes } = loadPreload()
  await exposed.odkPersonalAgent.consumerReady('11111111-1111-4111-8111-111111111111')
  assert.deepEqual(invokes, [['odk-personal-agent-consumer-ready', '11111111-1111-4111-8111-111111111111']])
})

test('Devices native fixture serves current Personal Agent preload calls before opening a window', async () => {
  const fixturePath = path.resolve('tests/device-gateway-electron.cjs')
  const fixtureRequire = createRequire(fixturePath)
  const handlers = new Map()
  vm.runInNewContext(fs.readFileSync(fixturePath, 'utf8'), {
    __dirname: path.dirname(fixturePath),
    process: { env: { ODK_DEVICE_GATEWAY_TEST_PROFILE: '/fixture-profile' } },
    require(id) {
      if (id !== 'electron') return fixtureRequire(id)
      return {
        app: { setPath() {}, whenReady: () => new Promise(() => {}) },
        ipcMain: { handle(channel, handler) { handlers.set(channel, handler) } },
      }
    },
  }, { filename: fixturePath })
  const { exposed } = loadPreload((channel, payload, ...extra) => {
    const handler = handlers.get(channel)
    assert.ok(handler, `No handler registered for ${channel}`)
    return Promise.resolve(handler({}, payload, ...extra))
  })
  assert.equal((await exposed.odkPersonalAgent.getStatus()).state, 'unavailable')
  assert.equal((await exposed.odkPersonalAgent.consumerReady('consumer')).accepted, false)
})

test('package device calls forward only their bound identity and request', async () => {
  const { exposed, invokes } = loadPreload()
  await exposed.odkUserApps.deviceRequest('sensor', 'a'.repeat(32), 'token', { type: 'read' })
  assert.deepEqual(JSON.parse(JSON.stringify(invokes)), [['odk-user-apps-device', { appId: 'sensor', revision: 'a'.repeat(32), frameToken: 'token', request: { type: 'read' } }]])
})

test('Hydra management exposes only the dedicated host request channel', async () => {
  const { exposed, invokes } = loadPreload()
  await exposed.odkPlatform.getHydraDevice()
  await exposed.odkPlatform.hydraDeviceAction({ type: 'bind', peer: '02:00:00:00:00:01' })
  await exposed.odkPlatform.hydraDeviceAction({ type: 'unbind' })
  const actions = [{ type: 'control-visibility', visible: true }, { type: 'prepare-water', node: 1, durationMs: 5000 },
    { type: 'prepare-plan', node: 1, season: 1, entries: [{ offsetMinutes: 15, intent: 3, night: false }] },
    { type: 'confirm', token: 'opaque-confirmation' }, { type: 'cancel' }, { type: 'control-visibility', visible: false }]
  for (const action of actions) await exposed.odkPlatform.hydraDeviceAction(action)
  assert.deepEqual(JSON.parse(JSON.stringify(invokes)), [
    ['odk-hydra-device', { type: 'status' }],
    ['odk-hydra-device', { type: 'bind', peer: '02:00:00:00:00:01' }],
    ['odk-hydra-device', { type: 'unbind' }],
    ...actions.map(action => ['odk-hydra-device', action]),
  ])
})
