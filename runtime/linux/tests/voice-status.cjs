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
  let pageState
  ipcMain.handle('odk-remote-publish-page-state', (_event, state) => { pageState = state; return { ok: true } })
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight', 'odk-user-apps-list', 'odk-face-agent-status']) {
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
  await evaluate(`document.querySelectorAll('#dots .dot')[1].click(); document.querySelectorAll('#dots .dot')[1].focus()`)
  const originalPage = await evaluate(`document.getElementById('page-context').textContent`)
  win.show()
  win.focus()
  await new Promise((resolve) => setTimeout(resolve, 300))
  await evaluate(`document.getElementById('pages-viewport').addEventListener('pointerdown', (event) => { window.voiceCapturedPointer = event.pointerId })`)
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: 300, y: 300, button: 'left', buttons: 1, clickCount: 1 })
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 50, y: 300, button: 'left', buttons: 1 })
  await pause()
  assert.equal(await evaluate(`document.getElementById('pages-viewport').hasPointerCapture(window.voiceCapturedPointer)`), true, 'Regression starts with a real captured pager drag')
  await evaluate(`(() => {
    document.querySelectorAll('#dots .dot')[1].focus();
    window.voiceActions = 0;
    document.addEventListener('odk-remote-action', () => window.voiceActions++);
  })()`)
  await send({ state: 'starting' })
  assert.equal(await evaluate(`document.getElementById('pages-viewport').hasPointerCapture(window.voiceCapturedPointer)`), false, 'Voice activation releases pager pointer capture')
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 50, y: 300, button: 'left', buttons: 0, clickCount: 1 })
  win.webContents.debugger.detach()
  assert.equal(await evaluate(`document.activeElement.classList.contains('voice-status-content')`), true)
  assert.equal(pageState.canPrev, false)
  assert.equal(pageState.canNext, false)
  assert.deepEqual(pageState.actions, [])
  win.webContents.send('odk-remote-navigation', { direction: 'next' })
  await pause()
  const restingTrack = await evaluate(`document.getElementById('pages-track').style.transform`)
  await evaluate(`(() => {
    const viewport = document.getElementById('pages-viewport');
    for (const [type, x] of [['pointermove', 0], ['pointerup', 0], ['pointerdown', 300], ['pointermove', 0], ['pointerup', 0]]) {
      viewport.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, clientX: x, bubbles: true }));
    }
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    for (const input of ['left', 'right', 'primary', 'secondary', 'action']) {
      window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: { input, action: 'refresh' } }));
    }
    document.querySelectorAll('#dots .dot')[2].click();
  })()`)
  assert.equal(await evaluate(`document.getElementById('page-context').textContent`), originalPage)
  assert.equal(await evaluate(`document.getElementById('pages-track').style.transform`), restingTrack)
  assert.equal(await evaluate(`document.getElementById('pages-track').classList.contains('dragging')`), false)
  assert.equal(await evaluate(`window.voiceActions`), 0)
  await send({ state: 'idle', message: 'Scrollable response 测试结果\n'.repeat(200) })
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'down' }))`)
  assert.ok(await evaluate(`document.querySelector('.voice-status-content').scrollTop > 0`))
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'up' }))`)
  assert.equal(await evaluate(`document.querySelector('.voice-status-content').scrollTop`), 0)
  win.show()
  win.focus()
  for (const keyCode of ['Down', 'PageDown', 'End']) {
    await evaluate(`document.querySelector('.voice-status-content').scrollTop = 0; document.querySelector('.voice-status-content').focus()`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.ok(await evaluate(`document.querySelector('.voice-status-content').scrollTop > 0`), `${keyCode} scrolls the response`)
    assert.equal(await evaluate(`document.getElementById('page-context').textContent`), originalPage)
  }
  await new Promise((resolve) => setTimeout(resolve, 300))
  await evaluate(`document.querySelector('.voice-status-content').scrollTop = 0`)
  await pause()
  win.webContents.sendInputEvent({ type: 'mouseWheel', x: 200, y: 300, deltaY: -200, canScroll: true })
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.ok(await evaluate(`document.querySelector('.voice-status-content').scrollTop > 0`), 'Wheel scrolls the response')
  win.webContents.debugger.attach('1.3')
  await evaluate(`document.querySelector('.voice-status-content').scrollTop = 0`)
  await win.webContents.debugger.sendCommand('Input.synthesizeScrollGesture', {
    x: 200, y: 400, yDistance: -180, gestureSourceType: 'touch', speed: 600,
  })
  assert.ok(await evaluate(`document.querySelector('.voice-status-content').scrollTop > 0`), 'Vertical touch swipe scrolls the response')
  await win.webContents.debugger.sendCommand('Input.synthesizeScrollGesture', {
    x: 300, y: 400, xDistance: -200, gestureSourceType: 'touch', speed: 600,
  })
  assert.equal(await evaluate(`document.getElementById('page-context').textContent`), originalPage)
  win.webContents.debugger.detach()
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'back' }))`)
  assert.equal(await evaluate(`document.activeElement === document.querySelectorAll('#dots .dot')[1] && !document.getElementById('pages-viewport').inert`), true)
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'left' }))`)
  assert.notEqual(await evaluate(`document.getElementById('page-context').textContent`), originalPage)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready.then(() => true)`)
    for (const [width, height] of [[1920, 1280], [480, 854], [320, 480]]) {
      win.setContentSize(width, height)
      for (const state of ['starting', 'recording', 'sending', 'transcribing', 'thinking', 'error', 'unavailable', 'idle']) {
        const message = ['error', 'idle'].includes(state) ? 'Result 测试结果 https://example.test/\n'.repeat(100) : ''
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
            fullscreen: r.x === 0 && r.y === 0 && r.width === innerWidth && r.height === innerHeight,
            headingHidden: node.querySelector('.voice-status-heading').hidden,
            progressHidden: node.querySelector('.voice-status-progress').hidden,
            modal: node.getAttribute('role') === 'dialog' && node.getAttribute('aria-modal') === 'true',
            outside: !node.contains(document.elementFromPoint(5, 5)) };
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
        assert.equal(result.fullscreen, true, 'Voice interaction must cover the viewport')
        assert.equal(result.modal, true)
        assert.equal(result.outside, false)
        assert.equal(result.headingHidden, state === 'idle')
        assert.ok(result.stageFont >= 12 && result.stageFont < result.titleFont)
        assert.equal(result.titleHidden, state !== 'idle')
        if (state === 'idle') assert.equal(result.progressHidden, true)
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
  await evaluate(`(() => {
    document.querySelectorAll('#dots .dot')[3].click();
    window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'primary' }));
    window.voicePreviousControl = document.activeElement;
    window.voiceControlClicks = 0;
    window.voicePreviousControl.addEventListener('click', () => window.voiceControlClicks++);
  })()`)
  await pause()
  assert.equal(pageState.mode, 'focus', 'Regression starts in Remote App focus mode')
  await send({ state: 'starting' })
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'back' }))`)
  await pause()
  assert.equal(await evaluate(`document.activeElement === window.voicePreviousControl`), true)
  assert.equal(pageState.mode, 'focus', 'Closing voice restores Remote App focus mode')
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'primary' }))`)
  assert.equal(await evaluate(`window.voiceControlClicks`), 1, 'Remote primary activates the restored control')
  await evaluate(`document.getElementById('app-view').hidden = false`)
  await send({ state: 'starting' })
  assert.equal(await evaluate(`document.getElementById('voice-status').parentElement === document.body && document.getElementById('app-view').inert`), true)
  await evaluate(`document.querySelector('.voice-status-content').focus()`)
  const trapped = await evaluate(`(() => { const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); document.activeElement.dispatchEvent(event); return event.defaultPrevented && document.activeElement.classList.contains('voice-status-content') })()`)
  assert.equal(trapped, true, 'Voice owns the Tab cycle above the App')
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
