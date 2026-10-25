const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')
const { createHash } = require('node:crypto')
const { createPersonalAgentClient } = require('../src/personal-agent-client')
const { createPluginHost } = require('../src/plugin-host')
const { createSystemChannelPlugins, SYSTEM_PORTS } = require('../src/plugins/system-channels')
const { installGeometryFixtures } = require('./helpers/live-fixtures')

app.disableHardwareAcceleration()
if (process.platform === 'darwin') app.dock.hide()
app.on('window-all-closed', () => {})
const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'odk-child-flow-')))
const profile = path.join(directory, 'electron')
app.setPath('userData', profile)
app.setPath('sessionData', profile)
const socketPath = process.platform === 'win32' ? '\\\\.\\pipe\\odk-child-flow-' + createHash('sha256').update(directory).digest('hex').slice(0, 24) : path.join(directory, 's')
let win, child, client, channelHost, result, exited = false, childExit, finishing, diagnostics = '', forcedCleanup = false
const messages = [], waiting = new Set()
function event(type) {
  const index = messages.findIndex(value => value.type === type)
  if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0])
  if (exited) return Promise.reject(Error(`Resident terminated before ${type}: ${diagnostics}`))
  return new Promise((resolve, reject) => {
    const entry = { type, resolve: value => { clearTimeout(timer); waiting.delete(entry); resolve(value) },
      reject: error => { clearTimeout(timer); waiting.delete(entry); reject(error) } }
    const timer = setTimeout(() => entry.reject(Error(`Resident checkpoint ${type} timed out: ${diagnostics}`)), 15000)
    waiting.add(entry)
  })
}
const command = type => child.stdin.write(`${JSON.stringify({ type })}\n`)
const evaluate = script => win.webContents.executeJavaScript(script)
// MutationObserver waits for product DOM updates; no time-based settling loop drives the child lifecycle.
const dom = expression => evaluate(`new Promise((resolve,reject)=>{let timer;const observer=new MutationObserver(check);function check(){if(${expression}){clearTimeout(timer);observer.disconnect();resolve(true)}}observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});timer=setTimeout(()=>{observer.disconnect();reject(Error('DOM checkpoint: '+${JSON.stringify(expression)}))},10000);check()})`)
const timer = setTimeout(() => finish(1, Error('Child pipeline deadline exceeded')), 60000)
async function bounded(promise, ms, label) {
  let limit
  try { return await Promise.race([promise, new Promise((_, reject) => { limit = setTimeout(() => reject(Error(label)), ms) })]) }
  finally { clearTimeout(limit) }
}
async function stopResident() {
  if (!child) return 0
  if (!exited) {
    command('close'); child.stdin.end()
    try { await bounded(childExit, 2500, 'Resident close deadline exceeded') }
    catch {
      forcedCleanup = true
      child.kill('SIGTERM')
      try { await bounded(childExit, 1000, 'Resident ignored SIGTERM') }
      catch { child.kill('SIGKILL'); await bounded(childExit, 2000, 'Resident did not exit after SIGKILL') }
    }
  }
  return childExit
}
async function finish(code, error) {
  if (finishing) return finishing
  finishing = (async () => {
    clearTimeout(timer)
    if (error) console.error(error)
    const cleanupErrors = []
    const attempt = async operation => { try { await operation() } catch (cleanup) { cleanupErrors.push(cleanup); console.error(cleanup) } }
    await attempt(() => bounded(Promise.resolve().then(() => channelHost?.stop()), 2000, 'Main channel cleanup deadline exceeded'))
    await attempt(async () => { client?.stop() })
    await attempt(async () => { const wasActive = child && !exited, status = await stopResident(); if (wasActive) assert.equal(status, 0, diagnostics); else if (status !== 0) code = 1 })
    await attempt(async () => { win?.destroy() })
    const cleanupPassed = cleanupErrors.length === 0 && !forcedCleanup
    // Chromium can write profile files until process exit. The Node acceptance owner removes this directory afterward.
    console.log(JSON.stringify({ ...result, passed: code === 0 && cleanupPassed, cleanupPassed, forcedCleanup,
      cleanupScope: 'processes and window; the Node test owner removes the profile after Electron exits', directory }))
    if (!cleanupPassed) code = 1
    app.exit(code)
  })()
  return finishing
}

async function startResident(resume = false) {
  exited = false; diagnostics = ''; messages.length = 0
  child = spawn('node', [path.resolve(__dirname, '../../../integrations/personal-agent/tests/helpers/agent-avatar-resident.mjs'), directory, socketPath,
    ...(resume ? ['--resume'] : []), ...(resume && process.argv.includes('--stall-resident-close') ? ['--stall-close'] : [])], {
    env: { PATH: process.env.PATH, HOME: directory, USERPROFILE: directory, TMPDIR: directory, TEMP: directory, TMP: directory,
      PI_CODING_AGENT_DIR: path.join(directory, 'agent-settings'),
      ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  childExit = new Promise(resolve => {
    child.once('error', error => { diagnostics += error.message; exited = true; for (const entry of waiting) entry.reject(error); resolve(1) })
    child.once('close', code => { exited = true; for (const entry of waiting) entry.reject(Error(`Resident exited ${code}: ${diagnostics}`)); resolve(code) })
  })
  child.stdin.on('error', () => {})
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8192) })
  createInterface({ input: child.stdout }).on('line', line => {
    try {
      const value = JSON.parse(line), entry = [...waiting].find(item => item.type === value.type)
      if (entry) entry.resolve(value)
      else messages.push(value)
    } catch { diagnostics = (diagnostics + line).slice(-8192) }
  })
  const ready = await event('ready')
  assert.equal(ready.pid, child.pid)
  return ready
}

