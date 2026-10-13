const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installGeometryFixtures } = require('./helpers/live-fixtures')

if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-agent-home-'))
app.setPath('userData', profile)
installGeometryFixtures(ipcMain)
ipcMain.removeHandler('odk-personal-bot-status')
let initial = { state: 'idle', briefing: { state: 'empty', items: [], generatedAt: Date.now(), omittedSources: 0 } }
ipcMain.handle('odk-personal-bot-status', () => initial)
let win
let micToggles = 0
let sentText = []
let textAccepted = true
let completeBeforeReceipt = false
ipcMain.handle('odk-personal-bot-text', async (_event, text) => {
  sentText.push(text)
  if (completeBeforeReceipt) {
    win.webContents.send('odk-personal-bot-status', { state: 'thinking', transcript: text, message: 'Working' })
    win.webContents.send('odk-personal-bot-status', { state: 'idle', transcript: text, message: 'Already completed' })
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return { accepted: textAccepted }
})
ipcMain.handle('odk-personal-bot-toggle', () => { micToggles++; return { accepted: true } })
const timer = setTimeout(() => finish(1), 60000)
const evaluate = script => win.webContents.executeJavaScript(script)
function finish(code) {
  clearTimeout(timer)
  win?.destroy()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  app.exit(code)
}
async function send(briefing) {
  win.webContents.send('odk-personal-bot-status', { state: 'idle', message: '', briefing })
  await evaluate(`new Promise(resolve => setTimeout(resolve, 30))`)
}

app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1920, height: 1280, show: false, frame: false, useContentSize: true,
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, offscreen: true, backgroundThrottling: false } })
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  // Hidden windows can start at 1x1 before their first layout on Linux.
  win.setContentSize(1920, 1280)
  await evaluate(`window.dispatchEvent(new Event('resize'))`)
  await evaluate('document.fonts.ready')
  assert.equal(await evaluate(`!!document.querySelector('#personal-agent textarea')`), true, 'resident Agent has a composer')
  assert.equal(await evaluate(`document.querySelector('[data-page-id="today"]').parentElement.id`), 'home-summary', 'briefing retains its plugin host')
  assert.equal(await evaluate(`document.querySelector('#home-summary').closest('[data-page-id="home"]')?.parentElement.id`), 'pages-track', 'Overview belongs to the first paged canvas')
  assert.equal(await evaluate(`document.querySelector('#dots').closest('#status-bar')`), null, 'dots stay below Widgets')
  assert.equal(await evaluate(`document.querySelectorAll('[data-widget="odk.tile.clock"], [data-widget="odk.tile.almanac"]').length`), 0, 'separate time and date Widgets are removed')
  const compactSegments = [{ text: 'You have ' }, { text: '3 active sessions', icon: 'sessions' },
    { text: ' and ' }, { text: '2 plants at 63% moisture', icon: 'plants' },
    { text: ' today. Taipei is ' }, { text: '26°C and overcast', icon: 'weather' }, { text: '.' }]
  const compact = { state: 'live', generatedAt: Date.now(), omittedSources: 0, items: [{
    text: compactSegments.map(s => s.text).join(''), segments: compactSegments,
    sources: [{ id: 'desk', label: 'Desk readings', state: 'live', updatedAt: Date.now() }],
  }] }
  await send(compact)
  assert.equal(await evaluate(`document.querySelectorAll('.dash-fact svg').length`), 3)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.dash-icon svg')).color === getComputedStyle(document.querySelector('.dash-fact')).color`), false, 'only icons carry source color')
  assert.ok(await evaluate(`document.querySelector('.dash-unit')?.getBoundingClientRect().width < parseFloat(getComputedStyle(document.querySelector('.dash-fact')).fontSize)`), 'Celsius unit uses compact typography')
  await send({ ...compact, items: [{ text: 'Weather 25°C.', segments: [{ text: 'Weather 25°C.', icon: 'weather' }], sources: compact.items[0].sources }] })
  assert.equal(await evaluate(`document.querySelector('.dash-token').textContent`), 'Weather', 'complete weather label stays attached')
  assert.equal(await evaluate(`document.querySelector('.dash-temperature')?.textContent`), '25°C', 'temperature and unit stay together')
  await evaluate(`window.odkTheme.set('pixel')`)
  assert.ok(await evaluate(`document.querySelector('.dash-unit-degree') && getComputedStyle(document.querySelector('.dash-unit')).fontFamily.includes('Zpix')`), 'Pixel Celsius uses pixel font and square degree')
  await evaluate(`window.odkTheme.set('instrument')`)
  await send(compact)
  assert.equal(await evaluate(`document.querySelector('#dash-narrative').tagName`), 'P')
  assert.equal(await evaluate(`document.querySelector('.dash-foot, .dash-provenance, #dash-agent-status, #dash-source-list')`), null)
  assert.ok(await evaluate(`(() => { const n=document.querySelector('#dash-narrative'), d=document.querySelector('.dash'), c=getComputedStyle(d); return Math.abs(n.getBoundingClientRect().width-(d.clientWidth-parseFloat(c.paddingLeft)-parseFloat(c.paddingRight))) < 2 })()`), 'home uses full content width')

  for (const [change, direction] of [['+1.23%', 'up'], ['-0.63%', 'down'], ['-100.00%', 'down'], ['0.00%', undefined]]) {
    const text = `${change} Futu holdings today.`
    const frame = { ...compact, items: [{ text, segments: [{ text, icon: 'portfolio' }], sources: [{ id: 'futu', label: 'Futu holdings', state: 'live' }] }] }
    await send(frame)
    assert.equal(await evaluate(`document.querySelector('.dash-change')?.textContent`), change)
    assert.equal(await evaluate(`document.querySelector('.dash-change')?.dataset.direction`), direction)
    if (direction) assert.equal(await evaluate(`getComputedStyle(document.querySelector('.dash-change')).color === getComputedStyle(document.querySelector('.dash-fact')).color`), false)
    await send({ ...frame, state: 'loading' })
    assert.equal(await evaluate(`document.querySelector('.dash-change')?.dataset.direction`), undefined)
  }
  await send(compact)

  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    for (const [width, height] of [[1920, 1280], [1920, 1080], [1280, 800], [1280, 776], [960, 640], [480, 854], [320, 480]]) {
      win.setContentSize(width, height)
      await evaluate(`window.odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); new Promise(r => setTimeout(r, 80))`)
      await send(compact)
      const geometry = await evaluate(`(() => {
        const bar = document.querySelector('#status-bar'), pi = document.querySelector('#sb-pi-status')
        const metrics = odkLayout.compute(innerWidth, innerHeight)
        const cell = document.querySelector('[data-widget="odk.tile.weather"]').getBoundingClientRect()
        const pane = document.querySelector('#pages-viewport')
        return { statusHeight: bar.clientHeight, expectedHeight: metrics.statusH,
          icon: parseFloat(getComputedStyle(document.querySelector('#sb-net svg')).width), expectedIcon: metrics.barIcon,
          capsule: parseFloat(getComputedStyle(pi).borderTopWidth),
          time: parseFloat(getComputedStyle(document.querySelector('.sb-time')).fontSize),
          summaryBorder: parseFloat(getComputedStyle(document.querySelector('#home-summary')).borderTopWidth),
          squares: [...document.querySelectorAll('.widget')].filter(tile => odkGridPlacement.spanCells(tile.style.gridColumn) === 1 && odkGridPlacement.spanCells(tile.style.gridRow) === 1).map(tile => { const r = tile.getBoundingClientRect(); return Math.abs(r.width - r.height) }),
          cell: [cell.width, cell.height], columns: window.__odkGrid.cols, unit: window.__odkGrid.cellDim,
          paneWidth: pane.clientWidth, spans: ['odk.tile.pi-sessions','odk.tile.pomodoro'].map(id => document.querySelector('[data-widget="'+id+'"]').dataset.span),
          overflow: document.querySelector('.widget-grid').scrollWidth > pane.clientWidth }
      })()`)
      assert.equal(geometry.statusHeight, geometry.expectedHeight, theme + ' original State Bar height')
      assert.equal(geometry.icon, geometry.expectedIcon, theme + ' original State Bar icons')
      assert.ok(geometry.capsule >= 1, 'Pi retains its outlined capsule')
      assert.ok(geometry.time >= 20, 'clock retains original display typography')
      assert.ok(Math.abs(geometry.cell[0] - geometry.cell[1]) < 1, '1x1 is square')
      assert.ok(geometry.squares.every(delta => delta < 1), 'every 1x1 Widget is square')
      assert.equal(geometry.summaryBorder, 0, 'Overview has no border in any theme')
      assert.equal(geometry.overflow, false, 'right grid has no horizontal overflow')
      assert.ok(geometry.columns <= 3, 'right grid never exceeds three columns')
      if (width >= 1280) {
        const fit = await evaluate(`(() => {
          const pane = document.querySelector('#pages-viewport').getBoundingClientRect()
          const tiles = [...document.querySelectorAll('[data-page-id="home"] .widget')].map(tile => tile.getBoundingClientRect())
          const gap = parseFloat(getComputedStyle(document.querySelector('[data-page-id="home"] .widget-grid')).gap)
          return { agentWidth: document.querySelector('#personal-agent').getBoundingClientRect().width,
            leftMargin: Math.min(...tiles.map(r => r.left)) - pane.left,
            rightMargin: pane.right - Math.max(...tiles.map(r => r.right)),
            overviewLeft: document.querySelector('#home-summary').getBoundingClientRect().left,
            overviewRight: document.querySelector('#home-summary').getBoundingClientRect().right,
            gridLeft: Math.min(...tiles.map(r => r.left)), gridRight: Math.max(...tiles.map(r => r.right)),
            bottomMargin: pane.bottom - Math.max(...tiles.map(r => r.bottom)),
            topMargin: Math.min(...tiles.map(r => r.top)) - pane.top, gap }
        })()`)
        assert.ok(fit.agentWidth >= width * 0.35 && fit.agentWidth < width * 0.6, 'Agent uses spare width beside the square canvas: ' + JSON.stringify(fit))
        if (width === 1920) assert.ok(Math.abs(fit.leftMargin - 32) <= 1 && Math.abs(fit.rightMargin - 32) <= 1, 'square canvas has balanced 32 pixel side margins: ' + JSON.stringify(fit))
        if (width === 1920) assert.ok(fit.bottomMargin >= 16 && fit.bottomMargin < 19, 'reference canvas leaves one margin plus integer-cell rounding: ' + JSON.stringify(fit))
        assert.equal(fit.topMargin, geometry.unit + 32, 'Overview occupies the first row with one gap before Widgets')
        assert.equal(fit.gap, 16, 'Widget grid uses consistent expanded spacing')
        assert.ok(Math.abs(fit.overviewLeft - fit.gridLeft) <= 1 && Math.abs(fit.overviewRight - fit.gridRight) <= 1, 'Overview spans the same three columns as Widgets: ' + JSON.stringify(fit))
        if (width === 1920 && height === 1280) {
          assert.ok(await evaluate(`document.querySelector('#home-summary').scrollHeight <= document.querySelector('#home-summary').clientHeight + 1`), 'reference Overview shows its short briefing without scrolling')
        }
        const visibleHome = await evaluate(`(() => {
          const pane = document.querySelector('#pages-viewport').getBoundingClientRect()
          return Array.from(document.querySelectorAll('[data-page-id="home"] .widget')).filter(tile => {
            const r = tile.getBoundingClientRect()
            return r.left >= pane.left && r.right <= pane.right && r.top >= pane.top && r.bottom <= pane.bottom
          }).length
        })()`)
        assert.equal(visibleHome, 6, 'all six Home Widgets are fully visible on desktop panels')
        assert.ok(await evaluate(`(() => { const page=document.querySelector('[data-page-id="home"]'); page.scrollTop=100; return page.scrollTop===0 && getComputedStyle(page).overflowY==='clip' })()`), 'Home cannot scroll vertically')
        assert.equal(geometry.columns, 3, 'wide right pane uses at most three columns')
        assert.ok(geometry.unit >= 186, 'home uses readable square units')
        assert.equal(await evaluate(`window.__odkGrid.rows`), 2, 'Widget region has two rows')
        assert.ok(await evaluate(`document.querySelector('#pages-viewport').clientHeight >= 3 * window.__odkGrid.cellDim + 64 && document.querySelector('#pages-viewport').clientHeight < 3 * window.__odkGrid.cellDim + 67`), 'Overview and two Widget rows fit the three-row canvas')
        assert.deepEqual(geometry.spans, ['kept', 'kept'], 'original instrument proportions survive')
        if (width === 1920) assert.ok(await evaluate(`Array.from(document.querySelectorAll('.widget')).every(tile => tile.getBoundingClientRect().bottom <= tile.closest('.page').getBoundingClientRect().bottom)`), 'reference panel shows complete Widget pages')
      }
      const header = await evaluate(`(() => {
        const day = document.querySelector('.dash-wd').getBoundingClientRect()
        const date = document.querySelector('.dash-date').getBoundingClientRect()
        return { align: getComputedStyle(document.querySelector('.dash-head')).alignItems, sameRow: date.top < day.bottom, centers: Math.abs((day.top + day.bottom) / 2 - (date.top + date.bottom) / 2) }
      })()`)
      assert.equal(header.align, 'center')
      assert.equal(header.sameRow, true, theme + ' ' + width + ' weekday and date share one row')
      if (header.sameRow) assert.ok(header.centers < 1, theme + ' ' + width + ' header centers align')
      const sentence = await evaluate(`(() => {
        const dash = document.querySelector('.dash')
        const paragraph = document.querySelector('#dash-narrative')
        return { text: paragraph.textContent, icons: paragraph.querySelectorAll('svg').length,
          overflow: dash.scrollWidth > dash.clientWidth + 1,
          fits: dash.scrollHeight <= dash.clientHeight + 1,
          attached: [...paragraph.querySelectorAll('.dash-token')].every(token => token.getClientRects().length === 1),
          warmColors: [...paragraph.querySelectorAll('.dash-icon[data-kind="weather"], .dash-icon[data-kind="sessions"]')].map(n => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
            const ctx = canvas.getContext('2d'); ctx.fillStyle = getComputedStyle(n).color; ctx.fillRect(0, 0, 1, 1)
            const [red, green, blue] = ctx.getImageData(0, 0, 1, 1).data
            return red > blue + 10
          }),
          iconColors: [...paragraph.querySelectorAll('.dash-icon')].map(n => getComputedStyle(n).color),
          facts: [...paragraph.querySelectorAll('.dash-fact')].map(n => getComputedStyle(n).color),
          context: getComputedStyle(paragraph.querySelector('.dash-context')).color,
          pixel: [...paragraph.querySelectorAll('svg')].every(n => n.getAttribute('fill') === 'currentColor') }
      })()`)
      assert.equal(sentence.text, compact.items[0].text)
      assert.equal(sentence.icons, 3)
      assert.ok(sentence.warmColors.every(Boolean), 'weather and Pi use warm accents without blue')
      assert.equal(new Set(sentence.iconColors).size, 3, 'weather, sessions and plants have distinct restrained colors')
      assert.equal(sentence.attached, true, 'icons stay with their text')
      assert.equal(sentence.overflow, false)
      assert.ok(sentence.facts.every(color => color !== sentence.context))
      if (width >= 960) assert.equal(sentence.fits, true, theme + ' ' + width + ' compact sentence fits')
      assert.equal(sentence.pixel, theme === 'pixel')
      await send({ ...compact, state: 'loading' })
      assert.equal(await evaluate(`document.querySelectorAll('.dash-icon[data-state="live"]').length`), 0, 'retained values have no live color')
      assert.equal(await evaluate(`new Set([...document.querySelectorAll('.dash-icon')].map(n => getComputedStyle(n).color)).size`), 3, 'retained source icons retain their category colors')
      const statement = '<script>literal</script> 状态更新。' + 'Long source context with mixed 中文 readings. '.repeat(8)
      const frame = { state: 'live', generatedAt: Date.now(), omittedSources: 1, items: [{ text: statement,
        sources: [{ id: 'mail', label: 'Mail ' + '长标题'.repeat(30), state: 'stale', updatedAt: Date.now() - 60000 }] }] }
      await send(frame)
      const result = await evaluate(`(() => {
        const dash = document.querySelector('.dash');
        const text = document.querySelector('[data-briefing="agent-0"]');
        const status = document.querySelector('#dash-narrative');
        return { literal: text.textContent, script: !!text.querySelector('script'),
          overflow: dash.scrollWidth > dash.clientWidth + 1,
          controls: dash.querySelectorAll('details, summary, button, a, [tabindex]').length,
          footer: !!dash.querySelector('.dash-foot, #dash-agent-status, #dash-source-list'), live: status.getAttribute('aria-live'),
          storedFallback: dash.textContent.includes('You have') };
      })()`)
      assert.equal(result.literal, statement)
      assert.equal(result.script, false)
      assert.equal(result.overflow, false, `${theme} ${width}: no horizontal overflow`)
      assert.equal(result.controls, 0)
      assert.equal(result.footer, false)
      assert.equal(result.live, 'polite')
      assert.equal(result.storedFallback, false)
      for (const state of ['loading', 'empty', 'unavailable', 'error', 'stale']) {
        await send({ ...frame, state, items: ['loading', 'stale'].includes(state) ? frame.items : [] })
        assert.equal(await evaluate(`document.querySelector('#dash-narrative').dataset.state`), state)
        assert.ok(await evaluate(`document.querySelector('#dash-narrative').textContent.length > 0`))
      }
      win.webContents.send('odk-personal-bot-status', { state: 'error', message: '' })
      await evaluate(`new Promise(r => setTimeout(r, 30))`)
      assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.agent-state')).fontSize) >= 14`), 'Agent recovery feedback clears the text floor')
      assert.equal(await evaluate(`document.querySelector('.agent-state').getAttribute('role')`), 'status')
      assert.match(await evaluate(`document.querySelector('.agent-state').textContent`), /try again/)
      console.log(`PASS Agent home: ${theme} ${width}x${height} literal text, no metadata controls, availability, wrapping`)
    }
  }
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); new Promise(r => setTimeout(r, 80))`)
  assert.equal(await evaluate(`document.querySelectorAll('.dot')[1].classList.contains('active')`), true)
  await evaluate(`document.querySelectorAll('.dot')[0].click(); new Promise(r => setTimeout(r, 80))`)
  assert.equal(await evaluate(`document.querySelectorAll('.dot')[0].classList.contains('active')`), true)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    win.setContentSize(1280, 800)
    await evaluate(`window.odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); new Promise(r => setTimeout(r, 100))`)
    await send(compact)
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-agent-home-' + theme + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  win.setContentSize(1536, 1024)
  await evaluate(`window.dispatchEvent(new Event('resize')); new Promise(r => setTimeout(r, 100))`)
  await send(compact)
  const firstCard = await evaluate(`(() => { const r = document.querySelector('#home-summary').getBoundingClientRect(); return { x: r.x, height: r.height, unit: window.__odkGrid.cellDim, border: parseFloat(getComputedStyle(document.querySelector('#home-summary')).borderTopWidth) } })()` )
  assert.equal(firstCard.height, firstCard.unit, 'Overview is exactly one grid row high')
  assert.equal(firstCard.border, 0, 'Overview stays borderless')
  const swipe = await evaluate(`(() => { const r = document.querySelector('#home-summary').getBoundingClientRect(); return { x: Math.round(r.right - 30), y: Math.round(r.top + 24), end: Math.round(r.left + 30) } })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', x: swipe.x, y: swipe.y, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseMove', x: swipe.end, y: swipe.y, button: 'left' })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: swipe.end, y: swipe.y, button: 'left', clickCount: 1 })
  await evaluate(`new Promise(r => setTimeout(r, 280))`)
  assert.equal(await evaluate(`document.querySelectorAll('.dot')[1].classList.contains('active')`), true, 'swiping Overview changes the whole Home page')
  assert.ok(await evaluate(`document.querySelector('#home-summary').getBoundingClientRect().right <= document.querySelector('#pages-viewport').getBoundingClientRect().left`), 'next page excludes Overview')
  assert.equal(await evaluate(`document.querySelectorAll('#pages-track > .page:not([data-page-id="home"]) #home-summary').length`), 0)
  await evaluate(`document.querySelectorAll('.dot')[0].click(); new Promise(r => setTimeout(r, 280))`)
  assert.equal(await evaluate(`document.querySelector('#home-summary').getBoundingClientRect().x`), firstCard.x, 'Overview returns with Home')
  assert.equal(await evaluate(`document.querySelector('#home-summary details, #home-summary summary')`), null, 'paging never restores source controls')
  assert.equal(await evaluate(`document.querySelectorAll('#pages-track [data-plugin="odk.page.dashboard"]').length`), 1)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.widget[data-interaction="display-only"]')).backgroundColor`), 'rgba(0, 0, 0, 0)')
  await evaluate(`document.querySelector('.agent-identity-form [name="name"]').value = 'Mori 中文'; document.querySelector('.agent-identity-form [name="icon"]').value = 'leaf'; document.querySelector('.agent-identity-form').requestSubmit()`)
  win.webContents.send('odk-personal-bot-status', { state: 'thinking', transcript: 'Question 中文', message: 'Partial' })
  await evaluate(`new Promise(r => setTimeout(r, 30))`)
  await evaluate(`window.agentStreamBubble = document.querySelector('.agent-message-bubble'); window.agentStreamBody = document.querySelector('.agent-message-assistant .agent-message-body')`)
  win.webContents.send('odk-personal-bot-status', { state: 'thinking', transcript: 'Question 中文', message: 'Partial response' })
  win.webContents.send('odk-personal-bot-status', { state: 'unavailable', message: '' })
  win.webContents.send('odk-personal-bot-status', { state: 'thinking', transcript: 'Question 中文', message: 'Reconnected response' })
  await evaluate(`new Promise(r => setTimeout(r, 30))`)
  assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`), 1, 'reconnect keeps the streaming turn')
  win.webContents.send('odk-personal-bot-status', { state: 'idle', transcript: 'Question 中文', message: 'Final response' })
  await evaluate(`new Promise(r => setTimeout(r, 30))`)
  assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`), 1)
  assert.equal(await evaluate(`document.querySelectorAll('.agent-message-assistant').length`), 1)
  assert.equal(await evaluate(`document.querySelector('.agent-message-assistant .agent-message-body').textContent.includes('Final response')`), true)
  assert.equal(await evaluate(`document.querySelector('.agent-message-bubble') === window.agentStreamBubble && document.querySelector('.agent-message-assistant .agent-message-body') === window.agentStreamBody && getComputedStyle(window.agentStreamBubble).backgroundColor !== 'rgba(0, 0, 0, 0)'`), true, 'streaming and reconnect retain the same message background and body')
  await evaluate(`delete window.agentStreamBubble; delete window.agentStreamBody`)
  assert.equal(await evaluate(`document.querySelector('.agent-name').textContent === 'Mori 中文' && document.querySelector('.agent-message-assistant').getAttribute('aria-label') === 'Mori 中文' && document.querySelector('.agent-composer textarea').getAttribute('aria-label').includes('Mori 中文')`), true)
  assert.equal(await evaluate(`document.querySelectorAll('.agent-message-name, .agent-caption, .agent-message time, .agent-message-avatar').length`), 0, 'name is shown once and messages have no timestamps or avatars')
  assert.equal(await evaluate(`document.querySelector('.agent-avatar').innerHTML === document.querySelector('.agent-input-avatar').innerHTML`), true)
  assert.equal(await evaluate(`document.querySelector('#personal-bot-status').hidden && !document.querySelector('#home-desk').inert`), true)
  await evaluate(`document.querySelector('.agent-composer textarea').value = 'Typed question'; document.querySelector('.agent-composer').requestSubmit(); new Promise(r => setTimeout(r, 30))`)
  assert.deepEqual(sentText, ['Typed question'])
  assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').value`), '')
  completeBeforeReceipt = true
  await evaluate(`document.querySelector('.agent-composer textarea').value = 'Fast turn'; document.querySelector('.agent-composer').requestSubmit(); new Promise(r => setTimeout(r, 80))`)
  assert.equal(await evaluate(`document.querySelector('.agent-state').textContent`), 'Ready', 'receipt cannot overwrite a completed status')
  completeBeforeReceipt = false
  textAccepted = false
  await evaluate(`document.querySelector('.agent-composer textarea').value = 'Keep draft'; document.querySelector('.agent-composer').requestSubmit(); new Promise(r => setTimeout(r, 30))`)
  assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').value`), 'Keep draft')
  assert.match(await evaluate(`document.querySelector('.agent-state').textContent`), /not confirmed/)
  win.webContents.send('odk-personal-bot-status', { state: 'recording', message: '' })
  await evaluate(`new Promise(r => setTimeout(r, 30));`)
  await evaluate(`document.querySelector('.agent-mic').click(); new Promise(r => setTimeout(r, 30))`)
  assert.equal(micToggles, 1, 'home Stop toggles the active recording')
  win.webContents.send('odk-personal-bot-status', { state: 'idle', transcript: 'Question 中文', message: 'Final response' })
  await evaluate(`new Promise(r => setTimeout(r, 30));`)
  await evaluate(`document.querySelector('.agent-mic').click(); new Promise(r => setTimeout(r, 30))`)
  assert.equal(micToggles, 2, 'next home mic starts another voice turn')
  const identity = await evaluate(`document.querySelector('.agent-name').textContent`)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    win.setContentSize(320, 480)
    await evaluate(`odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); document.querySelector('.agent-identity-form [name="name"]').value = '中文'.repeat(20); document.querySelector('.agent-identity-form').requestSubmit(); new Promise(r => setTimeout(r, 60))`)
    const nameLayout = await evaluate(`(() => { const panel = document.querySelector('.agent-panel').getBoundingClientRect(), composer = document.querySelector('.agent-composer').getBoundingClientRect(); return { fits: composer.bottom <= panel.bottom && composer.right <= panel.right, conversation: document.querySelector('.agent-conversation').clientHeight } })()`)
    assert.ok(nameLayout.fits && nameLayout.conversation >= 40, JSON.stringify({ theme, nameLayout }))
    assert.equal(await evaluate(`(() => { window.dispatchEvent(new CustomEvent('odk-gamepad-state', { detail: { connected: true, readable: true, id: 'Fixture pad' } })); const bar = document.querySelector('#status-bar').getBoundingClientRect(), pad = document.querySelector('#sb-pad').getBoundingClientRect(), pi = document.querySelector('#sb-pi-status').getBoundingClientRect(); return pad.width > 0 && pad.bottom <= bar.bottom && pad.right <= bar.right && (pi.right <= pad.left || pad.right <= pi.left) })()`), true, 'compact gamepad and Pi status remain inside separate bounds')
    await evaluate(`window.dispatchEvent(new CustomEvent('odk-gamepad-state', { detail: { connected: false } }))`)
  }
  win.setContentSize(1536, 1024)
  await evaluate(`document.querySelector('.agent-identity-form [name="name"]').value = ${JSON.stringify(identity)}; document.querySelector('.agent-identity-form').requestSubmit(); window.dispatchEvent(new Event('resize')); new Promise(r => setTimeout(r, 60))`)
  await evaluate(`document.querySelectorAll('.dot')[1].click()` )
  await evaluate(`document.querySelector('.agent-composer textarea').focus(); document.querySelector('.agent-composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
  assert.equal(await evaluate(`document.querySelectorAll('.dot')[1].classList.contains('active')`), true)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`window.odkTheme.set('${theme}'); document.querySelectorAll('.dot')[0].click(); new Promise(r => setTimeout(r, 100))`)
    assert.equal(await evaluate(`document.querySelector('.agent-name').textContent`), identity)
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-home-stress-' + theme + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  win.setContentSize(1920, 1280)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`window.odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); void document.body.offsetHeight; document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`)
    await send(compact)
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-home-failure-grid-' + theme + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  console.log('PASS resident Agent identity, typed input, streaming, retained draft, first-page briefing and independent Agent')
  console.log('PASS keyboard and pointer paging remain usable; fixture capture saved')
  finish(0)
}).catch(error => { console.error(error); finish(1) })
