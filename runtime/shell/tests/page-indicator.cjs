const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
ipcMain.handle('odk-remote-link-state', () => ({ state: 'disconnected', sequence: 0 }))
const { resolvePages } = require('./helpers/pages')

if (process.platform === 'darwin') app.dock.hide()
const root = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-page-indicator-'))
const cleanupProfile = () => {
  try { fs.rmSync(profile, { recursive: true, force: true }) }
  catch (error) {
    if (process.platform !== 'win32' || !['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error
    console.warn('Temporary indicator profile remains locked after shutdown')
  }
}
app.setPath('userData', profile)
const captureDir = process.argv.find(arg => arg.startsWith('--capture-dir='))?.slice('--capture-dir='.length)
const themes = ['instrument', 'border-beam', 'pixel']
const sizes = [[1920, 1280], [1000, 800], [636, 900], [480, 854], [380, 600], [320, 480]]
const js = (win, source) => win.webContents.executeJavaScript(source)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let failures = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) {
    failures += 1
    if (detail) console.log(JSON.stringify(detail))
  }
}

ipcMain.handle('odk-camera-frame', () => ({ status: 'unavailable', frame: null, capturedAt: null }))
ipcMain.handle('odk-weather-status', () => ({ status: 'unconfigured', place: null, current: null, daily: null, updatedAt: null, hint: null, error: null }))
ipcMain.handle('odk-futu-holdings', () => ({ state: 'unavailable', service: 'futu-poller', snapshot: null, updatedAt: null }))
ipcMain.handle('odk-personal-bot-status', () => ({ state: 'unavailable' }))
ipcMain.handle('odk-renderer-development-plugins', () => [])
ipcMain.handle('odk-opencode-go-status', () => ({ state: 'unconfigured' }))
ipcMain.handle('odk-pi-sessions', () => ({ summary: { running: 2, total: 2, workspacesCount: 1 }, sessions: [] }))
ipcMain.handle('odk-remote-publish-page-state', () => true)
ipcMain.handle('odk-hydra-status', () => ({ configured: false, connected: false, env: null, nodes: [] }))
ipcMain.handle('odk-weread-highlight', () => ({ status: 'unconfigured', highlight: null }))
ipcMain.handle('odk-user-apps-list', () => ({ ok: true, apps: [] }))

