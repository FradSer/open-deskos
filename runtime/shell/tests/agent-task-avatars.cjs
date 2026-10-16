const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installGeometryFixtures } = require('./helpers/live-fixtures')

app.disableHardwareAcceleration()
if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-child-avatars-'))
app.setPath('userData', profile)
app.setPath('sessionData', profile)
installGeometryFixtures(ipcMain)
const saved = { taskId: '64a7f377-3169-447c-9b85-547a2454c28f', identity: { id: 'reporter', name: 'Reporter 中文', avatar: 'book', revision: 'a'.repeat(64) }, state: 'running', updatedAt: '2026-10-16T00:00:00.000Z' }
let win
const timer = setTimeout(() => finish(1), 60000)
function finish(code) { clearTimeout(timer); win?.destroy(); try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} app.exit(code) }
const evaluate = script => win.webContents.executeJavaScript(script)
async function waitFor(expression) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail(`Child avatar condition failed: ${expression}`)
}
const send = (agents, state = 'idle') => win.webContents.send('odk-personal-bot-status', { state, agents })

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1280, height: 800, show: false, useContentSize: true, webPreferences: {
    preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false,
  } })
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  await waitFor(`!!document.querySelector('.agent-conversation')`)
  await evaluate('document.fonts.ready')
  send({ state: 'live', tasks: [saved] })
  await waitFor(`document.querySelectorAll('.agent-child').length === 1`)
  assert.equal(await evaluate(`document.querySelector('.agent-child-name').textContent`), saved.identity.name)
  assert.equal(await evaluate(`document.querySelector('.agent-child-state').textContent`), 'Running')
  assert.equal(await evaluate(`document.querySelector('.agent-child-avatar svg').getAttribute('data-tabler')`), 'book-open')
  send({ state: 'live', tasks: [{ ...saved, state: 'cancelling' }] })
  await waitFor(`document.querySelector('.agent-child-state').textContent === 'Cancelling'`)
  send({ state: 'unavailable', tasks: [] }, 'unavailable')
  await waitFor(`document.querySelector('.agent-child-state').textContent === 'Status unavailable'`)
  send({ state: 'live', tasks: [] })
  await waitFor(`document.querySelectorAll('.agent-child').length === 0`)
  const long = { ...saved, identity: { ...saved.identity, name: '<script>literal</script>中文中文中文中文中文中文中文', avatar: 'compass' } }
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    for (const [width, height, zoom] of [[1280, 800, 1], [320, 480, 1], [640, 960, 2]]) {
      win.setContentSize(width, height)
      win.webContents.setZoomFactor(zoom)
      await evaluate(`(async()=>{await odkTheme.set(${JSON.stringify(theme)});window.dispatchEvent(new Event('resize'));await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`)
      send({ state: 'live', tasks: [long] })
      await waitFor(`document.querySelector('.agent-child-name')?.textContent === ${JSON.stringify(long.identity.name)}`)
      const geometry = await evaluate(`(()=>{const row=document.querySelector('.agent-child'),name=row.querySelector('.agent-child-name'),list=document.querySelector('.agent-conversation'),composer=document.querySelector('.agent-composer'),r=row.getBoundingClientRect(),l=list.getBoundingClientRect(),c=composer.getBoundingClientRect();return {inside:r.left>=l.left-1&&r.right<=l.right+1,noOverflow:row.scrollWidth<=row.clientWidth+1,font:parseFloat(getComputedStyle(row.querySelector('.agent-child-state')).fontSize),separate:c.top>=l.bottom-1,literal:name.children.length===0}})()`)
      assert(geometry.inside && geometry.noOverflow && geometry.font >= 14 && geometry.separate && geometry.literal, `${theme} ${width} ${zoom}: ${JSON.stringify(geometry)}`)
      if (theme === 'pixel') assert.equal(await evaluate(`document.querySelector('.agent-child-avatar svg').getAttribute('fill')`), 'currentColor')
    }
  }
  win.webContents.setZoomFactor(1)
  win.setContentSize(1280, 800)
  await evaluate(`(async()=>{await odkTheme.set('instrument');window.dispatchEvent(new Event('resize'));await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`)
  win.webContents.send('odk-personal-bot-status', { state: 'idle', transcript: 'Compare the regional report.', message: 'I am checking all three requested regions.', agents: { state: 'live', tasks: [saved] } })
  await waitFor(`document.querySelector('.agent-child-name').textContent === 'Reporter 中文'`)
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
  if (process.env.ODK_AGENT_AVATAR_CAPTURE) {
    const painted = new Promise(resolve => win.webContents.once('paint', resolve))
    win.webContents.invalidate()
    await painted
    const clip = await evaluate(`(()=>{const r=document.querySelector('.agent-panel').getBoundingClientRect();return {x:Math.ceil(r.x),y:Math.ceil(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}})()`)
    fs.writeFileSync(process.env.ODK_AGENT_AVATAR_CAPTURE, (await win.webContents.capturePage(clip)).toPNG())
  }
  assert.equal(await evaluate(`(()=>{const input=document.querySelector('.agent-composer textarea');input.focus();return document.activeElement===input})()`), true)
  console.log('Child avatars: identity, lifecycle, unavailable state, literal names, four themes, narrow layout, large text and composer passed.')
  finish(0)
}).catch(error => { console.error(error); finish(1) })
