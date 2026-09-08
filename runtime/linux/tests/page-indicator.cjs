const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const root = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-page-indicator-'))
app.setPath('userData', profile)
const captureDir = process.argv.find(arg => arg.startsWith('--capture-dir='))?.slice('--capture-dir='.length)
const themes = ['instrument', 'border-beam', 'pixel']
const sizes = [[1920, 1280], [1000, 800], [636, 900], [480, 854], [380, 600], [320, 480]]
const js = (win, source) => win.webContents.executeJavaScript(source)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let failures = 0
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) {
    failures += 1
    if (detail) console.log(JSON.stringify(detail))
  }
}

ipcMain.handle('odk-opencode-go-status', () => ({ state: 'unconfigured' }))
ipcMain.handle('odk-face-agent-status', () => ({ state: 'unavailable', unlocked: false }))
ipcMain.handle('odk-pi-sessions', () => ({ summary: { running: 2, total: 2, workspacesCount: 1 }, sessions: [] }))
ipcMain.handle('odk-remote-publish-page-state', () => true)
ipcMain.handle('odk-hydra-status', () => ({ configured: false, connected: false, env: null, nodes: [] }))

async function waitFor(win, expression) {
  const end = Date.now() + (process.arch === 'arm64' ? 15000 : 5000)
  while (Date.now() < end) {
    if (await js(win, expression)) return
    await delay(20)
  }
  throw new Error(`Indicator did not settle: ${expression}`)
}

async function resize(win, width, height) {
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await js(win, `window.dispatchEvent(new Event('resize'))`)
  await waitFor(win, `window.__odkGrid?.width === ${width} && window.__odkGrid?.height === ${height}`)
}

