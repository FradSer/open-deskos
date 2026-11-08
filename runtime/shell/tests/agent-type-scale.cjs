// Compare rendered recommendation content with a plain reply at the same width.
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const assert = require('node:assert/strict')
const os = require('node:os')
const fs = require('node:fs')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-agent-type-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })
const timer = setTimeout(() => app.exit(1), 90000)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const proposal = {
  id: 'e311a280-c0b9-4411-96cd-4e1e92385349', ruleId: 'commute-anomaly', status: 'pending', offered: true, presented: true,
  advice: '通勤比平时多了28分钟。',
  preview: { summary: '路上的时间', items: [
    { label: '今天', value: '52 分钟', tone: 'warn' },
    { label: '平时', value: '24 分钟' },
    { label: '多出', value: '28 分钟', tone: 'warn' } ] },
  // A small composable OpenUI tree. It mirrors the legacy preview so the ui path
  // renders the same generic card, chips, labels and values as the preview fallback.
  ui: { type: 'Suggestion', props: { children: [
    { type: 'Badge', props: { value: '通勤变化', tone: 'warn' } },
    { type: 'Divider', props: {} },
    { type: 'Heading', props: { value: '路上的时间' } },
    { type: 'Text', props: { value: '今天的通勤时间比平时长。' } },
    { type: 'Reading', props: { label: '今天', value: '52 分钟', tone: 'warn' } },
    { type: 'Reading', props: { label: '平时', value: '24 分钟' } },
    { type: 'Reading', props: { label: '多出', value: '28 分钟', tone: 'warn' } },
    { type: 'Divider', props: {} },
  ] } },
  action: { tool: 'memory_update', params: { category: 'note', value: 'opened' } },
  confirmation: '记住 note：opened', nextStep: '打开计划',
  createdAt: new Date().toISOString(),
  evidence: [{ readingId: 'commute.traffic', field: 'minutes', value: 52, state: 'live', measuredAt: new Date().toISOString() }]
}

const READING = ['.personal-agent-proposal-advice', '.openui-badge', '.openui-heading', '.openui-text',
  '.personal-agent-preview-label', '.personal-agent-preview-value', '.personal-agent-proposal-primary']

