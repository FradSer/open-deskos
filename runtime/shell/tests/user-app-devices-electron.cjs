'use strict'
// This isolated fixture uses real installed bytes, opaque frames, preload IPC,
// private grants, and a fake Bridge port. It does not access serial hardware.
const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const assert = require('node:assert/strict')
const profileRoot = process.env.ODK_PACKAGE_DEVICE_PROFILE
assert.equal(typeof profileRoot, 'string', 'parent-owned fixture profile is required')
assert.equal(path.isAbsolute(profileRoot), true)
const profileInfo = require('node:fs').lstatSync(profileRoot)
assert.equal(profileInfo.isDirectory() && !profileInfo.isSymbolicLink(), true)
assert.equal(profileInfo.uid, process.getuid())
assert.equal(profileInfo.mode & 0o777, 0o700)
app.setPath('userData', profileRoot)
app.setPath('sessionData', profileRoot)
const { registerUserAppScheme, startUserAppSystem } = require('../src/user-app-system')
const { createUserAppStore } = require('../src/user-app-store')
const { resolveShellHost } = require('../src/platform')
registerUserAppScheme(protocol)
if (process.platform === 'darwin') app.dock.hide()
let win, stop, finishing = false
const deadline = setTimeout(() => { void finish(Error('PACKAGE_DEVICE_FIXTURE_TIMEOUT')) }, 30000)
const peer = '02:11:22:33:44:55', remote = 'f0:9e:9e:11:23:cc'
app.on('window-all-closed', () => {})

async function finish(error, report) {
  if (finishing) return
  finishing = true
  clearTimeout(deadline)
  let failure = error, cleanupTimer
  if (error) console.error('PACKAGE_DEVICE_FIXTURE_FAILED', error)
  try {
    await Promise.race([
      Promise.resolve().then(() => stop?.()),
      new Promise((_, reject) => { cleanupTimer = setTimeout(() => reject(Error('runtime cleanup deadline')), 2000) }),
    ])
  } catch (cleanupError) {
    failure ||= cleanupError
    console.error('PACKAGE_DEVICE_FIXTURE_CLEANUP_FAILED', cleanupError)
  } finally { clearTimeout(cleanupTimer) }
  try { win?.destroy() } catch (cleanupError) {
    failure ||= cleanupError
    console.error('PACKAGE_DEVICE_FIXTURE_WINDOW_CLEANUP_FAILED', cleanupError)
  }
  // Session Storage remains live until Electron exits. Only the parent removes it.
  if (!failure) console.log(JSON.stringify(report))
  app.exit(failure ? 1 : 0)
}

app.whenReady().then(async () => {
  const profile = profileRoot
  const env = { ...process.env, XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state'), XDG_RUNTIME_DIR: path.join(profile, 'runtime') }
  await fs.mkdir(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 })
  const stateDir = resolveShellHost({ env }).stateDir
  const workspace = path.join(profile, 'workspace'), draft = path.join(workspace, 'apps/sensor')
  await fs.mkdir(draft, { recursive: true })
  await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'sensor', name: 'Sensor', version: '1', kind: 'app', devices: { gateway: true, read: [peer, remote], send: [peer, remote] } }))
  await fs.writeFile(path.join(draft, 'index.html'), `<body><p>Sensor fixture</p><script>
    addEventListener('message', async event => {
      if(event.source !== parent || event.data?.type !== 'fixture-device-call') return;
      let confined=false;try{parent.document.body}catch{confined=true}
      const result=event.data.operation==='read'?await odkPackageDevices.read():await odkPackageDevices.send(event.data.peer,'eA==');
      parent.postMessage({type:'fixture-device-result',id:event.data.id,result,confined,preload:typeof odkUserApps},'*');
    });
  </script></body>`)
  const store = createUserAppStore({ workspace, stateDir: path.join(stateDir, 'user-apps'), verify: () => true })
  const installed = await store.install('sensor'); assert.equal(installed.ok, true)
  const grantsFile = path.join(stateDir, 'device-grants.json')
  await fs.writeFile(grantsFile, JSON.stringify({ schemaVersion: 1, grants: [{ appId: 'sensor', revision: installed.app.revision, gateway: true, read: [peer, remote], send: [peer, remote] }] }), { mode: 0o600 })
  const hostFile = path.join(profile, 'host.html')
  await fs.writeFile(hostFile, '<!doctype html><div id="host"></div><script src="frame.js"></script><script src="observe.js"></script>')
  await fs.copyFile(path.join(__dirname, '../src/renderer/core/user-app-frame.js'), path.join(profile, 'frame.js'))
  await fs.writeFile(path.join(profile, 'observe.js'), `window.results=[];addEventListener('message',event=>{if(event.source===window.instance?.frame.contentWindow&&event.data?.type==='fixture-device-result')results.push(event.data)})`)
  let sends = 0
  const gateway = { snapshot: () => ({ status: 'live', gateway: { status: 'live', mac: '9c:cc:01:34:31:50', firmware: '0.1.0' }, remote: { mac: remote, status: 'ready' }, peers: [{ mac: peer, role: 'device', status: 'live' }, { mac: remote, role: 'remote', status: 'live' }], events: [], pmk: 'must-not-escape' }), action: async () => { sends++; return { ok: true, delivery: 'mac-receipt' } } }
  await startUserAppSystem({ app, ipcMain, protocol, BrowserWindow, env, store, shellDocument: hostFile, deviceGateway: gateway, onCleanup: release => { stop = release } })
  win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  await win.loadFile(hostFile)
  const js = code => win.webContents.executeJavaScript(code)
  await js(`window.instance=odkUserAppFrame.mount(document.querySelector('#host'),${JSON.stringify({ id: 'sensor', revision: installed.app.revision, url: `odk-user-app://app/sensor/${installed.app.revision}` })});instance.ready`)
  let sequence = 0
  async function call(operation, address) {
    const id = ++sequence
    return js(`(async()=>{instance.frame.contentWindow.postMessage(${JSON.stringify({ type: 'fixture-device-call', id, operation, peer: address })},'*');const end=performance.now()+8000;while(performance.now()<end){const result=results.find(v=>v.id===${id});if(result)return result;await new Promise(r=>setTimeout(r,20))}throw Error('Device SDK timeout')})()`)
  }
  const reading = await call('read')
  assert.equal(reading.confined, true); assert.equal(reading.preload, 'undefined')
  assert.equal(reading.result.ok, true); assert.equal(reading.result.gateway.firmware, '0.1.0'); assert.equal(reading.result.pmk, undefined)
  assert.equal((await call('send', peer)).result.delivery, 'mac-receipt'); assert.equal(sends, 1)
  assert.equal((await call('send', remote)).result.error, 'reserved-peer'); assert.equal(sends, 1)
  await fs.writeFile(grantsFile, JSON.stringify({ schemaVersion: 1, grants: [] }), { mode: 0o600 })
  assert.equal((await call('send', peer)).result.error, 'device-not-granted'); assert.equal(sends, 1)
  await js('instance.dispose()')
  const removed = await js(`odkUserApps.deviceRequest('sensor',${JSON.stringify(installed.app.revision)},'forged',{type:'read'})`)
  assert.equal(removed.error, 'frame-inactive')
  await finish(null, { result: 'PASS', opaqueFrame: true, actualPreload: true, privateGrants: true, sends, physicalDevice: false })
}).catch(error => finish(error))
