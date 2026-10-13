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
  assert.equal(await evaluate(`document.querySelector('[data-page-id="today"]').parentElement.id`), 'home-summary', 'briefing is outside paging')
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
  assert.equal(await evaluate(`document.querySelector('.dash-provenance').open`), false)
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

  const sourcePoint = await evaluate(`(() => { const r = document.querySelector('.dash-provenance summary').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()` )
  win.webContents.sendInputEvent({ type: 'mouseDown', ...sourcePoint, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', ...sourcePoint, button: 'left', clickCount: 1 })
  await evaluate(`new Promise(r => setTimeout(r, 50))`)
  assert.equal(await evaluate(`document.querySelector('.dash-provenance').open`), true, 'real pointer opens Sources')
  await evaluate(`document.querySelector('.dash-provenance').open = false`)

  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    for (const [width, height] of [[1920, 1280], [1920, 1080], [1280, 800], [960, 640], [480, 854], [320, 480]]) {
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
          cell: [cell.width, cell.height], columns: window.__odkGrid.cols, unit: window.__odkGrid.cellDim,
          paneWidth: pane.clientWidth, spans: ['odk.tile.pi-sessions','odk.tile.pomodoro'].map(id => document.querySelector('[data-widget="'+id+'"]').dataset.span),
          overflow: document.querySelector('.widget-grid').scrollWidth > pane.clientWidth }
      })()`)
      assert.equal(geometry.statusHeight, geometry.expectedHeight, theme + ' original State Bar height')
      assert.equal(geometry.icon, geometry.expectedIcon, theme + ' original State Bar icons')
      assert.ok(geometry.capsule >= 1, 'Pi retains its outlined capsule')
      assert.ok(geometry.time >= 20, 'clock retains original display typography')
      assert.ok(Math.abs(geometry.cell[0] - geometry.cell[1]) < 1, '1x1 is square')
      assert.equal(geometry.overflow, false, 'right grid has no horizontal overflow')
      assert.ok(geometry.columns <= 3, 'right grid never exceeds three columns')
      if (width >= 1280) {
        const fit = await evaluate(`(() => {
          const pane = document.querySelector('#pages-viewport').getBoundingClientRect()
          const tiles = [...document.querySelectorAll('[data-page-id="home"] .widget')].map(tile => tile.getBoundingClientRect())
          const gap = parseFloat(getComputedStyle(document.querySelector('[data-page-id="home"] .widget-grid')).gap)
          return { agentWidth: document.querySelector('#personal-agent').getBoundingClientRect().width,
            bottomMargin: pane.bottom - Math.max(...tiles.map(r => r.bottom)),
            topMargin: Math.min(...tiles.map(r => r.top)) - pane.top, gap }
        })()`)
        assert.ok(fit.agentWidth <= width * 0.35, 'resident Agent leaves at least 65 percent for the desk: ' + JSON.stringify(fit))
        assert.ok(fit.bottomMargin >= 12 && fit.bottomMargin < 14, 'last Widget row leaves one margin plus less than two pixels of cell rounding: ' + JSON.stringify(fit))
        assert.equal(fit.topMargin, 12, 'Widget grid has a small top margin')
        assert.equal(fit.gap, 12, 'Widget grid uses compact consistent spacing')
        const visibleHome = await evaluate(`(() => {
          const pane = document.querySelector('#pages-viewport').getBoundingClientRect()
          return Array.from(document.querySelectorAll('[data-page-id="home"] .widget')).filter(tile => {
            const r = tile.getBoundingClientRect()
            return r.left >= pane.left && r.right <= pane.right && r.top >= pane.top && r.bottom <= pane.bottom
          }).length
        })()`)
        assert.equal(visibleHome, 6, 'home shows six complete Widgets in the lower two rows')
        assert.equal(geometry.columns, 3, 'wide right pane uses at most three columns')
        assert.ok(geometry.unit >= 200, 'home uses readable square units')
        assert.equal(await evaluate(`window.__odkGrid.rows`), 2, 'Widget region has two rows')
        assert.ok(await evaluate(`Math.abs(document.querySelector('#pages-viewport').clientHeight - 2 * document.querySelector('#home-summary').clientHeight) <= 2`), 'Overview is one row above two Widget rows')
        assert.deepEqual(geometry.spans, ['kept', 'kept'], 'original instrument proportions survive')
        assert.ok(await evaluate(`Array.from(document.querySelectorAll('.widget')).every(tile => tile.getBoundingClientRect().bottom <= tile.closest('.page').getBoundingClientRect().bottom)`), 'target panel shows complete Widget pages below Overview')
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
      await evaluate(`document.querySelector('.dash-provenance').open = true`)
      assert.equal(await evaluate(`document.querySelector('#dash-source-list').innerText.includes('Desk readings')`), true)
      await evaluate(`document.querySelector('.dash-provenance').open = false`)
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
        const sources = document.querySelector('.dash-sources');
        const status = document.querySelector('#dash-agent-status');
        return { literal: text.textContent, script: !!text.querySelector('script'),
          overflow: dash.scrollWidth > dash.clientWidth + 1,
          sourceFont: parseFloat(getComputedStyle(sources).fontSize),
          sourceState: sources.textContent.includes('stale'), live: status.getAttribute('aria-live'),
          omitted: dash.textContent.includes('1 source was outside'),
          storedFallback: dash.textContent.includes('You have') };
      })()`)
      assert.equal(result.literal, statement)
      assert.equal(result.script, false)
      assert.equal(result.overflow, false, `${theme} ${width}: no horizontal overflow`)
      assert.ok(result.sourceFont >= 14)
      assert.equal(result.sourceState, true)
      assert.equal(result.live, 'polite')
      assert.equal(result.omitted, true)
      assert.equal(result.storedFallback, false)
      for (const state of ['loading', 'empty', 'unavailable', 'error', 'stale']) {
        await send({ ...frame, state, items: ['loading', 'stale'].includes(state) ? frame.items : [] })
        assert.equal(await evaluate(`document.querySelector('#dash-narrative').dataset.state`), state)
        assert.ok(await evaluate(`document.querySelector('#dash-agent-status').textContent.length > 0`))
      }
      win.webContents.send('odk-personal-bot-status', { state: 'error', message: '' })
      await evaluate(`new Promise(r => setTimeout(r, 30))`)
      assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.agent-state')).fontSize) >= 14`), 'Agent recovery feedback clears the text floor')
      assert.equal(await evaluate(`document.querySelector('.agent-state').getAttribute('role')`), 'status')
      assert.match(await evaluate(`document.querySelector('.agent-state').textContent`), /try again/)
      console.log(`PASS Agent home: ${theme} ${width}x${height} literal text, sources, availability, wrapping`)
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
  const pinned = await evaluate(`(() => { const r = document.querySelector('#home-summary').getBoundingClientRect(); return [r.x, r.y] })()`)
  await evaluate(`document.querySelectorAll('.dot')[1].click()`)
  assert.deepEqual(await evaluate(`(() => { const r = document.querySelector('#home-summary').getBoundingClientRect(); return [r.x, r.y] })()`), pinned)
  assert.equal(await evaluate(`document.querySelectorAll('#pages-track [data-plugin="odk.page.dashboard"]').length`), 0)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.widget[data-interaction="display-only"]')).backgroundColor`), 'rgba(0, 0, 0, 0)')
  await evaluate(`document.querySelector('.agent-identity-form [name="name"]').value = 'Mori 中文'; document.querySelector('.agent-identity-form [name="icon"]').value = 'leaf'; document.querySelector('.agent-identity-form').requestSubmit()`)
  win.webContents.send('odk-personal-bot-status', { state: 'thinking', transcript: 'Question 中文', message: 'Partial' })
  await evaluate(`new Promise(r => setTimeout(r, 30))`)
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
  assert.equal(await evaluate(`document.querySelector('.agent-name').textContent === 'Mori 中文' && document.querySelector('.agent-message-name').textContent === 'Mori 中文' && document.querySelector('.agent-composer textarea').placeholder.includes('Mori 中文')`), true)
  assert.equal(await evaluate(`document.querySelector('.agent-avatar').innerHTML === document.querySelector('.agent-message-avatar').innerHTML && document.querySelector('.agent-avatar').innerHTML === document.querySelector('.agent-input-avatar').innerHTML`), true)
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
  await evaluate(`document.querySelector('.agent-composer textarea').focus(); document.querySelector('.agent-composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
  assert.equal(await evaluate(`document.querySelectorAll('.dot')[1].classList.contains('active')`), true)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`window.odkTheme.set('${theme}'); document.querySelectorAll('.dot')[0].click(); new Promise(r => setTimeout(r, 100))`)
    assert.equal(await evaluate(`document.querySelector('.agent-name').textContent`), identity)
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-home-final-' + theme + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  win.setContentSize(1920, 1280)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`window.odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); void document.body.offsetHeight; document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`)
    await send(compact)
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-home-grid-preview-' + theme + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  console.log('PASS resident Agent identity, typed input, streaming, retained draft, fixed briefing and independent paging')
  console.log('PASS keyboard and pointer paging remain usable; fixture capture saved')
  finish(0)
}).catch(error => { console.error(error); finish(1) })
