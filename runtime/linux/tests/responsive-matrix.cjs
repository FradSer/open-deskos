// The responsive matrix: the standing proof that the desk is readable on the two
// panels it is responsible for. The density gate asks how much ink a Widget lays
// down; this one asks whether everything the Widget has to say can be drawn, is
// reachable, and stays readable. Both read the same fixture content.
//
// Two sizes are promised, 1920x1280 and 1280x776, because those are the panels
// the desk ships on. Other window sizes are not promised and are not run here.
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { installGeometryFixtures } = require('./helpers/live-fixtures.js')
const { resolvePages } = require('./helpers/pages')
const root = path.resolve(__dirname, '..')
app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
// The host decides where a temporary directory lives, so this gate runs on a
// Windows Shell Host as well as on the reference host.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-responsive-'))
app.setPath('userData', userData)
// A Windows host can still hold a lock on a profile directory at exit, and a
// failed cleanup must not become a dialog on the owner's screen: the run has
// already reported by then.
app.on('will-quit', () => { try { fs.rmSync(userData, { recursive: true, force: true }) } catch { /* the temporary profile outlives the run */ } })
const timeout = setTimeout(() => { console.error('RESPONSIVE_MATRIX_TIMEOUT'); app.exit(2) }, 600000)

const value = (key) => process.argv.find((arg) => arg.startsWith(`${key}=`))?.slice(key.length + 1)
const output = value('--output')
const captureDir = value('--capture-dir')
// The two promised panels. A size list exists only so a failing run can be
// narrowed to one panel while fixing it.
const PROMISED = [['reference panel', 1920, 1280], ['handheld panel', 1280, 776]]
const wanted = (value('--sizes') || '').split(',').filter(Boolean)
const SIZES = wanted.length ? PROMISED.filter((size) => wanted.includes(size[0])) : PROMISED
const THEMES = ['instrument', 'pixel', 'border-beam']
const CAPTION_FLOOR = 12
const reportOnly = process.argv.includes('--report-only')

// The widest content each feed can carry, so the property is proven on stress
// content rather than on thin content that would pass anyway.
installGeometryFixtures(ipcMain, { state: 'live', wide: true })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function settle(win, expression) {
  const deadline = Date.now() + 6000
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression)) return
    await wait(30)
  }
  throw new Error(`Renderer did not settle: ${expression}`)
}

const READ = `(() => { try {
  const CAPTION_FLOOR = ${CAPTION_FLOOR}
  const visible = (node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0 }
  const label = (node) => { const widget = node.closest('[data-widget]'); if (widget) return widget.dataset.widget; const app = node.closest('.page-app'); return app ? 'app-surface' : 'page-chrome' }
  const screenReaderOnly = (node) => { for (let at = node; at; at = at.parentElement) if (at.classList && at.classList.contains('sr-only')) return true; return false }
  const scrollable = (node) => { const s = getComputedStyle(node); return ['auto', 'scroll'].includes(s.overflowY) || ['auto', 'scroll'].includes(s.overflowX) }
  const ellipsized = (node) => getComputedStyle(node).textOverflow === 'ellipsis'
  const clipped = []
  const belowFloor = []
  for (const node of document.querySelectorAll('main *, .page *')) {
    if (!visible(node) || node.children.length !== 0) continue
    const text = (node.textContent || '').trim()
    if (text.length === 0 || screenReaderOnly(node)) continue
    const size = parseFloat(getComputedStyle(node).fontSize)
    if (size < CAPTION_FLOOR) belowFloor.push({ label: label(node), text: text.slice(0, 30), size })
    // Text cut without saying so is a defect; text bounded on purpose, with the
    // ellipsis that says it is bounded, is the contract working.
    if (node.scrollWidth > node.clientWidth + 1 && !ellipsized(node)) {
      clipped.push({ label: label(node), cls: String(node.className).slice(0, 24), text: text.slice(0, 30), over: node.scrollWidth - node.clientWidth, size })
    }
  }
  // A glanceable Widget never scrolls, so anything it hides is lost. A page or an
  // App surface that scrolls has not lost anything.
  const hidden = [...document.querySelectorAll('[data-widget]')].filter(visible)
    .filter(node => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
    .map(node => ({ label: node.dataset.widget, hiddenV: node.scrollHeight - node.clientHeight, hiddenH: node.scrollWidth - node.clientWidth }))
  // Every Widget is drawn in a cell that meets the Minimum Readable Cell it
  // declared. This is what makes the declaration a number the desk enforces
  // rather than a comment: raising a floor fails the run until the layout, the
  // fixture, or the promise changes.
  const underDeclared = []
  for (const node of document.querySelectorAll('[data-widget]')) {
    if (!visible(node)) continue
    const minCell = Number(node.dataset.minCell)
    if (!Number.isFinite(minCell) || minCell <= 0) continue
    const box = node.getBoundingClientRect()
    const smallest = Math.min(box.width, box.height)
    if (smallest < minCell - 1) underDeclared.push({ label: node.dataset.widget, minCell, cell: Math.round(smallest) })
  }
  // The promise is that the desk is right at these two sizes, which includes
  // keeping the composition the layout declares: a tile the promised cells can
  // carry must not be left as a single cell.
  const droppedSpans = [...document.querySelectorAll('[data-widget][data-span="dropped"]')]
    .filter(visible).map(node => ({ label: node.dataset.widget, box: (() => { const r = node.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) })() }))
  return { error: null, cell: getComputedStyle(document.documentElement).getPropertyValue('--cell-dim').trim(), clipped, belowFloor, hidden, underDeclared, droppedSpans }
} catch (error) { return { error: String((error && error.stack) || error) } } })()`

