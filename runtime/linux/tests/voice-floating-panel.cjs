const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-voice-floating-'))
app.setPath('userData', profile)
let win
let pageState
const pause = () => new Promise((resolve) => setTimeout(resolve, 50))
const evaluate = (script) => win.webContents.executeJavaScript(script)
const send = async (status) => { win.webContents.send('odk-voice-status', status); await pause() }
function finish(code) {
  clearTimeout(timeout)
  if (win && !win.isDestroyed()) win.destroy()
  fs.rmSync(profile, { recursive: true, force: true })
  app.exit(code)
}
const timeout = setTimeout(() => { console.error('Voice floating panel test timed out'); finish(1) }, 60000)

async function geometry(state, width) {
  const result = await evaluate(`(() => {
    const root = document.getElementById('voice-status');
    const panel = root.querySelector('.voice-status-content');
    const r = root.getBoundingClientRect(); const p = panel.getBoundingClientRect();
    const css = getComputedStyle(panel); const rootCss = getComputedStyle(root);
    const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const probe = document.createElement('span'); panel.append(probe);
    probe.style.color = token('--odk-surface'); const surface = getComputedStyle(probe).color;
    probe.style.color = token('--odk-stroke'); const stroke = getComputedStyle(probe).color; probe.remove();
    return {
      fullscreen: r.x === 0 && r.y === 0 && r.width === innerWidth && r.height === innerHeight,
      transparent: rootCss.backgroundColor === 'rgba(0, 0, 0, 0)' && rootCss.backgroundImage === 'none',
      bounded: p.left > 0 && p.right < innerWidth && p.top > 0 && p.bottom < innerHeight && p.height <= innerHeight * .7 + 1,
      centered: Math.abs(p.left + p.width / 2 - innerWidth / 2) <= 1,
      bottom: innerHeight - p.bottom <= 64,
      width: p.width, charcoal: css.backgroundColor === surface,
      outlined: parseFloat(css.borderTopWidth) >= 1 && css.borderTopColor === stroke,
      overflow: panel.scrollWidth > panel.clientWidth + 1,
      hit: document.elementFromPoint(5, 5) === root,
      inert: document.getElementById('pages-viewport').inert,
      modal: root.getAttribute('role') === 'dialog' && root.getAttribute('aria-modal') === 'true',
      stageFont: parseFloat(getComputedStyle(root.querySelector('.voice-status-stage')).fontSize),
      titleFont: parseFloat(getComputedStyle(root.querySelector('.voice-status-title')).fontSize),
      detailFont: parseFloat(getComputedStyle(root.querySelector('.voice-status-detail')).fontSize),
      button: !!root.querySelector('button'),
      headingHidden: root.querySelector('.voice-status-heading').hidden,
      scrollable: panel.scrollHeight > panel.clientHeight && css.overflowY === 'auto'
    };
  })()`)
  for (const property of ['fullscreen', 'transparent', 'bounded', 'centered', 'bottom', 'charcoal', 'outlined', 'hit', 'inert', 'modal']) {
    assert.equal(result[property], true, `${state}: ${property}`)
  }
  assert.ok(result.width <= 960, 'Panel width stays bounded on the native display')
  assert.equal(result.overflow, false, `${state}: no horizontal overflow`)
  assert.equal(result.button, false, 'No Dismiss control')
  assert.ok(result.detailFont >= 18)
  if (width === 1920) { assert.ok(result.stageFont >= 24); assert.ok(result.titleFont >= 32) }
  if (state === 'idle') { assert.equal(result.headingHidden, true, 'No Complete label'); assert.equal(result.scrollable, true) }
}

async function blockedInputs(originalPage) {
  await evaluate(`(() => {
    const root = document.getElementById('voice-status');
    document.elementFromPoint(5, 5).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    root.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 300, clientY: 5 }));
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    for (const input of ['left', 'right', 'primary', 'secondary']) window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: input }));
    document.querySelectorAll('#dots .dot')[2].click();
  })()`)
  win.webContents.send('odk-remote-navigation', { direction: 'next' })
  await pause()
  assert.equal(await evaluate(`document.getElementById('page-context').textContent`), originalPage)
  assert.equal(pageState.canPrev, false)
  assert.equal(pageState.canNext, false)
  assert.deepEqual(pageState.actions, [])
}

async function checkSize(width, height) {
  win.setContentSize(width, height)
  await pause()
  await evaluate(`document.querySelectorAll('#dots .dot')[1].click(); document.querySelectorAll('#dots .dot')[1].focus()`)
  const originalPage = await evaluate(`document.getElementById('page-context').textContent`)
  for (const state of ['starting', 'recording', 'sending', 'transcribing', 'thinking', 'error', 'unavailable']) {
    await send({ state, message: state === 'error' ? 'Configuration required. '.repeat(30) : '' })
    await geometry(state, width)
  }
  await blockedInputs(originalPage)
  const message = `Response 测试结果 ${'unbroken'.repeat(60)}\n`.repeat(100)
  await send({ state: 'idle', message })
  await geometry('idle', width)
  assert.equal(await evaluate(`document.querySelector('.voice-status-title').textContent`), message)
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'down' }))`)
  assert.ok(await evaluate(`document.querySelector('.voice-status-content').scrollTop > 0`))
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'back' }))`)
  assert.equal(await evaluate(`document.getElementById('voice-status').hidden && !document.getElementById('pages-viewport').inert && document.activeElement === document.querySelectorAll('#dots .dot')[1]`), true)
  assert.equal(await evaluate(`document.getElementById('page-context').textContent`), originalPage)
  await evaluate(`window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'left' }))`)
  assert.notEqual(await evaluate(`document.getElementById('page-context').textContent`), originalPage)
  assert.equal(win.isVisible(), false, 'Test window must remain hidden')
  assert.equal(win.isFocused(), false, 'Test window must never own foreground focus')
}

app.whenReady().then(async () => {
  ipcMain.handle('odk-remote-publish-page-state', (_event, state) => { pageState = state; return { ok: true } })
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight', 'odk-user-apps-list', 'odk-camera-frame']) {
    ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [] }))
  }
  win = new BrowserWindow({ show: false, width: 480, height: 854, useContentSize: true, webPreferences: {
    offscreen: true, preload: path.resolve(__dirname, '../src/preload.js'), contextIsolation: true, sandbox: true,
  } })
  win.on('show', () => { throw new Error('Offscreen test window was shown') })
  win.on('focus', () => { throw new Error('Offscreen test window received foreground focus') })
  assert.equal(win.webContents.isOffscreen(), true)
  await win.loadFile(path.resolve(__dirname, '../src/renderer/index.html'))
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`odkTheme.set(${JSON.stringify(theme)}); document.fonts.ready.then(() => true)`)
    for (const [width, height] of [[1920, 1280], [480, 854], [320, 480]]) await checkSize(width, height)
  }
  console.log('VOICE_FLOATING_PANEL_PASS: 3 themes, 3 sizes, hidden offscreen window; no foreground focus')
  finish(0)
}).catch((error) => { console.error(error); finish(1) })
