const { app, BrowserWindow, ipcMain } = require('electron')
if (!process.argv.includes('--reconnect-only')) ipcMain.handle('odk-personal-agent-consumer-ready', () => ({ accepted: false }))
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
async function waitForAdviceEnd(run, timeoutMs = 2000) {
  const deadline = performance.now() + timeoutMs
  let observed
  do {
    observed = await run(`(() => {
      const body = document.querySelector('.personal-agent-proposal-advice')
      return { focused: document.activeElement === body && document.hasFocus(),
        atEnd: body.scrollTop + body.clientHeight >= body.scrollHeight - 2,
        top: body.scrollTop, height: body.clientHeight, extent: body.scrollHeight }
    })()`)
    if (observed.focused && observed.atEnd) return
    if (performance.now() >= deadline) break
    await new Promise(resolve => setTimeout(resolve, 20))
  } while (true)
  assert.fail('Native End did not reach the complete recommendation: ' + JSON.stringify(observed))
}
app.whenReady().then(async () => {
  const reconnect = reconnectOnly ? await require('./helpers/proactive-reconnect').createProactiveReconnectFixture() : undefined
  const commands = []
  const ownerTurns = []
  let rejectResponse = false
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight', 'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list', 'odk-personal-agent-status', 'odk-remote-publish-page-state']) ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [] }))
  ipcMain.handle('odk-personal-agent-text', (_event, text) => { ownerTurns.push(text); return { accepted: true } })
  ipcMain.handle('odk-personal-agent-proposal', (_event, command) => { commands.push(command); if (rejectResponse && command.type === 'proposal_respond') throw Error('Controlled offline delivery failure'); return { accepted: true } })
  const win = new BrowserWindow({ show: false, width: 480, height: 854, useContentSize: true, webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } })
  if (reconnect) {
    for (const name of ['odk-personal-agent-status', 'odk-personal-agent-text', 'odk-personal-agent-proposal']) ipcMain.removeHandler(name)
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
  const send = async status => { win.webContents.send('odk-personal-agent-status', status); await delay() }
  // Inline recommendations share the Home scroll context; bring the target into view before measurement.
  const showComposer = () => run(`(() => { const composer = document.querySelector('.agent-composer'); composer.scrollIntoView({block:'center', inline:'nearest'}); document.querySelector('.agent-suggestions').scrollTop = 0; return document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) })()`)
  const p = { id: 'e311a280-c0b9-4411-96cd-4e1e92385349', ruleId: 'dry-soil', status: 'pending', offered: true, presented: false, reason: 'A current soil reading is below the selected threshold.', nextStep: '保存检查盆土备忘', advice: '<script>untrusted reading</script> 检查盆土。', action: { tool: 'memory_update', params: { category: 'watering', value: '检查盆土' } }, confirmation: '记住 watering：检查盆土', evidence: [{ readingId: 'odk.tile.hydra', field: 'plants.0.soilPercent', value: 10, state: 'live', measuredAt: '2026-10-02T10:00:00Z', ruleId: 'dry-soil' }] }
  async function longAdviceVisibility() {
    await viewport(320, 480)
    const long = { ...p, id: 'b311a280-c0b9-4411-96cd-4e1e92385349', advice: '检查当前读数并决定下一步。'.repeat(100).slice(0, 1000) }
    commands.length = 0
    await send({ state: 'idle', proposals: [long], proposalPopup: true, proposalCapabilities: { read: true, respond: true, acknowledge: true } })
    await run(`document.querySelector('.personal-agent-proposal-advice').scrollIntoView({block:'center'})`)
    await delay()
    const geometry = await run(`(() => { const advice = document.querySelector('.personal-agent-proposal-advice'); const body = advice.getBoundingClientRect(); const viewport = document.querySelector('.agent-suggestions').getBoundingClientRect(); return { body: body.height, viewport: viewport.height, textHeight: advice.scrollHeight, text: advice.textContent, tabIndex: advice.tabIndex } })()`)
    assert.ok(geometry.body > 0 && geometry.body < geometry.viewport, JSON.stringify(geometry))
    assert.ok(geometry.textHeight > geometry.body * 2, JSON.stringify(geometry))
    assert.equal(geometry.text, long.advice)
    assert.equal(geometry.tabIndex, 0)
    await run(`document.querySelector('.personal-agent-proposal-advice').focus()`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' })
    await waitForAdviceEnd(run)
    assert.equal(await run(`(() => { const body = document.querySelector('.personal-agent-proposal-advice'); return body.scrollTop + body.clientHeight >= body.scrollHeight - 2 })()`), true, 'Keyboard reaches the end of the complete recommendation')
    assert.ok(commands.some(c => c.type === 'proposal_presented' && c.ids.includes(long.id)), 'Visible long advice must be acknowledged even when less than half of the entire paragraph fits')
    const before = commands.length
    await send({ state: 'idle', proposals: [{ ...long, id: 'b311a280-c0b9-4411-96cd-4e1e92385350' }], proposalPopup: true, proposalCapabilities: { read: true, respond: false, acknowledge: false } })
    await run(`document.querySelector('.personal-agent-proposal-advice').scrollIntoView({block:'center'})`)
    await delay(); assert.equal(commands.length, before, 'Long read-only advice cannot acknowledge itself')
    await send({ state: 'idle', proposals: [], proposalPopup: false })
    await viewport(480, 854)
    commands.length = 0
  }
  if (process.argv.includes('--long-advice-only')) {
    await longAdviceVisibility()
    console.log('PROACTIVE_LONG_ADVICE_VISIBLE_PASS')
    clearTimeout(timer); win.destroy(); app.exit(0); return
  }
  await run(`(() => { const composer = document.querySelector('.agent-composer'); if (composer.dataset.mode !== 'keyboard') composer.querySelector('.agent-keys').click(); const input = composer.querySelector('textarea'); input.value = 'Keep this unfinished draft.'; input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#dots .dot').focus() })()`)
  await send({ state: 'idle', proposals: [p], proposalPopup: true })
  assert.equal(await run(`document.activeElement.matches('#dots .dot')`), true)
  assert.equal(await run(`document.getElementById('pages-viewport').inert`), false)
  assert.equal(await run(`odkPersonalAgentStatus.visible()`), false)
  assert.equal(await run(`document.getElementById('personal-agent-status').hidden`), true, 'Recommendations never open the fallback voice popup')
  assert.equal(await run(`document.querySelector('.agent-suggestions').closest('.agent-composer') === document.querySelector('.agent-composer') && !document.querySelector('.agent-suggestions').hidden`), true, 'Recommendations stay inside the Personal Agent composer')
  assert.equal(await run(`document.querySelector('.agent-composer textarea').value`), 'Keep this unfinished draft.')
  assert.equal(await run(`!!document.querySelector('.personal-agent-proposal-sources, .personal-agent-ride-details, button[data-proposal-action="view-sources"]')`), false)
  assert.equal(await run(`[...document.querySelectorAll('[aria-modal="true"]')].some(node => node.checkVisibility())`), false, 'An inline recommendation must not open any modal surface')
  assert.equal(await run(`!!document.querySelector('.personal-agent-proposals script')`), false)
  assert.equal(commands[0].type, 'proposal_presented')
  await run(`[...document.querySelectorAll('.personal-agent-proposals button')].find(b => b.textContent === '保存检查盆土备忘').click()`)
  await delay(); assert.equal(commands.some(c => c.type === 'proposal_respond'), false)
  await run(`[...document.querySelectorAll('.personal-agent-proposals button')].find(b => b.textContent === '记住 watering：检查盆土').click()`)
  await delay(); assert.equal(commands.at(-1).confirmation, p.confirmation)
  await send({ state: 'idle', proposals: [p], proposalHiddenCount: 0, proposalPopup: true, proposalError: 'generation_unavailable' })
  assert.equal(await run(`document.querySelector('.personal-agent-proposal-error')?.textContent`), 'generation_unavailable')
  await run(`window.__proposalControls = [...document.querySelectorAll('.personal-agent-proposals button')]`)
  await send({ state: 'idle', proposals: [p], proposalHiddenCount: 0, proposalPopup: false })
  assert.equal(await run(`!!document.querySelector('.personal-agent-proposal-error')`), false)
  assert.equal(await run(`window.__proposalControls.every((node, index) => document.querySelectorAll('.personal-agent-proposals button')[index] === node)`), true)
  await send({ state: 'idle', proposals: [p], proposalHiddenCount: 0, proposalPopup: false, proposalError: 'checkpoint_failed' })
  assert.equal(await run(`!!document.querySelector('.personal-agent-proposal-error')`), true)
  const uncertain = { ...p, id: 'a91cb070-410b-42a8-b15e-f0508d2f9dbf' }
  await send({ state: 'idle', proposals: [uncertain], proposalHiddenCount: 0, proposalPopup: true })
  rejectResponse = true
  await run(`[...document.querySelectorAll('.personal-agent-proposals button')].find(b => b.textContent === '保存检查盆土备忘').click()`)
  await run(`[...document.querySelectorAll('.personal-agent-proposals button')].find(b => b.textContent === '记住 watering：检查盆土').click()`)
  await delay()
  const commandCount = commands.filter(c => c.type === 'proposal_respond').length
  await run(`window.__disabledConfirmation = [...document.querySelectorAll('.personal-agent-proposals button')].find(b => b.textContent === '记住 watering：检查盆土')`)
  await send({ state: 'idle', proposals: [uncertain], proposalHiddenCount: 0, proposalPopup: false, proposalError: 'generation_unavailable' })
  await send({ state: 'idle', proposals: [uncertain], proposalHiddenCount: 0, proposalPopup: false })
  assert.match(await run(`document.querySelector('.personal-agent-proposal-error')?.textContent ?? ''`), /not delivered.*do not repeat an uncertain action/)
  assert.equal(await run(`window.__disabledConfirmation.isConnected && window.__disabledConfirmation.disabled`), true)
  assert.equal(commands.filter(c => c.type === 'proposal_respond').length, commandCount)
  rejectResponse = false
  const ride = { ...p, id: 'a2f9fed5-8a7a-458e-bfbf-d5650c5edf40', action: null, confirmation: '',
    ridePreview: { handle: '11111111-1111-4111-8111-111111111111', status: 'choose_places', sandbox: true, measuredAt: new Date().toISOString(), expiresAt: Date.now() + 120000,
      from: [{ handle: '22222222-2222-4222-8222-222222222222', name: '<script>测试起点甲</script>', city: '测试市', address: '测试街道' }, { handle: '33333333-3333-4333-8333-333333333333', name: '测试起点乙', city: '测试市' }],
      to: [{ handle: '44444444-4444-4444-8444-444444444444', name: '测试终点', city: '测试市' }], items: [{ productName: '测试车型', productCategory: '1', priceText: '20元' }] } }
  await send({ state: 'idle', proposals: [ride], proposalPopup: true })
  const beforeRoute = commands.length
  assert.equal(await run(`(() => { const quote = document.querySelector('.personal-agent-ride-actions .personal-agent-proposal-primary'); const route = document.querySelector('.personal-agent-ride-route'); return !!quote && quote.checkVisibility() && !!route && route.hidden && !route.contains(quote) && !document.querySelector('.personal-agent-ride-details, .personal-agent-proposal-sources') })()`), true, 'Prepared preview exposes its real next action without a Details control')
  assert.equal(await run(`!!document.querySelector('.personal-agent-ride-route script')`), false)
  assert.match(await run(`document.querySelector('.personal-agent-proposal').textContent`), /Sandbox preview; no real vehicle or trip\./)
  assert.match(await run(`document.querySelector('.personal-agent-proposal').textContent`), /20元/)
  await run(`[...document.querySelectorAll('.personal-agent-ride-actions button')].find(b => b.textContent === 'Get current quote').click()`)
  await delay(); assert.equal(ownerTurns.length, 0); assert.equal(commands.length, beforeRoute)
  assert.equal(await run(`document.querySelector('.personal-agent-ride-route').hidden`), false, 'An ambiguous quote opens only the essential route chooser')
  assert.equal(await run(`document.activeElement === document.querySelector('.personal-agent-ride-route select')`), true)
  await run(`document.querySelector('.personal-agent-ride-route select').value = '33333333-3333-4333-8333-333333333333'; [...document.querySelectorAll('.personal-agent-ride-actions button')].find(b => b.textContent === 'Get current quote').click()`)
  await delay()
  assert.deepEqual(ownerTurns, ['查看报价 11111111-1111-4111-8111-111111111111 33333333-3333-4333-8333-333333333333 44444444-4444-4444-8444-444444444444'])
  assert.equal(commands.filter(c => c.type === 'proposal_respond').length, 2, 'Route selection adds no proposal acceptance')
  let rideScenario = 0
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await run(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready.then(() => true)`)
    for (const [width, height] of [[320, 480], [480, 854], [1920, 1280]]) {
      await viewport(width, height)
      const scenarioRide = { ...ride, id: `7311a280-c0b9-4411-96cd-${String(++rideScenario).padStart(12, '0')}`, ridePreview: { ...ride.ridePreview, handle: `matrix-preview-${rideScenario}` } }
      await send({ state: 'idle', proposals: [scenarioRide], proposalPopup: true })
      const beforeSelection = ownerTurns.length
      await run(`(() => { const route = document.querySelector('.personal-agent-ride-route'); if (route.hidden) document.querySelector('.personal-agent-ride-actions .personal-agent-proposal-primary').click(); return document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))) })()`)
      assert.equal(ownerTurns.length, beforeSelection, 'Each fresh ambiguous route requires an explicit place selection')
      const rideGeometry = await run(`(() => { const node = document.querySelector('.agent-suggestions'); return { routeHidden: document.querySelector('.personal-agent-ride-route').hidden, overflow: node.scrollWidth > node.clientWidth + 1, heights: [...document.querySelectorAll('.personal-agent-ride-route select, .personal-agent-ride-route button, .personal-agent-ride-actions button')].map(n => n.getBoundingClientRect().height) } })()`)
      assert.equal(rideGeometry.routeHidden, false, JSON.stringify({ theme, width, height, ...rideGeometry })); assert.equal(rideGeometry.overflow, false); assert.ok(rideGeometry.heights.length >= 3); assert.ok(rideGeometry.heights.every(h => h >= 44), JSON.stringify({ theme, width, height, ...rideGeometry }))
      for (const status of ['pending', 'expired', 'ignored', 'completed', 'unknown']) {
        await send({ state: 'idle', proposals: [{ ...p, status, advice: 'Long CJK 长句测试 '.repeat(40), result: status === 'unknown' ? 'Outcome unknown; do not retry.' : '' }], proposalPopup: true })
        await showComposer()
        const geometry = await run(`(() => {
          const node = document.querySelector('.agent-suggestions'); const r = node.getBoundingClientRect();
          const controls = [...document.querySelectorAll('.personal-agent-proposals button')].filter(n => n.checkVisibility());
          return { contained: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
            overflow: node.scrollWidth > node.clientWidth + 1,
            controls: controls.every(b => b.getBoundingClientRect().height >= 44),
            font: parseFloat(getComputedStyle(document.querySelector('.personal-agent-proposal-state')).fontSize),
            accept: controls.some(b => b.textContent === '保存检查盆土备忘') }
        })()`)
        assert.equal(geometry.contained, true); assert.equal(geometry.overflow, false); assert.equal(geometry.controls, true); assert.ok(geometry.font >= 14)
        assert.equal(geometry.accept, status === 'pending')
      }
    }
  }
  const actionCard = { ...p, actionId: 'save-watering-note', advice: '保存一条检查盆土备忘，方便下次查看。', nextStep: '保存检查盆土备忘', reason: 'Legacy reason must not render.', evidence: [...p.evidence, { readingId: 'fixture.export', field: 'sha256', value: 'a'.repeat(64), state: 'live', measuredAt: '2026-10-23T10:00:00Z' }] }
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await run(`odkTheme.set(${JSON.stringify(theme)})`)
    for (const [width, height] of [[320, 480], [480, 854], [1920, 1280]]) {
      await viewport(width, height)
      await send({ state: 'idle', proposals: [actionCard], proposalPopup: true })
      await showComposer()
      const layout = await run(`(() => {
        const card = document.querySelector('.personal-agent-proposal'), advice = card.querySelector('.personal-agent-proposal-advice'), primary = card.querySelector('.personal-agent-proposal-primary'), actions = card.querySelector('.personal-agent-proposal-actions'), feedback = card.querySelector('.personal-agent-proposal-feedback-options'), state = card.querySelector('.personal-agent-proposal-state');
        return { advice: advice.textContent, action: primary.textContent, duplicateNext: !!card.querySelector('.personal-agent-proposal-next-step'), secondary: actions.querySelector('.personal-agent-proposal-secondary')?.textContent, reason: !!card.querySelector('.personal-agent-proposal-reason') || card.textContent.includes('Legacy reason must not render.'), sourcesAbsent: !card.querySelector('.personal-agent-proposal-sources'), feedbackClosed: !feedback.open, hashAbsent: !card.textContent.includes('a'.repeat(64)), ordered: advice.getBoundingClientRect().bottom <= actions.getBoundingClientRect().top && actions.getBoundingClientRect().bottom <= feedback.getBoundingClientRect().top, adviceSize: parseFloat(getComputedStyle(advice).fontSize), stateSize: parseFloat(getComputedStyle(state).fontSize), actionSize: parseFloat(getComputedStyle(primary).fontSize), primaryHeight: primary.getBoundingClientRect().height, feedbackTarget: feedback.querySelector('summary').getBoundingClientRect().height >= 44, inline: !!card.closest('.agent-composer .agent-suggestions'), popupHidden: document.getElementById('personal-agent-status').hidden, overflow: card.scrollWidth > card.clientWidth + 1, controls: [...actions.querySelectorAll('button')].every(b => b.getBoundingClientRect().height >= 44) }
      })()`)
      assert.equal(layout.advice, actionCard.advice); assert.equal(layout.action, actionCard.nextStep)
      assert.equal(layout.duplicateNext, false); assert.equal(layout.secondary, 'Later')
      for (const key of ['sourcesAbsent', 'feedbackClosed', 'hashAbsent', 'ordered', 'controls', 'feedbackTarget', 'inline', 'popupHidden']) assert.equal(layout[key], true, JSON.stringify({ theme, width, height, key, ...layout }))
      assert.equal(layout.reason, false); assert.equal(layout.overflow, false)
      assert.ok(layout.adviceSize >= 18); assert.ok(layout.adviceSize > layout.stateSize); assert.ok(layout.adviceSize >= layout.actionSize); assert.ok(layout.actionSize >= 16); assert.ok(layout.primaryHeight >= 48)
      await run(`document.querySelector('.personal-agent-proposal-primary').focus()`)
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
      await delay()
      const confirmationFocus = await run(`({ tag: document.activeElement?.tagName, action: document.activeElement?.dataset.proposalAction, primary: document.activeElement?.classList.contains('personal-agent-proposal-primary'), confirmExists: !!document.querySelector('[data-proposal-action="confirm"]') })`)
      assert.equal(confirmationFocus.action, 'confirm', JSON.stringify(confirmationFocus))
      assert.equal(confirmationFocus.primary, true, 'Keyboard execution moves focus to the primary exact confirmation')
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
      await delay()
      assert.equal(await run(`document.activeElement?.dataset.proposalAction === 'cancel'`), true)
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
      await delay()
      assert.equal(await run(`document.activeElement === document.querySelector('.personal-agent-proposal-primary') && document.activeElement?.dataset.proposalAction === 'execute'`), true, 'Cancel restores the original execution focus')
    }
  }
  // Technical legacy content has no source surface and cannot acknowledge its unavailable placeholder.
  const technical = { ...p, id: 'a111a280-c0b9-4411-96cd-4e1e92385349', action: null, confirmation: '', advice: `Inspect expectedSHA256 ${'a'.repeat(64)}` }
  commands.length = 0
  await send({ state: 'idle', proposals: [technical], proposalPopup: true })
  await run(`document.querySelector('.personal-agent-proposal-advice').scrollIntoView({block:'center'}); document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`)
  await delay()
  assert.equal(await run(`document.querySelector('.personal-agent-proposal-advice').textContent`), 'Earlier recommendation unavailable. Ask the Agent for an updated suggestion.')
  assert.equal(await run(`!!document.querySelector('.personal-agent-proposal-sources, .personal-agent-proposal-original-advice, button[data-proposal-action="view-sources"]')`), false)
  assert.equal(await run(`document.querySelector('.agent-suggestions').textContent.includes('a'.repeat(64))`), false)
  assert.equal(commands.some(c => c.type === 'proposal_presented' && c.ids.includes(technical.id)), false)
  // A mounted but hidden Personal Agent is not a visible recommendation surface.
  const hidden = { ...p, id: 'a111a280-c0b9-4411-96cd-4e1e92385350', action: null, confirmation: '' }
  commands.length = 0
  await run(`(() => { const agent = document.getElementById('personal-agent'); window.__agentHidden = { hidden: agent.hidden, display: agent.style.display }; agent.hidden = true; agent.style.display = 'none' })()`)
  await send({ state: 'idle', proposals: [hidden], proposalPopup: true, proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  assert.equal(await run(`document.querySelector('.personal-agent-proposal-advice').checkVisibility()`), false, 'The hidden-page fixture must actually suppress native visibility')
  assert.equal(commands.some(c => c.type === 'proposal_presented' && c.ids.includes(hidden.id)), false, 'An inactive Personal Agent cannot acknowledge unread advice')
  assert.equal(await run(`document.getElementById('personal-agent-status').hidden`), true, 'Hidden-page delivery cannot escape into a popup')
  await run(`(() => { const agent = document.getElementById('personal-agent'); agent.hidden = window.__agentHidden.hidden; agent.style.display = window.__agentHidden.display; document.querySelector('.personal-agent-proposal-advice').scrollIntoView({block:'center'}) })()`)
  const presentationDeadline = performance.now() + 2000
  while (!commands.some(c => c.type === 'proposal_presented' && c.ids.includes(hidden.id)) && performance.now() < presentationDeadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const presentationDiagnostics = commands.some(c => c.type === 'proposal_presented' && c.ids.includes(hidden.id)) ? '' : JSON.stringify({
    commands,
    viewport: await run(`(() => {
      const advice = document.querySelector('.personal-agent-proposal-advice')
      const surface = document.querySelector('.agent-suggestions')
      return { documentHidden: document.hidden, adviceVisible: advice.checkVisibility(),
        advice: advice.getBoundingClientRect().toJSON(), surfaceHidden: surface.hidden,
        surface: surface.getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight }
    })()`),
  })
  assert.equal(await run(`document.querySelector('.personal-agent-proposal-advice').checkVisibility()`), true, presentationDiagnostics)
  assert.ok(commands.some(c => c.type === 'proposal_presented' && c.ids.includes(hidden.id)), 'Restoring the actual page allows its viewport to acknowledge advice: ' + presentationDiagnostics)
  assert.equal(await run(`document.querySelector('.agent-composer textarea').value`), 'Keep this unfinished draft.')
  // Synthetic suggestions exercise the real scroll viewport without model or device access.
  await run(`odkTheme.set('instrument')`)
  await viewport(480, 854)
  const queued = Array.from({ length: 8 }, (_, index) => ({ ...p, id: `e311a280-c0b9-4411-96cd-4e1e92385${String(350 + index).padStart(3, '0')}`, action: null, confirmation: '', advice: `Suggestion ${index + 1}: inspect the actual soil reading.`, reason: 'This plant has a fresh low soil reading.' }))
  commands.length = 0
  await send({ state: 'idle', proposals: queued, proposalPopup: true, proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  const seen = () => commands.filter(c => c.type === 'proposal_presented').flatMap(c => c.ids)
  assert.ok(seen().length > 0 && seen().length < queued.length, JSON.stringify({ seen: seen() }))
  assert.ok(!seen().includes(queued.at(-1).id), 'An offscreen suggestion must remain unread')
  await run(`document.querySelectorAll('.personal-agent-proposal-advice')[7].scrollIntoView({block:'center'})`)
  await delay()
  assert.ok(seen().includes(queued.at(-1).id), 'Scrolling the actual advice into view acknowledges that suggestion')
  const expectedFeedback = [['Done', 'done'], ['Later', 'snooze'], ['Useful', 'useful'], ['Not relevant', 'irrelevant'], ['Incorrect', 'incorrect']]
  for (const [label, decision] of expectedFeedback) {
    const next = { ...p, id: `d311a280-c0b9-4411-96cd-4e1e92385${String(360 + expectedFeedback.findIndex(row => row[0] === label)).padStart(3, '0')}`, action: null, confirmation: '' }
    await send({ state: 'idle', proposals: [next], proposalPopup: true })
    await run(`(() => { const details = document.querySelector('.personal-agent-proposal-feedback-options'); details.open = true; const control = [...document.querySelectorAll('.personal-agent-proposal button')].find(b => b.textContent === ${JSON.stringify(label)}); control.scrollIntoView({block:'center'}); control.focus(); return control.getBoundingClientRect().height })()`)
    // Keyboard activation uses the same candidate-specific command as touch/click.
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
    await delay()
    assert.equal(commands.at(-1).decision, decision); assert.equal(commands.at(-1).id, next.id)
    const updated = { ...next, feedback: decision, status: ['done'].includes(decision) ? 'completed' : ['irrelevant', 'incorrect'].includes(decision) ? 'ignored' : 'pending', ...(decision === 'snooze' ? { snoozedUntil: Date.now() + 60000 } : {}) }
    await send({ state: 'idle', proposals: [updated], proposalPopup: false })
    assert.equal(await run(`document.activeElement === document.querySelector('.agent-composer textarea') || document.activeElement.textContent === 'Useful'`), true, 'Feedback updates retain their control or return focus to the draft')
    assert.equal(await run(`document.querySelector('.agent-composer textarea').value`), 'Keep this unfinished draft.')
  }
  const touched = { ...p, id: 'f311a280-c0b9-4411-96cd-4e1e92385349', action: null, confirmation: '' }
  await send({ state: 'idle', proposals: [touched], proposalPopup: true })
  const touch = await run(`(() => { document.querySelector('.personal-agent-proposal-feedback-options').open = true; const node = [...document.querySelectorAll('.personal-agent-proposals button')].find(b => b.textContent === 'Done'); node.scrollIntoView({block:'center'}); const r = node.getBoundingClientRect(); return { x: r.x+r.width/2, y: r.y+r.height/2 } })()`)
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
  assert.equal(await run(`!![...document.querySelectorAll('.personal-agent-proposals button')].find(b => ['Accept','Run action','保存检查盆土备忘','Done','Later','Useful','Not relevant','Incorrect','Ignore','Get current quote','Refresh preview'].includes(b.textContent))`), false)
  assert.match(await run(`document.querySelector('.personal-agent-proposal-capability').textContent`), /read-only on this device/)
  assert.equal(ownerTurns.length, beforeReadOnlyTurns)
  await run(`document.querySelector('.agent-composer textarea').focus()`)
  await send({ state: 'idle', proposals: [ride], proposalPopup: true, proposalRecovery: true, proposalCapabilities: { read: true, respond: false, acknowledge: false } })
  assert.equal(await run(`!document.querySelector('.agent-suggestions').hidden && document.querySelector('.agent-suggestions').closest('.agent-composer') !== null && document.getElementById('personal-agent-status').hidden`), true, 'Read-only recovery remains inline and never opens a popup')
  assert.equal(await run(`document.activeElement === document.querySelector('.agent-composer textarea') && document.activeElement.value === 'Keep this unfinished draft.'`), true)
  await send({ state: 'idle', proposals: [{ ...ride, id: '11111111-1111-4111-8111-111111111111' }], proposalPopup: true, proposalRecovery: false, proposalCapabilities: { read: true, respond: false, acknowledge: false } })
  assert.equal(await run(`!document.querySelector('.agent-suggestions').hidden && document.getElementById('personal-agent-status').hidden`), true, 'A new read-only recommendation stays inside the input')
  assert.equal(commands.length, beforeReadOnly, 'Read-only recovery grants no acknowledgement or response authority')
  const disclosureResponses = commands.filter(c => c.type === 'proposal_respond').length
  await send({ state: 'idle', proposals: [{ ...p, id: '11111111-1111-4111-8111-111111111112', action: null, confirmation: '' }], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await run(`document.querySelector('.personal-agent-proposal-feedback-options summary').focus()`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })
  await delay(); assert.equal(await run(`document.querySelector('.personal-agent-proposal-feedback-options').open`), true)
  assert.equal(commands.filter(c => c.type === 'proposal_respond').length, disclosureResponses, 'Opening Feedback does not submit a decision')
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await run(`odkTheme.set(${JSON.stringify(theme)})`)
    for (const revoked of [{ state: 'unavailable' }, { state: 'idle', proposalCapabilities: { read: false, respond: false, acknowledge: false } }]) {
      await send({ state: 'idle', proposals: [{ ...p, action: null, confirmation: '' }], proposalPopup: true })
      assert.equal(await run(`document.querySelector('.personal-agent-proposals').hidden`), false)
      const beforeWithdrawal = commands.length
      await send(revoked)
      assert.deepEqual(await run(`(() => { const section = document.querySelector('.personal-agent-proposals'); return { hidden: section.hidden, children: section.children.length } })()`), { hidden: true, children: 0 })
      await send({ state: 'idle' })
      assert.equal(await run(`document.querySelectorAll('.personal-agent-proposal').length`), 0, `${theme} legacy status retains no withdrawn proposal`)
      assert.equal(commands.length, beforeWithdrawal, `${theme} withdrawn content sends no acknowledgement`)
    }
  }
  await longAdviceVisibility()
  // Populated fixture preview: the capture waits for the current native compositor frame.
  const preview = { ...actionCard, id: 'c311a280-c0b9-4411-96cd-4e1e92385349' }
  const previewFrame = { state: 'idle', judgment: { status: 'ready', provider: 'jev' }, transcript: 'Help me remember to check the soil.', ownerTurnId: 'synthetic-preview-turn', message: 'I can save a soil-check note. Choose the suggestion below to continue.', proposals: [preview], proposalPopup: true }
  await send(previewFrame)
  assert.equal(await run(`document.querySelector('.agent-conversation').textContent.includes('I can save a soil-check note.')`), true, 'Preview captures a populated normal conversation')
  assert.equal(await run(`document.querySelector('.agent-state').textContent.includes('Connection unavailable')`), false)
  await showComposer()
  // A catalog failure belongs to Desk and cannot intercept the Personal Agent.
  await viewport(1920, 1280)
  await run(`odkTheme.set('instrument')`)
  await send(previewFrame)
  await showComposer()
  const noticeHit = await run(`(() => {
    const notice = document.getElementById('user-app-desktop-notice'), desk = document.getElementById('desk-content'), agent = document.getElementById('personal-agent')
    const input = document.querySelector('.agent-composer textarea'), feedback = document.querySelector('.personal-agent-proposal-feedback-options summary')
    const point = node => { const r = node.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }
    const hit = node => { const p = point(node); return node.contains(document.elementFromPoint(p.x, p.y)) }
    const n = notice.getBoundingClientRect(), d = desk.getBoundingClientRect(), a = agent.getBoundingClientRect()
    return { input: point(input), feedback: point(feedback), inputHit: hit(input), feedbackHit: hit(feedback), draft: input.value,
      noticeVisible: notice.checkVisibility(), deskParent: notice.parentElement === desk,
      contained: n.left >= d.left && n.right <= d.right && n.top >= d.top && n.bottom <= d.bottom,
      overlapsAgent: Math.min(n.right, a.right) > Math.max(n.left, a.left) && Math.min(n.bottom, a.bottom) > Math.max(n.top, a.top) }
  })()`)
  assert.equal(noticeHit.noticeVisible, true, 'The catalog failure remains visible during the hit test')
  assert.equal(noticeHit.inputHit, true, JSON.stringify(noticeHit))
  assert.equal(noticeHit.feedbackHit, true, JSON.stringify(noticeHit))
  assert.equal(noticeHit.deskParent, true); assert.equal(noticeHit.contained, true); assert.equal(noticeHit.overlapsAgent, false)
  const noticeResponses = commands.filter(command => command.type === 'proposal_respond').length, noticeTurns = ownerTurns.length
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...noticeHit.input })
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...noticeHit.input })
  await delay()
  assert.equal(await run(`document.activeElement === document.querySelector('.agent-composer textarea')`), true)
  assert.equal(await run(`document.querySelector('.agent-composer textarea').value`), noticeHit.draft)
  win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...noticeHit.feedback })
  win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...noticeHit.feedback })
  await delay()
  assert.equal(await run(`document.querySelector('.personal-agent-proposal-feedback-options').open`), true)
  assert.equal(commands.filter(command => command.type === 'proposal_respond').length, noticeResponses)
  assert.equal(ownerTurns.length, noticeTurns, 'Opening Feedback cannot execute an action or owner request')
  await run(`document.querySelector('.personal-agent-proposal-feedback-options').open = false`)
  await viewport(480, 854)
  await showComposer()
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
        await send(previewFrame)
        await showComposer()
        fs.writeFileSync(path.join(previewDirectory, `${theme}-${width}x${height}.png`), (await capturePaintedPage(win)).toPNG())
      }
    }
  }
  const voiceFocus = { ...p, id: 'f311a280-c0b9-4411-96cd-4e1e92385349' }
  await send({ state: 'idle', proposals: [voiceFocus] })
  const beforeVoiceResponses = commands.filter(command => command.type === 'proposal_respond').length, beforeVoiceTurns = ownerTurns.length
  await send({ state: 'recording', proposals: [voiceFocus] })
  await run(`(() => { const summary = document.querySelector('.personal-agent-proposal-feedback-options summary'); summary.scrollIntoView({block:'center'}); summary.focus(); window.__voiceProposalFocus = summary })()`)
  assert.equal(await run(`document.activeElement === window.__voiceProposalFocus && window.__voiceProposalFocus.checkVisibility()`), true)
  await send({ state: 'idle', proposals: [voiceFocus] })
  assert.equal(await run(`document.activeElement === window.__voiceProposalFocus && document.activeElement !== document.querySelector('.agent-composer textarea')`), true, 'Voice completion must retain recommendation focus instead of moving it to the input')
  assert.equal(commands.filter(command => command.type === 'proposal_respond').length, beforeVoiceResponses)
  assert.equal(ownerTurns.length, beforeVoiceTurns, 'Retaining recommendation focus dispatches no owner operation')
  await send({ state: 'idle', proposals: [], proposalPopup: false })
  assert.equal(await run(`document.getElementById('personal-agent-status').hidden`), true)
  await send({ state: 'starting' })
  await send({ state: 'recording' })
  assert.equal(await run(`document.querySelector('.agent-suggestions').hidden`), true)
  assert.equal(await run(`document.getElementById('personal-agent-status').hidden`), true)
  assert.equal(await run(`document.querySelector('.agent-state').textContent`), 'Listening...')
  assert.equal(await run(`document.querySelector('.agent-mic').hidden`), true)
  assert.equal(await run(`document.querySelector('.agent-recording-feedback').hidden`), false)
  assert.equal(await run(`document.querySelector('.agent-send').getAttribute('aria-label')`), 'Send voice request')
  assert.equal(await run(`document.querySelector('.agent-send').disabled`), false)
  assert.equal(await run(`document.getElementById('pages-viewport').inert || document.getElementById('home-desk').inert`), false)
  console.log('PROACTIVE_PANEL_CM5_ISOLATED_PASS: 4 themes, 3 sizes, 5 proposal states, focus, touch confirmation, literal untrusted text, service error recovery, uncertain delivery, inline composer, no source/detail surfaces, essential route selection and explicit owner quote, viewport visibility acknowledgements, candidate feedback, read-only capabilities, provider withdrawal and keyboard disclosures')
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
