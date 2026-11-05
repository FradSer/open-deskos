// One 17px reading size for every visible text inside a recommendation message bubble.
// iOS-style hierarchy comes from weight and colour, not a second size.
// The pending "Suggested" label is gone; authoritative states and safety text remain.
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

const READING = ['.agent-message-body', '.personal-agent-proposal', '.personal-agent-proposal-advice',
  '.personal-agent-preview-card', '.personal-agent-preview-summary', '.personal-agent-preview-chip',
  '.personal-agent-preview-label', '.personal-agent-preview-value',
  '.personal-agent-proposal-next-step', '.personal-agent-proposal-primary', '.personal-agent-proposal-secondary']
// These state nodes no longer exist inside a bubble; the capsule owns them.
const CAPTION = ['.personal-agent-proposal-state', '.personal-agent-proposal-next-label',
  '.personal-agent-proposal-capability', '.personal-agent-preview-notice']

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
  await delay(800)
  await run(`odkTheme.set('instrument'); document.fonts.ready`)
  win.webContents.send('odk-personal-agent-status', { state: 'idle', proposals: [proposal], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await delay(400)

  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    await run(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready`)
    for (const [width, height] of [[320, 480], [480, 854], [1920, 1280]]) {
      win.setContentSize(width, height)
      await delay(120)
      const measured = await run(`(() => {
        const bubble = document.querySelector('.agent-recommendation .agent-message-bubble')
        if (!bubble) return { error: 'no bubble' }
        const card = bubble.querySelector('.personal-agent-preview-card')
        const chips = [...bubble.querySelectorAll('.personal-agent-preview-chip')]
        const size = sel => { const n = bubble.querySelector(sel); return n ? parseFloat(getComputedStyle(n).fontSize) : null }
        const weight = sel => { const n = bubble.querySelector(sel); return n ? parseFloat(getComputedStyle(n).fontWeight) : null }
        const rect = n => n.getBoundingClientRect()
        return {
          reading: ${JSON.stringify(READING)}.map(sel => [sel, size(sel)]),
          caption: ${JSON.stringify(CAPTION)}.map(sel => [sel, size(sel)]),
          textNodes: (() => { const w = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT); const out = []; while (w.nextNode()) { const t = w.currentNode.textContent.trim(); if (t) out.push({ text: t, size: parseFloat(getComputedStyle(w.currentNode.parentElement).fontSize) }) } return out })(),
          adviceWeight: weight('.personal-agent-proposal-advice'),
          chipWeight: weight('.personal-agent-preview-chip'),
          summaryWeight: weight('.personal-agent-preview-summary'),
          bubbleOverflow: bubble.scrollWidth > bubble.clientWidth + 1,
          cardOverflow: card.scrollWidth > card.clientWidth + 1,
          chipOverflow: chips.some(n => rect(n).right > rect(card).right - 1),
          controls: [...bubble.querySelectorAll('button')].every(n => rect(n).height >= 44),
          cardText: (() => {
            const chip = bubble.querySelector('.personal-agent-preview-chip')
            const label = chip?.querySelector('.personal-agent-preview-label')
            const value = chip?.querySelector('.personal-agent-preview-value')
            const summary = bubble.querySelector('.personal-agent-preview-summary')
            const cs = n => n ? getComputedStyle(n) : null
            const r = n => n?.getBoundingClientRect()
            return {
              sameRow: label && value ? Math.abs(r(label).top - r(value).top) < 2 : null,
              valueNowrap: cs(value)?.whiteSpace === 'nowrap',
              pairGap: label && value ? r(value).left - r(label).right : null,
              summaryColor: cs(summary)?.color,
              labelColor: cs(label)?.color,
              chipPadTop: parseFloat(cs(chip)?.paddingTop),
              chipGap: parseFloat(cs(chip)?.columnGap),
              chipRadius: parseFloat(cs(chip)?.borderTopLeftRadius),
              chipClipped: [...bubble.querySelectorAll('.personal-agent-preview-chip')].some(n => n.scrollWidth > n.clientWidth + 1)
            }
          })(),
          token: parseFloat(getComputedStyle(bubble).getPropertyValue('--agent-text-body')) || parseFloat(getComputedStyle(document.querySelector('.agent-panel')).getPropertyValue('--agent-text-body')),
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
      const reading = measured.reading.filter(([, value]) => value !== null)
      const captions = measured.caption.filter(([, value]) => value !== null)
      const sizes = [...new Set([...reading, ...captions, ...measured.textNodes.map(n => [null, n.size])].map(([, value]) => value))]
      assert.equal(sizes.length, 1, `${theme}/${width}: every visible text must be one size, got ${JSON.stringify({ reading: measured.reading, caption: measured.caption, textNodes: measured.textNodes })}`)
      assert.equal(sizes[0], 17, `${theme}/${width}: the reading size must be 17px like iOS body text`)
      assert.equal(sizes[0], measured.token, `${theme}/${width}: reading size must equal the body token ${measured.token}`)
      assert.ok(!measured.textNodes.some(n => /suggest(ed|ion)/i.test(n.text)), `${theme}/${width}: internal suggestion wording must not appear: ${JSON.stringify(measured.textNodes.map(n => n.text))}`)
      assert.ok(!measured.textNodes.some(n => /Dismissed|Expired|In progress|Completed|Outcome not confirmed|Read-only|No executable action|do not resend|do not repeat|Sandbox|Estimate expired|Result recorded|Next step/i.test(n.text)),
        `${theme}/${width}: state text must live in the capsule, not the bubble`)
      assert.equal(measured.bubbleOverflow, false, `${theme}/${width}: bubble overflows`)
      assert.equal(measured.cardOverflow, false, `${theme}/${width}: card overflows`)
      assert.equal(measured.chipOverflow, false, `${theme}/${width}: chip escapes card`)
      assert.equal(measured.controls, true, `${theme}/${width}: a control lost its touch target`)
      const t = measured.cardText
      assert.equal(t.sameRow, true, `${theme}/${width}: a chip split its label from its value`)
      assert.equal(t.valueNowrap, true, `${theme}/${width}: a measured value can wrap away from its unit`)
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
  console.log('PASS: one reading size across 4 themes x 3 sizes')
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
