const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { DEFAULTS, measureDensity, collectWidgetContent } = require('./helpers/widget-density.js')

const root = path.resolve(__dirname, '..')
const value = key => process.argv.find(arg => arg.startsWith(`${key}=`))?.slice(key.length + 1)
const reportOnly = process.argv.includes('--report-only')
const captureDir = value('--capture-dir')
const output = value('--output')
const sizes = (value('--sizes') || '1920x1280,1920x1080,960x640,480x854,320x480').split(',').map(size => {
  if (!/^\d+x\d+$/.test(size)) throw new Error(`Invalid size: ${size}`)
  return size.split('x').map(Number)
})
const fixtureDate = value('--date') || '2026-09-05T13:12:00'
if (!Number.isFinite(Date.parse(fixtureDate))) throw new Error(`Invalid fixture date: ${fixtureDate}`)
const fixtureTheme = value('--date-theme') || value('--theme') || null
if (fixtureTheme && !['instrument', 'border-beam', 'pixel'].includes(fixtureTheme)) throw new Error(`Invalid fixture theme: ${fixtureTheme}`)
const fixtureState = value('--state') || 'unavailable'
if (!['unavailable', 'live'].includes(fixtureState)) throw new Error(`Invalid fixture state: ${fixtureState}`)

ipcMain.handle('odk-opencode-go-status', () => ({ state: 'unconfigured' }))
ipcMain.handle('odk-remote-publish-page-state', () => true)
ipcMain.handle('odk-face-agent-status', () => fixtureState === 'live'
  ? { state: 'online', unlocked: true, facesCount: 1, emotion: { primary: 'happiness', confidence: 92 } }
  : { state: 'unavailable', unlocked: false })
ipcMain.handle('odk-pi-sessions', () => ({ summary: { running: fixtureState === 'live' ? 3 : 0, total: fixtureState === 'live' ? 5 : 0, workspacesCount: fixtureState === 'live' ? 2 : 0 }, sessions: [] }))
ipcMain.handle('odk-hydra-status', () => fixtureState === 'live'
  ? { configured: true, connected: true, env: { tempC: 31.3, humidity: 79.8, pressureHpa: 998.9, lux: 1234, updatedAt: Date.now(), stale: false }, nodes: [{ id: 1, online: true, pump: false, soilPercent: 62 }, { id: 2, online: true, pump: false, soilPercent: 48 }] }
  : { configured: true, connected: true, env: { tempC: 24.5, humidity: 61, pressureHpa: 1002, lux: 800, updatedAt: Date.now(), stale: true }, nodes: [{ id: 1, online: true, pump: false, soilPercent: 55 }, { id: 2, online: false, pump: false, soilPercent: null }] })