app.whenReady().then(async () => {
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight',
    'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list',
    'odk-personal-agent-status', 'odk-remote-publish-page-state', 'odk-personal-agent-consumer-ready',
    'odk-renderer-development-plugins', 'odk-remote-link-state']) {
    ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [], state: 'disconnected', sequence: 0 }))
  }
  ipcMain.handle('odk-personal-agent-text', () => ({ accepted: true }))
  ipcMain.handle('odk-personal-agent-proposal', () => ({ accepted: true }))

  const win = new BrowserWindow({ show: false, width: 480, height: 960, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  win.webContents.debugger.attach('1.3')
  win.webContents.setZoomFactor(1)
  await delay(800)
  await run(`odkTheme.set('instrument'); document.fonts.ready`)
  win.webContents.send('odk-personal-agent-status', {
    state: 'idle', ownerTurnId: 'e311a280-c0b9-4411-96cd-4e1e92385348', transcript: '今天的通勤怎么样？',
    message: proposal.advice, proposals: [proposal], proposalCapabilities: { read: true, respond: true, acknowledge: true },
  })
  await delay(400)
  win.webContents.send('odk-personal-agent-status', {
    state: 'idle', ownerTurnId: 'e311a280-c0b9-4411-96cd-4e1e92385350', transcript: '记住散步的天气条件',
    message: '已按本轮的明确请求保存：\n\n- 气温至少 **12°C**\n- 提前查看降雨概率',
    proposals: [proposal], proposalCapabilities: { read: true, respond: true, acknowledge: true },
  })
  await delay(400)

  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await run(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready`)
    for (const [width, height] of [[320, 480], [480, 854], [1920, 1280]]) {
      win.setContentSize(width, height)
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await run(`window.dispatchEvent(new Event('resize')); document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`)
      assert.deepEqual(await run(`[innerWidth, innerHeight]`), [width, height])
      const measured = await run(`(() => {
        const bubble = document.querySelector('.agent-recommendation .agent-message-bubble')
        if (!bubble) return { error: 'no bubble' }
        const reply = document.querySelector('.agent-message-assistant:not(.agent-recommendation) .agent-message-body')
        if (!reply?.checkVisibility()) return { error: 'no visible plain reply' }
        const card = bubble.querySelector('.personal-agent-preview-card')
        const chips = [...bubble.querySelectorAll('.personal-agent-preview-chip')]
        const size = sel => { const n = bubble.querySelector(sel); return n ? parseFloat(getComputedStyle(n).fontSize) : null }
        const weight = sel => { const n = bubble.querySelector(sel); return n ? parseFloat(getComputedStyle(n).fontWeight) : null }
        const rect = n => n.getBoundingClientRect()
        const confirmation = [...document.querySelectorAll('.agent-message-body.personal-agent-status-markdown')]
          .find(n => n.textContent.startsWith('已按本轮的明确请求保存'))
        if (!confirmation?.checkVisibility()) return { error: 'no visible Markdown confirmation' }
        const [intro, list] = confirmation.children
        const [first, second] = list.children
        const gap = (before, after) => rect(after).top - rect(before).bottom
        return {
          confirmationGaps: [gap(intro, first), gap(first, second)],
          paragraphSpacing: parseFloat(getComputedStyle(intro).marginBottom),
          replySize: parseFloat(getComputedStyle(reply).fontSize),
          reading: ${JSON.stringify(READING)}.map(sel => [sel, size(sel)]),
          moreSize: size('.personal-agent-proposal-more > summary'),
          labelSize: parseFloat(getComputedStyle(bubble).getPropertyValue('--agent-text-label')),
          textNodes: (() => {
            const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT)
            const visibleText = []
            while (walker.nextNode()) {
              const { textContent, parentElement } = walker.currentNode
              if (textContent.trim() && parentElement.checkVisibility() && !parentElement.closest('summary'))
                visibleText.push({ text: textContent.trim(), size: parseFloat(getComputedStyle(parentElement).fontSize) })
            }
            return visibleText
          })(),
          adviceWeight: weight('.personal-agent-proposal-advice'),
          chipWeight: weight('.personal-agent-preview-chip'),
          summaryWeight: weight('.personal-agent-preview-summary'),
          bubbleOverflow: bubble.scrollWidth > bubble.clientWidth + 1,
          cardOverflow: card.scrollWidth > card.clientWidth + 1,
          chipOverflow: chips.some(n => rect(n).right > rect(card).right - 1),
          controls: [...bubble.querySelectorAll('button, summary')].filter(n => n.checkVisibility()).every(n => rect(n).height >= 44),
          cardText: (() => {
            const chip = bubble.querySelector('.personal-agent-preview-chip')
            const label = chip?.querySelector('.personal-agent-preview-label')
            const value = chip?.querySelector('.personal-agent-preview-value')
            const summary = bubble.querySelector('.personal-agent-preview-summary')
            const cs = n => n ? getComputedStyle(n) : null
            const r = n => n?.getBoundingClientRect()
            return {
              sameRow: label && value ? Math.abs(r(label).top - r(value).top) < 2 : null,
              pairGap: label && value ? r(value).left - r(label).right : null,
              summaryColor: cs(summary)?.color,
              labelColor: cs(label)?.color,
              chipPadTop: parseFloat(cs(chip)?.paddingTop),
              chipGap: parseFloat(cs(chip)?.columnGap),
              chipRadius: parseFloat(cs(chip)?.borderTopLeftRadius),
              chipClipped: [...bubble.querySelectorAll('.personal-agent-preview-chip')].some(n => n.scrollWidth > n.clientWidth + 1)
            }
          })(),
          divider: (() => {
            const card = bubble.querySelector('.personal-agent-preview-card')
            const kids = card ? [...card.children] : []
            const dividers = kids.filter(n => n.classList.contains('openui-divider'))
            const cs = n => getComputedStyle(n)
            const r = n => n.getBoundingClientRect()
            // Gap between every adjacent pair of visible primitives.
            const visible = kids.filter(n => cs(n).display !== 'none')
            const gaps = []
            for (let i = 1; i < visible.length; i++) gaps.push(+(r(visible[i]).top - r(visible[i - 1]).bottom).toFixed(1))
            return {
              count: dividers.length,
              margins: dividers.map(n => [parseFloat(cs(n).marginTop), parseFloat(cs(n).marginBottom)]),
              gap: card ? parseFloat(cs(card).rowGap) : null,
              gaps,
              trailingHidden: dividers.length ? cs(dividers.at(-1)).display === 'none' : null,
              trailingIsLast: dividers.length ? dividers.at(-1) === kids.at(-1) : null,
            }
          })(),
        }
      })()`)
      assert.ok(!measured.error, `${theme}/${width}: ${measured.error}`)
      assert.ok(measured.confirmationGaps.every(gap => gap >= 0 && gap <= measured.paragraphSpacing + 1),
        `${theme}/${width}: Markdown gaps ${measured.confirmationGaps} exceed paragraph spacing ${measured.paragraphSpacing}px`)
      for (const [name, size] of [...measured.reading, ...measured.textNodes.map(n => [n.text, n.size])]) {
        assert.equal(size, measured.replySize, `${theme}/${width}: ${name} must match the plain reply`)
      }
      assert.equal(measured.moreSize, measured.labelSize, `${theme}/${width}: More uses the disclosure label size`)
      assert.ok(!measured.textNodes.some(n => /suggest(ed|ion)/i.test(n.text)), `${theme}/${width}: internal suggestion wording must not appear: ${JSON.stringify(measured.textNodes.map(n => n.text))}`)
      assert.ok(!measured.textNodes.some(n => /Dismissed|Expired|In progress|Completed|Outcome not confirmed|Read-only|No executable action|do not resend|do not repeat|Sandbox|Estimate expired|Result recorded|Next step/i.test(n.text)),
        `${theme}/${width}: state text must live in the capsule, not the bubble`)
      assert.equal(measured.bubbleOverflow, false, `${theme}/${width}: bubble overflows`)
      assert.equal(measured.cardOverflow, false, `${theme}/${width}: card overflows`)
      assert.equal(measured.chipOverflow, false, `${theme}/${width}: chip escapes card`)
      assert.equal(measured.controls, true, `${theme}/${width}: a control lost its touch target`)
      const t = measured.cardText
      assert.equal(t.sameRow, true, `${theme}/${width}: a chip split its label from its value`)
      assert.ok(t.pairGap >= 8, `${theme}/${width}: the label and value crowd each other (${t.pairGap}px)`)
      assert.equal(t.chipClipped, false, `${theme}/${width}: chip text is clipped`)
      assert.ok(t.chipPadTop >= t.chipGap, `${theme}/${width}: chip padding must clear its internal gap (${t.chipPadTop} < ${t.chipGap})`)
      assert.equal(t.summaryColor, t.labelColor, `${theme}/${width}: the summary must sit at the supporting label colour, not compete with advice`)
      if (theme !== 'pixel') {
        assert.ok(measured.adviceWeight > measured.chipWeight, `${theme}/${width}: advice needs weight priority`)
        assert.ok(measured.adviceWeight > measured.summaryWeight, `${theme}/${width}: advice leads the card summary`)
      }
      else assert.equal(measured.adviceWeight, 400, 'pixel keeps one weight and does not synthesize emphasis')
      // Divider spacing comes only from the card's named gap. No doubled margins,
      // and a trailing divider draws no orphan line.
      const d = measured.divider
      assert.ok(d.count >= 2, `${theme}/${width}: the composed card needs dividers to test spacing` )
      assert.ok(d.margins.every(([top, bottom]) => top === 0 && bottom === 0),
        `${theme}/${width}: a divider added margin that doubles the gap: ${JSON.stringify(d.margins)}`)
      assert.ok(d.gaps.every(gap => Math.abs(gap - d.gap) <= 1),
        `${theme}/${width}: every primitive gap must equal the named card gap ${d.gap}, got ${JSON.stringify(d.gaps)}`)
      assert.equal(d.trailingIsLast, true, `${theme}/${width}: the test tree ends with a divider`)
      assert.equal(d.trailingHidden, true, `${theme}/${width}: a trailing divider must not draw an orphan line`)
    }
  }
  console.log('PASS: recommendation and reply typography across 4 themes x 3 sizes')
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
