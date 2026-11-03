const { app, BrowserWindow, ipcMain } = require('electron')
if (process.platform === 'linux') app.disableHardwareAcceleration()
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installGeometryFixtures } = require('./helpers/live-fixtures')
const { capturePaintedPage } = require('./helpers/native-page-capture')

if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-avatar-pixel-theme-'))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
installGeometryFixtures(ipcMain)
ipcMain.removeHandler('odk-personal-agent-status')
ipcMain.handle('odk-personal-agent-status', () => ({ state: 'idle' }))
let win
const timer = setTimeout(() => finish(1), 120000)
function finish(code) {
  clearTimeout(timer)
  if (win && !win.webContents.isDestroyed() && win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
  win?.destroy()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  app.exit(code)
}
const evaluate = script => win.webContents.executeJavaScript(script)

// A point-sampled avatar changes its silhouette in whole Pixel cells, so its
// left edge stays on the same column for several rows. Smooth vector art moves
// its edge by about one pixel on nearly every row. Count both, plus the palette.
function inspectPixels(image) {
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  const colors = new Set()
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 4
    colors.add(`${bitmap[offset]},${bitmap[offset + 1]},${bitmap[offset + 2]}`)
  }
  const edges = []
  for (let y = 0; y < height; y++) {
    let edge = -1
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      if ((bitmap[offset] + bitmap[offset + 1] + bitmap[offset + 2]) / 3 > 100) { edge = x; break }
    }
    if (edge < 0) continue
    if (edges.length) edges.push({ y, x: edge, flat: edge === edges.at(-1).x })
    else edges.push({ y, x: edge, flat: false })
  }
  const comparable = edges.slice(1)
  return {
    colors: colors.size,
    flatEdgeRatio: comparable.length ? +(comparable.filter(row => row.flat).length / comparable.length).toFixed(3) : 0,
    distinctEdges: new Set(edges.map(row => row.x)).size,
  }
}

const THEMES = ['instrument', 'pixel', 'border-beam', 'liquid-glass']
const SIZES = [[1280, 800], [1920, 1280], [320, 480]]