app.whenReady().then(async () => {
  installGeometryFixtures(ipcMain)
  const initial = await startResident()
  const token = process.platform === 'win32' ? fs.readFileSync(path.join(directory, 'channel.token'), 'utf8').trim() : ''
  ipcMain.removeHandler('odk-personal-agent-status')
  win = new BrowserWindow({ width: 1280, height: 800, show: false, useContentSize: true, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
  } })
  channelHost = createPluginHost({ capabilities: { ipc: ipcMain,
    broadcast: (name, status) => { if (win && !win.isDestroyed()) win.webContents.send(name, status) },
    'system.personal-agent': { create: createPersonalAgentClient, options: { socketPath, token, reconnectDelayMs: 50 }, smokeMode: false },
  } })
  channelHost.register(createSystemChannelPlugins().find(plugin => plugin.manifest.id === 'odk.system.personal-agent'))
  await channelHost.start()
  client = channelHost.get(SYSTEM_PORTS.personalAgent)
  assert(client, 'The actual main-process channel plugin must start')
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  await evaluate('document.fonts.ready')
  await dom(`document.querySelector('.agent-send')?.disabled === false`)
  async function submit() {
    await evaluate(`(()=>{const input=document.querySelector('.agent-composer textarea');input.value='Run the saved reporter.';document.querySelector('.agent-composer').requestSubmit()})()`)
    await event('child_started')
    await dom(`document.querySelector('.agent-child-state')?.textContent === 'Running'`)
    await dom(`document.querySelector('.agent-send')?.disabled === false`)
    const [task] = client.snapshot().agents.tasks
    assert.equal(task.identity.revision, initial.identity.revision)
    assert.equal(await evaluate(`document.querySelector('.agent-child-name').textContent`), initial.identity.name)
    assert.equal(await evaluate(`document.querySelector('.agent-child-avatar svg').getAttribute('data-tabler')`), 'book-open')
    assert.equal(await evaluate(`(()=>{const row=document.querySelector('.agent-child'),r=row.getBoundingClientRect(),list=row.closest('.agent-conversation').getBoundingClientRect(),a=row.querySelector('.agent-child-avatar').getBoundingClientRect();return a.width>0&&a.height>0&&r.top>=list.top-1&&r.bottom<=list.bottom+1})()`), true, 'The running avatar must occupy visible conversation space')
    return task
  }
  const first = await submit()
  assert.equal(client.snapshot().state, 'idle', 'child activity must survive the completed parent admission')
  command('disconnect'); await event('disconnected')
  await dom(`document.querySelector('.agent-child-state')?.textContent === 'Status unavailable'`)
  command('connect'); await event('connected')
  await dom(`document.querySelector('.agent-child-state')?.textContent === 'Running'`)
  assert.equal(client.snapshot().agents.tasks[0].taskId, first.taskId)
  command('release')
  const completed = await event('child_finished')
  assert.equal(completed.task.state, 'finished')
  assert.equal(completed.task.verification.status, 'not_run', 'This activity check cannot certify the scripted task answer')
  assert.match(completed.task.response, /Three synthetic measurements/)
  await dom(`document.querySelectorAll('.agent-child').length === 0`)
  command('disconnect'); await event('disconnected')
  await dom(`document.querySelector('.agent-send')?.disabled === true`)
  assert.equal(await stopResident(), 0)
  assert.equal(forcedCleanup, false)
  if (process.argv.includes('--drop-saved-identity')) {
    const file = path.join(directory, 'state/personal-agent/children/state.json')
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    state.identities = []
    fs.writeFileSync(file, JSON.stringify(state), { mode: 0o600 })
  }
  const restarted = await startResident(true)
  assert.notEqual(restarted.pid, initial.pid, 'Persistence must survive a new resident process')
  assert.deepEqual(restarted.identity, initial.identity)
  assert(restarted.tasks.some(task => task.taskId === first.taskId && task.state === 'finished'))
  await dom(`document.querySelector('.agent-send')?.disabled === false`)
  const second = await submit()
  assert.notEqual(second.taskId, first.taskId)
  command('cancel'); await event('cancelling')
  await dom(`document.querySelector('.agent-child-state')?.textContent === 'Cancelling'`)
  command('release')
  const cancelled = await event('child_finished')
  assert.equal(cancelled.task.state, 'cancelled')
  assert.equal(cancelled.task.response, '')
  await dom(`document.querySelectorAll('.agent-child').length === 0`)
  result = { scope: 'offline Durable resident -> service -> socket -> Shell client -> Main plugin -> preload -> conversation',
    starts: 2, savedRestart: true, residentPids: [initial.pid, restarted.pid], reconnect: true, cancellation: true, externalModelCalls: 0, physicalInput: false }
  await finish(0)
}).catch(error => finish(1, error))
