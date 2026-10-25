'use strict'
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const { createRemoteBridgeClient } = require('../src/remote-bridge-client')
const { capturePaintedPage } = require('./helpers/native-page-capture')
const profile = process.env.ODK_DEVICE_GATEWAY_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'odk-gateway-ui-'))
const report = value => {
  console.log(JSON.stringify(value))
  if (process.env.ODK_DEVICE_GATEWAY_TEST_RESULT) fs.writeFileSync(process.env.ODK_DEVICE_GATEWAY_TEST_RESULT, JSON.stringify({ ...value, run: process.env.ODK_DEVICE_GATEWAY_TEST_RUN }))
}
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const endpoint = createAppManagerEndpoint()
const hydraPeer = '02:00:00:00:00:21'
const fixture = { status: 'live', reason: '',
  gateway: { status: 'live', serialNumber: '9C:CC:01:34:31:50', mac: '9c:cc:01:34:31:50', firmware: '0.1.0', channel: 1, receivedAt: Date.now() },
  remote: { mac: 'f0:9e:9e:11:23:cc', status: 'ready', lastSeen: Date.now() },
  peers: [{ mac: 'f0:9e:9e:11:23:cc', role: 'remote', status: 'paired' },
    { mac: hydraPeer, role: 'device', status: 'live', lastSeen: Date.now() }], events: [] }
let current = fixture
let liveSource = null
let bridgeClient = null
let hold = null
let hydra = { transport: 'esp-now', peer: null, status: 'unconfigured', availablePeers: [hydraPeer], nodes: [] }
const hydraActions = []
let holdHydra = null
let controlToken = 0
const rendererErrors = []
let rendererErrorCount = 0
let rendererPhase = 'shell-start'
const sdkBaselineErrors = []
const sdkPath = path.resolve(__dirname, '../src/renderer/themes/liquid-glass-sdk.js')
const sdkSourceURL = pathToFileURL(sdkPath).href
const sdkError = /^Creating a worker from 'blob:file:\/\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' violates the following Content Security Policy directive: "script-src 'self' odk-native-plugin:"\. Note that 'worker-src' was not explicitly set, so 'script-src' is used as a fallback\. The action has been blocked\.$/
let fixtureWindow = null
let lifecycleReleased = false
async function releaseFixture() {
  const failures = []
  if (fixtureWindow && !fixtureWindow.isDestroyed()) {
    try { const lifecycle = await fixtureWindow.webContents.executeJavaScript(`(async()=>{
      if(window.gatewayHarness){while(gatewayHarness.cleanups.length)await gatewayHarness.cleanups.pop()();gatewayHarness.ticks.length=0;}
      await window.odkRendererRuntime?.stop();
      window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));
      for(let i=0;i<100;i++){
        const states=[...odkTheme.catalog(),...odkRendererDiagnosis.catalog()].map(item=>item.state);
        if(states.every(state=>state==='stopped'||state==='disabled'))return {manualCallbacks:window.gatewayHarness?.cleanups.length||0,states};
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      throw Error('Renderer lifecycle hosts did not stop');
    })()`); assert.equal(lifecycle.manualCallbacks, 0); lifecycleReleased = true } catch (error) { failures.push(error) }
    try { await fixtureWindow.webContents.session.closeAllConnections() } catch (error) { failures.push(error) }
  }
  try { await liveSource?.stop() } catch (error) { failures.push(error) }
  try { await bridgeClient?.stop() } catch (error) { failures.push(error) }
  if (failures.length) throw new AggregateError(failures, 'Devices fixture cleanup failed')
}
ipcMain.handle('odk-hydra-device', (event, request) => {
  if (event.senderFrame !== event.sender.mainFrame) return { ok: false, error: 'unauthorized' }
  if (process.env.ODK_DEVICE_GATEWAY_TEST_SOCKET) return { transport: 'esp-now', peer: null, status: 'unconfigured', availablePeers: [], nodes: [] }
  if (request.type === 'status') return holdHydra ? new Promise(resolve => { holdHydra = () => resolve(hydra) }) : hydra
  if (request.type === 'control-visibility') return { ok: true }
  hydraActions.push(request)
  if (request.type === 'cancel') { if (hydra.control) hydra.control = { ...hydra.control, pending: null, lease: { active: false } }; return { ok: true } }
  if (request.type.startsWith('prepare-') && hydra.control?.available) {
    const { type, ...fields } = request
    const summary = { action: type.slice(8), ...fields }
    if (summary.action === 'plan') summary.windowSeq = 123
    hydra.control = { ...hydra.control, pending: { token: `fixture-token-${++controlToken}`, summary, expiresInMs: 30000 } }
    return { ok: true, ...hydra.control.pending }
  }
  if (request.type === 'confirm' && request.token === hydra.control?.pending?.token) {
    const summary = hydra.control.pending.summary
    hydra.control = { ...hydra.control, pending: null, result: { ...summary, state: 'accepted-main', commandId: '1' } }
    return { ok: true, state: 'awaiting-ack', commandId: '1' }
  }
  if (request.type === 'bind' && request.peer === hydraPeer) {
    hydra = { ...hydra, peer: hydraPeer, status: 'syncing' }; return { ok: true }
  }
  if (request.type === 'unbind') { hydra = { ...hydra, peer: null, status: 'unconfigured', nodes: [] }; return { ok: true } }
  return { ok: false }
})
ipcMain.handle('odk-device-gateway', (event, request) => {
  if (liveSource) return liveSource.dispatch(event, request)
  if (request.type === 'ping') return { ok: true, delivery: 'usb-reply' }
  if (hold) return new Promise(resolve => { hold = () => resolve(current) })
  return current
})
ipcMain.handle('odk-remote-link-state', () => ({ state: 'disconnected', sequence: 0 }))
ipcMain.handle('odk-renderer-development-plugins', () => [])
ipcMain.handle('odk-personal-agent-status', () => ({ state: 'unavailable' }))
ipcMain.handle('odk-personal-agent-consumer-ready', () => ({ accepted: false }))
ipcMain.handle('odk-app-manager-list', () => endpoint.list())
ipcMain.handle('odk-app-manager-intent', (_event, intent) => endpoint.dispatch(intent))
ipcMain.handle('odk-app-manager-state', (_event, id) => endpoint.get(id))
ipcMain.handle('odk-user-apps-list', () => ({ ok: true, apps: [] }))
for (const channel of ['odk-weather-status','odk-weread-highlight','odk-camera-frame','odk-hydra-status','odk-futu-holdings','odk-opencode-go-status']) ipcMain.handle(channel, () => ({ status: 'unconfigured' }))
ipcMain.handle('odk-pi-sessions', () => ({ sessions: [] }))
ipcMain.handle('odk-remote-publish-page-state', () => true)