async function pointerSelect(win, index) {
  const point = await js(win, `(() => {
    const r = document.querySelectorAll('.dot')[${index}].getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 })
  await waitFor(win, `document.querySelectorAll('.dot')[${index}].getAttribute('aria-current') === 'page'`)
  await waitFor(win, `document.querySelectorAll('#dots .dot').length > 0 && !document.querySelector('#dots').getAnimations({ subtree: true }).length`)
}

async function inspect(win) {
  return js(win, `(() => {
    const buttons = [...document.querySelectorAll('#dots .dot')]
    const center = document.querySelector('#page-center').getBoundingClientRect()
    const nav = document.querySelector('#dots').getBoundingClientRect()
    const left = document.querySelector('#sb-pi-status').getBoundingClientRect()
    const right = document.querySelector('.sb-time').getBoundingClientRect()
    const bar = document.querySelector('#status-bar').getBoundingClientRect()
    const capsule = getComputedStyle(document.querySelector('#dots'), '::before')
    const capsuleTop = nav.top + parseFloat(capsule.top)
    const capsuleHeight = parseFloat(capsule.height) + (capsule.boxSizing === 'border-box' ? 0
      : parseFloat(capsule.borderTopWidth) + parseFloat(capsule.borderBottomWidth) + parseFloat(capsule.paddingTop) + parseFloat(capsule.paddingBottom))
    const marker = (button, part = '::after') => getComputedStyle(button, part)
    const active = buttons.find(button => button.getAttribute('aria-current') === 'page')
    const idle = buttons.find(button => button !== active)
    const theme = document.documentElement.dataset.theme
    const color = theme === 'pixel' ? 'rgb(52, 199, 89)' : 'rgb(255, 255, 255)'
    const shape = buttons.every(button => ['::before', '::after'].every(part => {
      const style = marker(button, part)
      const m = new DOMMatrix(style.transform)
      const width = parseFloat(style.width)
      const height = parseFloat(style.height)
      return style.content !== 'none' && style.display !== 'none' && height >= 6 && height <= 10 && (part === '::before' ? width >= height * 2 : width === height) && m.a === 1 && m.d === 1 && (theme === 'pixel' ? parseFloat(style.borderRadius) === 0 : parseFloat(style.borderRadius) > 0)
    }))
    const hits = buttons.every((button, i) => {
      const r = button.getBoundingClientRect()
      return r.width >= 28 && r.height >= 44 && getComputedStyle(button).transform === 'none' &&
        [r.top + 4, r.top + r.height / 2, r.bottom - 4].every(y => document.elementFromPoint(r.left + r.width / 2, y) === button) &&
        (!i || buttons[i - 1].getBoundingClientRect().right <= r.left)
    })
    const contained = center.left >= left.right + 4 && center.right <= right.left - 4 && center.top >= bar.top - 1 && center.bottom <= bar.bottom + 1 && Math.abs((nav.left + nav.right) / 2 - innerWidth / 2) < 1
    return {
      named: buttons.length === window.DESKTOP_LAYOUT.pages.length && buttons.every((button, i) => button.getAttribute('aria-label') === 'Page ' + (i + 1) + ', ' + window.DESKTOP_LAYOUT.pages[i].name),
      quiet: buttons.every(button => !button.textContent.trim()) && document.querySelector('#page-context').classList.contains('sr-only'),
      selected: buttons.filter(button => button.getAttribute('aria-current') === 'page').length === 1 && marker(active, '::before').backgroundColor === color && marker(active, '::before').opacity === '1' && marker(active).opacity === '0' && marker(idle).opacity === '1' && marker(idle, '::before').opacity === '0',
      shape, hits, contained,
      equalCapsules: Math.abs(left.height - 44) < 1 && Math.abs(nav.height - left.height) < 1 && Math.abs(capsuleHeight - left.height) < 1 && Math.abs(capsuleTop - left.top) < 1 && Math.abs(capsuleTop + capsuleHeight - left.bottom) < 1,
      stationary: buttons.every(button => ['::before', '::after'].every(part => marker(button, part).animationName === 'none')),
      transitions: buttons.every(button => ['::before', '::after'].every(part => !/all|width|height/.test(marker(button, part).transitionProperty))),
      footprint: [nav.x, nav.y, nav.width, nav.height],
      diagnostics: { theme, center: center.toJSON(), left: left.toJSON(), right: right.toJSON(), marker: marker(active).backgroundColor },
    }
  })()`)
}

async function capture(win, theme, width, height) {
  if (!captureDir) return
  fs.mkdirSync(captureDir, { recursive: true })
  const statusHeight = await js(win, `Math.ceil(document.querySelector('#status-bar').getBoundingClientRect().height)`)
  const image = await win.webContents.capturePage({ x: 0, y: 0, width, height: statusHeight })
  fs.writeFileSync(path.join(captureDir, `${theme}-${width}x${height}.png`), image.resize({ width, height: statusHeight }).toPNG())
}

async function sizeChecks(win, theme, width, height) {
  await resize(win, width, height)
  let footprint
  for (let index = 0; index < 4; index += 1) {
    await pointerSelect(win, index)
    const result = await inspect(win)
    const label = `${theme} ${width}x${height} page ${index + 1}`
    check(`${label}: quiet themed markers with accessible names`, result.quiet && result.shape && result.selected && result.named, result)
    check(`${label}: distinct centered targets`, result.hits && result.contained, result.diagnostics)
    check(`${label}: Pi and page capsules share aligned 44px edges`, result.equalCapsules, result.diagnostics)
    check(`${label}: stable footprint and restrained feedback`, result.stationary && result.transitions && (!footprint || result.footprint.every((v, i) => Math.abs(v - footprint[i]) < 1)))
    footprint = result.footprint
  }
  await capture(win, theme, width, height)
}

async function keyboardChecks(win, theme) {
  win.focus()
  win.webContents.focus()
  for (const [index, keyCode] of [[1, 'Enter'], [2, 'Space']]) {
    await js(win, `document.querySelectorAll('.dot')[${index - 1}].focus()`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
    await waitFor(win, `document.activeElement === document.querySelectorAll('.dot')[${index}] && document.activeElement.matches(':focus-visible')`)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    if (keyCode === 'Enter') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await waitFor(win, `document.querySelectorAll('.dot')[${index}].getAttribute('aria-current') === 'page' && document.activeElement === document.querySelectorAll('.dot')[${index}] && document.activeElement.matches(':focus-visible')`)
    const result = await js(win, `(() => ({
      instant: getComputedStyle(document.querySelector('#pages-track')).transitionDuration === '0s',
      focused: document.activeElement === document.querySelectorAll('.dot')[${index}],
      visible: document.activeElement.matches(':focus-visible'),
      outline: getComputedStyle(document.activeElement).outlineWidth,
    }))()`)
    check(`${theme} ${keyCode}: immediate activation with focus`, result.instant && result.focused && result.visible && parseFloat(result.outline) >= 2, result)
  }
  win.webContents.send('odk-remote-input', { input: 'right' })
  await waitFor(win, `document.querySelectorAll('.dot')[3].getAttribute('aria-current') === 'page'`)
  check(`${theme}: Remote selection updates marker and announcement`, await js(win, `document.querySelector('#page-context').textContent === 'Usage · 4/4' && getComputedStyle(document.querySelector('#pages-track')).transitionDuration === '0s'`))
}

async function themeChecks(win) {
  await resize(win, 480, 854)
  await js(win, `document.querySelectorAll('.dot')[2].click(); document.querySelectorAll('.dot')[2].focus()`)
  const stable = await js(win, `(() => {
    const buttons = [...document.querySelectorAll('.dot')]
    const bounds = buttons.map(button => button.getBoundingClientRect().toJSON())
    const page = document.querySelector('#page-context').textContent
    const focus = document.activeElement
    return ['instrument', 'pixel', 'border-beam', 'instrument'].every(theme => {
      odkTheme.set(theme)
      return document.activeElement === focus && document.querySelector('#page-context').textContent === page && buttons.every((button, i) => {
        const r = button.getBoundingClientRect()
        return button === document.querySelectorAll('.dot')[i] && ['x', 'y', 'width', 'height'].every(key => Math.abs(r[key] - bounds[i][key]) < 1)
      })
    })
  })()`)
  check('live theme switching retains page, DOM, focus and target geometry', stable)
}

async function motionChecks(win, theme) {
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await pointerSelect(win, 1)
  check(`${theme}: reduced motion keeps feedback static`, await js(win, `[...document.querySelectorAll('.dot')].every(button => {
    return ['::before', '::after'].every(part => {
      const style = getComputedStyle(button, part)
      return style.transitionDuration.split(', ').every(value => parseFloat(value) === 0) && new DOMMatrix(style.transform).a === 1
    })
  })`))
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] })
}

async function main() {
  const win = new BrowserWindow({ width: 1000, height: 800, show: false, frame: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  win.focus()
  win.webContents.focus()
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  await js(win, 'document.fonts.ready')
  await waitFor(win, `document.querySelector('#sb-pi-count').textContent === '2'`)
  win.webContents.debugger.attach('1.3')
  const initialTheme = await js(win, `odkTheme.set('pixel'), document.documentElement.dataset.theme`)
  assert.equal(initialTheme, 'pixel', 'display theme must default to pixel')
  for (const theme of themes) {
    await js(win, `odkTheme.set('${theme}'); document.fonts.ready`)
    const shown = await js(win, `document.documentElement.dataset.theme`)
    assert.equal(shown, theme, `active theme must display as ${theme}`)
    for (const size of sizes) await sizeChecks(win, theme, ...size)
    await keyboardChecks(win, theme)
    await motionChecks(win, theme)
  }
  await themeChecks(win)
  await js(win, `odkTheme.set('pixel')`)
  win.webContents.setZoomFactor(2)
  await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
  await waitFor(win, `window.__odkGrid?.width === innerWidth`)
  const result = await inspect(win)
  check('200% zoom retains centered reachable markers', result.hits && result.contained)
  const finalTheme = await js(win, `document.documentElement.dataset.theme`)
  assert.equal(finalTheme, 'pixel', 'run must end displaying the Pixel theme')
  assert.equal(failures, 0, `${failures} page-indicator checks failed`)
  console.log('PASS final displayed theme is pixel')
  console.log('PAGE_INDICATOR_PASS')
}

const timeout = setTimeout(() => { console.error('Page indicator timed out'); app.exit(1) }, process.arch === 'arm64' ? 300000 : 60000)
process.once('exit', () => fs.rmSync(profile, { recursive: true, force: true }))
app.whenReady().then(main).then(() => { clearTimeout(timeout); app.exit(0) }).catch(error => { console.error(error); app.exit(1) })
