const { app, BrowserWindow, ipcMain } = require('electron')
if (!process.argv.includes('--reconnect-only')) ipcMain.handle('odk-personal-bot-consumer-ready', () => ({ accepted: false }))
ipcMain.handle('odk-renderer-development-plugins', () => [])
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
const reconnectOnly = process.argv.includes('--reconnect-only')
const timer = setTimeout(() => app.exit(1), reconnectOnly ? 120000 : 60000)
const delay = () => new Promise(resolve => setTimeout(resolve, 100))
app.whenReady().then(async () => {
  const reconnect = reconnectOnly ? await require('./helpers/proactive-reconnect').createProactiveReconnectFixture() : undefined
  const commands = []
  const ownerTurns = []
  let rejectResponse = false
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight', 'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list', 'odk-personal-bot-status', 'odk-remote-publish-page-state']) ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [] }))
  ipcMain.handle('odk-personal-bot-text', (_event, text) => { ownerTurns.push(text); return { accepted: true } })
  ipcMain.handle('odk-personal-bot-proposal', (_event, command) => { commands.push(command); if (rejectResponse && command.type === 'proposal_respond') throw Error('Controlled offline delivery failure'); return { accepted: true } })
  const win = new BrowserWindow({ show: false, width: 480, height: 854, useContentSize: true, webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } })
  if (reconnect) {
    for (const name of ['odk-personal-bot-status', 'odk-personal-bot-text', 'odk-personal-bot-proposal']) ipcMain.removeHandler(name)
    reconnect.bindMain(ipcMain, win)
  }
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
  if (reconnect) {
    try { await reconnect.verify(win, run) } finally { await reconnect.close() }
    clearTimeout(timer); win.destroy(); app.exit(0); return
  }
  const send = async status => { win.webContents.send('odk-personal-bot-status', status); await delay() }
  const p = { id: 'e311a280-c0b9-4411-96cd-4e1e92385349', ruleId: 'dry-soil', status: 'pending', offered: true, presented: false, reason: 'A current soil reading is below the selected threshold.', nextStep: 'Touch the soil and check its moisture before watering.', advice: '<script>untrusted reading</script> 检查盆土。', action: { tool: 'memory_update', params: { category: 'watering', value: '检查盆土' } }, confirmation: '记住 watering：检查盆土', evidence: [{ readingId: 'odk.tile.hydra', field: 'plants.0.soilPercent', value: 10, state: 'live', measuredAt: '2026-10-02T10:00:00Z', ruleId: 'dry-soil' }] }
  async function longAdviceVisibility() {
    await viewport(320, 480)
    const long = { ...p, id: 'b311a280-c0b9-4411-96cd-4e1e92385349', advice: '检查当前读数并决定下一步。'.repeat(100).slice(0, 1000) }
    commands.length = 0
    await send({ state: 'idle', proposals: [long], proposalPopup: true, proposalCapabilities: { read: true, respond: true, acknowledge: true } })
    await run(`document.querySelector('.personal-bot-proposal-advice').scrollIntoView({block:'center'})`)
    await delay()
    const geometry = await run(`(() => { const body = document.querySelector('.personal-bot-proposal-advice').getBoundingClientRect(); const viewport = document.querySelector('.personal-bot-status-content').getBoundingClientRect(); return { body: body.height, viewport: viewport.height } })()`)
    assert.ok(geometry.body > geometry.viewport * 2, JSON.stringify(geometry))
    assert.ok(commands.some(c => c.type === 'proposal_presented' && c.ids.includes(long.id)), 'Visible long advice must be acknowledged even when less than half of the entire paragraph fits')
    const before = commands.length
    await send({ state: 'idle', proposals: [{ ...long, id: 'b311a280-c0b9-4411-96cd-4e1e92385350' }], proposalPopup: true, proposalCapabilities: { read: true, respond: false, acknowledge: false } })
    await run(`document.querySelector('.personal-bot-proposal-advice').scrollIntoView({block:'center'})`)
    await delay(); assert.equal(commands.length, before, 'Long read-only advice cannot acknowledge itself')
    await run(`odkPersonalBotStatus.close()`)
    await viewport(480, 854)
    commands.length = 0
  }
  if (process.argv.includes('--long-advice-only')) {
    await longAdviceVisibility()
    console.log('PROACTIVE_LONG_ADVICE_VISIBLE_PASS')
    clearTimeout(timer); win.destroy(); app.exit(0); return
  }
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
  const commandCount = commands.filter(c => c.type === 'proposal_respond').length
  await run(`window.__disabledConfirmation = [...document.querySelectorAll('.personal-bot-proposals button')].find(b => b.textContent === '记住 watering：检查盆土')`)
  await send({ state: 'idle', proposals: [uncertain], proposalHiddenCount: 0, proposalPopup: false, proposalError: 'generation_unavailable' })
  await send({ state: 'idle', proposals: [uncertain], proposalHiddenCount: 0, proposalPopup: false })
  assert.match(await run(`document.querySelector('.personal-bot-proposal-error')?.textContent ?? ''`), /not delivered.*do not repeat an uncertain action/)
  assert.equal(await run(`window.__disabledConfirmation.isConnected && window.__disabledConfirmation.disabled`), true)
  assert.equal(commands.filter(c => c.type === 'proposal_respond').length, commandCount)
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
  assert.match(await run(`document.querySelector('.personal-bot-ride-details').textContent`), /Sandbox preview; no real vehicle or trip\./)
  assert.match(await run(`document.querySelector('.personal-bot-ride-details').textContent`), /20元/)
  await run(`[...document.querySelectorAll('.personal-bot-ride-details button')].find(b => b.textContent === 'Get current quote').click()`)
  await delay(); assert.equal(ownerTurns.length, 0)
  await run(`document.querySelector('.personal-bot-ride-details select').value = '33333333-3333-4333-8333-333333333333'; [...document.querySelectorAll('.personal-bot-ride-details button')].find(b => b.textContent === 'Get current quote').click()`)
  await delay()
  assert.deepEqual(ownerTurns, ['查看报价 11111111-1111-4111-8111-111111111111 33333333-3333-4333-8333-333333333333 44444444-4444-4444-8444-444444444444'])
  assert.equal(commands.filter(c => c.type === 'proposal_respond').length, 2, 'Ride details add no proposal action')
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await run(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready.then(() => true)`)
    for (const [width, height] of [[320, 480], [480, 854], [1920, 1280]]) {
      await viewport(width, height)
      await send({ state: 'idle', proposals: [ride], proposalPopup: true })
      await run(`(() => { const open = [...document.querySelectorAll('.personal-bot-proposals button')].find(b => b.textContent === 'View ride details'); if (open.getAttribute('aria-expanded') === 'false') open.click(); return document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) })()`)
      const rideGeometry = await run(`(() => { const node = document.querySelector('.personal-bot-status-content'); return { detailsHidden: document.querySelector('.personal-bot-ride-details').hidden, overflow: node.scrollWidth > node.clientWidth + 1, heights: [...document.querySelectorAll('.personal-bot-ride-details select, .personal-bot-ride-details button')].map(n => n.getBoundingClientRect().height) } })()`)
      assert.equal(rideGeometry.detailsHidden, false, JSON.stringify({ theme, width, height, ...rideGeometry })); assert.equal(rideGeometry.overflow, false); assert.ok(rideGeometry.heights.length >= 3); assert.ok(rideGeometry.heights.every(h => h >= 44), JSON.stringify({ theme, width, height, ...rideGeometry }))
      for (const status of ['pending', 'expired', 'ignored', 'completed', 'unknown']) {
        await send({ state: 'idle', proposals: [{ ...p, status, advice: 'Long CJK 长句测试 '.repeat(40), result: status === 'unknown' ? 'Outcome unknown; do not retry.' : '' }], proposalPopup: true })
        const geometry = await run(`(() => {
          const node = document.querySelector('.personal-bot-status-content'); const r = node.getBoundingClientRect();
          const controls = [...document.querySelectorAll('.personal-bot-proposals button')].filter(n => n.checkVisibility());
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
  const actionCard = { ...p, action: null, confirmation: '', advice: '检查书桌旁植物的盆土，确认是否需要浇水。', nextStep: '用手指检查表层下方的土壤；如果仍然干燥，再少量浇水。', reason: 'Legacy reason must not render.', evidence: [...p.evidence, { readingId: 'fixture.export', field: 'sha256', value: 'a'.repeat(64), state: 'live', measuredAt: '2026-10-23T10:00:00Z' }] }
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await run(`odkTheme.set(${JSON.stringify(theme)})`)
    for (const [width, height] of [[320, 480], [480, 854], [1920, 1280]]) {
      await viewport(width, height)
      await send({ state: 'idle', proposals: [actionCard], proposalPopup: true })
      await run(`document.querySelector('.personal-bot-status-content').scrollTop = 0; document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`)
      const layout = await run(`(() => {
        const card = document.querySelector('.personal-bot-proposal'), advice = card.querySelector('.personal-bot-proposal-advice'), next = card.querySelector('.personal-bot-proposal-next-step'), actions = card.querySelector('.personal-bot-proposal-actions'), sources = card.querySelector('.personal-bot-proposal-sources'), feedback = card.querySelector('.personal-bot-proposal-feedback-options');
        return { advice: advice.textContent, next: next.textContent, reason: !!card.querySelector('.personal-bot-proposal-reason') || card.textContent.includes('Legacy reason must not render.'), sourcesClosed: !sources.open, feedbackClosed: !feedback.open, hashHidden: [...sources.querySelectorAll('p')].filter(p => p.textContent.includes('a'.repeat(64))).every(p => !p.checkVisibility()), hashCount: [...sources.querySelectorAll('p')].filter(p => p.textContent.includes('a'.repeat(64))).length, ordered: advice.getBoundingClientRect().top < next.getBoundingClientRect().top && next.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top && actions.getBoundingClientRect().bottom <= sources.getBoundingClientRect().top, adviceSize: parseFloat(getComputedStyle(advice).fontSize), detailSize: parseFloat(getComputedStyle(sources.querySelector('p')).fontSize), nextSize: parseFloat(getComputedStyle(next).fontSize), overflow: card.scrollWidth > card.clientWidth + 1, controls: [...actions.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44) }
      })()`)
      assert.equal(layout.advice, actionCard.advice); assert.equal(layout.next, actionCard.nextStep)
      for (const key of ['sourcesClosed', 'feedbackClosed', 'hashHidden', 'ordered', 'controls']) assert.equal(layout[key], true, JSON.stringify({ theme, width, height, key, ...layout }))
      assert.equal(layout.hashCount, 1); assert.equal(layout.reason, false); assert.equal(layout.overflow, false)
      assert.ok(layout.adviceSize >= layout.detailSize * 1.4); assert.ok(layout.nextSize >= 16)
    }
  }
  // Only the original technical advice in the expanded source can acknowledge an older suggestion.
  const technical = { ...p, id: 'a111a280-c0b9-4411-96cd-4e1e92385349', action: null, confirmation: '', advice: `Inspect expectedSHA256 ${'a'.repeat(64)}` }
  commands.length = 0
  await send({ state: 'idle', proposals: [technical], proposalPopup: true })
  assert.equal(commands.some(c => c.type === 'proposal_presented' && c.ids.includes(technical.id)), false)
  await run(`document.querySelector('.personal-bot-proposals button[data-proposal-action="view-sources"]').click(); document.querySelector('.personal-bot-proposal-original-advice').scrollIntoView({block:'center'})`)
  await delay()
  assert.ok(commands.some(c => c.type === 'proposal_presented' && c.ids.includes(technical.id)))
  await run(`document.querySelector('.personal-bot-proposal-sources summary').click()`)
  // Synthetic suggestions exercise the real scroll viewport without model or device access.
  await run(`odkTheme.set('instrument')`)
  await viewport(480, 854)
  const queued = Array.from({ length: 8 }, (_, index) => ({ ...p, id: `e311a280-c0b9-4411-96cd-4e1e92385${String(350 + index).padStart(3, '0')}`, action: null, confirmation: '', advice: `Suggestion ${index + 1}: inspect the actual soil reading.`, reason: 'This plant has a fresh low soil reading.' }))
  commands.length = 0
  await send({ state: 'idle', proposals: queued, proposalPopup: true, proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  const seen = () => commands.filter(c => c.type === 'proposal_presented').flatMap(c => c.ids)
  assert.ok(seen().length > 0 && seen().length < queued.length, JSON.stringify({ seen: seen() }))
  assert.ok(!seen().includes(queued.at(-1).id), 'An offscreen suggestion must remain unread')
  await run(`document.querySelectorAll('.personal-bot-proposal-advice')[7].scrollIntoView({block:'center'})`)
  await delay()
  assert.ok(seen().includes(queued.at(-1).id), 'Scrolling the actual advice into view acknowledges that suggestion')
  const expectedFeedback = [['Done', 'done'], ['Later', 'snooze'], ['Useful', 'useful'], ['Not relevant', 'irrelevant'], ['Incorrect', 'incorrect']]
  for (const [label, decision] of expectedFeedback) {
    const next = { ...p, id: `d311a280-c0b9-4411-96cd-4e1e92385${String(360 + expectedFeedback.findIndex(row => row[0] === label)).padStart(3, '0')}`, action: null, confirmation: '' }
    await send({ state: 'idle', proposals: [next], proposalPopup: true })
    await run(`(() => { const details = document.querySelector('.personal-bot-proposal-feedback-options'); details.open = true; const control = [...document.querySelectorAll('.personal-bot-proposal button')].find(b => b.textContent === ${JSON.stringify(label)}); control.scrollIntoView({block:'center'}); control.focus(); return control.getBoundingClientRect().height })()`)
    // Keyboard activation uses the same candidate-specific command as touch/click.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await delay()
    assert.equal(commands.at(-1).decision, decision); assert.equal(commands.at(-1).id, next.id)
    const updated = { ...next, feedback: decision, status: ['done'].includes(decision) ? 'completed' : ['irrelevant', 'incorrect'].includes(decision) ? 'ignored' : 'pending', ...(decision === 'snooze' ? { snoozedUntil: Date.now() + 60000 } : {}) }
    await send({ state: 'idle', proposals: [updated], proposalPopup: false })
    assert.equal(await run(`document.activeElement.textContent`), decision === 'useful' ? 'Useful' : 'Close', 'Feedback updates retain a meaningful keyboard focus')
  }
  const touched = { ...p, id: 'f311a280-c0b9-4411-96cd-4e1e92385349', action: null, confirmation: '' }
  await send({ state: 'idle', proposals: [touched], proposalPopup: true })
  const touch = await run(`(() => { const node = [...document.querySelectorAll('.personal-bot-proposals button')].find(b => b.textContent === 'Done'); node.scrollIntoView({block:'center'}); const r = node.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 } })()`)
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true })
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touch, id: 1 }] })
  await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await delay()
  assert.equal(commands.at(-1).decision, 'done'); assert.equal(commands.at(-1).id, touched.id)
  await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: false })
  const beforeReadOnly = commands.length, beforeReadOnlyTurns = ownerTurns.length
  await send({ state: 'idle', proposals: [ride], proposalPopup: true, proposalCapabilities: { read: true, respond: false, acknowledge: false } })
  await delay()
  assert.equal(commands.length, beforeReadOnly)
  assert.equal(await run(`!![...document.querySelectorAll('.personal-bot-proposals button')].find(b => ['Accept','Done','Later','Useful','Not relevant','Incorrect','Ignore','Get current quote','Refresh preview'].includes(b.textContent))`), false)
  assert.match(await run(`document.querySelector('.personal-bot-proposal-capability').textContent`), /read-only on this device/)
  assert.equal(ownerTurns.length, beforeReadOnlyTurns)
  await run(`odkPersonalBotStatus.close()`)
  await send({ state: 'idle', proposals: [ride], proposalPopup: true, proposalRecovery: true, proposalCapabilities: { read: true, respond: false, acknowledge: false } })
  assert.equal(await run(`document.getElementById('personal-bot-status').hidden`), true, 'Read-only recovery preserves Close dismissal')
  await send({ state: 'idle', proposals: [{ ...ride, id: '11111111-1111-4111-8111-111111111111' }], proposalPopup: true, proposalRecovery: false, proposalCapabilities: { read: true, respond: false, acknowledge: false } })
  assert.equal(await run(`document.getElementById('personal-bot-status').hidden`), false, 'An ordinary new read-only reminder can open')
  assert.equal(commands.length, beforeReadOnly, 'Read-only recovery grants no acknowledgement or response authority')
  await run(`document.querySelector('.personal-bot-proposal-sources summary').focus()`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  await delay(); assert.equal(await run(`document.querySelector('.personal-bot-proposal-sources').open`), true)
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await run(`odkTheme.set(${JSON.stringify(theme)})`)
    for (const revoked of [{ state: 'unavailable' }, { state: 'idle', proposalCapabilities: { read: false, respond: false, acknowledge: false } }]) {
      await send({ state: 'idle', proposals: [{ ...p, action: null, confirmation: '' }], proposalPopup: true })
      assert.equal(await run(`document.querySelector('.personal-bot-proposals').hidden`), false)
      const beforeWithdrawal = commands.length
      await send(revoked)
      assert.deepEqual(await run(`(() => { const section = document.querySelector('.personal-bot-proposals'); return { hidden: section.hidden, children: section.children.length } })()`), { hidden: true, children: 0 })
      await send({ state: 'idle' })
      assert.equal(await run(`document.querySelectorAll('.personal-bot-proposal').length`), 0, `${theme} legacy status retains no withdrawn proposal`)
      assert.equal(commands.length, beforeWithdrawal, `${theme} withdrawn content sends no acknowledgement`)
    }
  }
  await longAdviceVisibility()
  // Populated fixture preview: the capture waits for the current native compositor frame.
  const preview = { ...actionCard, id: 'c311a280-c0b9-4411-96cd-4e1e92385349' }
  await send({ state: 'idle', proposals: [preview], proposalPopup: true })
  await run(`document.querySelector('.personal-bot-status-content').scrollTop = 0; document.fonts.ready.then(() => true)`)
  const { capturePaintedPage } = require('./helpers/native-page-capture')
  const output = process.env.ODK_PROACTIVE_PREVIEW_FILE
  if (output) fs.writeFileSync(output, (await capturePaintedPage(win)).toPNG())
  const previewDirectory = process.env.ODK_PROACTIVE_PREVIEW_DIR
  if (previewDirectory) {
    fs.mkdirSync(previewDirectory, { recursive: true, mode: 0o700 })
    for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
      await run(`odkTheme.set(${JSON.stringify(theme)})`)
      for (const [width, height] of [[480, 854], [1920, 1280]]) {
        await viewport(width, height)
        await send({ state: 'idle', proposals: [preview], proposalPopup: true })
        await run(`document.querySelector('.personal-bot-status-content').scrollTop = 0; document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`)
        fs.writeFileSync(path.join(previewDirectory, `${theme}-${width}x${height}.png`), (await capturePaintedPage(win)).toPNG())
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
  console.log('PROACTIVE_PANEL_CM5_ISOLATED_PASS: 4 themes, 3 sizes, 5 proposal states, focus, touch confirmation, literal untrusted text, service error recovery, uncertain delivery, read-only ride details explicit owner quote selection, viewport visibility acknowledgements, candidate feedback, read-only capabilities, provider withdrawal and keyboard disclosures')
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
