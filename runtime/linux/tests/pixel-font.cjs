const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const root = path.resolve(__dirname, '..')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-zpix-test-'))
app.setPath('userData', profile)
const captureDir = process.argv.find(arg => arg.startsWith('--capture-dir='))?.slice('--capture-dir='.length)
const js = (win, source) => win.webContents.executeJavaScript(source)
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const endpoint = createAppManagerEndpoint()
const samples = ['Desk runtime', '桌面运行状态 中文输入', '繁體中文 像素字體', '0123456789 13:12 100%']

ipcMain.handle('odk-opencode-go-status', () => ({ state: 'unconfigured' }))
ipcMain.handle('odk-face-agent-status', () => ({ state: 'unavailable', unlocked: false }))
ipcMain.handle('odk-pi-sessions', () => ({ summary: { running: 0, total: 0, workspacesCount: 0 }, sessions: [] }))
ipcMain.handle('odk-remote-publish-page-state', () => true)
ipcMain.handle('odk-hydra-status', () => ({ configured: false, connected: false, env: null, nodes: [] }))
ipcMain.handle('odk-weread-highlight', () => ({ status: 'unconfigured', highlight: null }))
ipcMain.handle('odk-user-apps-list', () => ({ ok: true, apps: [] }))
ipcMain.handle('odk-app-manager-list', () => endpoint.list())
ipcMain.handle('odk-app-manager-intent', (_event, intent) => endpoint.dispatch(intent))
ipcMain.handle('odk-app-manager-state', (_event, id) => endpoint.get(id))

async function waitForTheme(win, theme) {
  const end = Date.now() + 5000
  while (Date.now() < end) {
    if (await js(win, `document.documentElement.dataset.theme === '${theme}'`)) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Theme did not settle: ${theme}`)
}

async function actualFont(win, selector) {
  const { root: document } = await win.webContents.debugger.sendCommand('DOM.getDocument')
  const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: document.nodeId, selector })
  return win.webContents.debugger.sendCommand('CSS.getPlatformFontsForNode', { nodeId })
}

async function samplesCheck(win) {
  await js(win, `odkTheme.set('pixel')`)
  await waitForTheme(win, 'pixel')
  await js(win, `(async () => {
    await document.fonts.load('400 24px Zpix', ${JSON.stringify(samples.join(' '))})
    await odkAppPlatform.openApp({ appId: 'calendar' })
    const surface = document.querySelector('#app-runtime .runtime-app')
    const section = document.createElement('section')
    section.id = 'zpix-samples'
    const sampleTexts = ${JSON.stringify(samples)}
    sampleTexts.forEach((text, index) => {
      const p = document.createElement('p')
      p.id = 'zpix-sample-' + index
      p.textContent = text
      p.style.fontSize = '24px'
      section.append(p)
    })
    surface.append(section)
    await document.fonts.ready
  })()`)
  for (let index = 0; index < samples.length; index += 1) {
    const { fonts } = await actualFont(win, `#zpix-sample-${index}`)
    const used = fonts.filter(font => font.glyphCount > 0)
    assert.ok(used.length > 0, `Sample ${index} has rendered glyphs`)
    assert.ok(used.every(font => font.isCustomFont && /zpix/i.test(font.familyName)), JSON.stringify(used))
    console.log(`PASS actual Zpix glyphs: ${samples[index]}`)
  }
}

async function themeCheck(win) {
  const result = await js(win, `(() => {
    const current = document.querySelector('#page-context').textContent
    const focus = document.querySelector('#app-back')
    focus.focus()
    return ['instrument', 'border-beam', 'pixel'].every(theme => {
      odkTheme.set(theme)
      if (document.documentElement.dataset.theme !== theme) return false
      const family = getComputedStyle(document.querySelector('#zpix-sample-0')).fontFamily
      const themeOk = family.startsWith(theme === 'pixel' ? 'Zpix' : '"Noto Sans SC"')
      const uiOk = document.activeElement === focus && document.querySelector('#page-context').textContent === current
      return themeOk && uiOk
    })
  })()`)
  assert.ok(result, 'Theme switching restores native families without losing page or focus')
  console.log('PASS theme switching restores original fonts and preserves context')
}

async function themeLayoutCheck(win) {
  for (const theme of ['instrument', 'border-beam', 'pixel']) {
    await js(win, `odkTheme.set('${theme}')`)
    await waitForTheme(win, theme)
    const shown = await js(win, `document.documentElement.dataset.theme`)
    assert.equal(shown, theme, `active theme must display as ${theme}`)
    await layoutCheck(win, 1920, 1280)
    await layoutCheck(win, 320, 480)
  }
}

