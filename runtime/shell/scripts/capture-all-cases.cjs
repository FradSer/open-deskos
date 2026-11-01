const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { capturePaintedPage } = require('../tests/helpers/native-page-capture')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-capture-cases-'))
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

  win.webContents.on('console-message', (_e, level, msg) => console.log('RENDERER CONSOLE:', msg))
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  const send = async status => { win.webContents.send('odk-personal-agent-status', status); await delay(150) }

  await delay(1000)
  await run(`odkTheme.set('instrument'); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(r)))`)
  await delay(500)

  // Send initial idle state
  await send({
    state: 'idle',
    proposals: [],
    proposalCapabilities: { read: true, respond: true, acknowledge: true }
  })
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

  // --- Case 1: IoT Sensor Moisture + Memory Action ---
  const case1 = {
    id: '11111111-1111-4111-8111-000000000001',
    ruleId: 'dry-soil',
    status: 'pending',
    offered: true,
    presented: true,
    advice: '检测到盆栽土壤湿度持续偏低（12%），建议检查并记录补水。',
    preview: {
      items: [{ label: '当前湿度', value: '12%' }, { label: '检测点', value: '绿萝盆栽' }]
    },
    action: { tool: 'memory_update', params: { category: 'watering', value: '已检查盆土并补水' } },
    confirmation: '记住 watering：已检查盆土并补水',
    nextStep: '保存浇水备忘',
    createdAt: new Date().toISOString(),
    evidence: [{ readingId: 'odk.tile.hydra', field: 'soilPercent', value: 12, state: 'live', measuredAt: new Date().toISOString() }]
  }
  await send({ state: 'idle', proposals: [case1], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  const diag1 = await run(`(() => ({
    articles: document.querySelectorAll('.agent-message').length,
    convHTML: document.querySelector('.agent-conversation')?.innerHTML
  }))()`)
  console.log('DIAG CASE 1:', diag1.articles, diag1.convHTML?.slice(0, 200))
  await captureAgent('case-01-sensor-alert.png')

  // --- Case 2: Coding Task Finished with Verification ---
  const case2 = {
    id: '22222222-2222-4222-8222-000000000002',
    ruleId: 'coding-task',
    status: 'pending',
    offered: true,
    presented: true,
    advice: 'cm5 上的后台编译任务已完成，所有回归测试已通过。',
    preview: {
      items: [
        { label: '目标主机', value: 'cm5' },
        { label: '执行结果', value: '0 (成功)' },
        { label: '测试验证', value: '84 passed' }
      ]
    },
    action: { tool: 'coding_task_history', params: { target: 'cm5', project: 'open-deskos', taskId: '7a3c8e41' } },
    confirmation: '查看任务详情：cm5/open-deskos',
    nextStep: '查看任务历史',
    createdAt: new Date().toISOString(),
    evidence: [{ readingId: 'pi-tasks.cm5', field: 'turnOutcome', value: 'finished', state: 'live', measuredAt: new Date().toISOString() }]
  }
  await send({ state: 'idle', proposals: [case2], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await captureAgent('case-02-coding-task.png')

  // --- Case 3: Private Email Notification Review ---
  const case3 = {
    id: '33333333-3333-4333-8333-000000000003',
    ruleId: 'private-mail',
    status: 'pending',
    offered: true,
    presented: true,
    advice: '收到一封来自 GitHub 的新版本发布通知，请核对。',
    preview: {
      items: [
        { label: '发件人', value: 'notifications@github.com' },
        { label: '主题', value: 'Release v1.4.0' }
      ]
    },
    action: { tool: 'private_source_review', params: { sourceId: 'gmail', handle: 'mail-123' } },
    confirmation: '确认核对这封邮件',
    nextStep: '核对邮件并确认下一步',
    createdAt: new Date().toISOString(),
    evidence: [{ readingId: 'private.gmail.mail-123', field: 'subject', value: 'Release v1.4.0', state: 'live', measuredAt: new Date().toISOString() }]
  }
  await send({ state: 'idle', proposals: [case3], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await captureAgent('case-03-mail-review.png')

  // --- Case 4: Actionless Weather Advice (只读气象提醒) ---
  const case4 = {
    id: '44444444-4444-4444-8444-000000000004',
    ruleId: 'weather-alert',
    status: 'pending',
    offered: true,
    presented: true,
    advice: '下午局部有雷阵雨并伴随降温，傍晚外出建议携带雨具。',
    preview: {
      items: [
        { label: '气温', value: '22°C' },
        { label: '降水概率', value: '80%' },
        { label: '湿度', value: '78%' }
      ]
    },
    action: null,
    confirmation: '',
    createdAt: new Date().toISOString(),
    evidence: [{ readingId: 'odk.tile.weather', field: 'temperatureC', value: 22, state: 'live', measuredAt: new Date().toISOString() }]
  }
  await send({ state: 'idle', proposals: [case4], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await captureAgent('case-04-weather-actionless.png')

  // --- Case 5: Operation Submitted / In-flight State ---
  await send({ state: 'idle', proposals: [case1], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await delay(100)
  // Simulate execute click -> confirm click
  await run(`(() => {
    const btn = document.querySelector('[data-proposal-action="execute"]');
    btn?.click();
  })()`)
  await delay(100)
  // Click confirm and simulate pending status
  await run(`(() => {
    const confirm = document.querySelector('[data-proposal-action="confirm"]');
    confirm?.click();
  })()`)
  await delay(100)
  await captureAgent('case-05-operation-submitted.png')

  // --- Case 6: Pixel Theme (Retro Zpix & Hard Pixels) ---
  await run(`odkTheme.set('pixel'); document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(r)))`)
  await delay(200)
  await send({ state: 'idle', proposals: [case1], proposalCapabilities: { read: true, respond: true, acknowledge: true } })
  await delay(100)
  await captureAgent('case-06-pixel-theme.png')

  win.destroy()
  app.exit(0)
}).catch(err => {
  console.error(err)
  app.exit(1)
})
