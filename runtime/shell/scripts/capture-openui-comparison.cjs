const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { capturePaintedPage } = require('../tests/helpers/native-page-capture')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-openui-compare-'))
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

  // --- 1. Capture Open DeskOS Optimized View ---
  const winDeskOS = new BrowserWindow({
    show: false, width: 480, height: 720, useContentSize: true,
    webPreferences: {
      preload: path.resolve(__dirname, '../src/preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true
    }
  })

  winDeskOS.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await winDeskOS.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const runDeskOS = script => winDeskOS.webContents.executeJavaScript(script)

  await delay(400)
  await runDeskOS(`odkTheme.set('instrument'); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(r)))`)
  await delay(200)

  const rideProposal = {
    id: 'a2f9fed5-8a7a-458e-bfbf-d5650c5edf40',
    ruleId: 'commute-intent',
    status: 'pending',
    offered: true,
    presented: true,
    advice: '下班时间临近，已为你规划回家的常选路线。',
    action: null,
    confirmation: '',
    nextStep: '查看路线与报价',
    createdAt: new Date().toISOString(),
    ridePreview: {
      handle: 'ride-preview-handle',
      status: 'choose_places',
      sandbox: true,
      measuredAt: new Date().toISOString(),
      expiresAt: Date.now() + 120000,
      from: [{ handle: 'p1', name: '理想中心（公司）', city: '北京市', address: '望京东路 1 号' }],
      to: [{ handle: 'd1', name: '静安里（家）', city: '北京市', address: '西坝河南路' }],
      items: [{ productName: '特惠快车', priceText: '约 32 元' }, { productName: '滴滴快车', priceText: '约 38 元' }]
    }
  }

  winDeskOS.webContents.send('odk-personal-agent-status', {
    state: 'idle',
    proposals: [rideProposal],
    proposalCapabilities: { read: true, respond: true, acknowledge: true }
  })
  await delay(250)

  const deskOSRect = await runDeskOS(`(() => {
    const el = document.getElementById('personal-agent');
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  })()`)
  const deskOSImg = await capturePaintedPage(winDeskOS, deskOSRect)
  const deskOSPath = path.join(outDir, '07-open-deskos-optimized.png')
  fs.writeFileSync(deskOSPath, deskOSImg.toPNG())
  console.log(`CAPTURED Open DeskOS: ${deskOSPath}`)

  // --- 2. Capture OpenUI (thesysdev/openui) Generative UI View ---
  // Create an HTML file using the OpenUI Design System & Component Library (OpenUI React-UI style)
  const openuiHtmlPath = path.join(profile, 'openui-preview.html')
  const openuiHtml = `<!DOCTYPE html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="UTF-8">
  <title>OpenUI (thesysdev/openui) Generative UI</title>
  <style>
    :root {
      --bg: #09090b;
      --card: #18181b;
      --card-border: #27272a;
      --muted: #71717a;
      --muted-bg: #27272a;
      --foreground: #fafafa;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --accent: #3b82f6;
      --accent-badge-bg: #1e293b;
      --accent-badge-text: #60a5fa;
      --accent-badge-border: #1d4ed8;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--foreground);
      width: 480px;
      height: 720px;
      padding: 24px 20px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
    }
    .openui-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 14px;
      margin-bottom: 16px;
    }
    .openui-brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .openui-logo {
      width: 22px;
      height: 22px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 11px;
      color: white;
    }
    .openui-title {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: #e4e4e7;
    }
    .openui-pill-spec {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 999px;
      background: #1e1b4b;
      color: #a5b4fc;
      border: 1px solid #4338ca;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }

    .openui-chat-stream {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
    }
    .openui-message {
      display: flex;
      gap: 10px;
      max-width: 100%;
    }
    .openui-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #27272a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      color: #a1a1aa;
      flex: none;
    }
    .openui-bubble {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .openui-text {
      font-size: 15px;
      line-height: 1.5;
      color: #f4f4f5;
    }

    /* OpenUI Lang Component: <Card> */
    .oui-card {
      background: var(--card);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .oui-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .oui-card-title {
      font-size: 14px;
      font-weight: 600;
      color: #fafafa;
    }
    .oui-badge {
      font-size: 11px;
      font-weight: 500;
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--accent-badge-bg);
      color: var(--accent-badge-text);
      border: 1px solid var(--accent-badge-border);
    }
    .oui-route {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: #27272a;
      border-radius: 8px;
      font-size: 14px;
    }
    .oui-route-point {
      font-weight: 500;
      color: #fafafa;
    }
    .oui-route-arrow {
      color: var(--muted);
      font-size: 12px;
    }

    /* OpenUI Lang Component: <OptionsList> */
    .oui-options-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .oui-option-card {
      padding: 10px 12px;
      background: #27272a;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .oui-option-card.selected {
      border-color: #3b82f6;
      background: #1e293b;
    }
    .oui-option-name {
      font-size: 12px;
      color: #a1a1aa;
    }
    .oui-option-price {
      font-size: 15px;
      font-weight: 700;
      color: #fafafa;
      font-variant-numeric: tabular-nums;
    }

    .oui-action-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }
    .oui-btn-primary {
      flex: 1;
      height: 40px;
      background: var(--primary);
      color: white;
      border: 0;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .oui-btn-ghost {
      height: 40px;
      padding: 0 12px;
      background: transparent;
      color: #a1a1aa;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
    }
    .oui-stream-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: #71717a;
      font-family: ui-monospace, SFMono-Regular, monospace;
      padding-top: 4px;
      border-top: 1px dashed #27272a;
    }

    /* OpenUI Chat Composer */
    .openui-composer {
      display: flex;
      align-items: center;
      gap: 8px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 8px 12px;
    }
    .openui-input {
      flex: 1;
      background: transparent;
      border: 0;
      color: white;
      font-size: 14px;
      outline: none;
    }
    .openui-send-btn {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #2563eb;
      color: white;
      border: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <div class="openui-header">
    <div class="openui-brand">
      <div class="openui-logo">UI</div>
      <div class="openui-title">OpenUI Generative Runtime</div>
    </div>
    <div class="openui-pill-spec">thesysdev/openui</div>
  </div>

  <div class="openui-chat-stream">
    <div class="openui-message">
      <div class="openui-avatar">AI</div>
      <div class="openui-bubble">
        <p class="openui-text">下班时间临近，已为你规划回家的常选路线。</p>

        <!-- OpenUI Generative UI Card -->
        <div class="oui-card">
          <div class="oui-card-header">
            <span class="oui-card-title">Commute Preview</span>
            <span class="oui-badge">Generated UI</span>
          </div>

          <div class="oui-route">
            <span class="oui-route-point">理想中心（公司）</span>
            <span class="oui-route-arrow">➔</span>
            <span class="oui-route-point">静安里（家）</span>
          </div>

          <div class="oui-options-grid">
            <div class="oui-option-card selected">
              <span class="oui-option-name">特惠快车</span>
              <span class="oui-option-price">约 32 元</span>
            </div>
            <div class="oui-option-card">
              <span class="oui-option-name">滴滴快车</span>
              <span class="oui-option-price">约 38 元</span>
            </div>
          </div>

          <div class="oui-action-row">
            <button class="oui-btn-primary">Get current quote</button>
            <button class="oui-btn-ghost">Later</button>
          </div>

          <div class="oui-stream-footer">
            <span>&lt;Card&gt; &lt;Route&gt; &lt;OptionsGrid&gt;</span>
            <span>OpenUI Lang · 142 tokens</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="openui-composer">
    <input class="openui-input" value="帮我记录今天的浇水情况" readonly />
    <button class="openui-send-btn">↑</button>
  </div>
</body>
</html>`

  fs.writeFileSync(openuiHtmlPath, openuiHtml)

  const winOpenUI = new BrowserWindow({
    show: false, width: 480, height: 720, useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true
    }
  })
  await winOpenUI.loadFile(openuiHtmlPath)
  await delay(300)

  const openuiImg = await capturePaintedPage(winOpenUI)
  const openuiPath = path.join(outDir, '08-openui-generative-preview.png')
  fs.writeFileSync(openuiPath, openuiImg.toPNG())
  console.log(`CAPTURED OpenUI: ${openuiPath}`)

  // --- 3. Build Side-by-Side Comparison Canvas ---
  const compareHtmlPath = path.join(profile, 'compare.html')
  const deskOSDataUrl = 'data:image/png;base64,' + deskOSImg.toPNG().toString('base64')
  const openuiDataUrl = 'data:image/png;base64,' + openuiImg.toPNG().toString('base64')

  const compareHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #000;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      width: 1040px;
      height: 820px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 1px solid #27272a;
    }
    .header h1 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header p {
      font-size: 13px;
      color: #a1a1aa;
    }
    .panes {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      flex: 1;
      min-height: 0;
    }
    .pane-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: #111113;
      border: 1px solid #27272a;
      border-radius: 16px;
      padding: 14px;
      overflow: hidden;
    }
    .pane-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .pane-badge {
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 999px;
    }
    .pane-badge.deskos {
      background: #18181b;
      color: #e4e4e7;
      border: 1px solid #3f3f46;
    }
    .pane-badge.openui {
      background: #1e293b;
      color: #60a5fa;
      border: 1px solid #2563eb;
    }
    .pane-desc {
      font-size: 12px;
      color: #71717a;
      line-height: 1.4;
    }
    .frame-wrapper {
      flex: 1;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #27272a;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .frame-wrapper img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>Generative UI Architecture & Visual Comparison</h1>
      <p>Comparing Open DeskOS (Universal Desk Primitives) vs. OpenUI (thesysdev/openui Generative Framework)</p>
    </div>
  </div>
  <div class="panes">
    <div class="pane-card">
      <div class="pane-title-row">
        <span class="pane-badge deskos">Open DeskOS (Optimized)</span>
        <span class="pane-desc">Native Desk Instrument & Conversation Stream</span>
      </div>
      <div class="frame-wrapper">
        <img src="${deskOSDataUrl}" />
      </div>
    </div>
    <div class="pane-card">
      <div class="pane-title-row">
        <span class="pane-badge openui">OpenUI (thesysdev/openui)</span>
        <span class="pane-desc">Streaming Generative UI Component Primitives</span>
      </div>
      <div class="frame-wrapper">
        <img src="${openuiDataUrl}" />
      </div>
    </div>
  </div>
</body>
</html>`

  fs.writeFileSync(compareHtmlPath, compareHtml)

  const winCompare = new BrowserWindow({
    show: false, width: 1040, height: 820, useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      offscreen: true
    }
  })
  await winCompare.loadFile(compareHtmlPath)
  await delay(400)

  const compareImg = await capturePaintedPage(winCompare)
  const comparePath = path.join(outDir, '09-comparison-side-by-side.png')
  fs.writeFileSync(comparePath, compareImg.toPNG())
  console.log(`CAPTURED Comparison: ${comparePath}`)

  winDeskOS.destroy()
  winOpenUI.destroy()
  winCompare.destroy()
  app.exit(0)
}).catch(err => {
  console.error(err)
  app.exit(1)
})
