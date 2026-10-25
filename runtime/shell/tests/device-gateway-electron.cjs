'use strict'
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const { createRemoteBridgeClient } = require('../src/remote-bridge-client')
const { capturePaintedPage } = require('./helpers/native-page-capture')
const profile = process.env.ODK_DEVICE_GATEWAY_TEST_PROFILE || fs.mkdtempSync(path.join(os.tmpdir(), 'odk-gateway-ui-'))
const report = value => {
  console.log(JSON.stringify(value))
  if (process.env.ODK_DEVICE_GATEWAY_TEST_RESULT) fs.writeFileSync(process.env.ODK_DEVICE_GATEWAY_TEST_RESULT, JSON.stringify({ ...value, run: process.env.ODK_DEVICE_GATEWAY_TEST_RUN }))
}
app.setPath('userData', profile)
const endpoint = createAppManagerEndpoint()
const fixture = { status: 'live', reason: '',
  gateway: { status: 'live', serialNumber: '9C:CC:01:34:31:50', mac: '9c:cc:01:34:31:50', firmware: '0.1.0', channel: 1, receivedAt: Date.now() },
  remote: { mac: 'f0:9e:9e:11:23:cc', status: 'ready', lastSeen: Date.now() },
  peers: [{ mac: 'f0:9e:9e:11:23:cc', role: 'remote', status: 'paired' }], events: [] }
let current = fixture
let liveSource = null
let bridgeClient = null
let hold = null
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
  const win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
  } })
  if (process.env.ODK_DEVICE_GATEWAY_TEST_SOCKET) {
    bridgeClient = createRemoteBridgeClient({ socketPath: process.env.ODK_DEVICE_GATEWAY_TEST_SOCKET })
    liveSource = require('../src/device-bridge-source').createBridgeDeviceSource({ client: bridgeClient,
      authorize: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame })
    bridgeClient.start()
  }
  const execute = code => win.webContents.executeJavaScript(code)
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
  await execute(`window.gatewayHarness={cleanups:[],ticks:[],host:document.createElement('div')};
    document.body.replaceChildren(gatewayHarness.host);
    gatewayHarness.host.id='app-view';gatewayHarness.host.style.cssText='height:100vh;overflow:auto;padding:24px;box-sizing:border-box';
    window.gatewayPlugin=odkPlugins.byKind('app').find(p=>p.appId==='devices');
    gatewayHarness.mount=()=>gatewayPlugin.mount(gatewayHarness.host,{trackCleanup:fn=>gatewayHarness.cleanups.push(fn),onTick:fn=>gatewayHarness.ticks.push(fn)});
    gatewayHarness.refresh=()=>gatewayHarness.host.querySelector('[data-refresh]').click();
    gatewayHarness.mount();`)
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
  let comparisons = 0
  for (const theme of ['instrument','pixel','border-beam','liquid-glass']) {
    await execute(`odkTheme.set(${JSON.stringify(theme)}).then(() => document.fonts.ready)`)
    for (const [width,height] of [[1280,800],[800,600],[360,640],[320,480]]) {
      win.setContentSize(width,height)
      await new Promise(resolve => setTimeout(resolve, 60))
      const geometry = await execute(`(()=>{const h=gatewayHarness.host,b=[...h.querySelectorAll('button')];return{overflow:h.scrollWidth>h.clientWidth+1,buttons:b.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,font:parseFloat(getComputedStyle(n).fontSize)}))}})()`)
      assert.equal(geometry.overflow, false)
      assert.ok(geometry.buttons.every(b => b.width >= 44 && b.height >= 44 && b.font >= 14))
      comparisons++
      if (width === 1280 && process.env.ODK_DEVICE_GATEWAY_TEST_EVIDENCE) {
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
    current = { ...fixture, remote: { ...fixture.remote, status: 'syncing' } }; await execute('gatewayHarness.refresh()'); await waitText('S3 synchronizing')
    current = { ...fixture, remote: { ...fixture.remote, status: 'disconnected' } }; await execute('gatewayHarness.refresh()'); await waitText('S3 disconnected')
    assert.equal(await execute('gatewayHarness.host.querySelector("[data-ping]").disabled'), false)
    current = { status: 'unconfigured' }; await execute('gatewayHarness.refresh()'); await waitText('Select a NanoC6')
    current = { status: 'disconnected' }; await execute('gatewayHarness.refresh()'); await waitText('Bridge disconnected')
    assert.equal(await execute('gatewayHarness.host.querySelector("[data-ping]").disabled'), true)
    assert.equal(await execute('gatewayHarness.host.textContent.includes("S3 ready")'), false)
    current = fixture
    hold = true; await execute('gatewayHarness.refresh()')
    for (let i = 0; i < 100 && typeof hold !== 'function'; i++) await new Promise(resolve => setTimeout(resolve,10))
    assert.equal(typeof hold, 'function')
    await execute('gatewayHarness.cleanups.forEach(fn=>fn());gatewayHarness.host.replaceChildren()')
    hold(); await new Promise(resolve => setTimeout(resolve,60))
    assert.equal(await execute('gatewayHarness.host.childElementCount'),0)
  } else {
    fs.writeFileSync(path.join(profile, 'nano-c6.png'), (await capturePaintedPage(win)).toPNG())
    console.log(JSON.stringify({ screenshot: path.join(profile, 'nano-c6.png') }))
  }
  report({ actualPreload: true, actualDevice: Boolean(liveSource), themeSizeChecks: comparisons, result: 'PASS', screenshot: liveSource ? path.join(profile, 'nano-c6.png') : null })
  if (liveSource) await liveSource.stop()
  if (bridgeClient) await bridgeClient.stop()
  win.destroy(); app.exit(0)
}).catch(async error => {
  report({ result: 'FAIL', error: error.message })
  try { await liveSource?.stop() } catch {}
  try { await bridgeClient?.stop() } catch {}
  app.exit(1)
})
