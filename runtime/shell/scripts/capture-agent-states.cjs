const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { capturePaintedPage } = require('../tests/helpers/native-page-capture')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-modes-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })

// Evidence is disposable. Write to --out <dir>, or a temp directory by default.
const outIndex = process.argv.indexOf('--out')
const outDir = outIndex > -1 ? path.resolve(process.argv[outIndex + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'odk-agent-states-'))
fs.mkdirSync(outDir, { recursive: true })
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const signal = {
  id: '11111111-1111-4111-8111-000000000001',
  ruleId: 'commute-anomaly',
  status: 'pending',
  offered: true,
  presented: true,
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
  nextStep: '提前 15 分钟叫车（锁定平价）',
  createdAt: new Date().toISOString(),
  evidence: [{ readingId: 'commute.traffic', field: 'delay', value: 28, state: 'live', measuredAt: new Date().toISOString() }]
}

const reading = {
  id: '22222222-2222-4222-8222-000000000002',
  ruleId: 'ci-green',
  status: 'pending',
  offered: true,
  presented: true,
  advice: '主线验证全绿，建议部署至 CM5 实体参考机。',
  preview: {
    summary: 'main 分支 · Commit 1998604',
    items: [
      { label: '自动化验证', value: '116/116 passed', tone: 'good' },
      { label: 'Electron 套件', value: '6/6 pass', tone: 'good' },
      { label: '目标机', value: 'cm5' }
    ]
  },
  action: { tool: 'deploy_cm5', params: { commit: '1998604' } },
  confirmation: '确认部署当前版本到 CM5 参考机',
  nextStep: '一键部署到 CM5 参考宿主',
  createdAt: new Date().toISOString(),
  evidence: [{ readingId: 'ci.main', field: 'status', value: 'success', state: 'live', measuredAt: new Date().toISOString() }]
}

const readOnly = {
  id: '33333333-3333-4333-8333-000000000003',
  ruleId: 'weather-alert',
  status: 'pending',
  offered: true,
  presented: true,
  advice: '下午局部有雷阵雨并伴随降温，傍晚外出建议携带雨具。',
  preview: {
    items: [
      { label: '气温', value: '22°C' },
      { label: '降水概率', value: '80%', tone: 'warn' },
      { label: '湿度', value: '78%' }
    ]
  },
  action: null,
  confirmation: '',
  createdAt: new Date().toISOString(),
  evidence: [{ readingId: 'odk.tile.weather', field: 'temperatureC', value: 22, state: 'live', measuredAt: new Date().toISOString() }]
}

const completed = {
  id: '44444444-4444-4444-8444-000000000004',
  ruleId: 'dry-soil',
  status: 'completed',
  offered: true,
  presented: true,
  advice: '检测到绿萝盆土湿度偏低，已按你的偏好登记补水备忘。',
  result: '备忘已保存至个人记忆库。',
  completedAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  evidence: [{ readingId: 'odk.tile.hydra', field: 'soilPercent', value: 12, state: 'live', measuredAt: new Date().toISOString() }]
}

