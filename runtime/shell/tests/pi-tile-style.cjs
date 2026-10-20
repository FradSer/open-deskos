// Pi Widgets show working and idle counts; task details belong to the App.
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { installGeometryFixtures, WIDE_SESSIONS } = require('./helpers/live-fixtures.js')
const root = path.resolve(__dirname, '..')
app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-pi-tile-'))
app.setPath('userData', userData)
// A Windows host can still hold a lock on a profile directory at exit, and a
// failed cleanup must not become a dialog on the owner's screen: the run has
// already reported by then.
app.on('will-quit', () => { try { fs.rmSync(userData, { recursive: true, force: true }) } catch { /* the temporary profile outlives the run */ } })
const timer = setTimeout(() => { console.error('PI_TILE_STYLE_TIMEOUT'); app.exit(1) }, 120000)

// Each case names a real viewport and the cell that viewport produces, because a
// case about a cell the layout never produces would silently test nothing. The
// small cell comes from a compact layout, where the page's composition cannot
// be placed and every tile gets a single cell.
const CASES = [['reference panel', 357, 1920, 1280], ['handheld panel', 196, 1280, 776], ['small cell', 217, 480, 854], ['below-floor cell', 217, 480, 854, 206]]
const THEMES = ['instrument', 'pixel', 'border-beam', 'liquid-glass']
const LABEL_FLOOR = 14

// The tile's own scan, including a goal longer than the tile is wide.
installGeometryFixtures(ipcMain, { state: 'live', wide: true })
const SCANS = [
  ['short goal', { summary: { running: 1, total: 1, workspacesCount: 1 }, sessions: [{ status: 'running', sessionId: 'short', latestGoal: 'Review', cwd: '/desk' }] }],
  ['working goal', { summary: { running: 2, total: 5, workspacesCount: 4 }, sessions: WIDE_SESSIONS }],
  ['idle goal', { summary: { running: 0, total: 5, workspacesCount: 4 }, sessions: WIDE_SESSIONS.map(session => ({ ...session, status: session.status === 'running' ? 'settled' : session.status, updatedAt: new Date(session.updatedAt).toISOString() })) }],
  ['empty scan', { summary: { running: 0, total: 0, workspacesCount: 0 }, sessions: [] }],
  ['three-digit idle count', { summary: { running: 0, total: 123, workspacesCount: 1 }, sessions: Array.from({ length: 123 }, (_, index) => ({ sessionId: String(index), status: 'settled' })) }],
  ['three-digit count', { summary: { running: 123, total: 123, workspacesCount: 1 }, sessions: Array.from({ length: 123 }, (_, index) => ({ sessionId: String(index), status: 'running' })) }],
]
let scan = SCANS[0][1]
ipcMain.removeHandler('odk-pi-sessions')
ipcMain.handle('odk-pi-sessions', () => scan)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function settleViewport(win, width, height) {
  const deadline = Date.now() + 6000
  let actual
  while (Date.now() < deadline) {
    actual = await win.webContents.executeJavaScript(`({ width: innerWidth, height: innerHeight, scale: devicePixelRatio, gridWidth: window.__odkGrid?.width, gridHeight: window.__odkGrid?.height })`)
    if (actual.width === width && actual.height === height && actual.scale === 1
      && actual.gridWidth === width && actual.gridHeight === height) return
    await wait(30)
  }
  assert.fail(`Pi viewport did not settle at ${width}x${height}: ${JSON.stringify(actual)}`)
}