async function main() {
  const win = new BrowserWindow({
    width: SIZES[0][1], height: SIZES[0][2], frame: false, show: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src/preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  })
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.executeJavaScript('document.fonts.ready')
  const pages = await resolvePages(win)
  const report = { schemaVersion: 1, promised: PROMISED.map(([name, width, height]) => ({ name, viewport: `${width}x${height}` })), themes: THEMES, floors: { caption: CAPTION_FLOOR }, runs: [], cells: [] }
  let violations = 0
  for (const [sizeName, width, height] of SIZES) {
    win.setContentSize(width, height)
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'))`)
    await settle(win, `window.__odkGrid?.width === ${width} && window.__odkGrid?.height === ${height}`)
    for (const theme of THEMES) {
      await win.webContents.executeJavaScript(`window.odkTheme.set(${JSON.stringify(theme)})`)
      await settle(win, `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`)
      for (const [id, index] of Object.entries(pages.index)) {
        await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${index}].click()`)
        await wait(800)
        const reading = await win.webContents.executeJavaScript(READ)
        const at = { size: sizeName, viewport: `${width}x${height}`, cell: reading.cell, theme, page: id }
        if (reading.error) { report.runs.push({ ...at, readError: reading.error }); violations += 1; continue }
        const findings = [
          ...reading.clipped.map((item) => ({ kind: 'clipped-text', ...item })),
          ...reading.belowFloor.map((item) => ({ kind: 'below-caption-floor', ...item })),
          ...reading.hidden.map((item) => ({ kind: 'hidden-in-glanceable-widget', ...item })),
          ...reading.underDeclared.map((item) => ({ kind: 'under-declared-min-cell', ...item })),
          ...reading.droppedSpans.map((item) => ({ kind: 'declared-span-dropped-at-a-promised-size', ...item })),
        ]
        report.runs.push({ ...at, findings })
        violations += findings.length
        report.cells.push({ size: sizeName, viewport: `${width}x${height}`, cell: reading.cell })
        for (const finding of findings) {
          console.log(`FAIL ${width}x${height} ${theme} ${id}: ${finding.kind} ${JSON.stringify(finding)}`)
        }
        if (captureDir) {
          const image = await win.webContents.capturePage()
          fs.mkdirSync(captureDir, { recursive: true })
          fs.writeFileSync(path.join(captureDir, `${sizeName}-${theme}-${id}.png`), image.toPNG())
        }
      }
    }
  }
  report.violations = violations
  report.ok = violations === 0
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`RESPONSIVE_MATRIX_RESULT ${JSON.stringify({ ok: report.ok, runs: report.runs.length, violations, cells: [...new Set(report.cells.map((cell) => `${cell.viewport}:${cell.cell}`))] })}`)
  win.destroy()
  // app.exit does not stop this function, so the failure exit has to be the other
  // branch: written as two statements, the second one always won.
  if (report.ok || reportOnly) {
    clearTimeout(timeout)
    app.exit(0)
  } else {
    clearTimeout(timeout)
    app.exit(1)
  }
}

app.whenReady().then(main).catch((error) => { clearTimeout(timeout); console.error(`RESPONSIVE_MATRIX_ERROR ${(error && error.stack) || error}`); app.exit(1) })