async function layoutCheck(win, width, height) {
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await js(win, `window.dispatchEvent(new Event('resize'))`)
  // Wait for the shell's grid math to reach the requested viewport. A fixed
  // delay measures a stale intermediate layout, which makes tiles sized for the
  // previous viewport report spurious text overflow.
  const settled = Date.now() + 5000
  while (Date.now() < settled) {
    if (await js(win, `window.__odkGrid?.width === ${width} && window.__odkGrid?.height === ${height}`)) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  await new Promise(resolve => setTimeout(resolve, 120))
  const result = await js(win, `(() => {
    const badFonts = []
    if (document.documentElement.dataset.theme === 'pixel') {
      for (const el of document.querySelectorAll('body *')) {
        if (![...el.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) continue
        const style = getComputedStyle(el)
        if (!style.fontFamily.startsWith('Zpix') || style.fontWeight !== '400' || style.fontSynthesis !== 'none') badFonts.push(el.className || el.id || el.tagName)
      }
    }
    const overflow = [...document.querySelectorAll('.widget')].flatMap(widget => {
      const r = widget.getBoundingClientRect()
      return [...widget.querySelectorAll('span, strong')].filter(el => {
        const box = el.getBoundingClientRect()
        return box.width && (box.left < r.left - 1 || box.right > r.right + 1 || box.bottom > r.bottom + 1 || box.top < r.top - 1)
      }).map(el => widget.dataset.app + ':' + el.className)
    })
    const placeholder = getComputedStyle(document.querySelector('#pi-search-input'), '::placeholder').fontFamily
    const theme = document.documentElement.dataset.theme
    return { badFonts, overflow, placeholder, theme }
  })()`)
  assert.deepEqual(result.badFonts, [], 'All Pixel text uses Zpix Regular without synthesis')
  assert.deepEqual(result.overflow, [], `${width}x${height}: Widget text stays contained`)
  if (result.theme === 'pixel') assert.ok(result.placeholder.startsWith('Zpix'), 'Input placeholder uses Zpix')
  if (captureDir) {
    fs.mkdirSync(captureDir, { recursive: true })
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(captureDir, `zpix-${width}x${height}.png`), image.resize({ width, height }).toPNG())
  }
  console.log(`PASS Pixel font scope and Widget layout ${width}x${height}`)
}

async function main() {
  const win = new BrowserWindow({ width: 1000, height: 800, frame: false, show: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  win.focus()
  win.webContents.focus()
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('DOM.enable')
  await win.webContents.debugger.sendCommand('CSS.enable')
  await js(win, `odkTheme.set('pixel')`)
  await waitForTheme(win, 'pixel')
  await samplesCheck(win)
  await themeCheck(win)
  await themeLayoutCheck(win)
  await js(win, `odkTheme.set('pixel')`)
  await waitForTheme(win, 'pixel')
  for (const size of [[1920, 1280], [480, 854], [320, 480]]) await layoutCheck(win, ...size)
  win.webContents.setZoomFactor(2)
  await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
  await js(win, `window.dispatchEvent(new Event('resize'))`)
  await new Promise(resolve => setTimeout(resolve, 150))
  const zoomed = await js(win, `(() => {
    const surface = document.querySelector('#app-runtime .runtime-app')
    return getComputedStyle(surface).fontFamily.startsWith('Zpix') && surface.scrollWidth <= surface.clientWidth + 1
  })()`)
  assert.ok(zoomed, 'Pixel App content reflows at 200 percent zoom')
  await actualFont(win, '#zpix-sample-1').then(({ fonts }) => {
    assert.ok(fonts.some(font => font.isCustomFont && /zpix/i.test(font.familyName) && font.glyphCount > 0))
  })
  await js(win, `document.querySelector('#zpix-samples').remove()`)
  const finalTheme = await js(win, `document.documentElement.dataset.theme`)
  assert.equal(finalTheme, 'pixel', 'run must end displaying the Pixel theme')
  console.log('PASS final displayed theme is pixel')
  console.log('PASS Pixel Chinese glyphs and App reflow at 200% zoom')
  console.log('PIXEL_FONT_PASS')
}

const timeout = setTimeout(() => { console.error('Zpix verification timed out'); app.exit(1) }, 45000)
process.once('exit', () => fs.rmSync(profile, { recursive: true, force: true }))
app.whenReady().then(main).then(() => { clearTimeout(timeout); app.exit(0) }).catch(error => { console.error(error); app.exit(1) })
