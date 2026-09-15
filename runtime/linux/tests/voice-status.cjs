const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-voice-ui-'))
app.setPath('userData', profile)
const timeout = setTimeout(() => app.exit(1), 20000)
app.whenReady().then(async () => {
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-remote-publish-page-state']) {
    ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [] }))
  }
  const win = new BrowserWindow({ show: false, width: 480, height: 854, useContentSize: true, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true,
  } })
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  for (const [width, height] of [[1920, 1280], [320, 480]]) {
    win.setContentSize(width, height)
    for (const state of ['recording', 'transcribing', 'thinking', 'error', 'unavailable']) {
      win.webContents.send('odk-voice-status', { state, message: state === 'error' ? 'Configuration required. '.repeat(40) : '' })
      await new Promise((resolve) => setTimeout(resolve, 50))
      const result = await win.webContents.executeJavaScript(`(() => {
        const node = document.getElementById('voice-status'); const r = node.getBoundingClientRect();
        const title = node.querySelector('.voice-status-title'); const detail = node.querySelector('.voice-status-detail');
        const stage = node.querySelector('.voice-status-stage'); const icon = node.querySelector('.voice-status-icon');
        const progress = node.querySelector('.voice-status-progress'); const timing = node.querySelector('.voice-status-timing');
        return { hidden: node.hidden, text: node.textContent, title: title?.textContent, detail: detail?.textContent, stage: stage?.textContent, icon: icon?.dataset.stateIcon, children: node.childElementCount, contained: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, pointerEvents: getComputedStyle(node).pointerEvents, font: parseFloat(getComputedStyle(node).fontSize), titleFont: parseFloat(getComputedStyle(title).fontSize), detailFont: parseFloat(getComputedStyle(detail).fontSize), transform: getComputedStyle(node).transform, progressHidden: progress?.hidden, timeHidden: timing?.hidden };
      })()`)
      assert.equal(result.hidden, false)
      assert.equal(result.contained, true)
      assert.equal(result.pointerEvents, 'none')
      assert.ok(result.font >= 12)
      assert.ok(result.titleFont >= (width >= 1000 ? 24 : 18))
      assert.ok(result.detailFont >= 14)
      assert.ok(result.titleFont > result.detailFont)
      assert.ok(result.text.length > 0)
      assert.ok(result.title.length > 0)
      assert.ok(result.detail.length > 0)
      assert.ok(result.stage.length > 0)
      assert.ok(result.icon.length > 0)
      assert.equal(result.children, 2)
      assert.equal(result.progressHidden, !['transcribing', 'thinking'].includes(state))
      assert.equal(result.timeHidden, state !== 'recording')
      if (width >= 1000) {
        assert.equal(result.titleFont, 32)
        assert.equal(result.detailFont, 18)
      } else {
        assert.equal(result.titleFont, 22)
        assert.equal(result.detailFont, 14)
      }
    }
  }
  console.log('VOICE_STATUS_UI_PASS')
  clearTimeout(timeout)
  win.destroy()
  fs.rmSync(profile, { recursive: true, force: true })
  app.exit(0)
}).catch((error) => {
  console.error(error)
  fs.rmSync(profile, { recursive: true, force: true })
  app.exit(1)
})