app.whenReady().then(async () => {
  assert.equal(createHash('sha256').update(fs.readFileSync(sdkPath)).digest('hex'), '30d784231503778aaf3712091d5f8c08df40a007e6027cfadd4d472dd2168ac3')
  assert.equal(createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../src/renderer/index.html'))).digest('hex'), 'effe18f70e49bf744b3b23e4534468c8e4c8b0ed77f73c9d50793160dcb7c0ee')

  const win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
  } })
  fixtureWindow = win
  if (process.env.ODK_DEVICE_GATEWAY_TEST_SOCKET) {
    bridgeClient = createRemoteBridgeClient({ socketPath: process.env.ODK_DEVICE_GATEWAY_TEST_SOCKET })
    liveSource = require('../src/device-bridge-source').createBridgeDeviceSource({ client: bridgeClient,
      authorize: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame })
    bridgeClient.start()
  }
  win.webContents.on('console-message', event => {
    if (event.level !== 'error') return
    const message = String(event.message)
    // Independently reproduced with the frozen SDK/CSP and no Devices session.
    if (rendererPhase === 'theme:liquid-glass' && event.sourceId === sdkSourceURL && event.lineNumber === 108 && sdkError.test(message) && sdkBaselineErrors.length === 0) {
      sdkBaselineErrors.push({ signature: 'frozen-liquid-glass-blob-worker-csp', phase: rendererPhase, source: 'themes/liquid-glass-sdk.js:108' }); return
    }
    rendererErrorCount++; if (rendererErrors.length < 16) rendererErrors.push(message.slice(0, 500)); console.error('Renderer fixture:', message.slice(0, 500))
  })
  const execute = code => win.webContents.executeJavaScript(code).catch(error => { error.message += ' · Script: ' + code.slice(0, 220); throw error })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  await execute('window.odkShellReady')
  assert.equal(await execute("Boolean(document.querySelector('button[aria-label=\"Open Devices\"]'))"), true)
  await execute("document.querySelector('button[aria-label=\"Open Devices\"]').click()")
  await execute("(async()=>{for(let i=0;i<100;i++){if(odkAppPlatform.active()?.appId==='devices')return;await new Promise(r=>setTimeout(r,20))}throw Error('Desktop Devices entry failed')})()")
  assert.equal(await execute("odkAppPlatform.active().appId"), 'devices')
  await execute(`(async()=>{for(let i=0;i<150;i++){const b=document.querySelector('#app-runtime [data-ping]');if(b&&!b.disabled){b.focus();return}await new Promise(r=>setTimeout(r,40))}throw Error('Gateway ping did not become available')})()`)
  win.webContents.focus()
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
  await execute(`(async()=>{for(let i=0;i<100;i++){if(document.querySelector('#app-runtime [data-result]')?.textContent.includes('Gateway reply received'))return;await new Promise(r=>setTimeout(r,40))}throw Error('Keyboard gateway check did not complete')})()`)
  assert.equal(await execute('odkAppPlatform.closeApp()'), true)
  await execute("document.querySelector('button[aria-label=\"Open Devices\"]').focus()")
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
  await execute("(async()=>{for(let i=0;i<100;i++){if(odkAppPlatform.active()?.appId==='devices')return;await new Promise(r=>setTimeout(r,20))}throw Error('Keyboard Devices entry failed')})()")
  assert.equal(await execute('odkAppPlatform.closeApp()'), true)
  await execute('window.odkRendererRuntime.stop()')
  await execute(`window.testVisibility='visible';Object.defineProperty(document,'visibilityState',{get:()=>window.testVisibility,configurable:true});
    window.gatewayHarness={cleanups:[],ticks:[],host:document.createElement('div')};
    gatewayHarness.host.id='devices-fixture-root';
    document.body.append(gatewayHarness.host);
    gatewayHarness.host.style.cssText='position:fixed;inset:0;z-index:10000;height:100vh;overflow:auto;padding:24px;box-sizing:border-box;background:var(--odk-bg)';
    window.gatewayPlugin=odkPlugins.byKind('app').find(p=>p.appId==='devices');
    gatewayHarness.mount=()=>gatewayPlugin.mount(gatewayHarness.host,{trackCleanup:fn=>gatewayHarness.cleanups.push(fn),onTick:fn=>gatewayHarness.ticks.push(fn)});
    gatewayHarness.refresh=()=>gatewayHarness.host.querySelector('[data-refresh]').click();
    gatewayHarness.mount();`)
  const captureControl = async (name, selector) => {
    if (!process.env.ODK_DEVICE_GATEWAY_TEST_EVIDENCE) return
    await execute(`(async()=>{const target=gatewayHarness.host.querySelector(${JSON.stringify(selector)});target.scrollIntoView({block:'center',behavior:'instant'});target.focus();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const box=target.getBoundingClientRect();if(box.top<0||box.bottom>innerHeight)throw Error('Control evidence target outside viewport')})()`)
    fs.mkdirSync(process.env.ODK_DEVICE_GATEWAY_TEST_EVIDENCE, { recursive: true })
    fs.writeFileSync(path.join(process.env.ODK_DEVICE_GATEWAY_TEST_EVIDENCE, name + '.png'), (await capturePaintedPage(win)).toPNG())
  }
  const waitText = async expected => {
    for (let i = 0; i < 100; i++) {
      if ((await execute('gatewayHarness.host.textContent')).includes(expected)) return
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    throw Error('Missing expected UI text: ' + expected + ' in ' + await execute('gatewayHarness.host.textContent'))
  }
  await waitText('NanoC6 connected')
  await execute(`gatewayHarness.host.querySelector('[data-ping]').click()`)
  await waitText('Gateway reply received')
  await waitText('S3 ready')
  if (!liveSource) {
    await waitText('Select a paired Hydra controller.')
    await execute(`gatewayHarness.host.querySelector('[data-hydra-peer]').value=${JSON.stringify(hydraPeer)};gatewayHarness.host.querySelector('[data-hydra-peer]').dispatchEvent(new Event('change'));gatewayHarness.host.querySelector('[data-hydra-bind]').focus()`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
    win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
    await waitText('Hydra association saved.')
    await execute('gatewayHarness.refresh()')
    await waitText('Waiting for Hydra telemetry.')
    hydra = { ...hydra, status: 'live', firmware: 'desk-1', clockValid: false,
      nodes: [{ id: 1, soilPercent: 62, status: 'PULSE', online: true, stale: false }, { id: 2, soilPercent: null, status: 'WAIT', online: false, stale: true }] }
    await execute('gatewayHarness.refresh()')
    await waitText('Hydra connected through ESP-NOW.')
    await waitText('62% soil · PULSE · Current')
    await waitText('Soil unavailable · WAIT · Offline')
    await waitText('Not set')
    assert.equal(await execute('gatewayHarness.host.querySelector("[data-control-fields]").disabled'), true)
    hydra.control = { available: true, reason: null, pending: null, result: null, physicalOwner: null, lease: { active: false }, planSequence: { available: true, deviceKnown: false } }
    await execute('gatewayHarness.refresh()')
    await waitText('Review each action before sending')
    const preparesBefore = hydraActions.filter(action => action.type.startsWith('prepare-')).length
    await execute('gatewayHarness.host.querySelector("[data-control-duration]").value="0";gatewayHarness.host.querySelector("[data-review-water]").click()')
    await waitText('Choose a duration from 1 to 30')
    assert.equal(hydraActions.filter(action => action.type.startsWith('prepare-')).length, preparesBefore)
    await execute('gatewayHarness.host.querySelector("[data-control-duration]").value="5";gatewayHarness.host.querySelector("[data-review-water]").click()')
    await waitText('Water Plant 1 for 5 seconds.')
    assert.equal(hydraActions.some(action => action.type === 'confirm'), false)
    await captureControl('water-confirmation-focus', '[data-control-confirm]')
    await execute('gatewayHarness.host.querySelector("[data-control-cancel]").click()')
    await waitText('Confirmation cancelled.')
    await execute('gatewayHarness.host.querySelector("[data-review-water]").click()')
    await waitText('Water Plant 1 for 5 seconds.')
    await execute('gatewayHarness.host.querySelector("[data-control-confirm]").click();gatewayHarness.host.querySelector("[data-control-confirm]").click()')
    await waitText('Controller accepted the action. Plant execution is not confirmed.')
    assert.equal(hydraActions.filter(action => action.type === 'confirm').length, 1)
    await execute('gatewayHarness.host.querySelector(".devices-plan").open=true')
    win.setContentSize(360,640)
    await captureControl('plan-expanded-compact', '[data-plan-minute]')
    win.setContentSize(1280,800)
    await execute('gatewayHarness.host.querySelector("[data-review-plan]").click()')
    await waitText("Replace Plant 1's four-hour plan:")
    assert.deepEqual(hydraActions.at(-1), { type: 'prepare-plan', node: 1, season: 1, entries: [{ offsetMinutes: 0, intent: 3, night: false }] })
    await execute('gatewayHarness.host.querySelector("[data-control-cancel]").click()')
    await waitText('Confirmation cancelled.')
    await execute('gatewayHarness.host.querySelector("[data-plan-add]").click();gatewayHarness.host.querySelectorAll("[data-plan-minute]")[1].value="0";gatewayHarness.host.querySelector("[data-review-plan]").click()')
    await waitText('Use one to four entries with increasing offsets')
    await execute('gatewayHarness.host.querySelector("[data-review-pause]").click()')
    await waitText('Pause routine watering for Plant 1.')
    assert.deepEqual(hydraActions.at(-1).entries, [])
    await execute('window.testVisibility="hidden";document.dispatchEvent(new Event("visibilitychange"))')
    assert.equal(await execute('gatewayHarness.host.querySelector("[data-control-confirmation]").hidden'), true)
    assert.equal(await execute('gatewayHarness.host.querySelector("[data-control-confirm]").disabled'), true)
    await execute('window.testVisibility="visible";document.dispatchEvent(new Event("visibilitychange"))')
    await execute('gatewayHarness.refresh()')
  }
  let comparisons = 0
  for (const theme of ['instrument','pixel','border-beam','liquid-glass']) {
    rendererPhase = `theme:${theme}`
    await execute(`odkTheme.set(${JSON.stringify(theme)}).then(() => document.fonts.ready)`)
    for (const [width,height] of [[1280,800],[800,600],[360,640],[320,480]]) {
      win.setContentSize(width,height)
      await new Promise(resolve => setTimeout(resolve, 60))
      const geometry = await execute(`(()=>{const h=gatewayHarness.host,b=[...h.querySelectorAll('button,select,input,summary')].filter(n=>n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0);return{overflow:h.scrollWidth>h.clientWidth+1,buttons:b.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,font:parseFloat(getComputedStyle(n).fontSize)}))}})()`)
      assert.equal(geometry.overflow, false)
      assert.ok(geometry.buttons.every(b => b.width >= 44 && b.height >= 44 && b.font >= 14))
      comparisons++
      if (width === 1280 && process.env.ODK_DEVICE_GATEWAY_TEST_EVIDENCE) {
        await execute(`(async()=>{
          gatewayHarness.host.querySelector('.devices-control').scrollIntoView({block:'start',behavior:'instant'});
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const field=gatewayHarness.host.querySelector('[data-control-node]').getBoundingClientRect();
          if(field.top<0||field.bottom>innerHeight)throw Error('Hydra control field is outside the evidence viewport');
        })()`)
        fs.mkdirSync(process.env.ODK_DEVICE_GATEWAY_TEST_EVIDENCE, { recursive: true })
        fs.writeFileSync(path.join(process.env.ODK_DEVICE_GATEWAY_TEST_EVIDENCE, `devices-${theme}.png`), (await capturePaintedPage(win)).toPNG())
      }
    }
  }
  win.setContentSize(1280,800)
  win.webContents.setZoomFactor(2)
  await execute('document.fonts.ready')
  assert.equal(await execute('gatewayHarness.host.scrollWidth > gatewayHarness.host.clientWidth + 1'), false)
  win.webContents.setZoomFactor(1)
  if (!liveSource) {
    hydra = { ...hydra, status: 'unavailable', nodes: hydra.nodes.map(node => ({ ...node, stale: true })) }
    await execute('gatewayHarness.refresh()'); await waitText('Hydra unavailable.')
    assert.equal(await execute('gatewayHarness.host.textContent.includes("62% soil · PULSE · Current")'), false)
    await execute('gatewayHarness.host.querySelector("[data-hydra-unbind]").click()'); await waitText('Hydra association removed.')
    await execute('gatewayHarness.refresh()'); await waitText('Select a paired Hydra controller.')
    assert.equal(await execute('gatewayHarness.host.querySelector("[data-hydra-nodes]").childElementCount'), 0)
    assert.deepEqual(hydraActions.filter(action => ['bind', 'unbind'].includes(action.type)), [{ type: 'bind', peer: hydraPeer }, { type: 'unbind' }])
    current = { ...fixture, remote: { ...fixture.remote, status: 'syncing' } }; await execute('gatewayHarness.refresh()'); await waitText('S3 synchronizing')
    current = { ...fixture, remote: { ...fixture.remote, status: 'disconnected' } }; await execute('gatewayHarness.refresh()'); await waitText('S3 disconnected')
    assert.equal(await execute('gatewayHarness.host.querySelector("[data-ping]").disabled'), false)
    current = { status: 'unconfigured' }; await execute('gatewayHarness.refresh()'); await waitText('Select a NanoC6')
    current = { status: 'disconnected' }; await execute('gatewayHarness.refresh()'); await waitText('Bridge disconnected')
    assert.equal(await execute('gatewayHarness.host.querySelector("[data-ping]").disabled'), true)
    assert.equal(await execute('gatewayHarness.host.textContent.includes("S3 ready")'), false)
    current = fixture
    hold = true; holdHydra = true; await execute('gatewayHarness.refresh()')
    for (let i = 0; i < 100 && typeof hold !== 'function'; i++) await new Promise(resolve => setTimeout(resolve,10))
    assert.equal(typeof hold, 'function')
    assert.equal(typeof holdHydra, 'function')
    await execute('(async()=>{while(gatewayHarness.cleanups.length)await gatewayHarness.cleanups.pop()();gatewayHarness.host.replaceChildren()})()')
    hold(); holdHydra(); await new Promise(resolve => setTimeout(resolve,60))
    assert.equal(await execute('gatewayHarness.host.childElementCount'),0)
  } else {
    fs.writeFileSync(path.join(profile, 'nano-c6.png'), (await capturePaintedPage(win)).toPNG())
    console.log(JSON.stringify({ screenshot: path.join(profile, 'nano-c6.png') }))
  }
  await releaseFixture()
  assert.equal(await execute('window.gatewayHarness.cleanups.length'), 0)
  assert.equal(rendererErrorCount, 0, JSON.stringify(rendererErrors))
  report({ mainPid: process.pid, actualPreload: true, actualDevice: Boolean(liveSource), themeSizeChecks: comparisons, fixturePeers: liveSource ? null : fixture.peers.length, zoom200: true, cleanupReleased: true, lifecycleReleased, rendererErrors: 0, sdkBaselineErrors, result: 'CHECKS_PASSED', screenshot: liveSource ? path.join(profile, 'nano-c6.png') : null })
  // The parent accepts only a natural exit AND close with code zero.
  win.webContents.stopPainting()
  win.destroy()
  app.quit()
}).catch(async error => {
  let cleanupError = null
  try { await releaseFixture() } catch (failure) { cleanupError = failure.message }
  report({ result: 'FAIL', error: error.message, cleanupError, rendererErrors: rendererErrors.slice(0, 8) })
  app.exit(1)
})