async function waitFor(win, expression) {
  const end = Date.now() + (process.arch === 'arm64' ? 15000 : 5000)
  while (Date.now() < end) {
    if (await js(win, expression)) return
    await delay(20)
  }
  throw new Error(`Handle did not settle: ${expression}`)
}
async function key(win, code) {
  const windowsVirtualKeyCode = { ArrowLeft:37, ArrowRight:39, Home:36, End:35, Enter:13, Space:32 }[code]
  const value = code === 'Space' ? ' ' : code
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type:'keyDown', key:value, code, windowsVirtualKeyCode })
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type:'keyUp', key:value, code, windowsVirtualKeyCode })
}
async function resize(win, width, height) {
  win.setContentSize(width, height)
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor:1, mobile:false })
  await js(win, 'window.dispatchEvent(new Event("resize"))')
  await waitFor(win, `window.__odkGrid?.width === ${width} && window.__odkGrid?.height === ${height}`)
  await js(win, 'document.querySelector("#page-center").scrollIntoView({block:"end"}); new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
}
async function pointerSelect(win, index) {
  let current = await js(win, '[...document.querySelectorAll(".dot")].findIndex(n=>n.classList.contains("active"))')
  while (current !== index) {
    const point = await js(win, '(()=>{const r=document.querySelector(".dot.active").getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()')
    const dx = current < index ? -90 : 90
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type:'mouseMoved', ...point })
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type:'mousePressed', ...point, button:'left', clickCount:1 })
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type:'mouseMoved', x:point.x+dx, y:point.y, button:'left', buttons:1 })
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type:'mouseReleased', x:point.x+dx, y:point.y, button:'left', clickCount:1 })
    current += Math.sign(index-current)
    await waitFor(win, `document.querySelectorAll('.dot')[${current}].getAttribute('aria-current') === 'page'`)
  }
}
async function cancelledSwipe(win) {
  const point = await js(win, '(()=>{const r=document.querySelector(".dot.active").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id:1}})()')
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[point] })
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{...point,x:point.x-90}] })
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type:'touchCancel', touchPoints:[] })
  assert.equal(await js(win, 'document.querySelectorAll(".dot")[0].getAttribute("aria-current")'), 'page', 'Cancelled Home handle swipe must preserve the current page')
}
async function inspect(win) {
  return js(win, `(()=>{
    const buttons=[...document.querySelectorAll('#dots .dot')], visible=buttons.filter(n=>n.getClientRects().length), active=buttons.find(n=>n.classList.contains('active'));
    const index=buttons.indexOf(active), names=window.DESKTOP_LAYOUT.pages.filter(p=>!p.persistent).map(p=>p.name);
    const r=active.getBoundingClientRect(), nav=document.getElementById('dots').getBoundingClientRect(), v=document.getElementById('pages-viewport').getBoundingClientRect();
    const marker=getComputedStyle(active,'::before'), after=getComputedStyle(active,'::after');
    return {count:visible.length,named:active.getAttribute('aria-label').includes(names[index])&&active.getAttribute('aria-label').includes('page '+(index+1)+' of '+names.length),
      quiet:!active.textContent.trim()&&document.getElementById('page-context').classList.contains('sr-only'),
      selected:visible.length===1&&visible[0]===active&&active.getAttribute('aria-current')==='page'&&buttons.filter(n=>n!==active).every(n=>n.hidden&&n.tabIndex===-1),
      shape:parseFloat(marker.width)===104&&parseFloat(marker.height)===5&&marker.opacity==='1'&&after.content==='none',
      hits:r.width>=100&&r.height===44&&[r.top+4,r.top+r.height/2,r.bottom-4].every(y=>document.elementFromPoint(r.x+r.width/2,y)===active),
      contained:r.left>=v.left&&r.right<=v.right&&Math.abs((nav.left+nav.right)/2-(v.left+v.right)/2)<1&&nav.bottom<=innerHeight+1,
      noCard:getComputedStyle(document.getElementById('dots'),'::before').content==='none'&&getComputedStyle(active).backgroundColor==='rgba(0, 0, 0, 0)',
      stationary:marker.animationName==='none'&&!/all|width|height/.test(marker.transitionProperty),footprint:[nav.x,nav.y,nav.width,nav.height]};
  })()`)
}
async function main() {
  const win = new BrowserWindow({ width:1000, height:800, show:false, frame:false, useContentSize:true,
    webPreferences:{preload:path.join(root,'src/preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true} })
  await win.loadFile(path.join(root,'src/renderer/index.html'))
  await js(win,'window.odkShellReady'); await js(win,'document.fonts.ready')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2})
  const count=await js(win,'document.querySelectorAll(".dot").length')
  await cancelledSwipe(win)
  for(const theme of [...themes,'liquid-glass']) {
    await js(win,`odkTheme.set('${theme}')`)
    await js(win,'document.fonts.ready')
    for(const [width,height] of sizes) {
      await resize(win,width,height)
      let footprint
      for(let index=0;index<count;index++) {
        await pointerSelect(win,index)
        const value=await inspect(win), label=`${theme} ${width}x${height} page ${index+1}`
        check(`${label}: one named neutral handle`,value.count===1&&value.named&&value.quiet&&value.selected&&value.shape,value)
        check(`${label}: centered reachable 44px target without a card`,value.hits&&value.contained&&value.noCard,value)
        check(`${label}: stable footprint and restrained feedback`,value.stationary&&(!footprint||value.footprint.every((n,i)=>Math.abs(n-footprint[i])<1)),value)
        footprint=value.footprint
      }
      if(captureDir){fs.mkdirSync(captureDir,{recursive:true});fs.writeFileSync(path.join(captureDir,`${theme}-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG())}
    }
    await js(win,'document.querySelector(".dot.active").focus()')
    await key(win,'Home');await key(win,'ArrowRight')
    check(`${theme}: arrow navigation retains focus`,await js(win,'document.activeElement===document.querySelectorAll(".dot")[1]&&document.activeElement.matches(":focus-visible")'))
    await key(win,'End');await key(win,'ArrowLeft')
    check(`${theme}: End and previous page retain focus`,await js(win,`document.activeElement===document.querySelectorAll('.dot')[${count-2}]`))
    await key(win,'Enter');await key(win,'Space')
    check(`${theme}: Home handle taps do not change page`,await js(win,`document.querySelectorAll('.dot')[${count-2}].classList.contains('active')`))
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    await pointerSelect(win,0)
    check(`${theme}: reduced motion retains static feedback`,(await inspect(win)).stationary)
    await cancelledSwipe(win)
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]})
  }
  await js(win,'odkTheme.set("pixel")')
  win.webContents.setZoomFactor(2)
  await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
  await waitFor(win,'window.__odkGrid?.width===innerWidth')
  await js(win,'document.querySelector("#page-center").scrollIntoView({block:"end"})')
  const zoom=await inspect(win)
  check('200% zoom retains one reachable handle',zoom.count===1&&zoom.hits&&zoom.contained,zoom)
  assert.equal(failures,0,`${failures} home handle checks failed`)
  console.log('PAGE_INDICATOR_PASS')
  app.exit(0)
}
const timeout=setTimeout(()=>{console.error('Home handle matrix timed out');app.exit(1)},process.arch==='arm64'||process.platform==='win32'?900000:120000)
process.once('exit',cleanupProfile)
app.whenReady().then(main).then(()=>clearTimeout(timeout)).catch(error=>{console.error(error);app.exit(1)})
