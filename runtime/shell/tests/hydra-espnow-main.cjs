'use strict'
// This controlled adapter supplies synthetic telemetry/control, never device evidence.
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { RemoteBridge } = require('../../../integrations/remote-bridge/lib/remote-bridge')
const { resolveShellHost } = require('../src/platform')
const { TYPES, decodeControlFrame, encodeControlFrame } = require('../src/hydra-control-codec')
const profile = process.env.ODK_HYDRA_RADIO_PROFILE
assert.ok(profile && path.isAbsolute(profile))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.getAppPath = () => path.resolve(__dirname, '..')
if (process.platform === 'darwin') app.dock.hide()
BrowserWindow.prototype.show = function () {}
const peer = '02:11:22:33:44:55', remote = 'f0:9e:9e:11:23:cc'
const gateway = '9c:cc:01:34:31:50'
// Explicitly fake, disposable fixture bytes. Never use a real pairing/control key.
const syntheticControlKey = Buffer.alloc(32, 0x42), controlBoot = 0x8899aabbccddeeffn
const stateDir = resolveShellHost().stateDir
assert.equal(stateDir, path.join(process.env.XDG_STATE_HOME, 'odk'))
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 })
fs.writeFileSync(path.join(stateDir, 'hydra-espnow.json'), JSON.stringify({ schemaVersion: 1, peer }), { mode: 0o600 })
fs.writeFileSync(path.join(stateDir, 'hydra-control.key'), syntheticControlKey, { mode: 0o600, flag: 'wx' })
const hydraRequests = [], originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, handler) => originalHandle(channel, channel === 'odk-hydra-device'
  ? (event, request) => { hydraRequests.push(structuredClone(request)); return handler(event, request) } : handler)
const layout = {}
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/renderer/config/desktop_layout.js'), 'utf8'), layout)
process.env.ODK_DISABLED_PLUGINS += ',' + layout.DESKTOP_LAYOUT.pages.flatMap(page => page.widgets?.map(widget => widget.id) || [page.plugin])
  .filter(id => id !== 'odk.tile.hydra').join(',')
const mqtt = require('../src/hydra-mqtt')
let mqttConstructed = 0
const forbidden = () => { mqttConstructed++; throw Error('Default Hydra attempted MQTT') }
mqtt.createHydraSource = forbidden
mqtt.connectHydraMqtt = forbidden
const hostModule = require('../src/plugin-host'), createHost = hostModule.createPluginHost
let host
hostModule.createPluginHost = options => {
  const created = createHost(options)
  if (options.capabilities?.['source.hydra']) host = created
  return created
}
let interval, starts = 0, stops = 0, seq = 0
let issuedId = 0n, pendingChallenge = null, acceptedPlan = null
const controlFrames = []
const adapter = new EventEmitter()
const deviceNow = () => 100000 + Math.floor(performance.now())
function emitControl(frame, code = TYPES.CHALLENGE, body = Buffer.alloc(0)) {
  const output = encodeControlFrame({ ...frame, type: code, main: peer, gateway, boot: controlBoot, body }, syntheticControlKey)
  queueMicrotask(() => adapter.emit('device-event', { peer, payload: output.toString('base64'), receivedAt: Date.now() }))
}
function acknowledge(frame, code) {
  const body = Buffer.alloc(7); body[0] = frame.body[0]; body[1] = code
  if (frame.type === TYPES.WATER) body.writeUInt32LE(deviceNow() + frame.body.readUInt32LE(1), 3)
  emitControl({ ...frame, deadline: (deviceNow() + 5000) >>> 0 }, TYPES.ACK, body)
}
const actuatorFrames = () => controlFrames.filter(frame => [TYPES.WATER, TYPES.STOP, TYPES.PLAN].includes(frame.type))
const snapshot = () => ({ status: 'live', reason: '', gateway: { status: 'live', mac: gateway, firmware: 'gateway-fixture', channel: 6 },
  remote: { mac: remote, status: 'disconnected' }, peers: [{ mac: peer, role: 'device', status: 'paired' }, { mac: remote, role: 'remote', status: 'paired' }], events: [] })