async function waitFor(win, expression) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression)) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Renderer did not settle: ${expression}`)
}

async function measureSize(win, width, height) {
  win.setContentSize(width, height)
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'))`)
  await waitFor(win, `window.__odkGrid?.width === ${width} && window.__odkGrid?.height === ${height}`)
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[1].click(); document.querySelector('.page[data-page="1"]').scrollTop = 0`)
  await waitFor(win, `Math.abs(document.querySelector('.page[data-page="1"]').getBoundingClientRect().left) < 1`)
  await waitFor(win, `Math.abs(document.querySelector('.widget').getBoundingClientRect().width - window.__odkGrid.cellW) < 2`)
  await win.webContents.executeJavaScript(`Promise.all([
      document.fonts.load('700 32px "Montserrat"'),
      document.fonts.load('400 16px "Noto Sans SC"'),
      document.fonts.load('400 16px "Zpix"'),
    ]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`)
  await new Promise(resolve => setTimeout(resolve, 300))
  const widgets = await win.webContents.executeJavaScript(`(${collectWidgetContent.toString()})()`)
  const expected = await win.webContents.executeJavaScript(`window.DESKTOP_LAYOUT.pages.find(page => page.kind === 'grid').widgets.map(widget => widget.id)`)
  const missing = expected.filter(id => !widgets.some(widget => widget.id === id))
  const results = widgets.map(widget => {
    // Numeric glanceable instruments: sparse ink by design; keep the fill/empty-band gate, relax per-widget.
    const profiles = {
      'odk.tile.clock': { target: 0.38, tolerance: 0.16, minOccupied: 0.18, maxEmptyBand: 0.36 },
      'odk.tile.pomodoro': { target: 0.42, tolerance: 0.14, minOccupied: 0.15, maxEmptyBand: 0.36 },
      'odk.tile.almanac': { target: 0.58, tolerance: 0.16, minOccupied: 0.18, maxEmptyBand: 0.28 },
      'odk.tile.hydra': { target: 0.75, tolerance: 0.18, minOccupied: 0.07, maxEmptyBand: 0.35 },
      'odk.tile.pi-sessions': { target: 0.44, tolerance: 0.20, minOccupied: 0.08, maxEmptyBand: 0.32 },
    }
    const settings = profiles[widget.id]
    const result = measureDensity(widget.frame, widget.boxes, settings)
    if (widget.clipped) result.violations.push('ancestor-clipping')
    return { ...widget, ...result }
  })
  if (captureDir) await captureWidgets(win, results, width, height)
  return { width, height, missing, widgets: results }
}

async function saveCapture(win, file, bounds) {
  const image = await win.webContents.capturePage(bounds)
  const raw = image.getSize()
  if (image.isEmpty() || Math.abs(raw.width / raw.height - bounds.width / bounds.height) > .01) {
    throw new Error(`Invalid screenshot dimensions: ${file}`)
  }
  const normalized = image.resize({ width: bounds.width, height: bounds.height })
  const size = normalized.getSize()
  if (size.width !== bounds.width || size.height !== bounds.height) throw new Error(`Screenshot resize failed: ${file}`)
  fs.writeFileSync(file, normalized.toPNG())
}

async function captureWidgets(win, widgets, width, height) {
  fs.mkdirSync(captureDir, { recursive: true })
  const prefix = `home-${fixtureState}-${width}x${height}`
  await saveCapture(win, path.join(captureDir, `${prefix}.png`), { x: 0, y: 0, width, height })
  for (const widget of widgets) {
    await win.webContents.executeJavaScript(`document.querySelector('[data-widget="${widget.id}"]').scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })`)
    const bounds = await win.webContents.executeJavaScript(`(() => {
      const r = document.querySelector('[data-widget="${widget.id}"]').getBoundingClientRect()
      return { x: Math.ceil(r.left), y: Math.ceil(r.top), width: Math.floor(r.width), height: Math.floor(r.height) }
    })()`)
    if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > width || bounds.y + bounds.height > height) {
      throw new Error(`Widget capture is outside the viewport: ${widget.id}`)
    }
    await saveCapture(win, path.join(captureDir, `${prefix}-${widget.id}.png`), bounds)
  }
}

async function main() {
  const win = new BrowserWindow({ width: sizes[0][0], height: sizes[0][1], frame: false, show: true, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  })
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const NativeDate = Date
    const epoch = new NativeDate(${JSON.stringify(fixtureDate)}).getTime()
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [epoch])) }
      static now() { return epoch }
    }
  }` })
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  await waitFor(win, `Boolean(window.__odkGrid)`)
  await win.webContents.executeJavaScript(`document.fonts.ready`)
  const renderedDate = await win.webContents.executeJavaScript(`new Date().getTime()`)
  if (renderedDate !== Date.parse(fixtureDate)) throw new Error('Fixture clock was not applied')
  if (fixtureTheme) {
    await win.webContents.executeJavaScript(`window.odkTheme.set(${JSON.stringify(fixtureTheme)})`)
    await waitFor(win, `document.documentElement.dataset.theme === ${JSON.stringify(fixtureTheme)}`)
  }
  await win.webContents.executeJavaScript(`window.odkServices.faceAgent.refresh()`)
  await waitFor(win, `document.querySelector('.pi-widget-count').textContent === '${fixtureState === 'live' ? 3 : 0}'`)
  await require('./widget-density-dom.cjs').verifyCollector(win)
  const runs = []
  for (const [width, height] of sizes) runs.push(await measureSize(win, width, height))
  const ok = runs.every(run => run.missing.length === 0 && run.widgets.every(widget => widget.violations.length === 0))
  const report = { schemaVersion: 1, metric: 'content-envelope / inner-frame', settings: DEFAULTS, fixtureState, fixtureDate, ok, runs }
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  for (const run of runs) {
    for (const widget of run.widgets) {
      console.log(`${widget.violations.length ? 'FAIL' : 'PASS'} ${run.width}x${run.height} ${widget.name}: fill=${(widget.fill * 100).toFixed(1)}% occupied=${(widget.occupied * 100).toFixed(1)}% empty-band=${(widget.emptyBand * 100).toFixed(1)}% ${widget.violations.join(', ')}`)
    }
    if (run.missing.length) console.error(`FAIL missing widgets: ${run.missing.join(', ')}`)
  }
  console.log(`WIDGET_DENSITY_RESULT ${JSON.stringify({ ok, reportOnly, runs: runs.length, violations: runs.flatMap(run => run.widgets).filter(widget => widget.violations.length).length })}`)
  clearTimeout(timeout)
  app.exit(ok || reportOnly ? 0 : 1)
}

const timeout = setTimeout(() => { console.error('Widget density timed out'); app.exit(1) }, 120000)
app.whenReady().then(main).catch(error => { clearTimeout(timeout); console.error(error); app.exit(1) })