const READ = `(() => {
  const host = document.querySelector('[data-widget="odk.tile.pi-sessions"]');
  const count = host.querySelector('.pi-widget-count'), label = host.querySelector('.pi-widget-tag-label'), summary = host.querySelector('.pi-widget-summary');
  const bounds = host.getBoundingClientRect(), reading = count.getBoundingClientRect(), metric = count.parentElement.getBoundingClientRect();
  const capsule = host.querySelector('.pi-widget-live-tag').getBoundingClientRect(), footer = summary.getBoundingClientRect();
  const heading = (host.querySelector('.widget-title') || host.querySelector('.widget-heading')).getBoundingClientRect();
  return { viewport: { width: innerWidth, height: innerHeight, scale: devicePixelRatio },
    cell: Math.round(bounds.width), count: count.textContent, label: label.textContent, idle: summary.textContent, capsuleBelowCount: capsule.top >= reading.bottom + 4, idleBelowCapsule: footer.top >= capsule.bottom + 4,
    details: host.querySelectorAll('.pi-widget-activity,.pi-widget-context,.w-state').length,
    font: parseFloat(getComputedStyle(label).fontSize),
    scrollable: ['auto', 'scroll'].includes(getComputedStyle(host).overflowY),
    hiddenV: host.scrollHeight - host.clientHeight,
    summaryVisible: summary.getBoundingClientRect().height > 0,
    countContained: reading.left >= metric.left && reading.right <= metric.right,
    aligned: Math.abs(heading.left - bounds.left - parseFloat(getComputedStyle(host).borderLeftWidth) - parseFloat(getComputedStyle(host).paddingLeft)) < 1 };
})()`

async function main() {
  const win = new BrowserWindow({
    width: 1280, height: 776, frame: false, show: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src/preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true },
  })
  assert.equal(win.webContents.isOffscreen(), true, 'hidden Pi geometry renders offscreen')
  assert.equal(win.webContents.isPainting(), true, 'Pi layout callbacks have an active frame source')
  win.webContents.setZoomFactor(1)
  const results = []
  for (const [state, payload] of SCANS) {
    scan = payload
    await win.loadFile(path.join(root, 'src/renderer/index.html'))
    if (!win.webContents.debugger.isAttached()) {
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Page.enable')
    }
    for (const [name, cell, width, height, forcedCell] of CASES) {
      win.setContentSize(width, height)
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: false,
      })
      await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'))`)
      await settleViewport(win, width, height)
      if (forcedCell) await win.webContents.executeJavaScript(`(() => { const tile = document.querySelector('[data-widget="odk.tile.pi-sessions"]'); tile.style.width = '${forcedCell}px'; tile.style.height = '${forcedCell}px' })()`)
      for (const theme of THEMES) {
        await win.webContents.executeJavaScript(`window.odkTheme.set(${JSON.stringify(theme)})`)
        await wait(400)
        await win.webContents.executeJavaScript(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`)
        const reading = await win.webContents.executeJavaScript(READ)
        assert.equal(reading.count, String(payload.summary.running))
        assert.equal(reading.label, payload.summary.running > 0 ? 'Working...' : 'Idle')
        assert.equal(reading.idle, payload.sessions.filter(session => session.status === 'settled').length + ' idle')
        assert.deepEqual(reading.viewport, { width, height, scale: 1 }, `${name} ${state} ${theme}: measured viewport matches the case`)
        results.push({ panel: name, state, theme, ...reading })
      }
    }
  }
  for (const reading of results) {
    const where = `${reading.panel} ${reading.state} ${reading.theme}`
    assert.equal(reading.capsuleBelowCount, true, `${where}: capsule follows the count`)
    assert.equal(reading.idleBelowCapsule, true, `${where}: idle count follows the capsule`)
    assert.equal(reading.details, 0, `${where}: task details belong to the App`)
    assert.ok(reading.font >= LABEL_FLOOR, `${where}: labels remain readable`)
    assert.equal(reading.scrollable, false, `${where}: no inner scroll`)
    assert.ok(reading.hiddenV <= 1, `${where}: all readings fit`)
    assert.equal(reading.countContained, true, `${where}: every count digit fits`)
    assert.equal(reading.aligned, true, `${where}: heading follows the shared inset`)
    assert.equal(reading.summaryVisible, true, `${where}: idle count remains visible`)
  }
  console.log(`PI_TILE_STYLE_PASS ${results.length} cases`)
  win.destroy()
}

app.whenReady().then(main).then(() => { clearTimeout(timer); app.exit(0) }).catch((error) => { clearTimeout(timer); console.error(error); app.exit(1) })
