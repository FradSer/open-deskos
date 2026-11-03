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
  advice: '通勤比平时多28分钟，且傍晚有降雨风险，建议现在就打开计划调整出发时间。',
  preview: { summary: '通勤时长与常态对比', items: [
    { label: '当前通勤（分钟）', value: '52', tone: 'warn' },
    { label: '平时通勤（分钟）', value: '24' },
    { label: '延误（分钟）', value: '28', tone: 'warn' } ] },
  action: { tool: 'memory_update', params: { category: 'note', value: 'opened' } },
  confirmation: '记住 note：opened', nextStep: '打开计划',
  createdAt: new Date().toISOString(),
  evidence: [{ readingId: 'commute.traffic', field: 'minutes', value: 52, state: 'live', measuredAt: new Date().toISOString() }]
}

const READING = ['.agent-message-body', '.personal-agent-proposal', '.personal-agent-proposal-advice',
  '.personal-agent-preview-card', '.personal-agent-preview-summary', '.personal-agent-preview-chip',
  '.personal-agent-preview-label', '.personal-agent-preview-value',
  '.personal-agent-proposal-next-step', '.personal-agent-proposal-primary', '.personal-agent-proposal-secondary']
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
          token: parseFloat(getComputedStyle(bubble).getPropertyValue('--agent-text-body')) || parseFloat(getComputedStyle(document.querySelector('.agent-panel')).getPropertyValue('--agent-text-body'))
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
      assert.equal(measured.bubbleOverflow, false, `${theme}/${width}: bubble overflows`)
      assert.equal(measured.cardOverflow, false, `${theme}/${width}: card overflows`)
      assert.equal(measured.chipOverflow, false, `${theme}/${width}: chip escapes card`)
      assert.equal(measured.controls, true, `${theme}/${width}: a control lost its touch target`)
      if (theme !== 'pixel') {
        assert.ok(measured.adviceWeight > measured.chipWeight, `${theme}/${width}: advice needs weight priority`)
        assert.ok(measured.adviceWeight > measured.summaryWeight, `${theme}/${width}: advice leads the card summary`)
      }
      else assert.equal(measured.adviceWeight, 400, 'pixel keeps one weight and does not synthesize emphasis')
    }
  }
  console.log('PASS: one reading size across 4 themes x 3 sizes')
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
