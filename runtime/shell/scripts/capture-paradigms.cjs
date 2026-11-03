// Renders each case from a real Agent-path corpus, not hand-written cards.
// Usage: electron scripts/capture-paradigms.cjs --corpus <json> --out <dir>
// Corpus: { rounds: [{ round, proposals: [{ topic, advice, preview, nextStep, probability, grounding }] }] }
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { capturePaintedPage } = require('../tests/helpers/native-page-capture')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-paradigm-cases-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index > -1 ? path.resolve(process.argv[index + 1]) : fallback
}
const corpusPath = arg('--corpus', '/tmp/odk-agent-path-live.json')
const outDir = arg('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'odk-paradigm-cases-')))
fs.mkdirSync(outDir, { recursive: true })
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'))
const rounds = corpus.rounds ?? []
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const CASE_NAMES = {
  'commute-anomaly': 'P1 · 异常差值',
  'commitment-guard': 'P3 · 时限守卫',
  'commute-tradeoff': 'P4 · 权衡对冲',
  'release-pipeline': 'P2 · 流水线推进',
}

const proposalFor = (row, index) => ({
  id: `${String(index).padStart(8, '0')}-1111-4111-8111-${String(index).padStart(12, '0')}`,
  status: 'pending', offered: true, presented: true,
  advice: row.advice,
  ...(row.preview ? { preview: row.preview } : {}),
  nextStep: row.nextStep || '打开计划',
  action: { tool: 'memory_update', params: { category: 'note', value: 'opened' } },
  confirmation: '记住 note：opened',
  createdAt: new Date().toISOString(),
  evidence: [{ readingId: 'fixture', field: 'value', value: 1, state: 'live', measuredAt: new Date().toISOString() }],
})

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
    show: false, width: 480, height: 1100, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true }
  })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  await delay(900)
  await run(`odkTheme.set('instrument'); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(r)))`)
  await delay(300)

  const capabilities = { read: true, respond: true, acknowledge: true }
  const shots = []
  for (const round of rounds) {
    // Only a candidate that passed the host gates may appear as a published message.
    // A rejected round is an honest empty state, with its scores shown in the matrix.
    const proposals = (round.proposals ?? []).filter(p => p.pass === true).map(proposalFor)
    const topics = round.topics ?? (corpus.cases?.[round.round - 1]?.topics) ?? [...new Set((round.proposals ?? []).map(p => p.topic))]
    const label = CASE_NAMES[round.proposals?.[0]?.topic] || CASE_NAMES[topics[0]] || `Case ${round.round}`
    await win.webContents.send('odk-personal-agent-status', { state: 'idle', proposals: [], proposalCapabilities: capabilities })
    await delay(180)
    await win.webContents.send('odk-personal-agent-status', { state: 'idle', proposals, proposalCapabilities: capabilities })
    await delay(320)
    await run(`(() => { const c = document.querySelector('.agent-conversation'); c.scrollTop = 0; const b = document.querySelector('.agent-latest'); if (b) b.hidden = true })()`)
    await delay(150)
    const rect = await run(`(() => { const r = document.getElementById('personal-agent').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })()`)
    const png = (await capturePaintedPage(win, rect)).toPNG()
    const file = `case-${round.round}-${(topics[0] || 'empty').replace(/[^a-z0-9-]/gi, '-')}.png`
    fs.writeFileSync(path.join(outDir, file), png)
    console.log('CAPTURED', file, `(${proposals.length} shown)`)
    const scores = (round.proposals ?? []).map(p => `p=${Number(p.probability).toFixed(2)} g=${Number(p.grounding).toFixed(2)}${p.pass === true ? '' : ' · below threshold'}`).join(' · ')
    shots.push({ label, file, topics, scores, count: proposals.length, png })
  }

  const url = png => 'data:image/png;base64,' + png.toString('base64')
  const height = 240 + Math.ceil(shots.length / 2) * 620
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;width:1080px;height:${height}px;padding:22px;display:flex;flex-direction:column;gap:14px}
    header{border-bottom:1px solid #27272a;padding-bottom:12px}
    h1{font-size:19px;font-weight:700;letter-spacing:-.02em}
    header p{font-size:12px;color:#a1a1aa;margin-top:4px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;min-height:0}
    .cell{background:#0d0d0f;border:1px solid #27272a;border-radius:12px;padding:11px;display:flex;flex-direction:column;gap:7px;overflow:hidden}
    .cap{font-size:13px;font-weight:700}
    .desc{font-size:11px;line-height:1.4;color:#8b8b93;min-height:32px}
    .box{flex:1;min-height:0;border-radius:8px;overflow:hidden;border:1px solid #1b1b1e;background:#000;display:flex;align-items:center;justify-content:center}
    .box img{width:100%;height:100%;object-fit:contain;object-position:top}
    .empty{color:#f59e0b}
  </style></head><body>
  <header><h1>Personal Agent · 真实 Agent 路径各 Case</h1><p>${rounds.length} cases · createPersonalAgent → 真实 ephemeral Durable 会话 → 工具可见 → 宿主 Jev 资格判定 · corpus: ${path.basename(corpusPath)}</p></header>
  <div class="grid">${shots.map(s => `<div class="cell"><div class="cap">${s.label}</div><div class="desc ${s.count ? '' : 'empty'}">${s.count ? `${s.count} 条发布 · ${s.scores}` : '无发布（宿主门槛未通过）'} · ${s.topics.join(', ') || '—'}</div><div class="box"><img src="${url(s.png)}"/></div></div>`).join('')}</div>
  </body></html>`
  const matrixPath = path.join(profile, 'cases.html')
  fs.writeFileSync(matrixPath, html)
  const grid = new BrowserWindow({ show: false, width: 1080, height, useContentSize: true, webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } })
  await grid.loadFile(matrixPath)
  await delay(500)
  fs.writeFileSync(path.join(outDir, 'agent-cases-matrix.png'), (await capturePaintedPage(grid)).toPNG())
  console.log('CAPTURED agent-cases-matrix.png')
  console.log('OUT_DIR ' + outDir)

  win.destroy(); grid.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
