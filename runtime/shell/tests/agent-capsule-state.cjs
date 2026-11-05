// State text lives in the identity capsule, never inside a recommendation bubble.
// Real renderer: authoritative states, safety assertions and error detail remain
// reachable through the capsule's visible caption and accessible name.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-capsule-state-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })
const timer = setTimeout(() => app.exit(1), 90000)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const stamp = () => new Date().toISOString()
const full = { read: true, respond: true, acknowledge: true }
const readOnly = { read: true, respond: false, acknowledge: false }
let serial = 0
const base = extra => ({
  id: `${String(++serial).padStart(8, '0')}-1111-4111-8111-${String(serial).padStart(12, '0')}`,
  status: 'pending', offered: true, presented: true,
  advice: '通勤比平时多28分钟，建议打开计划查看安排。',
  preview: { summary: '通勤时长对比', items: [
    { label: '当前通勤（分钟）', value: '52', tone: 'warn' },
    { label: '平时通勤（分钟）', value: '24' } ] },
  // A small composable OpenUI tree that mirrors the legacy preview, so the ui path
  // renders the same neutral card and keeps bubble text at one 17px reading size.
  ui: { type: 'Suggestion', props: { children: [
    { type: 'Heading', props: { value: '通勤时长对比' } },
    { type: 'Reading', props: { label: '当前通勤（分钟）', value: '52', tone: 'warn' } },
    { type: 'Reading', props: { label: '平时通勤（分钟）', value: '24' } },
  ] } },
  nextStep: '打开计划', action: { tool: 'memory_update', params: { category: 'note', value: 'opened' } },
  confirmation: '记住 note：opened', createdAt: stamp(),
  evidence: [{ readingId: 'fixture', field: 'value', value: 1, state: 'live', measuredAt: stamp() }],
  ...extra
})

const cases = [
  { key: 'pending', expected: '', proposal: () => base(), capabilities: full },
  { key: 'dismissed', expected: 'Dismissed', proposal: () => base({ status: 'ignored' }), capabilities: full },
  { key: 'expired', expected: 'Expired', proposal: () => base({ status: 'expired' }), capabilities: full },
  { key: 'in-progress', expected: 'In progress', proposal: () => base({ status: 'executing' }), capabilities: full },
  { key: 'completed', expected: 'Completed', proposal: () => base({ status: 'completed' }), capabilities: full },
  { key: 'unknown', expected: 'Outcome not confirmed', proposal: () => base({ status: 'unknown' }), capabilities: full },
  { key: 'read-only', expected: 'Read-only preview', proposal: () => base(), capabilities: readOnly },
  { key: 'no-action', expected: 'No executable action', proposal: () => base({ action: null, confirmation: '' }), capabilities: full },
  { key: 'sandbox', expected: 'Sandbox preview', proposal: () => base({ preview: { ...base({}).preview, sandbox: true } }), capabilities: full },
  { key: 'estimate-expired', expected: 'Estimate expired', proposal: () => base({ preview: { ...base({}).preview, expiresAt: Date.now() - 1000 } }), capabilities: full },
]

const BANNED = [/suggest(ed|ion)/i, /Dismissed/i, /Expired/i, /In progress/i, /Completed/i,
  /Outcome not confirmed/i, /Read-only/i, /No executable action/i, /do not resend/i,
  /do not repeat/i, /Sandbox preview/i, /Estimate expired/i, /Result recorded/i,
  /Next step/i, /State unavailable/i, /Updates unavailable/i]

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
  await delay(250)

  const report = []
  for (const c of cases) {
    const built = c.proposal()
    win.webContents.send('odk-personal-agent-status', { state: 'idle', proposals: [], proposalCapabilities: c.capabilities })
    await delay(90)
    win.webContents.send('odk-personal-agent-status', { state: 'idle', proposals: [built], proposalCapabilities: c.capabilities })
    await delay(260)
    const measured = await run(`(() => {
      const bubble = document.querySelector('.agent-recommendation .agent-message-bubble')
      const capsule = document.querySelector('.agent-identity .agent-capsule')
      const stateNode = document.querySelector('.agent-state')
      const w = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT)
      const texts = []
      while (w.nextNode()) { const t = w.currentNode.textContent.trim(); if (t) texts.push(t) }
      const cap = capsule.getBoundingClientRect(), st = stateNode.getBoundingClientRect()
      return { texts, caption: stateNode.textContent, aria: capsule.getAttribute('aria-label'),
        capsuleHeight: Math.round(cap.height),
        oneLine: [document.querySelector('.agent-name'), stateNode].every(n => n.getBoundingClientRect().height <= parseFloat(getComputedStyle(n).lineHeight) + 1),
        sizes: [...new Set([...bubble.querySelectorAll('*')].filter(n => n.childNodes.length && [...n.childNodes].some(x => x.nodeType === 3 && x.textContent.trim())).map(n => parseFloat(getComputedStyle(n).fontSize)))] }
    })()`)
    const offenders = measured.texts.filter(t => BANNED.some(re => re.test(t)))
    assert.deepEqual(offenders, [], `${c.key}: state text must not appear in the bubble: ${JSON.stringify(measured.texts)}`)
    assert.ok(measured.caption.includes(c.expected), `${c.key}: capsule must name state ${c.expected}, got ${JSON.stringify(measured.caption)}`)
    assert.ok(measured.aria.includes(c.expected), `${c.key}: capsule accessible name must carry the state`)
    assert.ok(measured.capsuleHeight >= 44 && measured.capsuleHeight <= 84, `${c.key}: capsule height ${measured.capsuleHeight}`)
    assert.equal(measured.oneLine, true, `${c.key}: capsule text must stay one line`)
    assert.deepEqual(measured.sizes, [17], `${c.key}: bubble text must remain 17px`)
    report.push({ key: c.key, caption: measured.caption, aria: measured.aria, bubbleTexts: measured.texts })
    console.log('PASS', c.key, JSON.stringify({ caption: measured.caption, bubbleTexts: measured.texts.length }))
  }
  fs.writeFileSync('/tmp/odk-capsule-state-report.json', JSON.stringify(report, null, 2))
  console.log('PASS: state lives in the capsule, bubble holds content only')
  clearTimeout(timer); win.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
