const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
if (!process.argv.includes('--fixture-x11')) app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-proactive-ui-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })
const timer = setTimeout(() => app.exit(1), 60000)
const delay = () => new Promise(resolve => setTimeout(resolve, 100))
app.whenReady().then(async () => {
  const commands = []
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight', 'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list', 'odk-personal-bot-status', 'odk-remote-publish-page-state']) ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [] }))
  ipcMain.handle('odk-personal-bot-proposal', (_event, command) => { commands.push(command); return { accepted: true } })
  const win = new BrowserWindow({ show: false, width: 480, height: 854, useContentSize: true, webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  const send = async status => { win.webContents.send('odk-personal-bot-status', status); await delay() }
  const p = { id: 'e311a280-c0b9-4411-96cd-4e1e92385349', ruleId: 'dry-soil', status: 'pending', advice: '<script>untrusted reading</script> 检查盆土。', action: { tool: 'memory_update', params: { category: 'watering', value: '检查盆土' } }, confirmation: '记住 watering：检查盆土', evidence: [{ readingId: 'odk.tile.hydra', field: 'plants.0.soilPercent', value: 10, state: 'live', measuredAt: '2026-10-02T10:00:00Z', ruleId: 'dry-soil' }] }
  await run(`document.querySelector('#dots .dot').focus()`)
  await send({ state: 'idle', proposals: [p], proposalPopup: true })
  assert.equal(await run(`document.activeElement.matches('#dots .dot')`), true)
  assert.equal(await run(`document.getElementById('pages-viewport').inert`), false)
  assert.equal(await run(`odkPersonalBotStatus.visible()`), false)
  assert.equal(await run(`document.getElementById('personal-bot-status').getAttribute('aria-modal')`), 'false')
  assert.equal(await run(`!!document.querySelector('.personal-bot-proposals script')`), false)
  assert.equal(commands[0].type, 'proposal_presented')
  await run(`[...document.querySelectorAll('.personal-bot-proposals button')].find(b => b.textContent === 'Accept').click()`)
  await delay(); assert.equal(commands.some(c => c.type === 'proposal_respond'), false)
  await run(`[...document.querySelectorAll('.personal-bot-proposals button')].find(b => b.textContent === '记住 watering：检查盆土').click()`)
  await delay(); assert.equal(commands.at(-1).confirmation, p.confirmation)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await run(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready.then(() => true)`)
    for (const [width, height] of [[320, 480], [480, 854], [1920, 1280]]) {
      win.setContentSize(width, height)
      for (const status of ['pending', 'expired', 'ignored', 'completed', 'unknown']) {
        await send({ state: 'idle', proposals: [{ ...p, status, advice: 'Long CJK 长句测试 '.repeat(40), result: status === 'unknown' ? 'Outcome unknown; do not retry.' : '' }], proposalPopup: true })
        const geometry = await run(`(() => {
          const node = document.querySelector('.personal-bot-status-content'); const r = node.getBoundingClientRect();
          const controls = [...document.querySelectorAll('.personal-bot-proposals button')];
          return { contained: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
            overflow: node.scrollWidth > node.clientWidth + 1,
            controls: controls.every(b => b.getBoundingClientRect().height >= 44),
            font: parseFloat(getComputedStyle(document.querySelector('.personal-bot-proposal-evidence')).fontSize),
            accept: controls.some(b => b.textContent === 'Accept') }
        })()`)
        assert.equal(geometry.contained, true); assert.equal(geometry.overflow, false); assert.equal(geometry.controls, true); assert.ok(geometry.font >= 14)
        assert.equal(geometry.accept, status === 'pending')
      }
    }
  }
  await run(`odkPersonalBotStatus.close()`)
  await send({ state: 'idle', proposals: [], proposalPopup: false })
  assert.equal(await run(`document.getElementById('personal-bot-status').hidden`), true)
  await send({ state: 'starting' })
  await send({ state: 'recording' })
  assert.equal(await run(`document.getElementById('personal-bot-status').dataset.proactive`), 'false')
  assert.equal(await run(`document.getElementById('pages-viewport').inert`), true)
  console.log('PROACTIVE_PANEL_CM5_ISOLATED_PASS: 3 themes, 3 sizes, 5 proposal states, focus, touch confirmation, literal untrusted text')
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