Object.assign(adapter, {
  async start() {
    starts++
    interval = setInterval(() => {
      adapter.emit('device-snapshot', snapshot())
      for (const record of [{ k: 'hello', firmware: 'odk-hydra-main-1', uptime: 10, clock: false },
        { k: 'env', age: 0, valid: true, tc: 24.5, rh: 61.2, hp: 1002.6, lx: 12340, vp: 1.23 },
        { k: 'node', id: 1, age: 0, online: true, soil: 62.4, status: 'PULSE' }]) {
        const payload = Buffer.from(JSON.stringify({ p: 'hydra', v: 1, boot: '0123456789abcdef', seq: ++seq, ...record })).toString('base64')
        adapter.emit('device-event', { peer, payload, receivedAt: Date.now() })
      }
    }, 500)
  },
  async stop() { stops++; clearInterval(interval) },
  deviceSnapshot: snapshot,
  async deviceAction(action) {
    assert.equal(action.type, 'send'); assert.equal(action.peer, peer)
    const frame = decodeControlFrame(Buffer.from(action.payload, 'base64'), syntheticControlKey, { main: peer, gateway })
    assert.ok(frame, 'Real broker must send a correctly authenticated HDC1 packet')
    controlFrames.push(frame)
    if (frame.type === TYPES.QUERY) {
      const body = Buffer.alloc(8)
      if (frame.commandId === 0n) {
        body.writeBigUInt64LE(issuedId)
        emitControl({ ...frame, challenge: Buffer.alloc(16), deadline: 0 }, TYPES.CHALLENGE, body)
      } else {
        assert.ok(frame.commandId > issuedId); issuedId = frame.commandId
        pendingChallenge = { ...frame, boot: controlBoot, challenge: Buffer.alloc(16, Number(issuedId & 255n) || 1), deadline: (deviceNow() + 5000) >>> 0 }
        body.writeBigUInt64LE(issuedId); emitControl(pendingChallenge, TYPES.CHALLENGE, body)
      }
    } else if (frame.type === TYPES.HEARTBEAT) {
      assert.equal(frame.boot, controlBoot)
    } else {
      assert.ok([TYPES.WATER, TYPES.STOP, TYPES.PLAN].includes(frame.type))
      assert.equal(frame.boot, controlBoot); assert.equal(frame.commandId, pendingChallenge.commandId)
      assert.deepEqual(frame.challenge, pendingChallenge.challenge); assert.equal(frame.deadline, pendingChallenge.deadline)
      if (frame.type === TYPES.PLAN) acceptedPlan = frame
      acknowledge(frame, 1)
    }
    return { ok: true, delivery: 'esp-now' }
  },
})
const bridge = new RemoteBridge({ adapter, socketPath: path.join(process.env.XDG_RUNTIME_DIR, 'odk-remote', 'bridge.sock'), logger: { error: console.error } })
let failed = false
let fixtureWindow = null, releasePromise = null
let rendererLifecycle = null
const deadline = setTimeout(() => { void fail(Error('HYDRA_RADIO_MAIN_TIMEOUT')) }, 40000)
function releaseFixture() {
  if (releasePromise) return releasePromise
  releasePromise = (async () => {
    const failures = []
    if (fixtureWindow && !fixtureWindow.isDestroyed()) {
      try {
        rendererLifecycle = await fixtureWindow.webContents.executeJavaScript(`(async()=>{
          await window.odkAppPlatform?.closeApp();
          await window.odkRendererRuntime?.stop();
          window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));
          for(let i=0;i<100;i++){
            const states=[...odkTheme.catalog(),...odkRendererDiagnosis.catalog()].map(item=>item.state);
            if(states.every(state=>state==='stopped'||state==='disabled'))return {released:true,states};
            await new Promise(resolve=>setTimeout(resolve,20));
          }
          throw Error('Actual Main renderer lifecycle hosts did not stop');
        })()`)
        assert.equal(rendererLifecycle.released, true)
      } catch (error) { failures.push(error) }
      try { await fixtureWindow.webContents.session.closeAllConnections() } catch (error) { failures.push(error) }
    }
    try { await host?.stop() } catch (error) { failures.push(error) }
    try { await bridge.stop() } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, 'Actual Main fixture cleanup failed')
  })()
  return releasePromise
}
async function fail(error) {
  if (failed) return
  failed = true; clearTimeout(deadline); console.error(error)
  try { await releaseFixture() } catch (cleanupError) { console.error(cleanupError) }
  finally { app.exit(1) }
}
app.on('browser-window-created', (_event, win) => {
  fixtureWindow = win
  win.webContents.setBackgroundThrottling(false)
  win.webContents.once('did-finish-load', () => { void (async () => {
    const js = code => win.webContents.executeJavaScript(code)
    const consumer = await js(`(async () => {
      await window.odkShellReady;
      const until = async check => { const end = Date.now() + 12000; while (!await check()) {
        if (Date.now() > end) throw Error('Actual default Hydra did not reach its consumers');
        await new Promise(resolve => setTimeout(resolve, 30));
      }};
      await until(async () => (await window.odkPlatform.getHydraStatus()).env?.tempC === 24.5
        && document.querySelector('[data-widget="odk.tile.hydra"] #hydra-env-temp .hydra-env-value')?.textContent === '24.5'
        && document.querySelector('[data-widget="odk.tile.hydra"] #hydra-plant-1 .hydra-plant-soil')?.textContent === '62%');
      const management = await window.odkPlatform.getHydraDevice();
      if (!await window.odkAppPlatform.openApp({appId:'hydra'})) throw Error('Hydra App did not open');
      await until(() => document.querySelector('.environment-readings')?.textContent.includes('24.5°C')
        && document.querySelector('.plant-readings')?.textContent.includes('62.4%'));
      return { management, snapshot: await window.odkPlatform.getHydraStatus() };
    })()`)
    assert.equal(consumer.management.peer, peer)
    assert.equal(consumer.management.status, 'live')
    assert.equal(consumer.snapshot.connected, true)
    assert.equal(consumer.snapshot.nodes[0].soilPercent, 62.4)
    assert.equal(host.list().find(item => item.manifest.id === 'odk.source.hydra').manifest.requires.some(port => port.interface === 'odk:source/device-gateway/v1'), true)
    assert.equal(host.get('odk:plugin-health/odk.source.hydra/v1').snapshot().state, 'healthy')
    assert.equal((await host.get('odk:desk-reading/hydra/v1')[0].read()).value.greenhouse.temperatureC, 24.5)
    await js(`window.hydraFixtureUntil = async check => {
      const end = Date.now() + 8000;
      while (!await check()) { if (Date.now() > end) throw Error('Hydra control integration did not settle'); await new Promise(resolve => setTimeout(resolve, 25)); }
    };
    (async()=>{
      if (!await odkAppPlatform.closeApp()) throw Error('Hydra App did not close');
      if (!await odkAppPlatform.openApp({appId:'devices'})) throw Error('Devices App did not open');
      await hydraFixtureUntil(async()=> (await odkPlatform.getHydraDevice()).control?.available === true
        && document.querySelector('#app-runtime [data-control-fields]')?.disabled === false);
    })()`)
    assert.equal(actuatorFrames().length, 0)
    await js(`document.querySelector('#app-runtime [data-review-water]').click();
      hydraFixtureUntil(()=>document.querySelector('#app-runtime [data-control-confirmation]')?.hidden===false)`)
    assert.equal(actuatorFrames().length, 0, 'Reviewing water may query status, never dispatch an actuator command')
    assert.ok(controlFrames.some(frame => frame.type === TYPES.QUERY && frame.commandId === 0n))
    assert.equal(controlFrames.some(frame => frame.type === TYPES.QUERY && frame.commandId !== 0n), false)
    assert.deepEqual(hydraRequests.find(request => request.type === 'prepare-water'), { type: 'prepare-water', node: 1, durationMs: 5000 })
    await js(`document.querySelector('#app-runtime [data-control-confirm]').click();
      document.querySelector('#app-runtime [data-control-confirm]').click();
      hydraFixtureUntil(async()=> (await odkPlatform.getHydraDevice()).control?.result?.state==='accepted-main')`)
    assert.equal(actuatorFrames().filter(frame => frame.type === TYPES.WATER).length, 1)
    assert.equal(hydraRequests.filter(request => request.type === 'confirm').length, 1)
    const waterState = await js('odkPlatform.getHydraDevice()')
    assert.equal(waterState.control.result.state, 'accepted-main')
    assert.equal(waterState.control.lease.active, true)
    const waterCommand = actuatorFrames()[0]
    assert.equal(waterCommand.boot, controlBoot, 'Control boot is independent of the telemetry boot string')
    const heartbeatDeadline = Date.now() + 3000
    while (!controlFrames.some(frame => frame.type === TYPES.HEARTBEAT)) {
      if (Date.now() >= heartbeatDeadline) throw Error('Confirmed water did not send a shared-Bridge heartbeat')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    const firstHeartbeat = controlFrames.find(frame => frame.type === TYPES.HEARTBEAT)
    assert.equal(firstHeartbeat.boot, waterCommand.boot)
    assert.equal(firstHeartbeat.commandId, waterCommand.commandId)
    assert.deepEqual(firstHeartbeat.challenge, waterCommand.challenge)
    assert.equal(firstHeartbeat.body[0], waterCommand.body[0])
    assert.ok(firstHeartbeat.body.readUInt32LE(1) > 0)
    await js(`odkAppPlatform.closeApp().then(()=>hydraFixtureUntil(async()=>!(await odkPlatform.getHydraDevice()).control.lease.active))`)
    const heartbeatCount = controlFrames.filter(frame => frame.type === TYPES.HEARTBEAT).length
    await new Promise(resolve => setTimeout(resolve, 350))
    assert.equal(controlFrames.filter(frame => frame.type === TYPES.HEARTBEAT).length, heartbeatCount, 'Closing Devices stops host contact')
    await js(`(async()=>{
      if (!await odkAppPlatform.openApp({appId:'devices'})) throw Error('Devices App did not reopen');
      await hydraFixtureUntil(async()=> (await odkPlatform.getHydraDevice()).control?.planSequence?.available===true
        && document.querySelector('#app-runtime [data-review-plan]')?.disabled===false);
      document.querySelector('#app-runtime [data-review-plan]').click();
      await hydraFixtureUntil(()=>document.querySelector('#app-runtime [data-control-confirmation]')?.hidden===false);
    })()`)
    const planRequest = hydraRequests.find(request => request.type === 'prepare-plan')
    assert.deepEqual(planRequest, { type: 'prepare-plan', node: 1, season: 1, entries: [{ offsetMinutes: 0, intent: 3, night: false }] })
    assert.equal(Object.hasOwn(planRequest, 'windowSeq'), false, 'Public plan callers cannot choose the durable sequence')
    assert.equal(actuatorFrames().filter(frame => frame.type === TYPES.PLAN).length, 0)
    await js(`document.querySelector('#app-runtime [data-control-confirm]').click();
      hydraFixtureUntil(async()=> (await odkPlatform.getHydraDevice()).control?.result?.state==='accepted-main')`)
    assert.ok(acceptedPlan)
    const reserved = JSON.parse(fs.readFileSync(path.join(stateDir, 'hydra-control-plan-sequences.json'), 'utf8'))
    assert.equal(reserved.peers[peer]['1'], acceptedPlan.body.readUInt32LE(1))
    assert.ok(reserved.peers[peer]['1'] > 0)
    assert.equal(fs.statSync(path.join(stateDir, 'hydra-control-plan-sequences.json')).mode & 0o777, 0o600)
    acknowledge(acceptedPlan, 2)
    await js(`hydraFixtureUntil(async()=> (await odkPlatform.getHydraDevice()).control?.result?.state==='leaf-installed'
      && document.querySelector('#app-runtime [data-control-result]')?.textContent.includes('Watering execution is not confirmed'))`)
    assert.equal(actuatorFrames().filter(frame => frame.type === TYPES.PLAN).length, 1)
    await js(`(async()=>{
      const iframe=document.createElement('iframe');iframe.name='hydra-control-opaque-fixture';
      iframe.setAttribute('sandbox','allow-scripts');iframe.srcdoc='<p>Opaque control fixture</p>';
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Opaque frame did not load')),3000);
        iframe.onload=()=>{clearTimeout(timer);resolve()};document.body.append(iframe)});
    })()`)
    const opaque = win.webContents.mainFrame.frames.find(frame => frame.name === 'hydra-control-opaque-fixture')
    assert.ok(opaque)
    assert.equal(opaque.origin, 'null')
    assert.equal(await opaque.executeJavaScript('typeof window.odkPlatform'), 'undefined', 'Opaque iframe has no privileged preload platform')
    await js('document.querySelector("iframe[name=hydra-control-opaque-fixture]").remove()')
    await js('odkAppPlatform.closeApp()')
    assert.equal(bridge.clients.size, 1)
    assert.equal(bridge.adapter, adapter, 'The sole synthetic Bridge adapter never falls back to USB')
    assert.equal(adapter.listenerCount('device-event'), 1)
    assert.equal(starts, 1)
    assert.equal(mqttConstructed, 0)
    await releaseFixture()
    assert.equal(stops, 1)
    assert.equal(bridge.clients.size, 0)
    assert.equal(adapter.listenerCount('device-event'), 0)
    clearTimeout(deadline)
    console.log(JSON.stringify({ productionMain: true, actualPreload: true, sharedBridge: true, physicalDevice: false,
      mqttConstructed, widget: true, app: true, released: true, syntheticControl: true,
      waterCommands: actuatorFrames().filter(frame => frame.type === TYPES.WATER).length,
      planCommands: actuatorFrames().filter(frame => frame.type === TYPES.PLAN).length,
      positiveHeartbeat: true, planSequenceReserved: true, leafInstallationHistory: true, opaquePlatformAbsent: true, usbFallback: false,
      rendererLifecycleReleased: rendererLifecycle.released, result: 'CHECKS_PASSED' }))
    // Only the parent can prove natural process exit and close with code zero.
    win.webContents.stopPainting()
    win.destroy(); app.quit()
  })().catch(fail) })
})
// Main must register its privileged schemes before Electron becomes ready.
// Bridge starts concurrently; the real client retains its normal reconnect path.
void bridge.start().catch(fail)
require('../src/main')
