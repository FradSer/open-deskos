const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-voice-input-'))
app.setPath('userData', profile)
let win
const requests = []
let toggleCount = 0
let toggleStatus = { state: 'starting' }
let settleToggle
let deferToggle = false
let rejectToggle = false
const pause = () => new Promise((resolve) => setTimeout(resolve, 30))
const evaluate = (script) => win.webContents.executeJavaScript(script)
const send = async (status) => { win.webContents.send('odk-voice-status', status); await pause() }
const mic = async () => { win.webContents.send('odk-voice-mic'); await pause() }
const timeout = setTimeout(() => finish(1), 60000)
function finish(code) {
  clearTimeout(timeout)
  if (win && !win.isDestroyed()) win.destroy()
  fs.rmSync(profile, { recursive: true, force: true })
  app.exit(code)
}

async function listening() {
  await send({ state: 'starting' })
  await send({ state: 'recording', level: 0 })
  assert.equal(await evaluate(`document.querySelector('.voice-status-content').innerText.trim()`), 'Listening')
  const initial = await evaluate(`(() => {
    const panel = document.querySelector('.voice-status-content');
    const meter = panel.querySelector('.voice-status-level');
    window.voiceMutations = [];
    window.voiceObserver = new MutationObserver(records => window.voiceMutations.push(...records));
    window.voiceObserver.observe(panel.querySelector('[role="status"]'), { childList: true, subtree: true, characterData: true });
    return { width: meter.firstElementChild.getBoundingClientRect().width,
      hidden: meter.getAttribute('aria-hidden'), outside: !meter.closest('[role="status"]'),
      icons: [...panel.querySelectorAll('svg')].filter(n => n.getClientRects().length > 0).length,
      animation: getComputedStyle(meter.firstElementChild).animationName };
  })()`)
  assert.deepEqual(initial, { width: 0, hidden: 'true', outside: true, icons: 1, animation: 'none' })
  let previous = 0
  for (const level of [0.01, 0.04, 0.25, 1]) {
    await send({ state: 'recording', level, message: 'Unwanted recording guidance' })
    const width = await evaluate(`document.querySelector('.voice-status-level span').getBoundingClientRect().width`)
    assert.ok(width > previous, 'Measured level grows the line monotonically')
    previous = width
  }
  await send({ state: 'recording' })
  assert.equal(await evaluate(`document.querySelector('.voice-status-level span').getBoundingClientRect().width`), 0)
  assert.equal(await evaluate('window.voiceMutations.length'), 0, 'Level updates do not rewrite the live region')
  await evaluate('window.voiceObserver.disconnect()')
}

const markdown = [
  '# Summary 测试', '', '**Important** and *emphasis* with `inline <code>`.', '',
  '- First', '- Second', '', '1. Ordered', '2. Next', '', '> Quoted result', '',
  '```js', '<script>window.voiceUnsafe = true</script>', '```', '',
  '| Column | Value |', '| --- | --- |', '| Alpha | 中文 |', '',
  '[Reference](https://example.test/guide?q=1&x=2)', '![Remote image](https://example.test/image.png)', '',
  '<img src="https://example.test/raw.png" onerror="window.voiceUnsafe = true">',
  '<script>window.voiceUnsafe = true</script>', '[unsafe](javascript:alert(1))', '',
  `${'Long无间隔'.repeat(40)}`, '', '```', 'unbroken'.repeat(90), '```', '',
  '| Long column | More |', '| --- | --- |', `| ${'table'.repeat(90)} | Value |`, '',
  'Paragraph 测试结果.\n\n'.repeat(35),
].join('\n')

