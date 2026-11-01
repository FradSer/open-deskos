// Captures the revised four-paradigm comparison for Information Value review.
// Two strongest paradigms are retained; the fact-echo and precomputed-audit paradigms
// are replaced by a deadline guard and a trade-off choice.
const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { capturePaintedPage } = require('../tests/helpers/native-page-capture')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-paradigms-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })
const outDir = path.resolve(__dirname, '../../../screenshots')
fs.mkdirSync(outDir, { recursive: true })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const stamp = () => new Date().toISOString()
const base = extra => ({
  status: 'pending', offered: true, presented: true, createdAt: stamp(),
  evidence: [{ readingId: 'fixture.reading', field: 'value', value: 1, state: 'live', measuredAt: stamp() }],
  ...extra
})

const paradigms = [
  {
    file: 'p2-anomaly-delta.png',
    headline: 'P1 · 情境异常与利害差值',
    body: '多源联合推断（路况 + 降水 + 时间 + 价格），只报“偏离基线”的差值，并给出避险动作。',
    proposal: base({
      id: '22222222-2222-4222-8222-000000000002',
      ruleId: 'commute-anomaly',
      advice: '18:30 晚高峰中雨将至，望京东路严重拥堵（预计耗时 +28min）。',
      preview: {
        summary: '理想中心（公司） → 静安里（家）',
        items: [
          { label: '预计耗时', value: '52min (+28m)', tone: 'warn' },
          { label: '中雨到达', value: '18:15 (80%)', tone: 'warn' },
          { label: '特惠快车', value: '约 32 元' },
          { label: '雨后预计', value: '约 58 元' }
        ]
      },
      action: { tool: 'taxi_quote', params: { from: 'office', to: 'home' } },
      confirmation: '确认提前呼叫特惠快车',
      nextStep: '提前 15 分钟叫车（锁定平价）'
    })
  },
  {
    file: 'p2-pipeline-advance.png',
    headline: 'P2 · 工程流水线推进',
    body: '把“验证已完成”变成可执行的下一步：证据矩阵 + 一步部署，消除终端切换。',
    proposal: base({
      id: '33333333-3333-4333-8333-000000000003',
      ruleId: 'ci-green',
      advice: 'open-deskos 主线验证全绿，建议部署至 CM5 实体参考机。',
      preview: {
        summary: 'main 分支 · Commit 1998604',
        items: [
          { label: '自动化验证', value: '116/116 passed', tone: 'good' },
          { label: 'Electron 套件', value: '6/6 pass', tone: 'good' },
          { label: '样式产物', value: 'uno.css −2KB' },
          { label: '目标机', value: 'cm5' }
        ]
      },
      action: { tool: 'deploy_cm5', params: { commit: '1998604' } },
      confirmation: '确认部署当前版本到 CM5 参考机',
      nextStep: '一键部署到 CM5 参考宿主'
    })
  },
  {
    file: 'p2-deadline-guard.png',
    headline: 'P3 · 时限承诺守卫（新增）',
    body: '只在“剩余缓冲”跌破通勤时间时开口；把时间账算给你看，动作只有一个。',
    proposal: base({
      id: '55555555-5555-4555-8555-000000000005',
      ruleId: 'commitment-guard',
      advice: '14:00 产品评审就要开始，你必须在 12 分钟内出发。',
      preview: {
        summary: '14:00 产品评审 · 12:48 现在',
        items: [
          { label: '剩余缓冲', value: '12min', tone: 'warn' },
          { label: '通勤耗时', value: '34min' },
          { label: '当前路况', value: '中雨 · +9min', tone: 'warn' },
          { label: '预计抵达', value: '13:22' }
        ]
      },
      action: { tool: 'open_navigation', params: { destination: '会议中心' } },
      confirmation: '确认现在出发并打开导航',
      nextStep: '现在出发并打开导航'
    })
  },
  {
    file: 'p2-tradeoff-choice.png',
    headline: 'P4 · 权衡对冲（新增）',
    body: '两个互斥方案并列，显式给出“省时间 vs 多花钱”的兑换率，动作即选定方案。',
    proposal: base({
      id: '66666666-6666-4666-8666-000000000006',
      ruleId: 'tradeoff',
      advice: '现在走省 26 元但要堵 28 分钟；等 40 分钟后只堵 9 分钟。',
      preview: {
        summary: '兑换率：省 19 分钟 ≈ 多付 26 元',
        items: [
          { label: '现在出发', value: '¥32 · 堵 28min', tone: 'warn' },
          { label: '等 40 分钟', value: '¥58 · 堵 9min' },
          { label: '历史均价', value: '¥34' },
          { label: '雨天溢价', value: '1.7×', tone: 'warn' }
        ]
      },
      action: { tool: 'taxi_quote', params: { when: 'now' } },
      confirmation: '确认按当前方案叫车（¥32）',
      nextStep: '现在出发（¥32）'
    })
  }
]

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
    show: false, width: 480, height: 900, useContentSize: true,
    webPreferences: {
      preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true,
      backgroundThrottling: false, offscreen: true
    }
  })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  await delay(900)
  await run(`odkTheme.set('instrument'); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(r)))`)
  await delay(300)
  win.webContents.send('odk-personal-agent-status', { state: 'idle', proposals: [], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await delay(250)

  const shots = []
  for (const paradigm of paradigms) {
    win.webContents.send('odk-personal-agent-status', { state: 'idle', proposals: [paradigm.proposal], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
    await delay(320)
    await run(`(() => { const c = document.querySelector('.agent-conversation'); c.scrollTop = c.scrollHeight; const b = document.querySelector('.agent-latest'); if (b) b.hidden = true })()`)
    await delay(150)
    const rect = await run(`(() => { const r = document.getElementById('personal-agent').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })()`)
    const png = (await capturePaintedPage(win, rect)).toPNG()
    fs.writeFileSync(path.join(outDir, paradigm.file), png)
    console.log('CAPTURED', paradigm.file)
    shots.push({ ...paradigm, png })
  }

  const url = png => 'data:image/png;base64,' + png.toString('base64')
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;width:1200px;height:1020px;padding:22px;display:flex;flex-direction:column;gap:14px}
    header{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #27272a;padding-bottom:12px}
    h1{font-size:19px;font-weight:700;letter-spacing:-.02em}
    header p{font-size:12px;color:#a1a1aa}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;flex:1;min-height:0}
    .cell{background:#0d0d0f;border:1px solid #27272a;border-radius:12px;padding:11px;display:flex;flex-direction:column;gap:7px;overflow:hidden}
    .cap{font-size:12px;font-weight:700;color:#fafafa}
    .desc{font-size:11px;line-height:1.4;color:#8b8b93;min-height:30px}
    .box{flex:1;min-height:0;border-radius:8px;overflow:hidden;border:1px solid #1b1b1e;background:#000;display:flex;align-items:center;justify-content:center}
    .box img{width:100%;height:100%;object-fit:contain;object-position:top}
  </style></head><body>
  <header><h1>Personal Agent · Information Value Paradigms（第二版）</h1><p>4 paradigms · fact-echo and precomputed-audit dropped; deadline guard and trade-off added</p></header>
  <div class="grid">${shots.map(s => `<div class="cell"><div class="cap">${s.headline}</div><div class="desc">${s.body}</div><div class="box"><img src="${url(s.png)}"/></div></div>`).join('')}</div>
  </body></html>`
  const matrixPath = path.join(profile, 'paradigms.html')
  fs.writeFileSync(matrixPath, html)
  const grid = new BrowserWindow({ show: false, width: 1200, height: 1020, useContentSize: true, webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } })
  await grid.loadFile(matrixPath)
  await delay(500)
  fs.writeFileSync(path.join(outDir, 'paradigms-v2-matrix.png'), (await capturePaintedPage(grid)).toPNG())
  console.log('CAPTURED paradigms-v2-matrix.png')

  win.destroy(); grid.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })