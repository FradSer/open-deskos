const { app, BrowserWindow, ipcMain } = require('electron')
ipcMain.handle('odk-remote-link-state', () => ({ state: 'disconnected', sequence: 0 }))
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
  const ownerTurns = []
  let rejectResponse = false
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight', 'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list', 'odk-personal-bot-status', 'odk-remote-publish-page-state']) ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [] }))
  ipcMain.handle('odk-personal-bot-text', (_event, text) => { ownerTurns.push(text); return { accepted: true } })
  ipcMain.handle('odk-personal-bot-proposal', (_event, command) => { commands.push(command); if (rejectResponse && command.type === 'proposal_respond') throw Error('Controlled offline delivery failure'); return { accepted: true } })
  const win = new BrowserWindow({ show: false, width: 480, height: 854, useContentSize: true, webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  win.webContents.debugger.attach('1.3')
  win.webContents.setZoomFactor(1)
  const viewport = async (width, height) => {
    win.setContentSize(width, height)
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await run(`window.dispatchEvent(new Event('resize')); document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`)
    assert.deepEqual(await run(`({ width: innerWidth, height: innerHeight, scale: devicePixelRatio })`), { width, height, scale: 1 })
  }
  await viewport(480, 854)
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
  await send({ state: 'idle', proposals: [p], proposalHiddenCount: 0, proposalPopup: true, proposalError: 'generation_unavailable' })
  assert.equal(await run(`document.querySelector('.personal-bot-proposal-error')?.textContent`), 'generation_unavailable')
  await run(`window.__proposalControls = [...document.querySelectorAll('.personal-bot-proposals button')]`)
  await send({ state: 'idle', proposals: [p], proposalHiddenCount: 0, proposalPopup: false })
  assert.equal(await run(`!!document.querySelector('.personal-bot-proposal-error')`), false)
  assert.equal(await run(`window.__proposalControls.every((node, index) => document.querySelectorAll('.personal-bot-proposals button')[index] === node)`), true)
  await send({ state: 'idle', proposals: [p], proposalHiddenCount: 0, proposalPopup: false, proposalError: 'checkpoint_failed' })
  assert.equal(await run(`!!document.querySelector('.personal-bot-proposal-error')`), true)
  const uncertain = { ...p, id: 'a91cb070-410b-42a8-b15e-f0508d2f9dbf' }
  await send({ state: 'idle', proposals: [uncertain], proposalHiddenCount: 0, proposalPopup: true })
  rejectResponse = true
  await run(`[...document.querySelectorAll('.personal-bot-proposals button')].find(b => b.textContent === 'Accept').click()`)
  await run(`[...document.querySelectorAll('.personal-bot-proposals button')].find(b => b.textContent === '记住 watering：检查盆土').click()`)
  await delay()
  const commandCount = commands.length
  await run(`window.__disabledConfirmation = [...document.querySelectorAll('.personal-bot-proposals button')].find(b => b.textContent === '记住 watering：检查盆土')`)
  await send({ state: 'idle', proposals: [uncertain], proposalHiddenCount: 0, proposalPopup: false, proposalError: 'generation_unavailable' })
  await send({ state: 'idle', proposals: [uncertain], proposalHiddenCount: 0, proposalPopup: false })
  assert.match(await run(`document.querySelector('.personal-bot-proposal-error')?.textContent ?? ''`), /not delivered.*do not repeat an uncertain action/)
  assert.equal(await run(`window.__disabledConfirmation.isConnected && window.__disabledConfirmation.disabled`), true)
  assert.equal(commands.length, commandCount)
  rejectResponse = false
  const ride = { ...p, id: 'a2f9fed5-8a7a-458e-bfbf-d5650c5edf40', action: null, confirmation: '',
    ridePreview: { handle: '11111111-1111-4111-8111-111111111111', status: 'choose_places', sandbox: true, measuredAt: new Date().toISOString(), expiresAt: Date.now() + 120000,
      from: [{ handle: '22222222-2222-4222-8222-222222222222', name: '<script>测试起点甲</script>', city: '测试市', address: '测试街道' }, { handle: '33333333-3333-4333-8333-333333333333', name: '测试起点乙', city: '测试市' }],
      to: [{ handle: '44444444-4444-4444-8444-444444444444', name: '测试终点', city: '测试市' }], items: [{ productName: '测试车型', productCategory: '1', priceText: '20元' }] } }
  await send({ state: 'idle', proposals: [ride], proposalPopup: true })
  const beforeDetails = commands.length
  await run(`[...document.querySelectorAll('.personal-bot-proposals button')].find(b => b.textContent === 'View ride details').click()`)
  assert.equal(ownerTurns.length, 0); assert.equal(commands.length, beforeDetails)
  assert.equal(await run(`!!document.querySelector('.personal-bot-ride-details script')`), false)
  assert.equal(await run(`document.querySelector('.personal-bot-ride-details').hidden`), false)
  assert.match(await run(`document.querySelector('.personal-bot-ride-details').textContent`), /20元/)
  await run(`[...document.querySelectorAll('.personal-bot-ride-details button')].find(b => b.textContent === 'Get current quote').click()`)
  await delay(); assert.equal(ownerTurns.length, 0)
  await run(`document.querySelector('.personal-bot-ride-details select').value = '33333333-3333-4333-8333-333333333333'; [...document.querySelectorAll('.personal-bot-ride-details button')].find(b => b.textContent === 'Get current quote').click()`)
  await delay()
  assert.deepEqual(ownerTurns, ['查看报价 11111111-1111-4111-8111-111111111111 33333333-3333-4333-8333-333333333333 44444444-4444-4444-8444-444444444444'])
  assert.equal(commands.filter(c => c.type === 'proposal_respond').length, 2, 'Ride details add no proposal action')
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await run(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready.then(() => true)`)
    for (const [width, height] of [[320, 480], [480, 854], [1920, 1280]]) {
      await viewport(width, height)
      await send({ state: 'idle', proposals: [ride], proposalPopup: true })
      await run(`[...document.querySelectorAll('.personal-bot-proposals button')].find(b => b.textContent === 'View ride details').click(); document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`)
      const rideGeometry = await run(`(() => { const node = document.querySelector('.personal-bot-status-content'); return { overflow: node.scrollWidth > node.clientWidth + 1, heights: [...document.querySelectorAll('.personal-bot-ride-details select, .personal-bot-ride-details button')].map(n => n.getBoundingClientRect().height) } })()`)
      assert.equal(rideGeometry.overflow, false); assert.ok(rideGeometry.heights.length >= 3); assert.ok(rideGeometry.heights.every(h => h >= 44))
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
  assert.equal(await run(`document.getElementById('personal-bot-status').hidden`), true)
  assert.equal(await run(`document.querySelector('.agent-state').textContent`), 'Listening…')
  assert.equal(await run(`document.querySelector('.agent-mic').getAttribute('aria-label')`), 'Stop recording')
  assert.equal(await run(`document.getElementById('pages-viewport').inert || document.getElementById('home-desk').inert`), false)
  console.log('PROACTIVE_PANEL_CM5_ISOLATED_PASS: 3 themes, 3 sizes, 5 proposal states, focus, touch confirmation, literal untrusted text, service error recovery, uncertain delivery, read-only ride details and explicit owner quote selection')
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
