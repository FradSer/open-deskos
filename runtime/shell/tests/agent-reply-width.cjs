// Every assistant reply keeps one uniform bubble width, independent of text length.
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const assert = require('node:assert/strict')
const os = require('node:os')
const fs = require('node:fs')

app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-agent-width-'))
app.setPath('userData', profile)
app.on('will-quit', () => { try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} })
setTimeout(() => app.exit(1), 90000)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const source = {
  key: 'a'.repeat(64), revision: 'b'.repeat(64), threadId: 'c'.repeat(64),
  machine: 'CM5', sessionId: 's', project: '/p', taskName: '包查询',
  control: 'report_only', availability: 'live',
}
const messages = [
  '两个包都读到了，没有改动。',
  '已把 cm5-api-clock 这个 Widget 草稿任务交给 Hosted Pi，目标为 CM5 上的 open-deskos 项目，目前刚启动，草稿路径与验收标识尚未有产出。',
  '本轮读到的已安装记录：cm5-api-clock 为 UTC Live 2.1，cm5-api-clock-app 为 UTC Observatory 2。两者的 clock 源均为 timeapi.io UTC、refreshMs 10000。布局上 cm5-api-clock 位于 Desk 网格页，App 不占网格。本次只读取，未安装或改动任何包。',
].map((text, index) => ({
  id: String(index + 4).repeat(64), at: 1000 + index, presentation: 'assistant_update',
  text, sources: [source],
}))

const measure = `(() => {
  const conv = document.querySelector('.agent-conversation')
  const convBox = conv.getBoundingClientRect()
  const bubbles = [...conversationBubbles()]
  function conversationBubbles() { return document.querySelectorAll('.agent-message-assistant .agent-message-bubble') }
  return {
    convWidth: Math.round(convBox.width),
    bubbles: bubbles.map(bubble => {
      const box = bubble.getBoundingClientRect()
      const body = bubble.querySelector('.agent-message-body')
      return { width: Math.round(box.width), left: Math.round(box.left), right: Math.round(box.right),
        textChars: (body?.textContent || '').length,
        clipped: body ? body.scrollWidth > body.clientWidth + 1 : false }
    }),
    ownerWidth: (() => { const o = document.querySelector('.agent-message-user'); return o ? Math.round(o.getBoundingClientRect().width) : null })(),
  }
})()`

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
    show: false, width: 480, height: 925, useContentSize: true,
    webPreferences: { preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true },
  })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  const run = script => win.webContents.executeJavaScript(script)
  await delay(700)

  for (const size of [[480, 925], [320, 640], [1920, 1280]]) {
    win.setContentSize(size[0], size[1])
    await delay(250)
    for (const theme of ['instrument', 'pixel', 'border-beam']) {
      await run(`odkTheme.set(${JSON.stringify(theme)})`)
      win.webContents.send('odk-personal-agent-status', {
        state: 'idle', message: '', proposals: [],
        proposalCapabilities: { read: true, respond: true, acknowledge: true },
        remote: { state: 'live', messages, replies: [] },
      })
      await delay(300)
      const measured = await run(measure)
      const widths = measured.bubbles.map(bubble => bubble.width)
      assert.equal(widths.length, 3, `${theme}/${size}: expected three assistant bubbles, got ${widths.length}`)
      assert.equal(new Set(widths).size, 1,
        `${theme}/${size}: assistant bubbles must share one width, got ${JSON.stringify(widths)} with text lengths ${JSON.stringify(measured.bubbles.map(b => b.textChars))}`)
      assert.ok(widths[0] <= measured.convWidth,
        `${theme}/${size}: bubble ${widths[0]} overflows conversation ${measured.convWidth}`)
      assert.ok(measured.bubbles.every(bubble => !bubble.clipped),
        `${theme}/${size}: a bubble clips its text`)
      console.log(`PASS ${theme}/${size[0]}x${size[1]}: ${widths[0]}px for all ${widths.length} replies`)
    }
  }

  win.destroy()
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
