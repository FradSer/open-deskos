// The Pi Sessions tile is a glanceable instrument, so its reading has to be
// drawable inside the cell it is given. A goal longer than one line wraps and is
// bounded rather than being cut away, and the rest of the tile stays readable.
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
// small cell comes from a two-column layout, where the page's composition cannot
// be placed and every tile gets a single cell.
const CASES = [['reference panel', 348, 1920, 1280], ['handheld panel', 186, 1280, 776], ['small cell', 204, 480, 854]]
const THEMES = ['instrument', 'pixel', 'border-beam']
const GOAL_FLOOR = 14

// The tile's own scan, including a goal longer than the tile is wide.
installGeometryFixtures(ipcMain, { state: 'live', wide: true })
const SCANS = [
  ['working goal', { summary: { running: 2, total: 5, workspacesCount: 4 }, sessions: WIDE_SESSIONS }],
  ['idle goal', { summary: { running: 0, total: 5, workspacesCount: 4 }, sessions: WIDE_SESSIONS.map(session => ({ ...session, status: session.status === 'running' ? 'settled' : session.status, updatedAt: new Date(session.updatedAt).toISOString() })) }],
  ['empty scan', { summary: { running: 0, total: 0, workspacesCount: 0 }, sessions: [] }],
  ['three-digit count', { summary: { running: 123, total: 123, workspacesCount: 1 }, sessions: Array.from({ length: 123 }, (_, index) => ({ sessionId: String(index), status: 'running' })) }],
]
let scan = SCANS[0][1]
ipcMain.removeHandler('odk-pi-sessions')
ipcMain.handle('odk-pi-sessions', () => scan)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const READ = `(() => { try {
  const GOAL_FLOOR = ${GOAL_FLOOR}
  const host = document.querySelector('[data-widget="odk.tile.pi-sessions"]')
  if (!host) return { error: 'tile not mounted' }
  const goal = host.querySelector('.pi-widget-context .w-state')
  const summary = host.querySelector('.pi-widget-summary')
  const count = host.querySelector('.pi-widget-count')
  const countRange = document.createRange()
  countRange.selectNodeContents(count)
  const countBounds = countRange.getBoundingClientRect()
  const metricBounds = count.parentElement.getBoundingClientRect()
  const style = getComputedStyle(goal)
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
  const lines = Math.round(goal.getBoundingClientRect().height / lineHeight)
  // The width the goal would need on a single line, measured on the element
  // itself with its bound lifted, so "did this need to wrap" is a measurement
  // rather than an assumption about the text. Measuring a clone is not enough:
  // the Pixel theme's CJK face is a full-width pixel font, and a clone can end up
  // measured in the fallback face instead of the one the tile renders.
  const bound = goal.style.whiteSpace
  goal.style.whiteSpace = 'nowrap'
  const singleLineWidth = goal.scrollWidth
  goal.style.whiteSpace = bound
  const needsWrap = singleLineWidth > goal.clientWidth + 1
  return {
    error: null,
    cell: Math.round(host.getBoundingClientRect().width),
    layoutCell: Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-dim')) || 0,
    text: goal.textContent.trim(),
    font: parseFloat(style.fontSize),
    lines,
    needsWrap,
    wrapped: lines > 1,
    saysItIsBounded: style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none',
    scrollable: ['auto', 'scroll'].includes(getComputedStyle(host).overflowY),
    hiddenV: host.scrollHeight - host.clientHeight,
    summaryVisible: summary.getBoundingClientRect().height > 0,
    summaryFont: parseFloat(getComputedStyle(summary).fontSize),
    countVisible: count.getBoundingClientRect().height > 0,
    countContained: countBounds.left >= metricBounds.left - 1 && countBounds.right <= metricBounds.right + 1,
  }
} catch (error) { return { error: String((error && error.stack) || error) } } })()`

async function main() {
  const win = new BrowserWindow({
    width: 1280, height: 776, frame: false, show: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src/preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  const results = []
  for (const [state, payload] of SCANS) {
    scan = payload
    await win.loadFile(path.join(root, 'src/renderer/index.html'))
    for (const [name, cell, width, height] of CASES) {
      win.setContentSize(width, height)
      await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'))`)
      await wait(500)
      for (const theme of THEMES) {
        await win.webContents.executeJavaScript(`window.odkTheme.set(${JSON.stringify(theme)})`)
        await wait(400)
        const reading = await win.webContents.executeJavaScript(READ)
        results.push({ panel: name, state, theme, ...reading })
      }
    }
  }
  for (const [name, cell] of CASES) {
    const reading = results.find((item) => item.panel === name)
    assert.equal(reading.layoutCell, cell, `${name}: the layout produced a ${reading.layoutCell}px cell, not the ${cell}px this case is about`)
  }
  for (const reading of results) {
    assert.ok(!reading.error, JSON.stringify(reading))
    const where = `${reading.panel} ${reading.state} ${reading.theme}`
    // A goal too wide for its cell wraps instead of being cut away; a goal that
    // fits stays on one line, because bounding is not the same as using up space.
    assert.equal(reading.wrapped, reading.needsWrap, `${where}: the goal wraps only when it has to (needs ${reading.needsWrap})`)
    assert.ok(reading.lines <= 2, `${where}: the goal is bounded at two lines, measured ${reading.lines}`)
    assert.equal(reading.saysItIsBounded, true, `${where}: a bounded goal says so`)
    assert.ok(reading.font >= GOAL_FLOOR, `${where}: goal type ${reading.font}px is under the data floor`)
    // A glanceable tile does not scroll, and nothing is hidden by it.
    assert.equal(reading.scrollable, false, `${where}: a glanceable tile does not scroll`)
    assert.ok(reading.hiddenV <= 1, `${where}: the tile hides ${reading.hiddenV}px of its own content`)
    // The rest of the instrument survives the bound.
    assert.equal(reading.countVisible, true, `${where}: the count stays visible`)
    assert.equal(reading.countContained, true, `${where}: every count digit stays inside its metric row`)
    // The summary is the line that goes when the cell is smaller than the tile
    // declared it reads at; the primary reading never goes.
    if (reading.panel !== 'small cell') assert.equal(reading.summaryVisible, true, `${where}: the summary stays visible`)
  }
  // Below the declared minimum the tile drops its least essential line rather
  // than letting the cell cut it off.
  for (const reading of results.filter((item) => item.panel === 'small cell')) {
    const where = `${reading.panel} ${reading.state} ${reading.theme}`
    assert.ok(reading.hiddenV <= 1, `${where}: the tile hides ${reading.hiddenV}px of its own content`)
    assert.equal(reading.countVisible, true, `${where}: the primary reading stays visible`)
    assert.equal(reading.summaryVisible, false, `${where}: a cell below the declared minimum drops the summary rather than clipping it`)
    assert.ok(reading.font >= GOAL_FLOOR, `${where}: goal type ${reading.font}px is under the data floor`)
  }
  console.log(`PI_TILE_STYLE_PASS ${results.length} cases`)
  win.destroy()
}

app.whenReady().then(main).then(() => { clearTimeout(timer); app.exit(0) }).catch((error) => { clearTimeout(timer); console.error(error); app.exit(1) })
