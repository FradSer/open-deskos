const { app, BrowserWindow, ipcMain, protocol } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const { buildUserAppDocument, USER_APP_CSP } = require('../src/user-app-content')
const { USER_APP_SCHEME_PRIVILEGES } = require('../src/user-app-system')
const { createUserAppStore } = require('../src/user-app-store')
protocol.registerSchemesAsPrivileged([{ scheme: 'odk-user-app', privileges: USER_APP_SCHEME_PRIVILEGES }])
let win
let profile
let apps = []
let failure = false
const widget = (revision, pageId = 'reading') => ({ id: 'note', name: 'Notes 笔记', kind: 'widget', revision, placement: { pageId, col: '4', row: '3' } })
const interactive = { id: 'counter', name: 'Counter', kind: 'app', revision: 'r1' }
const js = source => win.webContents.executeJavaScript(source)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function wait(expression) {
  for (let i = 0; i < 150; i++) { if (await js(expression)) return; await delay(40) }
  throw new Error(`Timed out: ${expression}; ${await js(`document.body.innerText.slice(-1500)`)}`)
}
async function update(next) {
  apps = next
  win.webContents.send('odk-user-apps-changed')
  await delay(80)
}
for (const [channel, value] of Object.entries({
  'odk-opencode-go-status': { state: 'unconfigured' }, 'odk-pi-sessions': { summary: { running: 0 }, sessions: [] },
  'odk-hydra-status': { configured: false, connected: false, nodes: [] }, 'odk-weread-highlight': { status: 'unconfigured' },
  'odk-remote-publish-page-state': true, 'odk-camera-frame': { state: 'unavailable' },
  'odk-weather-status': { status: 'unconfigured', place: null, current: null, daily: null, updatedAt: null, hint: 'ODK_WEATHER_LAT', error: null },
})) ipcMain.handle(channel, () => value)
ipcMain.handle('odk-user-apps-list', () => failure ? { ok: false, error: 'offline' } : { ok: true, apps })
const deadline = setTimeout(() => { console.error('USER_APP_DESKTOP_TIMEOUT'); app.exit(1) }, 30000)
app.whenReady().then(async () => {
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-desktop-'))
  const workspace = path.join(profile, 'workspace')
  const draft = path.join(workspace, 'apps', 'note')
  await fs.mkdir(draft, { recursive: true })
  await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'note', name: 'Notes 笔记', version: '1', kind: 'widget' }))
  await fs.writeFile(path.join(draft, 'index.html'), '<p>Notes</p>')
  const storeOptions = { workspace, stateDir: path.join(profile, 'state'), verify: async () => ({ ok: true }) }
  const store = createUserAppStore(storeOptions)
  assert.equal((await store.install('note', widget('r1').placement)).ok, true)
  const persisted = (await createUserAppStore(storeOptions).list())[0]
  assert.deepEqual(persisted.placement, widget('r1').placement)
  protocol.handle('odk-user-app', request => {
    const url = new URL(request.url)
    const html = '<style>body{margin:0;color:white;font:20px sans-serif}</style><button id="counter">0</button><script>counter.onclick=()=>counter.textContent=Number(counter.textContent)+1</script>'
    return new Response(buildUserAppDocument(html, { token: url.searchParams.get('token') }), { headers: { 'content-type': 'text/html', 'content-security-policy': USER_APP_CSP } })
  })
  win = new BrowserWindow({ width: 1920, height: 1280, show: false, webPreferences: { preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  await wait(`document.querySelector('#user-app-desktop-status')?.dataset.state === 'ready'`)
  await js(`window.originalBuiltin=document.querySelector('[data-widget="odk.tile.clock"]'); window.originalPage=document.querySelector('[data-page-id="home"]')`)
  await update([persisted, interactive])
  await wait(`document.querySelectorAll('[data-user-app-id][data-state="ready"]').length === 2`)
  assert.equal(await js(`document.querySelector('[data-user-app-id="note"]').parentElement.parentElement.dataset.pageId`), 'reading')
  assert.equal(await js(`document.querySelectorAll('#dots .dot').length`), 6)
  assert.equal(await js(`document.querySelector('[data-user-app-id="note"] iframe').getAttribute('sandbox')`), 'allow-scripts')
  assert.equal(await js(`document.querySelector('[data-user-app-id="note"] iframe').inert`), true)
  assert.equal(await js(`getComputedStyle(document.querySelector('[data-user-app-id="note"] iframe')).pointerEvents`), 'none')
  const appFrame = win.webContents.mainFrame.frames.find(frame => frame.url.includes('/counter/'))
  await appFrame.executeJavaScript('counter.click()')
  await js(`window.oldWidget=document.querySelector('[data-user-app-id="note"] iframe'); document.querySelectorAll('#dots .dot')[2].click()`)
  await update([widget('r2', 'home'), interactive])
  await wait(`document.querySelector('[data-user-app-id="note"] iframe')?.dataset.revision === 'r2'`)
  assert.equal(await js(`oldWidget.isConnected`), false)
  assert.equal(await js(`originalBuiltin === document.querySelector('[data-widget="odk.tile.clock"]') && originalPage === document.querySelector('[data-page-id="home"]')`), true)
  assert.equal(await appFrame.executeJavaScript('counter.textContent'), '1')
  assert.equal(await js(`document.querySelector('.dot[aria-current="page"]').getAttribute('aria-label')`), 'Page 3, Reading')
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await js(`odkTheme.set('${theme}'); document.querySelectorAll('#dots .dot')[1].click()`)
    for (const width of [1920, 320]) {
      win.setContentSize(width, width === 1920 ? 1280 : 480)
      await delay(150)
      const geometry = await js(`(()=>{const tile=document.querySelector('[data-user-app-id="note"]');const frame=tile.querySelector('iframe');const r=frame.getBoundingClientRect();const t=tile.getBoundingClientRect();return {width:r.width,height:r.height,contained:r.left>=t.left&&r.right<=t.right+1,horizontal:document.querySelector('[data-page-id="home"]').scrollWidth<=innerWidth+1}})()`)
      assert.ok(geometry.width > 100 && geometry.height > 100 && geometry.contained && geometry.horizontal, JSON.stringify({ theme, width, geometry }))
    }
  }
  await update([widget('r2', 'home'), { ...interactive, id: 'earlier', name: 'Earlier' }, interactive])
  // Existing App pages retain their DOM position; add another after Counter.
  await update([...apps, { ...interactive, id: 'later', name: 'Later' }])
  await wait(`document.querySelectorAll('#dots .dot').length === 8`)
  await js(`document.querySelectorAll('#dots .dot')[7].click(); window.savedVoice=odkVoiceStatus; window.odkVoiceStatus={visible:()=>true}; true`)
  await update([widget('r2', 'home'), interactive, { ...interactive, id: 'later', name: 'Later' }])
  assert.equal(await js(`document.querySelector('.dot[aria-current="page"]').getAttribute('aria-label')`), 'Page 7, Later')
  await js(`window.odkVoiceStatus=window.savedVoice; true`)
  failure = true; await update(apps)
  await wait(`document.querySelector('#user-app-desktop-status').dataset.state === 'unavailable'`)
  assert.match(await js(`document.querySelector('#user-app-desktop-status').textContent`), /stale/)
  assert.equal(await appFrame.executeJavaScript('counter.textContent'), '1')
  await js(`odkAppPlatform.openApp({appId:'missing-installed-test'})`)
  assert.equal(await js(`document.querySelector('#user-app-desktop-notice').inert`), true)
  await js(`document.querySelector('#app-back').click()`)
  assert.equal(await js(`document.querySelector('#user-app-desktop-notice').inert`), false)
  failure = false; await update([])
  await wait(`document.querySelectorAll('[data-user-app-id]').length === 0`)
  assert.equal(await js(`document.querySelectorAll('#dots .dot').length`), 5)
  console.log('USER_APP_DESKTOP_PASS')
}).then(() => finish(0)).catch(error => { console.error(error); return finish(1) })
async function finish(code) {
  clearTimeout(deadline); win?.destroy(); if (profile) await fs.rm(profile, { recursive: true, force: true }); app.exit(code)
}
