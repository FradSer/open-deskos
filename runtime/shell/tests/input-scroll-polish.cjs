const { app, BrowserWindow, ipcMain, session } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installHomePreviewFixtures } = require('./helpers/home-preview-fixtures')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')

if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-input-scroll-profile-'))
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-input-scroll-evidence-'))
app.setPath('userData', profile)
let win
const failures = []
const report = []
const timer = setTimeout(() => finish(1, Error('Input/scroll checks timed out')), 90000)
function finish(code, error) {
  clearTimeout(timer)
  if (error) console.error(error)
  win?.destroy()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  app.exit(code)
}
function check(name, result) {
  if (!result) failures.push(name)
}
const js = source => win.webContents.executeJavaScript(source)
async function capture(name) {
  const painted = (marked, change) => new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(deadline); win.webContents.off('paint', observe) }
    const observe = (_event, _dirty, frame) => {
      const pixel = frame.crop({ x: 0, y: 0, width: 1, height: 1 }).toBitmap()
      if ([237, 19, 181, 255].every((v, i) => pixel[i] === v) !== marked) return
      cleanup()
      resolve(frame)
    }
    const deadline = setTimeout(() => { cleanup(); reject(Error('Paint did not settle')) }, 5000)
    win.webContents.on('paint', observe)
    js(change).then(() => win.webContents.invalidate()).catch(error => { cleanup(); reject(error) })
  })
  try {
    await painted(true, `(()=>{const n=document.createElement('div');n.id='polish-paint-marker';n.style.cssText='position:fixed;top:0;left:0;width:2px;height:2px;z-index:2147483647;background:rgb(181,19,237);pointer-events:none';document.body.append(n)})()`)
    const frame = await painted(false, `document.getElementById('polish-paint-marker').remove()`)
    fs.writeFileSync(path.join(evidence, name + '.png'), frame.toPNG())
  } finally { await js(`document.getElementById('polish-paint-marker')?.remove()`) }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_w, _p, done) => done(false))
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_r, done) => done({ cancel: true }))
  installHomePreviewFixtures(ipcMain)
  const endpoint = createAppManagerEndpoint()
  ipcMain.handle('odk-app-manager-intent', (_event, intent) => endpoint.dispatch(intent))
  ipcMain.removeHandler('odk-futu-holdings')
  ipcMain.handle('odk-futu-holdings', () => ({ state: 'live', updatedAt: Date.now(), snapshot: {
    totals: { plRatio: 0.0123 }, positions: Array.from({ length: 24 }, (_, i) => ({ code: `US.HOLD${i + 1}`, price: 1234.56, dayRatio: -0.0123 })),
  } }))
  win = new BrowserWindow({ width: 1280, height: 800, show: false, frame: false, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  await js('window.odkShellReady')
  await js(`window.polishUntil=async f=>{const end=performance.now()+4000;while(!f()){if(performance.now()>end)throw Error('Readiness: '+f);await new Promise(r=>setTimeout(r,20))}};void 0`)
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    for (const [width, height] of [[1280, 800], [480, 854], [320, 480]]) {
      const where = `${theme}-${width}`
      win.setContentSize(width, height)
      await js(`(async()=>{await odkTheme.set('${theme}');window.dispatchEvent(new Event('resize'));await polishUntil(()=>innerWidth===${width}&&innerHeight===${height});await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.querySelector('.agent-composer textarea').focus()})()`)
      const identity = await js(`(()=>{const name=document.querySelector('.agent-name'),pill=document.querySelector('.agent-identity summary');return {height:pill.getBoundingClientRect().height,nameHeight:name.getBoundingClientRect().height,nameLine:parseFloat(getComputedStyle(name).lineHeight),nameWhole:name.scrollWidth<=name.clientWidth+1}})()`)
      check(where + ': default name is whole on one line', identity.nameHeight <= identity.nameLine + 1 && identity.nameWhole)
      check(where + ': identity capsule keeps control height', identity.height <= 46)
      const focus = await js(`(()=>{const input=document.querySelector('.agent-composer textarea'),box=input.closest('form'),s=getComputedStyle(box),t=getComputedStyle(input);return {focused:input.matches(':focus-visible'),outline:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor,radius:s.borderTopLeftRadius,inputOutline:t.outlineStyle}})()`)
      check(where + ': outer composer focus follows theme shape', focus.focused && focus.outline === 'solid' && focus.width === '2px' && (theme === 'pixel' ? focus.radius === '0px' : parseFloat(focus.radius) >= 32))
      check(where + ': no rectangular input outline', focus.inputOutline === 'none')
      if (theme === 'instrument' && width === 1280) await capture('composer-focused')
      for (const button of ['.agent-mic', '.agent-send']) {
        check(where + ': button focus ' + button, await js(`(()=>{const n=document.querySelector('${button}');n.focus();return n.disabled||getComputedStyle(n).outlineStyle==='solid'})()`))
      }
      await js(`(async()=>{document.querySelector('[data-widget="odk.tile.futu"] .widget-launch').click();await polishUntil(()=>odkAppPlatform.active()?.appId==='futu');await polishUntil(()=>document.querySelectorAll('#app-runtime .futu-holding').length===24);document.getElementById('app-view').scrollIntoView({block:'center'});await document.fonts.ready})()`)
      const idle = await js(`(()=>{const list=document.querySelector('#app-runtime .futu-holdings'),head=document.querySelector('#app-runtime .futu-columns'),row=list.firstElementChild;window.polishList=list;const thumb=getComputedStyle(list,'::-webkit-scrollbar-thumb'),button=getComputedStyle(list,'::-webkit-scrollbar-button'),s=getComputedStyle(list);return {overflow:list.scrollHeight>list.clientHeight,thumb:thumb.backgroundColor,button:button.display,gutter:s.scrollbarGutter,padding:parseFloat(s.paddingInlineEnd),columnsAligned:Math.abs(head.lastElementChild.getBoundingClientRect().right-row.lastElementChild.getBoundingClientRect().right)<1,rightSafe:list.getBoundingClientRect().right-row.lastElementChild.getBoundingClientRect().right>=12,scrollWidth:list.scrollWidth,clientWidth:list.clientWidth}})()`)
      check(where + ': idle transparent thumb', idle.thumb === 'rgba(0, 0, 0, 0)')
      check(where + ': arrows removed', idle.button === 'none')
      check(where + ': reserved safe space and alignment', idle.overflow && idle.gutter === 'stable' && idle.padding >= 8 && idle.columnsAligned && idle.rightSafe && idle.scrollWidth <= idle.clientWidth + 1)
      if (theme === 'instrument' && width === 1280) await capture('futu-idle')
      await js(`polishList.focus()`)
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 })
      await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 })
      await js(`polishUntil(()=>polishList.scrollTop>0)`)
      const scrolling = await js(`(()=>{const s=getComputedStyle(polishList,'::-webkit-scrollbar-thumb');return {active:polishList.dataset.scrolling,thumb:s.backgroundColor,radius:s.borderTopLeftRadius}})()`)
      check(where + ': keyboard reveals theme-shaped thumb', scrolling.active === 'true' && scrolling.thumb !== 'rgba(0, 0, 0, 0)' && (theme === 'pixel' ? scrolling.radius === '0px' : parseFloat(scrolling.radius) > 0))
      if (theme === 'instrument' && width === 1280) await capture('futu-scrolling')
      // A missing implementation must still report the remaining RED cases.
      if (scrolling.active === 'true') await js(`polishUntil(()=>!polishList.hasAttribute('data-scrolling'))`)
      check(where + ': thumb hides without moving columns', await js(`getComputedStyle(polishList,'::-webkit-scrollbar-thumb').backgroundColor==='rgba(0, 0, 0, 0)'&&polishList.clientWidth===${idle.clientWidth}`))
      const wheel = await js(`(()=>{const r=polishList.getBoundingClientRect();return {x:r.x+20,y:r.y+r.height/2,before:polishList.scrollTop}})()`)
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wheel.x, y: wheel.y, deltaX: 0, deltaY: 40 })
      await js(`polishUntil(()=>polishList.scrollTop>${wheel.before})`)
      check(where + ': wheel reveals thumb', await js(`polishList.dataset.scrolling==='true'`))
      await js(`(async()=>{const handle=document.querySelector('#dots .dot.active');handle.focus();handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));await polishUntil(()=>!odkAppPlatform.active())})()`)
      check(where + ': release clears scroll state and listener', await js(`(()=>{polishList.dispatchEvent(new Event('scroll'));return !polishList.hasAttribute('data-scrolling')})()`))
      const longName = '长名字 Personal Agent '.repeat(3).slice(0, 40)
      await js(`(()=>{const form=document.querySelector('.agent-identity-form');form.elements.name.value=${JSON.stringify(longName)};form.requestSubmit()})()`)
      win.webContents.send('odk-personal-bot-status', { state: 'idle', proposalError: 'Provider response unavailable. '.repeat(30) })
      await js(`polishUntil(()=>document.querySelector('.agent-state').textContent==='Suggestions unavailable')`)
      const longIdentity = await js(`(()=>{const pill=document.querySelector('.agent-identity summary'),panel=document.querySelector('.agent-panel'),r=pill.getBoundingClientRect(),p=panel.getBoundingClientRect();return {height:r.height,contained:r.left>=p.left&&r.right<=p.right,oneLine:[...pill.querySelectorAll('.agent-name,.agent-state')].every(n=>n.getBoundingClientRect().height<=parseFloat(getComputedStyle(n).lineHeight)+1),accessible:pill.getAttribute('aria-label').includes(${JSON.stringify(longName)})&&pill.getAttribute('aria-label').includes('Suggestions unavailable')}})()`)
      check(where + ': long identity stays compact and accessible', longIdentity.height <= 46 && longIdentity.contained && longIdentity.oneLine && longIdentity.accessible)
      await js(`(()=>{const form=document.querySelector('.agent-identity-form');form.elements.name.value='Personal Agent';form.requestSubmit()})()`)
      win.webContents.send('odk-personal-bot-status', { state: 'idle' })
      await js(`polishUntil(()=>document.querySelector('.agent-state').textContent==='Ready')`)
      report.push({ theme, width, height, identity, longIdentity, focus, idle, scrolling })
    }
  }
  fs.writeFileSync(path.join(evidence, 'report.json'), JSON.stringify({ report, failures }, null, 2))
  console.log('INPUT_SCROLL_EVIDENCE ' + evidence)
  assert.deepEqual(failures, [])
  console.log('INPUT_SCROLL_POLISH_PASS: 4 themes x 3 sizes; capsule focus, native keyboard/wheel scroll, auto-hide, safe gutter, cleanup')
  finish(0)
}).catch(error => finish(1, error))
