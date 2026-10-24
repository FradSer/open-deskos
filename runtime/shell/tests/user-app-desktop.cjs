const { app, BrowserWindow, ipcMain, protocol } = require('electron')
ipcMain.handle('odk-personal-bot-consumer-ready', () => ({ accepted: false }))
ipcMain.handle('odk-remote-link-state', () => ({ state: 'disconnected', sequence: 0 }))
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
// Keep the process alive through asynchronous profile cleanup so failures
// retain their exit status after the last window is destroyed.
app.on('window-all-closed', () => {})
const widget = (revision, pageId = 'reading', col = '4') => ({ id: 'note', name: 'Notes 笔记', kind: 'widget', revision, placement: { pageId, col, row: '3' } })
const interactive = { id: 'counter', name: 'Counter', kind: 'app', revision: 'r1' }
const js = source => win.webContents.executeJavaScript(source)
// Pages are addressed by layout id: inserting a display page shifts every
// positional dot and silently retargets a click onto another surface.
const clickDot = pageId => js(`document.querySelectorAll('#dots .dot')[[...document.querySelectorAll('#pages-track > .page')].findIndex(page => page.dataset.pageId === '${pageId}')].click()`)
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
ipcMain.handle('odk-futu-holdings', () => ({ state: 'unavailable', service: 'futu-poller', snapshot: null, updatedAt: null }))
ipcMain.handle('odk-personal-bot-status', () => ({ state: 'unavailable' }))
ipcMain.handle('odk-renderer-development-plugins', () => [])
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
  win = new BrowserWindow({ width: 1920, height: 1280, show: false, webPreferences: { preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: process.platform === 'linux', backgroundThrottling: false } })
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  assert.equal(await js('document.hasFocus()'), true, 'hidden fixture receives focus without activating a desktop window')
  await wait(`document.querySelector('#user-app-desktop-status')?.dataset.state === 'ready'`)
  await js(`window.originalBuiltin=document.querySelector('[data-widget="odk.tile.year"]'); window.originalPage=document.querySelector('[data-page-id="home"]')`)
  await update([persisted, interactive])
  await wait(`document.querySelectorAll('[data-user-app-id][data-state="ready"]').length === 2`)
  assert.equal(await js(`document.querySelector('[data-user-app-id="note"]').parentElement.parentElement.dataset.pageId`), 'reading')
  assert.equal(await js(`document.querySelectorAll('#dots .dot').length`), 4)
  assert.equal(await js(`document.querySelector('[data-user-app-id="note"] iframe').getAttribute('sandbox')`), 'allow-scripts')
  assert.equal(await js(`document.querySelector('[data-user-app-id="note"] iframe').inert`), true)
  assert.equal(await js(`getComputedStyle(document.querySelector('[data-user-app-id="note"] iframe')).pointerEvents`), 'none')
  const appFrame = win.webContents.mainFrame.frames.find(frame => frame.url.includes('/counter/'))
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 3 })
  const { targetInfos } = await win.webContents.debugger.sendCommand('Target.getTargets')
  const ownedTargets = targetInfos.filter(target => target.type === 'iframe' && target.url === appFrame.url)
  assert.equal(ownedTargets.length, 1, 'one actual counter iframe target owns native touch')
  const { sessionId: touchSession } = await win.webContents.debugger.sendCommand('Target.attachToTarget', { targetId: ownedTargets[0].targetId, flatten: true })
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 3 }, touchSession)

  const currentPage = () => js(`document.querySelectorAll('#pages-track > .page')[[...document.querySelectorAll('#dots .dot')].findIndex(dot=>dot.classList.contains('active'))].dataset.pageId`)
  async function touchApp(kind = 'pinch') {
    const rect = await appFrame.executeJavaScript(`({x:innerWidth/2,y:innerHeight/2})`)
    const points = (span, dy = 0) => [0,1].map(id => ({ id, x: rect.x + (id ? span/2 : -span/2), y: rect.y + dy }))
    const send = (type, touchPoints) => win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type, touchPoints }, touchSession)
    await send('touchStart', points(240)); await delay(30)
    await send('touchMove', points(kind === 'scroll' ? 240 : 120, kind === 'scroll' ? -60 : 0)); await delay(30)
    await send('touchEnd', []); await delay(80)
  }
  await clickDot('installed:counter'); await delay(120)
  await touchApp('scroll')
  assert.equal(await currentPage(), 'installed:counter', 'ordinary iframe two-finger scrolling stays in App')
  await js(`window.savedModal=odkPersonalBotStatus;window.odkPersonalBotStatus={visible:()=>true};true`)
  await touchApp()
  assert.equal(await currentPage(), 'installed:counter', 'modal ownership blocks opaque return')
  await js(`window.odkPersonalBotStatus=window.savedModal;true`)
  // Actual opaque iframe sends only its own fixed capability; inactive and foreign frames cannot return.
  await clickDot('reading')
  await appFrame.executeJavaScript(`parent.postMessage({type:'odk-user-app-return-home',token:new URL(location.href).searchParams.get('token')},'*')`)
  await delay(50); assert.equal(await currentPage(), 'reading', 'inactive App is not authority')
  await clickDot('installed:counter'); await delay(100)
  await js(`window.postMessage({type:'odk-user-app-return-home',token:new URL(document.querySelector('[data-user-app-id="counter"] iframe').src).searchParams.get('token')},'*')`)
  await appFrame.executeJavaScript(`parent.postMessage({type:'odk-user-app-return-home',token:'old-nonce'},'*')`)
  await delay(50); assert.equal(await currentPage(), 'installed:counter', 'foreign source and stale nonce are refused')
  await touchApp()
  assert.equal(await currentPage(), 'home', 'real CDP touch inside opaque App returns Home')
  assert.equal(await js(`document.activeElement===document.querySelector('#dots .dot.active')`), true, 'return restores Home focus')
  await appFrame.executeJavaScript('counter.click()')
  await js(`window.oldWidget=document.querySelector('[data-user-app-id="note"] iframe')`)
  await clickDot('reading')
  await update([widget('r2', 'reading', '5'), interactive])
  await wait(`document.querySelector('[data-user-app-id="note"] iframe')?.dataset.revision === 'r2'`)
  assert.equal(await js(`oldWidget.isConnected`), false)
  assert.equal(await js(`originalBuiltin === document.querySelector('[data-widget="odk.tile.year"]') && originalPage === document.querySelector('[data-page-id="home"]')`), true)
  assert.equal(await appFrame.executeJavaScript('counter.textContent'), '1')
  assert.equal(await js(`document.querySelector('.dot[aria-current="page"]').getAttribute('aria-label')`), 'Reading, page 3 of 4. Swipe left or right to change page.')
  await js(`window.responsiveWidget=document.querySelector('[data-user-app-id="note"] iframe')`)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await js(`odkTheme.set('${theme}')`)
    await clickDot('reading')
    for (const width of [1920, 320]) {
      win.setContentSize(width, width === 1920 ? 1280 : 480)
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width, height: width === 1920 ? 1280 : 480, deviceScaleFactor: 1, mobile: false,
      })
      await js(`window.dispatchEvent(new Event('resize'))`)
      await wait(`window.__odkGrid?.width === ${width} && window.__odkGrid?.height === ${width === 1920 ? 1280 : 480}`)
      const geometry = await js(`(()=>{const tile=document.querySelector('[data-user-app-id="note"]');const frame=tile.querySelector('iframe');const r=frame.getBoundingClientRect();const t=tile.getBoundingClientRect();return {width:r.width,height:r.height,contained:r.left>=t.left&&r.right<=t.right+1,horizontal:document.querySelector('[data-page-id="reading"]').scrollWidth<=innerWidth+1,col:tile.style.gridColumn,row:tile.style.gridRow,sameFrame:frame===responsiveWidget,overlaps:[...tile.parentElement.querySelectorAll('[data-widget]')].some(other=>{const b=other.getBoundingClientRect();return Math.min(t.right,b.right)-Math.max(t.left,b.left)>1&&Math.min(t.bottom,b.bottom)-Math.max(t.top,b.top)>1})}})()`)
      assert.ok(geometry.width > 100 && geometry.height > 100 && geometry.contained && geometry.horizontal, JSON.stringify({ theme, width, geometry }))
      assert.equal(geometry.col, '')
      assert.equal(geometry.row, '')
      assert.equal(geometry.sameFrame, true)
      assert.equal(geometry.overlaps, false)
      const rest = await js(`(() => {
        const widget = getComputedStyle(document.querySelector('[data-user-app-id="note"]'))
        const app = document.querySelector('[data-user-app-id="counter"]'), frame = app.querySelector('iframe')
        document.querySelectorAll('#dots .dot')[[...app.parentElement.children].indexOf(app)].click()
        document.querySelector('.dot.active').focus()
        const css = getComputedStyle(frame), rect = frame.getBoundingClientRect()
        return { widgetWidth: widget.borderTopWidth, widgetColor: widget.borderTopColor, width: css.borderTopWidth, color: css.borderTopColor, size: [rect.width, rect.height] }
      })()`)
      assert.equal(rest.widgetWidth, '1px', 'installed Widget keeps a subtle static frame')
      assert.equal(rest.width, '1px', 'installed App shares the Widget frame')
      assert.equal(rest.color, rest.widgetColor)
      await appFrame.executeJavaScript('counter.focus()')
      const active = await js(`(() => {
        const frame = document.querySelector('[data-user-app-id="counter"] iframe'), css = getComputedStyle(frame), rect = frame.getBoundingClientRect()
        return { color: css.borderTopColor, outline: css.outlineStyle, width: css.outlineWidth, size: [rect.width, rect.height], focused: document.activeElement === frame }
      })()`)
      assert.equal(active.color, rest.color, 'sandbox focus preserves the shared frame: ' + JSON.stringify(active))
      assert.equal(active.outline, 'none')
      assert.equal(active.width, '0px')
      assert.deepEqual(active.size, rest.size, 'activation does not resize the sandbox')
      await js(`document.querySelector('.dot.active').focus()`)
      assert.equal(await js(`getComputedStyle(document.querySelector('[data-user-app-id="counter"] iframe')).borderTopColor`), rest.color, 'leaving the sandbox restores its resting frame')
    }
  }
  await update([widget('r2', 'reading', '5'), { ...interactive, id: 'earlier', name: 'Earlier' }, interactive])
  // Existing App pages retain their DOM position; add another after Counter.
  await update([...apps, { ...interactive, id: 'later', name: 'Later' }])
  await wait(`document.querySelectorAll('#dots .dot').length === 6`)
  await clickDot('installed:later')
  await js(`window.savedVoice=odkPersonalBotStatus; window.odkPersonalBotStatus={visible:()=>true}; true`)
  await update([widget('r2', 'reading', '5'), interactive, { ...interactive, id: 'later', name: 'Later' }])
  assert.equal(await js(`document.querySelector('.dot[aria-current="page"]').getAttribute('aria-label')`), 'Later, page 5 of 5. Swipe left or right to change page.')
  await js(`window.odkPersonalBotStatus=window.savedVoice; true`)
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
  assert.equal(await js(`document.querySelectorAll('#dots .dot').length`), 3)
  console.log('USER_APP_DESKTOP_PASS')
}).then(() => finish(0)).catch(error => { console.error(error); return finish(1) })
async function finish(code) {
  clearTimeout(deadline); win?.destroy(); if (profile) await fs.rm(profile, { recursive: true, force: true }); app.exit(code)
}
