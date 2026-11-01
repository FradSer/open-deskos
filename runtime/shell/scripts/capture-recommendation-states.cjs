const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { capturePaintedPage } = require('../tests/helpers/native-page-capture')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-capture-states-'))
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

  // Helper to capture personal-agent panel rect
  const captureAgent = async filename => {
    const rect = await run(`(() => {
      const el = document.getElementById('personal-agent');
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    })()`)
    const img = await capturePaintedPage(win, rect)
    const filePath = path.join(outDir, filename)
    fs.writeFileSync(filePath, img.toPNG())
    console.log(`CAPTURED: ${filePath} (${rect.width}x${rect.height})`)
    return filePath
  }

  // 1. Voice input mode (initial idle state)
  await send({
    state: 'idle',
    proposals: [],
    proposalCapabilities: { read: true, respond: true, acknowledge: true },
    conversation: { turns: [] }
  })
  await captureAgent('01-voice-composer.png')

  // 2. Keyboard input mode with draft
  await run(`(() => {
    const composer = document.querySelector('.agent-composer');
    composer.querySelector('.agent-keys')?.click();
    const textarea = composer.querySelector('textarea');
    textarea.value = '帮我记录今天的浇水情况';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await delay(100)
  await captureAgent('02-keyboard-composer.png')

  // 3. Pending recommendation in conversation
  const proposal1 = {
    id: 'e311a280-c0b9-4411-96cd-4e1e92385349',
    ruleId: 'dry-soil',
    status: 'pending',
    offered: true,
    presented: true,
    advice: '检测到盆栽土壤湿度持续偏低，建议检查并记录补水。',
    action: { tool: 'memory_update', params: { category: 'watering', value: '已检查盆土并补水' } },
    confirmation: '记住 watering：已检查盆土并补水',
    nextStep: '保存浇水备忘',
    createdAt: new Date().toISOString()
  }
  await send({
    state: 'idle',
    proposals: [proposal1],
    proposalCapabilities: { read: true, respond: true, acknowledge: true }
  })
  await delay(100)
  await captureAgent('03-pending-recommendation.png')

  // 4. Confirmation state
  await run(`(() => {
    const btn = document.querySelector('[data-proposal-action="execute"]');
    btn?.click();
  })()`)
  await delay(100)
  await captureAgent('04-confirmation-state.png')

  // 5. Ride preview recommendation
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
  await send({
    state: 'idle',
    proposals: [rideProposal],
    proposalCapabilities: { read: true, respond: true, acknowledge: true }
  })
  await delay(100)
  // Expand place selector and scroll to show complete route and quote
  await run(`(() => {
    const quote = document.querySelector('.personal-agent-ride-actions .personal-agent-proposal-primary');
    quote?.click();
    const conv = document.querySelector('.agent-conversation');
    conv.scrollTop = conv.scrollHeight;
    document.querySelector('.agent-latest').hidden = true;
  })()`)
  await delay(100)
  await captureAgent('05-ride-preview.png')

  // 6. Completed recommendation with quality feedback
  const completedProposal = {
    id: 'c311a280-c0b9-4411-96cd-4e1e92385349',
    ruleId: 'dry-soil',
    status: 'completed',
    offered: true,
    presented: true,
    advice: '检测到盆栽土壤湿度偏低，已为你登记备忘。',
    result: '备忘已保存至个人记忆库。',
    completedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  }
  await send({
    state: 'idle',
    proposals: [completedProposal],
    proposalCapabilities: { read: true, respond: true, acknowledge: true }
  })
  await delay(100)
  // Open feedback disclosure and scroll to view
  await run(`(() => {
    const details = document.querySelector('.personal-agent-proposal-feedback-options');
    if (details) details.open = true;
    const conv = document.querySelector('.agent-conversation');
    conv.scrollTop = conv.scrollHeight;
    document.querySelector('.agent-latest').hidden = true;
  })()`)
  await delay(100)
  await captureAgent('06-completed-feedback.png')

  win.destroy()
  app.exit(0)
}).catch(err => {
  console.error(err)
  app.exit(1)
})
