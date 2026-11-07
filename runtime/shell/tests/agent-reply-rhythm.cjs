// One bounded paragraph rhythm for real safe-Markdown conversation replies.
// The resident Agent produces short prose with blank-line paragraphs, bold,
// and inline code; it does not produce headings, lists, or tables.
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const assert = require('node:assert/strict')
const os = require('node:os')
const fs = require('node:fs')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-agent-reply-rhythm-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })
const timer = setTimeout(() => app.exit(1), 90000)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const reply = [
  '已在目标 **cm5**、项目 `/home/orangepi/Developer/open-deskos` 启动 Hosted Pi 草稿任务。任务正在运行；尚无草稿路径或字段解析检查结果，因此暂不能确认这些工作已完成。',
  '',
  '完成检查未通过证据校验，尚不能确认完成。安装工具另行验证并成功安装当前包。',
  '',
  '仍需确认：返回准确的 taskId、目标 cm5 和项目路径收据；创建 Widget 草稿并返回草稿路径及独立字段解析检查结果。',
].join('\n')

const message = {
  id: '4'.repeat(64),
  at: 1000,
  text: reply,
  presentation: 'assistant_update',
  sources: [{
    key: 'a'.repeat(64), revision: 'b'.repeat(64), threadId: 'c'.repeat(64),
    machine: 'CM5', sessionId: 'long-reply', project: '/synthetic/essay',
    taskName: 'Draft', control: 'report_only', availability: 'live',
  }],
}

const measure = `(() => {
  const body = document.querySelector('.agent-update .agent-message-body') || document.querySelector('.agent-message-body')
  if (!body) return { error: 'no reply body' }
  const cs = node => getComputedStyle(node)
  const nodes = [...body.children].filter(node => !node.classList.contains('agent-message-actions')
    && !node.classList.contains('agent-update-sources'))
  const namedGap = parseFloat(cs(document.querySelector('.agent-panel')).getPropertyValue('--agent-gap-block'))
  return {
    error: null,
    namedGap,
    whiteSpace: cs(body).whiteSpace,
    markdown: body.classList.contains('personal-agent-status-markdown'),
    bold: body.querySelectorAll('strong').length,
    code: body.querySelectorAll('code').length,
    headings: body.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
    nodes: nodes.map(node => ({
      tag: node.tagName,
      text: (node.textContent || '').trim().slice(0, 28),
      marginTop: parseFloat(cs(node).marginTop),
      marginBottom: parseFloat(cs(node).marginBottom),
      height: node.getBoundingClientRect().height,
      top: node.getBoundingClientRect().top,
    })),
  }
})()`