async function reply(theme, width) {
  await send({ state: 'idle', message: 'A &amp; B / \\*literal\\*' })
  assert.equal(await evaluate(`document.querySelector('.voice-status-title').textContent.trim()`), 'A & B / *literal*')
  await send({ state: 'idle', message: markdown })
  const result = await evaluate(`(() => {
    const root = document.querySelector('.voice-status-title'); const panel = root.closest('.voice-status-content');
    const strong = root.querySelector('strong'); const em = root.querySelector('em');
    window.voiceReplyNode = root.firstChild;
    return { heading: root.querySelector('h1')?.textContent, strong: strong?.textContent,
      em: em?.textContent, ul: root.querySelectorAll('ul li').length, ol: root.querySelectorAll('ol li').length,
      quote: root.querySelector('blockquote')?.textContent.trim(), code: root.querySelector('pre code')?.textContent,
      table: root.querySelectorAll('table th').length, unsafe: !!root.querySelector('a, img, script, iframe, object, style, input'),
      text: root.textContent, executed: !!window.voiceUnsafe,
      overflow: panel.scrollWidth > panel.clientWidth + 1,
      scrollable: panel.scrollHeight > panel.clientHeight,
      stageFont: parseFloat(getComputedStyle(document.querySelector('.voice-status-stage')).fontSize),
      font: parseFloat(getComputedStyle(root).fontSize),
      emphasis: strong && getComputedStyle(strong).textDecorationLine,
      emStyle: em && getComputedStyle(em).fontStyle,
      synthesis: strong && getComputedStyle(strong).fontSynthesis };
  })()`)
  assert.equal(result.heading, 'Summary 测试')
  assert.equal(result.strong, 'Important')
  assert.equal(result.em, 'emphasis')
  assert.equal(result.ul, 2)
  assert.equal(result.ol, 2)
  assert.equal(result.quote, 'Quoted result')
  assert.match(result.code, /<script>/)
  assert.equal(result.table, 4)
  assert.equal(result.unsafe, false)
  assert.equal(result.executed, false)
  assert.match(result.text, /Reference \(https:\/\/example.test\/guide\?q=1&x=2\)/)
  assert.match(result.text, /Remote image/)
  assert.doesNotMatch(result.text, /https:\/\/example.test\/image.png/)
  assert.match(result.text, /<img src=/)
  assert.equal(result.overflow, false, `${theme} ${width}: no panel horizontal overflow`)
  assert.equal(result.scrollable, true)
  assert.ok(result.font >= (width === 1920 ? 32 : 24))
  assert.ok(result.stageFont >= (width === 1920 ? 24 : 18))
  if (theme === 'pixel') {
    assert.equal(result.emphasis, 'underline')
    assert.equal(result.emStyle, 'normal')
    assert.equal(result.synthesis, 'none')
  }
  await evaluate(`document.querySelector('.voice-status-content').scrollTop = 100`)
  await send({ state: 'idle', message: markdown })
  assert.equal(await evaluate(`document.querySelector('.voice-status-title').firstChild === window.voiceReplyNode && document.querySelector('.voice-status-content').scrollTop === 100`), true)
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'back' }))`)
}

const transcript = '**Literal input** <img src="https://example.test/input.png" onerror="window.voiceUnsafe = true">\n中文 ' + 'unbroken'.repeat(30)
const partial = '# Live response\n\n**Actual** assistant text.\n\n' + 'Streaming paragraph 测试.\n\n'.repeat(35)

async function streamSnapshot(state, message = '', input = transcript) {
  await send({ state, message, transcript: input })
  return evaluate(`(() => {
    const panel = document.querySelector('.voice-status-content');
    const input = panel.querySelector('.voice-status-input');
    const text = panel.querySelector('.voice-status-transcript');
    const heading = panel.querySelector('.voice-status-heading');
    const progress = panel.querySelector('.voice-status-progress');
    const reply = panel.querySelector('.voice-status-title');
    const rect = panel.getBoundingClientRect();
    return { input: text.textContent, inputHidden: input.hidden, elements: text.children.length,
      label: input.querySelector('.voice-status-input-label')?.textContent || '',
      inputName: input.getAttribute('aria-label'),
      inputIcon: !!input.querySelector('svg[aria-hidden="true"]'),
      iconWidth: input.querySelector('svg')?.getBoundingClientRect().width || 0,
      inlineIcon: !!input.querySelector('svg') && input.querySelector('svg').getBoundingClientRect().right <= text.getBoundingClientRect().left,
      firstLineIcon: !!input.querySelector('svg') && Math.abs(input.querySelector('svg').getBoundingClientRect().top - text.getBoundingClientRect().top) <= 16,
      heading: heading.hidden ? '' : panel.querySelector('.voice-status-stage').textContent,
      progress: !progress.hidden, reply: reply.textContent, replyHidden: reply.hidden,
      detail: panel.querySelector('.voice-status-detail').textContent,
      order: !!(input.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING)
        && !!(progress.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING),
      live: reply.getAttribute('aria-live'), atomic: reply.getAttribute('aria-atomic'), busy: reply.getAttribute('aria-busy'),
      separate: !reply.closest('[role="status"]') && !input.closest('[role="status"]'),
      bounded: rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && rect.top >= 0 && rect.height <= innerHeight * 0.7 + 1,
      overflow: panel.scrollWidth > panel.clientWidth + 1,
      inputFont: parseFloat(getComputedStyle(text).fontSize),
      selectable: getComputedStyle(text).userSelect,
      bottom: Math.abs(panel.scrollHeight - panel.clientHeight - panel.scrollTop) <= 1,
      top: panel.scrollTop, hidden: document.getElementById('voice-status').hidden };
  })()`)
}

async function unchangedStream(state, message) {
  await evaluate(`(() => {
    const panel = document.querySelector('.voice-status-content'); panel.scrollTop = 100;
    window.streamNodes = [panel.querySelector('.voice-status-title').firstChild, panel.querySelector('.voice-status-transcript').firstChild];
    window.streamMutations = [];
    window.streamObserver = new MutationObserver(records => window.streamMutations.push(...records));
    window.streamObserver.observe(panel, { childList: true, subtree: true, characterData: true });
  })()`)
  const snapshot = await streamSnapshot(state, message)
  assert.equal(snapshot.top, 100, 'Repeated snapshot preserves scroll')
  assert.equal(await evaluate(`window.streamNodes[0] === document.querySelector('.voice-status-title').firstChild && window.streamNodes[1] === document.querySelector('.voice-status-transcript').firstChild && window.streamMutations.length === 0`), true, 'Repeated snapshot retains DOM')
  await evaluate('window.streamObserver.disconnect()')
}

async function streaming(width) {
  await send({ state: 'starting' })
  let result = await streamSnapshot('thinking')
  assert.equal(result.input, transcript)
  assert.equal(result.elements, 0, 'Transcript is plain text, never parsed as Markdown or HTML')
  assert.equal(result.label, '')
  assert.equal(result.inputName, 'Spoken input')
  assert.equal(result.inputIcon, true)
  assert.ok(result.iconWidth >= 16 && result.iconWidth <= 24)
  assert.equal(result.inlineIcon, true)
  assert.equal(result.firstLineIcon, true)
  assert.equal(result.inputHidden, false)
  assert.equal(result.heading, 'Working')
  assert.equal(result.progress, true)
  assert.equal(result.replyHidden, true)
  assert.equal(result.order, true, 'Input, Working/progress, then response in DOM order')
  assert.equal(result.separate, true, 'Static stage live region excludes input and streamed reply')
  assert.equal(result.selectable, 'text')
  assert.ok(result.inputFont >= (width === 1920 ? 32 : 24))
  await evaluate(`document.querySelector('.voice-status-content').scrollTop = 1e6`)
  result = await streamSnapshot('thinking', partial)
  assert.equal(result.bottom, true, 'Streaming follows an already-bottom reader')
  assert.equal(result.bounded, true)
  assert.equal(result.overflow, false)
  assert.equal(result.live, 'polite')
  assert.equal(result.atomic, 'false')
  assert.equal(result.busy, 'true', 'Streaming is not announced as repeated completed replies')
  assert.equal(await evaluate(`document.querySelector('.voice-status-title strong').textContent`), 'Actual')
  await unchangedStream('thinking', partial)
  result = await streamSnapshot('thinking', partial + '\nMore response')
  assert.equal(result.top, 100, 'Growing stream does not pull a scrolled-up reader down')
  await evaluate(`document.querySelector('.voice-status-content').scrollTop = 1e6`)
  result = await streamSnapshot('thinking', partial + '\nMore response\n\nAnother paragraph')
  assert.equal(result.bottom, true, 'Returning to bottom resumes following')
  await streamingOutcome()
}

async function streamingOutcome() {
  let result = await streamSnapshot('idle', partial + '\nFinal response')
  assert.equal(result.bottom, true, 'Final response follows a bottom reader')
  assert.equal(result.input, transcript)
  assert.equal(result.heading, '')
  assert.equal(result.progress, false)
  assert.equal(result.busy, 'false')
  await unchangedStream('idle', partial + '\nFinal response')
  await streamSnapshot('thinking', partial)
  result = await streamSnapshot('idle', partial + '\nFinal while reading')
  assert.equal(result.top, 100, 'Completion also preserves a scrolled-up reader')
  result = await streamSnapshot('idle')
  assert.equal(result.input, transcript)
  assert.equal(result.hidden, false, 'Transcript-only completion remains visible')
  result = await streamSnapshot('idle', '', '')
  assert.equal(result.hidden, true, 'Empty shutdown hides feedback')
  await send({ state: 'starting' })
  result = await streamSnapshot('idle', partial, '')
  assert.equal(result.top, 0, 'First non-streamed result starts at the top')
  result = await streamSnapshot('thinking', partial)
  result = await streamSnapshot('error', 'Request failed safely')
  assert.equal(result.input, transcript)
  assert.equal(result.replyHidden, true)
  assert.equal(result.reply, '')
  assert.equal(result.heading, 'Needs attention')
  assert.match(result.detail, /Request failed safely.*\n.*try again/)
  assert.equal(result.overflow, false)
  for (const state of ['starting', 'recording', 'transcribing']) {
    await streamSnapshot('thinking', partial)
    result = await streamSnapshot(state, 'Stale response', 'Stale input')
    assert.equal(result.input, '')
    assert.equal(result.inputHidden, true)
    assert.equal(result.reply, '')
  }
  await streamSnapshot('thinking', partial)
  await evaluate(`window.odkVoiceStatus.close()`)
  await pause()
  await evaluate(`window.streamRestoredFocus = document.activeElement`)
  for (const state of ['thinking', 'idle', 'error']) {
    result = await streamSnapshot(state, partial + '\nLate update')
    assert.equal(result.hidden, true, 'Updates never reopen dismissed feedback')
    assert.equal(await evaluate('document.activeElement === window.streamRestoredFocus'), true)
  }
  await send({ state: 'starting' })
}

async function firstMic() {
  for (const state of ['idle', 'error', 'unavailable']) {
    await new Promise(resolve => {
      win.webContents.once('did-finish-load', resolve)
      win.reload()
    })
    await send({ state, message: 'Historical reply', transcript: 'Historical input' })
    const before = toggleCount
    toggleStatus = state === 'unavailable' ? { state, activated: true } : { state: 'starting' }
    await mic()
    assert.equal(toggleCount, before + 1, `${state}: first MIC invokes recording control`)
    assert.equal(await evaluate(`document.getElementById('voice-status').hidden`), false)
    assert.equal(await evaluate(`document.querySelector('.voice-status-transcript').textContent`), '')
    if (state === 'unavailable') {
      assert.match(await evaluate(`document.querySelector('.voice-status-detail').textContent`), /service.*configuration/i)
    }
  }
}

async function restoreMic(state) {
  await send({ state: 'starting' })
  const text = state === 'error' ? 'Failure detail.\n\n'.repeat(100) : partial
  await streamSnapshot(['idle', 'error'].includes(state) ? 'thinking' : state, text)
  await evaluate(`document.querySelector('.voice-status-content').scrollTop = 100`)
  const top = await evaluate(`document.querySelector('.voice-status-content').scrollTop`)
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'back' }))`)
  await pause()
  await evaluate(`window.reopenFocus = document.activeElement`)
  await streamSnapshot(state, text + '\nLatest update')
  assert.equal(await evaluate(`document.getElementById('voice-status').hidden && document.activeElement === window.reopenFocus`), true, `${state}: background update retains dismissal and focus`)
  await evaluate(`window.reopenReplyNode = document.querySelector('.voice-status-title').firstChild`)
  const before = toggleCount
  await mic()
  assert.equal(toggleCount, before, `${state}: hidden MIC restores without invoking toggle`)
  assert.equal(await evaluate(`window.reopenReplyNode === document.querySelector('.voice-status-title').firstChild`), true, 'Reopening retains rendered Markdown nodes')
  const result = await evaluate(`(() => {
    const panel = document.querySelector('.voice-status-content');
    return { hidden: document.getElementById('voice-status').hidden, top: panel.scrollTop,
      state: document.getElementById('voice-status').dataset.state, focus: document.activeElement === panel,
      input: document.querySelector('.voice-status-transcript').textContent,
      markdown: document.querySelector('.voice-status-title strong')?.textContent,
      text: panel.textContent, inert: [...document.body.children].filter(n => n.id !== 'voice-status' && n.tagName !== 'SCRIPT').every(n => n.inert) };
  })()`)
  assert.equal(result.hidden, false)
  assert.equal(result.state, state)
  assert.equal(result.top, top, `${state}: restore reader position`)
  assert.equal(result.focus, true)
  assert.equal(result.inert, true)
  if (['thinking', 'idle', 'error'].includes(state)) {
    assert.equal(result.input, transcript)
    assert.match(result.text, /Latest update/)
  }
  if (['thinking', 'idle'].includes(state)) assert.equal(result.markdown, 'Actual')
  toggleStatus = { state: state === 'recording' ? 'sending' : 'starting' }
  await mic()
  assert.equal(toggleCount, before + (['recording', 'idle', 'error'].includes(state) ? 1 : 0), `${state}: second MIC applies visible policy`)
  if (['idle', 'error'].includes(state)) {
    assert.equal(await evaluate(`document.querySelector('.voice-status-content').scrollTop`), 0, 'A new recording resets reader position')
    assert.equal(await evaluate(`document.querySelector('.voice-status-transcript').textContent + document.querySelector('.voice-status-title').textContent`), '')
  }
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'back' }))`)
  await pause()
  assert.equal(await evaluate(`document.getElementById('voice-status').hidden && document.activeElement === window.reopenFocus`), true)
}

async function rapidMic() {
  await send({ state: 'idle' })
  await evaluate(`window.voiceRejections = []; window.addEventListener('unhandledrejection', e => window.voiceRejections.push(e.reason))`)
  deferToggle = true
  toggleStatus = null
  const before = toggleCount
  await mic()
  await mic()
  assert.equal(toggleCount, before + 1, 'Pending invoke suppresses MIC before optimistic status')
  await send({ state: 'recording' })
  await mic()
  assert.equal(toggleCount, before + 1, 'Pending invoke suppresses MIC even if recording arrives')
  settleToggle({ accepted: true })
  await pause()
  assert.equal(toggleCount, before + 1, 'Settling does not replay ignored MIC')
  deferToggle = false
  rejectToggle = true
  await mic()
  assert.equal(await evaluate(`document.getElementById('voice-status').dataset.state`), 'error')
  assert.deepEqual(await evaluate('window.voiceRejections'), [])
  rejectToggle = false
  toggleStatus = { state: 'starting' }
  await mic()
  assert.equal(toggleCount, before + 3, 'Rejected invocation releases pending guard for explicit retry')
}

app.whenReady().then(async () => {
  ipcMain.handle('odk-voice-toggle', () => {
    toggleCount += 1
    if (rejectToggle) throw new Error('Recording control unavailable')
    if (toggleStatus) win.webContents.send('odk-voice-status', toggleStatus)
    if (deferToggle) return new Promise(resolve => { settleToggle = resolve })
    return { accepted: toggleStatus?.state !== 'unavailable' }
  })
  for (const channel of ['odk-remote-publish-page-state', 'odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight', 'odk-user-apps-list', 'odk-camera-frame']) {
    ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [] }))
  }
  win = new BrowserWindow({ show: false, width: 480, height: 854, useContentSize: true, webPreferences: {
    offscreen: true, preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true,
  } })
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    requests.push(details.url); callback({ cancel: true })
  })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  await firstMic()
  await rapidMic()
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready.then(() => true)`)
    for (const [width, height] of [[1920, 1280], [480, 854], [320, 480]]) {
      win.setContentSize(width, height)
      await pause()
      await listening()
      await streaming(width)
      await reply(theme, width)
      for (const state of ['starting', 'sending', 'transcribing', 'thinking', 'idle', 'error', 'recording']) await restoreMic(state)
    }
  }
  assert.deepEqual(requests, [], 'Markdown never attempts network requests')
  assert.equal(win.isVisible(), false)
  assert.equal(win.isFocused(), false)
  console.log('VOICE_INPUT_UI_PASS: MIC IPC restore/state policy/pending/recovery, transcript, streaming, safe Markdown, meter, scroll/DOM/focus restoration, 3 themes x 3 sizes, hidden offscreen')
  finish(0)
}).catch((error) => { console.error(error); finish(1) })
