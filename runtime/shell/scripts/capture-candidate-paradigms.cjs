const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { capturePaintedPage } = require('../tests/helpers/native-page-capture')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-candidates-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })

const outDir = path.resolve(__dirname, '../../../screenshots')
fs.mkdirSync(outDir, { recursive: true })

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  for (const channel of [
    'odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status',
    'odk-weread-highlight', 'odk-futu-holdings', 'odk-weather-status',
    'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list',
    'odk-personal-agent-status', 'odk-remote-publish-page-state',
    'odk-personal-agent-consumer-ready', 'odk-renderer-development-plugins',
    'odk-remote-link-state'
  ]) {
    ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [], state: 'disconnected', sequence: 0 }))
  }
  ipcMain.handle('odk-personal-agent-text', (_event, text) => ({ accepted: true }))
  ipcMain.handle('odk-personal-agent-proposal', (_event, command) => ({ accepted: true }))

  const win = new BrowserWindow({
    show: false, width: 960, height: 640, useContentSize: true,
    webPreferences: {
      preload: path.resolve(__dirname, '../src/preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true
    }
  })

  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  const send = async status => { win.webContents.send('odk-personal-agent-status', status); await delay(150) }

  await delay(500)
  await run(`odkTheme.set('instrument'); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(r)))`)
  await delay(200)

  const captureAgent = async filename => {
    const rect = await run(`(() => {
      const el = document.getElementById('personal-agent');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    })()`)
    const img = await capturePaintedPage(win, rect)
    const filePath = path.join(outDir, filename)
    fs.writeFileSync(filePath, img.toPNG())
    console.log(`CAPTURED: ${filePath}`)
    return filePath
  }

  // --- Candidate 1: Current "Fact Echo" (现状：事实回声型，低信息价值) ---
  const candidate1 = {
    id: '11111111-1111-4111-8111-000000000001',
    ruleId: 'soil-echo',
    status: 'pending',
    offered: true,
    presented: true,
    advice: '检测到绿萝土壤湿度 12%，低于设定阈值。',
    preview: {
      items: [
        { label: '湿度读数', value: '12%' },
        { label: '传感器', value: 'odk.tile.hydra' }
      ]
    },
    action: { tool: 'memory_update', params: { category: 'note', value: '已检查绿萝盆土' } },
    confirmation: '记住 note：已检查绿萝盆土',
    nextStep: '记录检查备忘',
    createdAt: new Date().toISOString(),
    evidence: [{ readingId: 'odk.tile.hydra', field: 'soil', value: 12, state: 'live', measuredAt: new Date().toISOString() }]
  }
  await send({ state: 'idle', proposals: [candidate1], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await captureAgent('candidate-1-fact-echo.png')

  // --- Candidate 2: Contextual Anomaly & Impact (情境异常与利害分析型，高决策价值) ---
  const candidate2 = {
    id: '22222222-2222-4222-8222-000000000002',
    ruleId: 'commute-weather-anomaly',
    status: 'pending',
    offered: true,
    presented: true,
    advice: '18:30 晚高峰中雨将至，望京东路严重拥堵（预计耗时 +28min）。',
    preview: {
      summary: '理想中心（公司） → 静安里（家）',
      items: [
        { label: '预计耗时', value: '52min (+28m)' },
        { label: '中雨到达', value: '18:15 (80%)' },
        { label: '特惠快车', value: '约 32 元' },
        { label: '雨后预计', value: '约 58 元 (溢价)' }
      ]
    },
    action: { tool: 'taxi_quote', params: { from: 'office', to: 'home', product: 'express_discount' } },
    confirmation: '确认提前呼叫特惠快车',
    nextStep: '提前 15 分钟叫车（锁定平价）',
    createdAt: new Date().toISOString(),
    evidence: [{ readingId: 'commute.traffic', field: 'delay', value: 28, state: 'live', measuredAt: new Date().toISOString() }]
  }
  await send({ state: 'idle', proposals: [candidate2], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await captureAgent('candidate-2-contextual-anomaly.png')

  // --- Candidate 3: Engineering Pipeline & Continuous Delivery (工程流水线推进型，高开发杠杆) ---
  const candidate3 = {
    id: '33333333-3333-4333-8333-000000000003',
    ruleId: 'ci-pipeline-passed',
    status: 'pending',
    offered: true,
    presented: true,
    advice: 'open-deskos 主线验证全绿，建议部署至 CM5 实体参考机。',
    preview: {
      summary: 'main 分支 · Commit 1998604',
      items: [
        { label: '自动化验证', value: '116/116 passed' },
        { label: 'Electron 套件', value: '6/6 pass' },
        { label: '样式优化', value: 'uno.css (-2KB)' },
        { label: '目标机', value: 'cm5 (192.168.1.102)' }
      ]
    },
    action: { tool: 'deploy_cm5_stage', params: { commit: '1998604', target: 'cm5' } },
    confirmation: '确认部署当前版本到 CM5 参考机',
    nextStep: '一键部署到 CM5 参考宿主',
    createdAt: new Date().toISOString(),
    evidence: [{ readingId: 'ci.open-deskos', field: 'status', value: 'success', state: 'live', measuredAt: new Date().toISOString() }]
  }
  await send({ state: 'idle', proposals: [candidate3], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await captureAgent('candidate-3-engineering-pipeline.png')

  // --- Candidate 4: Precomputed Dependency & Security Audit (预备计算与影响分析型) ---
  const candidate4 = {
    id: '44444444-4444-4444-8444-000000000004',
    ruleId: 'upstream-dependency-audit',
    status: 'pending',
    offered: true,
    presented: true,
    advice: '上游 @earendil-works/pi-coding-agent 发布 v1.4.1，本地 0 破坏性改动。',
    preview: {
      summary: '修复了子 Agent 分词异常，安全补丁已就绪',
      items: [
        { label: '版本升级', value: '1.4.0 → 1.4.1' },
        { label: '影响模块', value: '0 breaking' },
        { label: '沙箱回归', value: '已预先验证' }
      ]
    },
    action: { tool: 'package_upgrade_pr', params: { package: '@earendil-works/pi-coding-agent', version: '1.4.1' } },
    confirmation: '确认自动创建依赖升级 PR 并更新 lockfile',
    nextStep: '在独立工作树升级依赖并建 PR',
    createdAt: new Date().toISOString(),
    evidence: [{ readingId: 'npm.audit', field: 'v1.4.1', value: 'safe', state: 'live', measuredAt: new Date().toISOString() }]
  }
  await send({ state: 'idle', proposals: [candidate4], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await captureAgent('candidate-4-precomputed-audit.png')

  // --- Build Combined 4-Candidate Comparison Grid ---
  const compareHtmlPath = path.join(profile, 'candidates-grid.html')
  const toDataUrl = file => 'data:image/png;base64,' + fs.readFileSync(path.join(outDir, file)).toString('base64')

  const gridHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      width: 1200px;
      height: 900px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #27272a;
      padding-bottom: 12px;
    }
    .header h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
    .header p { font-size: 13px; color: #a1a1aa; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      gap: 16px;
      flex: 1;
      min-height: 0;
    }
    .card {
      background: #111113;
      border: 1px solid #27272a;
      border-radius: 14px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      overflow: hidden;
    }
    .card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
    }
    .badge.c1 { background: #27272a; color: #a1a1aa; border: 1px solid #3f3f46; }
    .badge.c2 { background: #1e293b; color: #38bdf8; border: 1px solid #0284c7; }
    .badge.c3 { background: #064e3b; color: #34d399; border: 1px solid #059669; }
    .badge.c4 { background: #4c1d95; color: #c084fc; border: 1px solid #7c3aed; }
    .score {
      font-size: 11px;
      font-weight: 700;
      color: #e4e4e7;
    }
    .desc {
      font-size: 12px;
      color: #71717a;
      line-height: 1.3;
    }
    .preview-box {
      flex: 1;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #27272a;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .preview-box img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Personal Agent Information Value & Generation Paradigms</h1>
      <p>Comparing 4 Distinct Content & Interaction Models across Real User Scenarios</p>
    </div>
  </div>
  <div class="grid">
    <div class="card">
      <div class="card-top">
        <span class="badge c1">方案 1：现状「事实回声型」</span>
        <span class="score">价值评分：2.5 / 10（低）</span>
      </div>
      <p class="desc">直接复述单一传感器读数，提供“记一条备忘”等假闭环低杠杆动作，用户仍需线下人工介入。</p>
      <div class="preview-box">
        <img src="${toDataUrl('candidate-1-fact-echo.png')}" />
      </div>
    </div>

    <div class="card">
      <div class="card-top">
        <span class="badge c2">方案 2：「情境异常与利害分析型」</span>
        <span class="score">价值评分：9.2 / 10（极高）</span>
      </div>
      <p class="desc">多源联合推断（路况+降水+时间差值），突出关键拥堵差值与价格溢价，提供真正避险的高杠杆决策动作。</p>
      <div class="preview-box">
        <img src="${toDataUrl('candidate-2-contextual-anomaly.png')}" />
      </div>
    </div>

    <div class="card">
      <div class="card-top">
        <span class="badge c3">方案 3：「工程流水线推进型」</span>
        <span class="score">价值评分：9.0 / 10（极高）</span>
      </div>
      <p class="desc">针对桌面工程师场景，提供 Commit/测试覆盖率/产物度量矩阵，一步推进下一步部署或合并动作。</p>
      <div class="preview-box">
        <img src="${toDataUrl('candidate-3-engineering-pipeline.png')}" />
      </div>
    </div>

    <div class="card">
      <div class="card-top">
        <span class="badge c4">方案 4：「预计算审计与影响分析型」</span>
        <span class="score">价值评分：8.8 / 10（高）</span>
      </div>
      <p class="desc">不报空洞通知；在通知到达前完成本地依赖影响预计算（0 breaking），直接呈现实质决策闭环。</p>
      <div class="preview-box">
        <img src="${toDataUrl('candidate-4-precomputed-audit.png')}" />
      </div>
    </div>
  </div>
</body>
</html>`

  fs.writeFileSync(compareHtmlPath, gridHtml)

  const winGrid = new BrowserWindow({
    show: false, width: 1200, height: 900, useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true
    }
  })
  await winGrid.loadFile(compareHtmlPath)
  await delay(400)

  const gridImg = await capturePaintedPage(winGrid)
  const gridPath = path.join(outDir, 'candidates-comparison-matrix.png')
  fs.writeFileSync(gridPath, gridImg.toPNG())
  console.log(`CAPTURED Matrix: ${gridPath}`)

  win.destroy()
  winGrid.destroy()
  app.exit(0)
}).catch(err => {
  console.error(err)
  app.exit(1)
})