app.whenReady().then(async () => {
  for (const channel of [
    'odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight',
    'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame',
    'odk-app-manager-list', 'odk-personal-agent-status', 'odk-remote-publish-page-state',
    'odk-personal-agent-consumer-ready', 'odk-renderer-development-plugins', 'odk-remote-link-state'
  ]) ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [], state: 'disconnected', sequence: 0 }))
  ipcMain.handle('odk-personal-agent-text', () => ({ accepted: true }))
  ipcMain.handle('odk-personal-agent-proposal', () => ({ accepted: true }))

  const win = new BrowserWindow({
    show: false, width: 960, height: 640, useContentSize: true,
    webPreferences: {
      preload: path.resolve(__dirname, '../src/preload.js'),
      contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true
    }
  })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  const send = async status => { win.webContents.send('odk-personal-agent-status', status); await delay(180) }
  const viewport = async (w, h) => {
    win.setContentSize(w, h)
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
    await run(`window.dispatchEvent(new Event('resize')); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`)
    await delay(120)
  }
  win.webContents.debugger.attach('1.3')
  await delay(700)
  await viewport(480, 960)
  await run(`odkTheme.set('instrument'); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(r)))`)
  await delay(300)
  await send({ state: 'idle', proposals: [], proposalCapabilities: { read: true, respond: true, acknowledge: true } })

  const shot = async (name, { scroll = true } = {}) => {
    if (scroll) await run(`document.querySelector('.agent-conversation').scrollTop = document.querySelector('.agent-conversation').scrollHeight`)
    await delay(150)
    const rect = await run(`(() => { const r = document.getElementById('personal-agent').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })()`)
    const png = (await capturePaintedPage(win, rect)).toPNG()
    fs.writeFileSync(path.join(outDir, name), png)
    console.log('CAPTURED', name)
    return png
  }

  const results = []

  // M1 voice composer
  await send({ state: 'idle', proposals: [], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  results.push({ mode: 'M1', file: 'mode-1-voice-idle.png', png: await shot('mode-1-voice-idle.png') })

  // M2 keyboard draft
  await run(`(() => { const c = document.querySelector('.agent-composer'); if (c.dataset.mode !== 'keyboard') c.querySelector('.agent-keys').click(); const t = c.querySelector('textarea'); t.value = '帮我看看今天晚上几点出门合适'; t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await delay(150)
  results.push({ mode: 'M2', file: 'mode-2-keyboard-draft.png', png: await shot('mode-2-keyboard-draft.png') })
  await run(`(() => { const t = document.querySelector('.agent-composer textarea'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })) })()`)

  // M3 anomaly recommendation with tone
  await send({ state: 'idle', proposals: [signal], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  results.push({ mode: 'M3', file: 'mode-3-recommendation-tone.png', png: await shot('mode-3-recommendation-tone.png') })

  // M4 confirmation
  await run(`document.querySelector('[data-proposal-action="execute"]')?.click()`)
  await delay(150)
  results.push({ mode: 'M4', file: 'mode-4-confirmation.png', png: await shot('mode-4-confirmation.png') })

  // M5 executing
  await run(`document.querySelector('[data-proposal-action="confirm"]')?.click()`)
  await delay(200)
  results.push({ mode: 'M5', file: 'mode-5-executing.png', png: await shot('mode-5-executing.png') })

  // M6 completed + feedback
  await send({ state: 'idle', proposals: [completed], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await delay(120)
  results.push({ mode: 'M6', file: 'mode-6-completed.png', png: await shot('mode-6-completed.png') })

  // M7 read-only actionless
  await send({ state: 'idle', proposals: [readOnly], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  results.push({ mode: 'M7', file: 'mode-7-read-only.png', png: await shot('mode-7-read-only.png') })

  // M8 good tone / engineering
  await send({ state: 'idle', proposals: [reading], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  results.push({ mode: 'M8', file: 'mode-8-positive-tone.png', png: await shot('mode-8-positive-tone.png') })

  // M9-M11 other themes
  for (const [theme, name] of [['pixel', 'mode-9-pixel-theme.png'], ['border-beam', 'mode-10-border-beam.png'], ['liquid-glass', 'mode-11-liquid-glass.png']]) {
    await run(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(r)))`)
    await delay(250)
    await send({ state: 'idle', proposals: [{ ...signal, id: `66666666-6666-4666-8666-00000000000${results.length}` }], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
    results.push({ mode: theme, file: name, png: await shot(name) })
  }

  // M12 narrow 320x480 with active overlay
  await run(`odkTheme.set('instrument')`)
  await viewport(320, 480)
  await run(`(() => { const c = document.querySelector('.agent-composer'); const t = c.querySelector('textarea'); if (t) { t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })) } })()`)
  const many = Array.from({ length: 3 }, (_, i) => ({ ...signal, id: `55555555-5555-4555-8555-00000000000${i}` }))
  await send({ state: 'idle', proposals: many, proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await run(`document.querySelector('.agent-conversation').scrollTop = 0`)
  await delay(300)
  results.push({ mode: 'M12', file: 'mode-12-narrow-overlay.png', png: await shot('mode-12-narrow-overlay.png', { scroll: false }) })

  // Comparison matrix
  const toUrl = png => 'data:image/png;base64,' + png.toString('base64')
  const cells = [
    ['M1 语音输入态', results[0]], ['M2 键盘草稿态', results[1]],
    ['M3 异常推荐（warn 色调）', results[2]], ['M4 原地二次确认', results[3]],
    ['M5 执行中防重放', results[4]], ['M6 已完成（无评分控件）', results[5]],
    ['M7 只读建议（无动作）', results[6]], ['M8 正向读数（good 色调）', results[7]],
    ['M9 Pixel 主题', results[8]], ['M10 Border Beam 主题', results[9]],
    ['M11 Liquid Glass 主题', results[10]], ['M12 320px 窄屏 + 悬浮避让', results[11]]
  ]
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;width:1420px;height:1180px;padding:24px;display:flex;flex-direction:column;gap:14px}
    header{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #27272a;padding-bottom:12px}
    h1{font-size:20px;font-weight:700;letter-spacing:-.02em}
    header p{font-size:12px;color:#a1a1aa}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;flex:1;min-height:0}
    .cell{background:#0d0d0f;border:1px solid #27272a;border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px;overflow:hidden}
    .cap{font-size:11px;font-weight:600;color:#e4e4e7;letter-spacing:.01em}
    .box{flex:1;min-height:0;border-radius:8px;overflow:hidden;border:1px solid #1b1b1e;background:#000;display:flex;align-items:center;justify-content:center}
    .box img{width:100%;height:100%;object-fit:contain;object-position:top}
  </style></head><body>
  <header><h1>Open DeskOS · Personal Agent 全模式矩阵</h1><p>12 modes · after overlay-avoidance and state-tone fixes</p></header>
  <div class="grid">${cells.map(([cap, r]) => `<div class="cell"><div class="cap">${cap}</div><div class="box"><img src="${toUrl(r.png)}"/></div></div>`).join('')}</div>
  </body></html>`
  const matrixPath = path.join(profile, 'matrix.html')
  fs.writeFileSync(matrixPath, html)
  const winGrid = new BrowserWindow({ show: false, width: 1420, height: 1180, useContentSize: true, webPreferences: { contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false } })
  await winGrid.loadFile(matrixPath)
  await delay(500)
  fs.writeFileSync(path.join(outDir, 'mode-matrix-all.png'), (await capturePaintedPage(winGrid)).toPNG())
  console.log('CAPTURED mode-matrix-all.png')
  console.log('OUT_DIR ' + outDir)

  win.destroy(); winGrid.destroy(); app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })