const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-voice-ui-'))
app.setPath('userData', profile)
const timeout = setTimeout(() => app.exit(1), 60000)
const pause = () => new Promise((resolve) => setTimeout(resolve, 30))
app.whenReady().then(async () => {
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-remote-publish-page-state', 'odk-weread-highlight', 'odk-user-apps-list', 'odk-face-agent-status']) {
    ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [] }))
  }
  const win = new BrowserWindow({ show: false, width: 480, height: 854, useContentSize: true, webPreferences: {
    preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true,
  } })
  const evaluate = (script) => win.webContents.executeJavaScript(script)
  const send = async (status) => { win.webContents.send('odk-voice-status', status); await pause() }
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  for (const state of ['idle', 'error', 'unavailable']) {
    await send({ state, message: 'Previous result' })
    assert.equal(await evaluate('document.getElementById("voice-status").hidden'), true)
  }
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready.then(() => true)`)
    for (const [width, height] of [[1920, 1280], [480, 854], [320, 480]]) {
      win.setContentSize(width, height)
      for (const state of ['starting', 'recording', 'sending', 'transcribing', 'thinking', 'error', 'unavailable', 'idle']) {
        const message = ['error', 'idle'].includes(state) ? 'Result 测试结果 https://example.test/'.repeat(30) : ''
        await send({ state, message })
        const result = await evaluate(`(() => {
          const node = document.getElementById('voice-status'); const r = node.getBoundingClientRect();
          const content = node.querySelector('.voice-status-content');
          const title = node.querySelector('.voice-status-title'); const stage = node.querySelector('.voice-status-stage');
          const detail = node.querySelector('.voice-status-detail');
          content.scrollTop = content.scrollHeight;
          return { hidden: node.hidden, title: title.textContent, titleHidden: title.hidden,
            contained: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
            overflow: content.scrollWidth > content.clientWidth + 1, scroll: content.scrollTop,
            hasButton: !!node.querySelector('button'), detailFont: parseFloat(getComputedStyle(detail).fontSize),
            titleFont: parseFloat(getComputedStyle(title).fontSize), stageFont: parseFloat(getComputedStyle(stage).fontSize),
            compact: r.height <= 110, outside: !node.contains(document.elementFromPoint(5, 5)) };
        })()`)
        assert.equal(result.hidden, false)
        assert.equal(result.contained, true)
        assert.equal(result.overflow, false)
        assert.equal(result.hasButton, false)
        assert.ok(result.detailFont >= 18)
        if (width === 1920) {
          assert.ok(result.stageFont >= 24)
          assert.ok(result.titleFont >= 32)
        }
        assert.equal(result.outside, true)
        assert.ok(result.stageFont >= 12 && result.stageFont < result.titleFont)
        assert.equal(result.titleHidden, state !== 'idle')
        if (state === 'thinking') assert.equal(result.compact, true)
        if (state === 'idle') { assert.equal(result.title, message); assert.ok(result.scroll > 0) }
      }
      await evaluate(`document.querySelector('.voice-status-content').focus(); document.querySelector('.voice-status-content').scrollTop = 0`)
      const keyHandled = await evaluate(`(() => { const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(event); return event.defaultPrevented })()`)
      assert.equal(keyHandled, false, 'Shell paging must not consume voice content scroll keys')
      win.show()
      win.focus()
      await pause()
      await evaluate('document.activeElement.blur()')
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      await pause()
      assert.equal(await evaluate('document.getElementById("voice-status").hidden'), true)
      await send({ state: 'idle', message: 'Repeated result' })
      assert.equal(await evaluate('document.getElementById("voice-status").hidden'), true)
      await send({ state: 'unavailable', activated: true })
      assert.equal(await evaluate('document.getElementById("voice-status").hidden'), false)
      await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'back' }))`)
    }
  }
  await evaluate(`document.getElementById('app-view').hidden = false`)
  await send({ state: 'starting' })
  assert.equal(await evaluate(`document.getElementById('app-view').contains(document.getElementById('voice-status'))`), true)
  await evaluate(`document.querySelector('.voice-status-content').focus()`)
  const trapped = await evaluate(`(() => { const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(event); return event.defaultPrevented && document.activeElement.id === 'app-back' })()`)
  assert.equal(trapped, true, 'Voice controls join the App Tab cycle')
  await evaluate(`document.getElementById('app-back').focus()`)
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
  await pause()
  assert.equal(await evaluate(`document.getElementById('voice-status').hidden && !document.getElementById('app-view').hidden`), true)
  await send({ state: 'starting' })
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'back' }))`)
  assert.equal(await evaluate(`document.getElementById('voice-status').hidden && !document.getElementById('app-view').hidden`), true, 'Remote Back closes feedback before the App')
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'back' }))`)
  assert.equal(await evaluate(`document.getElementById('app-view').hidden`), true, 'The next Back closes the App')
  await pause()
  assert.equal(await evaluate(`document.getElementById('voice-status').parentElement === document.body`), true)
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await send({ state: 'starting' })
  await send({ state: 'thinking' })
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".voice-status-progress span")).animationName'), 'none')
  win.webContents.setZoomFactor(2)
  await send({ state: 'error', message: 'Configuration required. '.repeat(30) })
  assert.equal(await evaluate(`(() => { const n = document.getElementById('voice-status'); const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight })()`), true)
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