app.whenReady().then(async () => {
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight',
    'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list',
    'odk-personal-agent-status', 'odk-remote-publish-page-state', 'odk-personal-agent-consumer-ready',
    'odk-renderer-development-plugins', 'odk-remote-link-state']) {
    ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [], state: 'disconnected', sequence: 0 }))
  }
  ipcMain.handle('odk-personal-agent-text', () => ({ accepted: true }))
  ipcMain.handle('odk-personal-agent-proposal', () => ({ accepted: true }))

  const win = new BrowserWindow({
    show: false, width: 480, height: 925, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true },
  })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  await delay(700)

  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await run(`odkTheme.set(${JSON.stringify(theme)})`)
    win.webContents.send('odk-personal-agent-status', {
      state: 'idle', proposals: [], proposalCapabilities: { read: true, respond: true, acknowledge: true },
      remote: { state: 'live', messages: [message], replies: [] },
    })
    await delay(300)
    await run(`(() => { const c = document.querySelector('.agent-conversation'); if (c) c.scrollTop = 0 })()`)
    const measured = await run(measure)
    assert.equal(measured.error, null, `${theme}: ${measured.error}`)
    assert.equal(measured.markdown, true, `${theme}: the reply must use the safe Markdown renderer`)
    assert.equal(measured.whiteSpace, 'normal', `${theme}: Markdown source whitespace must not become preformatted blanks`)
    assert.equal(measured.headings, 0, `${theme}: the fixture must match real output with no headings`)
    assert.ok(measured.bold > 0 && measured.code > 0, `${theme}: inline emphasis and code must render`)
    const gap = measured.namedGap
    assert.ok(gap > 0, `${theme}: the named block gap must resolve`)
    assert.equal(measured.nodes.length, 3, `${theme}: three source paragraphs must become three blocks`)
    assert.ok(measured.nodes.every(node => node.tag === 'P'), `${theme}: every block must be a paragraph`)
    for (let i = 0; i < measured.nodes.length; i++) {
      const node = measured.nodes[i]
      assert.equal(node.marginBottom, 0, `${theme}: ${node.text} must not add a trailing margin`)
      assert.equal(node.marginTop, i === 0 ? 0 : gap, `${theme}: ${node.text} must use the named gap`)
    }
    for (let i = 1; i < measured.nodes.length; i++) {
      const previous = measured.nodes[i - 1], current = measured.nodes[i]
      const visualGap = current.top - (previous.top + previous.height)
      assert.ok(Math.abs(visualGap - gap) <= 1,
        `${theme}: paragraph gap is ${visualGap}px, expected ${gap}px`)
    }
    console.log(`PASS ${theme}: ${measured.nodes.length} paragraphs, gap ${gap}px, white-space normal, bold ${measured.bold}, code ${measured.code}`)
  }

  // A generated card is the result: full by default, collapsed only when very long.
  const card = text => ({ type: 'Suggestion', props: {}, children: [
    { type: 'Heading', props: { value: '安装状态' }, children: [] },
    { type: 'Reading', props: { label: 'cm5-api-clock', value: 'UTC Live 2.1' }, children: [] },
    { type: 'Text', props: { value: text }, children: [] },
  ] })
  const normal = card('读数未包含设备名字段，本次只读取，未安装或改动任何包。')
  const veryLong = card('读数未包含设备名字段，无法断定是哪台机器。'.repeat(40))

  const lead = '两个包都读到了，没有改动。'
  const sendCard = async ui => {
    win.webContents.send('odk-personal-agent-status', {
      state: 'idle', message: reply, replyPresentation: { text: lead, ui },
      proposals: [], proposalCapabilities: { read: true, respond: true, acknowledge: true },
      remote: { state: 'partial', messages: [], replies: [] },
    })
    await delay(300)
    return run(`(() => {
      const detail = document.querySelector('.agent-remote-detail')
      if (!detail) return { error: 'no detail card' }
      const cardEl = detail.querySelector('.openui-suggestion')
      if (!cardEl) return { error: 'no generated detail' }
      const toggle = detail.querySelector('.agent-remote-detail-expand')
      const cardStyle = getComputedStyle(cardEl)
      const children = [...cardEl.children]
      const gap = parseFloat(cardStyle.rowGap)
      const childGaps = children.slice(1).map((element, index) =>
        element.getBoundingClientRect().top - children[index].getBoundingClientRect().bottom)
      return { lead: detail.previousSibling?.textContent, tag: detail.tagName, clipped: detail.classList.contains('agent-remote-detail-clipped'),
        expanded: detail.classList.contains('agent-remote-detail-expanded'),
        hasToggle: !!toggle, toggleText: toggle?.textContent, ariaExpanded: toggle?.getAttribute('aria-expanded'),
        cardVisible: cardEl.getBoundingClientRect().height > 0,
        flat: cardStyle.backgroundColor === 'rgba(0, 0, 0, 0)' && cardStyle.boxShadow === 'none' &&
          ['Top', 'Right', 'Bottom', 'Left'].every(side => parseFloat(cardStyle['border' + side + 'Width']) === 0 &&
            parseFloat(cardStyle['padding' + side]) === 0),
        fade: cardStyle.maskImage !== 'none', togglePosition: toggle ? getComputedStyle(toggle).position : null,
        textLength: cardEl.textContent.length, gap, childGaps }
    })()`)
  }

  const shown = await sendCard(normal)
  assert.ok(!shown.error, shown.error)
  assert.equal(shown.lead, lead, 'the card shows its lead instead of repeating the original text')
  assert.equal(shown.clipped, false, 'a normal generated card must render in full')
  assert.equal(shown.hasToggle, false, 'a normal card must not show an expand control')
  assert.equal(shown.cardVisible, true, 'the normal card content must be visible')
  assert.equal(shown.flat, true, 'the generated reply shares the message surface and inset')
  assert.ok(shown.childGaps.every(gap => Math.abs(gap - shown.gap) <= 1),
    `reply card spacing must use its ${shown.gap}px gap, measured ${shown.childGaps.join(', ')}px`)
  console.log(`PASS normal card: ${shown.tag}, fully visible, ${shown.textLength} chars, no expand control`)

  const long = await sendCard(veryLong)
  assert.equal(long.tag, 'DIV', 'a very long card stays one card message, not a details list')
  assert.equal(long.clipped, true, 'a very long card is clipped')
  assert.equal(long.fade, true, 'the clipped card fades out at the bottom')
  assert.equal(long.hasToggle, true, 'an expand text button is present')
  assert.equal(long.toggleText, 'Show more')
  assert.equal(long.ariaExpanded, 'false', 'the card starts collapsed')
  assert.equal(long.togglePosition, 'absolute', 'the button overlays the fade')
  console.log(`PASS very-long card: clipped card with bottom fade, Show more overlay, ${long.textLength} chars`)

  await run(`document.querySelector('.agent-remote-detail-expand')?.click()`)
  await delay(100)
  const opened = await run(`(() => { const d=document.querySelector('.agent-remote-detail'); const t=d?.querySelector('.agent-remote-detail-expand');
    return { expanded:d?.classList.contains('agent-remote-detail-expanded'), toggleText:t?.textContent,
      ariaExpanded:t?.getAttribute('aria-expanded'), fade:getComputedStyle(d.querySelector('.openui-suggestion')).maskImage!=='none' } })()`)
  assert.equal(opened.expanded, true, 'clicking Show more reveals the whole card')
  assert.equal(opened.toggleText, 'Show less')
  assert.equal(opened.ariaExpanded, 'true')
  assert.equal(opened.fade, false, 'an expanded card has no fade')
  console.log('PASS expanded: whole card visible, no fade, Show less')

  const refreshed = await sendCard(veryLong)
  assert.equal(refreshed.expanded, true, 'an unchanged reply keeps its open card across a status refresh')
  assert.equal(refreshed.ariaExpanded, 'true')

  win.webContents.send('odk-personal-agent-status', {
    state: 'idle', message: reply, replyPresentation: { text: lead, ui: null },
  })
  await delay(100)
  const fallback = await run(`(() => {
    const body = [...document.querySelectorAll('.agent-message-body')].at(-1)
    return { text: body?.textContent, card: Boolean(body?.querySelector('.agent-remote-detail')) }
  })()`)
  assert.match(fallback.text, /仍需确认/)
  assert.equal(fallback.card, false)

  clearTimeout(timer)
  win.destroy()
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