async function resize(width, height) {
  win.setContentSize(width, height)
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  })
  await evaluate(`window.dispatchEvent(new Event('resize'))`)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await evaluate(`innerWidth === ${width} && innerHeight === ${height} && devicePixelRatio === 1`)) {
      await evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>{window.dispatchEvent(new Event('resize'));requestAnimationFrame(()=>requestAnimationFrame(resolve))}))`)
      return
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail(`Viewport did not settle at ${width}x${height}`)
}

function geometryScript() {
  return `(()=>{
    const q=s=>document.querySelector(s), r=e=>e.getBoundingClientRect();
    const status=r(q('#status-bar')), avatar=r(q('.agent-avatar')), conversation=r(q('.agent-conversation'));
    const capsule=r(q('.agent-capsule')), bs=r(q('.bs-avatar')), composer=r(q('.agent-composer'));
    const svg=q('.agent-avatar .bs-avatar svg'), box=svg.getBBox(), matrix=svg.getScreenCTM();
    const artTop=new DOMPoint(box.x,box.y).matrixTransform(matrix).y;
    const defs=q('#odk-avatar-pixelate');
    // The live engine removes the static fallback; probe the selector without
    // leaving a node in the composition.
    const probe=document.createElement('img');probe.className='agent-avatar-fallback';
    q('.agent-avatar').append(probe);const fallbackFilter=getComputedStyle(probe).filter;probe.remove();
    return {
      gap:+(artTop-status.bottom).toFixed(1),
      topAligned:Math.abs(avatar.top-conversation.top)<1, visibleTop:Math.abs(artTop-conversation.top)<=6,
      messagesClear:conversation.top+parseFloat(getComputedStyle(q('.agent-conversation')).paddingTop)>capsule.bottom,
      composerInside:composer.bottom<=r(q('.agent-panel')).bottom+1,
      filter:getComputedStyle(q('.bs-avatar')).filter,
      activeTheme:document.documentElement.dataset.theme,
      fallbackFilter,
      viewBox:svg.getAttribute('viewBox'), paths:svg.querySelectorAll('path[d]').length,
      defsHidden:!!defs&&defs.ownerSVGElement.getBoundingClientRect().width===0,
      defsPrimitives:defs?[...defs.children].map(n=>n.tagName):[],
      avatarWidth:+bs.width.toFixed(1), policyErrors:window.pixelAvatarPolicyErrors||[],
      clip:{x:Math.max(0,Math.floor(bs.left)),y:Math.max(0,Math.ceil(status.bottom)),width:Math.floor(bs.width),height:Math.floor(capsule.top-status.bottom)}
    };
  })()`
}

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1280, height: 800, show: false, useContentSize: true, webPreferences: {
    preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true,
    nodeIntegration: false, offscreen: true, backgroundThrottling: false,
  } })
  win.webContents.debugger.attach('1.3')
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await evaluate(`!!document.querySelector('.agent-avatar .bs-avatar svg')`)) break
    await new Promise(resolve => setTimeout(resolve, 30))
  }
  assert.ok(await evaluate(`!!document.querySelector('.agent-avatar .bs-avatar svg')`), 'local Onee engine mounts')
  await evaluate(`(()=>{window.pixelAvatarPolicyErrors=[];document.addEventListener('securitypolicyviolation',event=>pixelAvatarPolicyErrors.push(event.violatedDirective))})()`)
  const rows = []
  for (const theme of THEMES) {
    for (const [width, height] of SIZES) {
      await resize(width, height)
      await evaluate(`(async()=>{await odkTheme.set(${JSON.stringify(theme)});window.dispatchEvent(new Event('resize'));await document.fonts.ready;await new Promise(r=>setTimeout(r,80))})()`)
      const geometry = await evaluate(geometryScript())
      const image = await capturePaintedPage(win, geometry.clip)
      rows.push({ theme, width, height, ...geometry, ...inspectPixels(image), clip: undefined })
    }
  }
  console.log('AVATAR_THEME_METRICS ' + JSON.stringify(rows.map(({ theme, width, height, colors, flatEdgeRatio, distinctEdges, gap, filter }) =>
    ({ theme, width, height, colors, flatEdgeRatio, distinctEdges, gap, filter }))))
  const failures = []
  for (const row of rows) {
    const where = `${row.theme} ${row.width}x${row.height}`
    const pixel = row.theme === 'pixel'
    const compact = row.width <= 639
    if (row.activeTheme !== row.theme) failures.push(`${where}: requested theme did not apply (${row.activeTheme})`)
    if (row.avatarWidth !== (compact ? 64 : 112)) failures.push(`${where}: unexpected Onee size ${row.avatarWidth}`)
    const expected = pixel ? (compact ? 'odk-avatar-pixelate-compact' : 'odk-avatar-pixelate') : null
    if (expected) {
      if (!/url\(/.test(row.filter) || !row.filter.includes(expected)) failures.push(`${where}: live avatar lacks ${expected} (${row.filter})`)
      if (!row.fallbackFilter.includes(expected)) failures.push(`${where}: fallback lacks the Pixel treatment (${row.fallbackFilter})`)
      if (!(row.flatEdgeRatio >= 0.7 && row.distinctEdges <= 9)) failures.push(`${where}: Pixel avatar has no square Pixel cells (ratio ${row.flatEdgeRatio}, edges ${row.distinctEdges})`)
      if (!row.defsHidden || row.defsPrimitives.length < 5) failures.push(`${where}: filter definition missing or visible ${JSON.stringify(row.defsPrimitives)}`)
    } else {
      if (row.filter !== 'none') failures.push(`${where}: smooth theme applies ${row.filter}`)
      if (!(row.distinctEdges >= 11 && row.flatEdgeRatio <= 0.65)) failures.push(`${where}: smooth avatar gained Pixel cells (ratio ${row.flatEdgeRatio}, edges ${row.distinctEdges})`)
    }
    if (!(row.gap >= 0 && row.gap <= 12)) failures.push(`${where}: Onee is ${row.gap}px below the State Bar`)
    if (!row.topAligned || !row.visibleTop) failures.push(`${where}: header top alignment changed`)
    if (!row.messagesClear || !row.composerInside) failures.push(`${where}: conversation or composer lost its space`)
    if (row.viewBox !== '-150 -150 300 300' || row.paths < 4) failures.push(`${where}: live Onee geometry changed`)
    // Liquid Glass starts its SDK worker without a worker-src allowance. That
    // violation predates the avatar filter, so it is not part of this gate.
    const added = row.policyErrors.filter(directive => directive !== 'worker-src')
    if (added.length) failures.push(`${where}: CSP violations ${JSON.stringify(added)}`)
  }
  assert.deepEqual(failures, [], 'Avatar theme and State Bar distance')
  console.log('Avatar pixel theme and State Bar distance passed across four themes and three sizes.')
  finish(0)
}).catch(error => { console.error(error); finish(1) })
