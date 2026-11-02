// Renders the same live-generated candidate set at two Jev thresholds so the
// difference is a picture, not a number.
// Usage: electron scripts/capture-threshold-compare.cjs --corpus <json> --out <dir>
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { capturePaintedPage } = require('../tests/helpers/native-page-capture')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-threshold-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index > -1 ? path.resolve(process.argv[index + 1]) : fallback
}
const corpusPath = arg('--corpus', '/tmp/odk-threshold-corpus.json')
const outDir = arg('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'odk-threshold-out-')))
fs.mkdirSync(outDir, { recursive: true })
const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'))
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const proposalFor = (row, index) => ({
  id: `${String(index).padStart(8, '0')}-1111-4111-8111-${String(index).padStart(12, '0')}`,
  status: 'pending',
  offered: true,
  presented: true,
  advice: row.advice,
  ...(row.preview ? { preview: row.preview } : {}),
  nextStep: row.nextStep || 'Open the plan',
  action: { tool: 'memory_update', params: { category: 'note', value: 'opened' } },
  confirmation: '记住 note：opened',
  createdAt: new Date().toISOString(),
  evidence: [{ readingId: 'fixture', field: 'value', value: 1, state: 'live', measuredAt: new Date().toISOString() }]
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
    show: false, width: 480, height: 2000, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true }
  })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  await delay(900)
  await run(`odkTheme.set('instrument'); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(r)))`)
  await delay(300)

  const send = async status => { win.webContents.send('odk-personal-agent-status', status); await delay(220) }
  const shot = async name => {
    await run(`(() => { document.querySelector('.agent-conversation').scrollTop = 0; const b = document.querySelector('.agent-latest'); if (b) b.hidden = true })()`)
    await delay(180)
    const rect = await run(`(() => { const r = document.getElementById('personal-agent').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })()`)
    const png = (await capturePaintedPage(win, rect)).toPNG()
    fs.writeFileSync(path.join(outDir, name), png)
    console.log('CAPTURED', name)
    return png
  }

  // Group by generation round: one round is what the owner would face at one moment.
  const rounds = [...new Set(corpus.map(row => row.run))].sort((a, b) => a - b)
  const panels = []
  for (const threshold of [0.8, 0.7]) {
    for (const round of rounds) {
      const candidates = corpus.filter(row => row.run === round)
      const passing = candidates.filter(row => row.probability >= threshold && row.grounding >= threshold)
      await send({ state: 'idle', proposals: [], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
      await send({ state: 'idle', proposals: passing.map(proposalFor), proposalCapabilities: { read: true, respond: true, acknowledge: true } })
      const name = `threshold-${String(threshold).replace('.', '')}-run-${round}.png`
      const png = await shot(name)
      panels.push({ threshold, round, pass: passing.length, total: candidates.length, name, png })
    }
  }

  // A single frame per threshold using the round with the widest gap.
  const gap = threshold => {
    const rows = rounds.map(r => panels.find(p => p.threshold === threshold && p.round === r))
    return rows.reduce((best, row) => (row.pass - (row.total - row.pass) > best.pass - (best.total - best.pass) ? row : best), rows[0])
  }
  const best08 = gap(0.8)
  const best07 = gap(0.7)

  const url = png => 'data:image/png;base64,' + png.toString('base64')
  const totals = threshold => ({ pass: corpus.filter(r => r.probability >= threshold && r.grounding >= threshold).length })
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;width:1080px;height:2090px;padding:22px;display:flex;flex-direction:column;gap:14px}
    header{border-bottom:1px solid #27272a;padding-bottom:12px}
    h1{font-size:19px;font-weight:700;letter-spacing:-.02em}
    header p{font-size:12px;color:#a1a1aa;margin-top:4px}
    .panes{display:grid;grid-template-columns:1fr 1fr;gap:18px;flex:1;min-height:0}
    .pane{background:#0d0d0f;border:1px solid #27272a;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:9px;overflow:hidden}
    .top{display:flex;align-items:center;justify-content:space-between}
    .badge{font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px}
    .a{background:#18181b;color:#e4e4e7;border:1px solid #3f3f46}
    .b{background:#1e293b;color:#60a5fa;border:1px solid #2563eb}
    .stat{font-size:12px;color:#a1a1aa;font-variant-numeric:tabular-nums}
    .frame{flex:1;min-height:0;border-radius:8px;overflow:hidden;border:1px solid #1b1b1e;background:#000;display:flex;align-items:center;justify-content:center}
    .frame img{width:100%;height:100%;object-fit:contain;object-position:top}
  </style></head><body>
  <header><h1>Jev 阈值 0.8 与 0.7：同一批真实生成候选，用户看到的差别</h1>
    <p>16 candidates from 4 live model rounds · judged by live Jev · threshold ${'0.8'} keeps ${totals(0.8).pass}/16 · threshold 0.7 keeps ${totals(0.7).pass}/16</p></header>
  <div class="panes">
    <div class="pane"><div class="top"><span class="badge a">阈值 0.80</span><span class="stat">这一轮 ${best08.pass}/${best08.total} 条可见</span></div><div class="frame"><img src="${url(best08.png)}"/></div></div>
    <div class="pane"><div class="top"><span class="badge b">阈值 0.70</span><span class="stat">这一轮 ${best07.pass}/${best07.total} 条可见</span></div><div class="frame"><img src="${url(best07.png)}"/></div></div>
  </div>
  </body></html>`
  const matrixHtml = path.join(profile, 'compare.html')
  fs.writeFileSync(matrixHtml, html)
  const grid = new BrowserWindow({ show: false, width: 1080, height: 2090, useContentSize: true, webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } })
  await grid.loadFile(matrixHtml)
  await delay(450)
  fs.writeFileSync(path.join(outDir, 'threshold-compare.png'), (await capturePaintedPage(grid)).toPNG())
  console.log('CAPTURED threshold-compare.png')

  console.log('\nSUMMARY threshold pass/16')
  for (const t of [0.8, 0.7, 0.6]) console.log(`  ${t} → ${corpus.filter(r => r.probability >= t && r.grounding >= t).length}`)
  console.log('OUT_DIR', outDir)
  win.destroy(); grid.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })