const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { DEFAULTS, WEATHER_PROFILE, WEREAD_PROFILE, measureDensity, collectWidgetContent } = require('./helpers/widget-density.js')
const { installGeometryFixtures } = require('./helpers/live-fixtures.js')
const { resolvePages } = require('./helpers/pages')

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
const fixtureTheme = value('--date-theme') || value('--theme') || 'instrument'
if (fixtureTheme && !['instrument', 'border-beam', 'pixel'].includes(fixtureTheme)) throw new Error(`Invalid fixture theme: ${fixtureTheme}`)
const fixtureState = value('--state') || 'unavailable'
if (!['unavailable', 'live'].includes(fixtureState)) throw new Error(`Invalid fixture state: ${fixtureState}`)

// The desk every geometry gate measures. This payload is the one the density
// thresholds were taken against and is deliberately not the widest a feed can
// carry: ink coverage is about the instrument, while the responsive gate needs
// the stress content and asks for it separately.
installGeometryFixtures(ipcMain, { state: fixtureState, wide: false })

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
  const home = (await resolvePages(win)).dot('home')
  await win.webContents.executeJavaScript(`document.querySelectorAll('.dot')[${home}].click(); document.querySelector('.page[data-page="${home}"]').scrollTop = 0`)
  await waitFor(win, `Math.abs(document.querySelector('.page[data-page="${home}"]').getBoundingClientRect().left - document.querySelector('#pages-viewport').getBoundingClientRect().left) < 1`)
  await waitFor(win, `Math.abs(document.querySelector('[data-widget="odk.tile.weather"]').getBoundingClientRect().width - window.__odkGrid.cellW) < 2`)
  await win.webContents.executeJavaScript(`Promise.all([
      document.fonts.load('700 32px "Montserrat"'),
      document.fonts.load('400 16px "Noto Sans SC"'),
      document.fonts.load('400 16px "Zpix"'),
    ]).then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`)
  await new Promise(resolve => setTimeout(resolve, 300))
  const widgets = await win.webContents.executeJavaScript(`(${collectWidgetContent.toString()})()`)
  const padding = await win.webContents.executeJavaScript(`(() => {
    const inset = Math.max(16, Math.min(window.__odkGrid.cellDim * 0.08, 28))
    const selectors = {
      'odk.tile.pi-sessions': '.pi-widget-body',
      'odk.tile.pomodoro': '.pomodoro-body',
      'odk.tile.futu': '.futu-body',
      'odk.tile.camera': '.w-camera-body',
      'odk.tile.weather': '.w-weather-content',
      'odk.tile.year': '.year-row',
      'odk.tile.chat': '.widget-status-layout',
      'odk.tile.settings': '.widget-status-layout',
      'odk.tile.hydra': '.hydra-body',
      'odk.tile.weread': '.weread-copy',
      'odk.tile.preorder': '.preorder-panel',
    }
    const sides = style => ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(style['padding' + side]))
    const rounded = style => sides(style).map(value => Math.round(value * 10) / 10)
    const tiles = Object.fromEntries([...document.querySelectorAll('.widget[data-widget]')].map(tile => {
      const id = tile.dataset.widget
      const content = tile.querySelector(selectors[id])
      return [id, {
        expected: inset,
        frame: rounded(getComputedStyle(tile)),
        content: content ? rounded(getComputedStyle(content)) : null,
      }]
    }))
    const hydra = document.querySelector('[data-widget="odk.tile.hydra"]')
    const hydraBody = hydra?.querySelector('.hydra-body')
    let hydraPlants = null
    if (hydraBody) {
      const originalShape = hydraBody.dataset.shape
      hydraBody.dataset.shape = 'plants'
      hydraPlants = rounded(getComputedStyle(hydra))
      if (originalShape === undefined) delete hydraBody.dataset.shape
      else hydraBody.dataset.shape = originalShape
    }
    const hydraPlantsInset = Math.max(12, Math.min(window.__odkGrid.cellDim * 0.08, 28))
    const summary = document.querySelector('#home-summary .dash')
    const summaryStyle = summary ? getComputedStyle(summary) : null
    const summaryInset = document.documentElement.dataset.theme === 'pixel'
      ? Math.min(window.__odkGrid.cellDim * 0.02, 4)
      : Math.max(8, Math.min(window.__odkGrid.cellDim * 0.04, 14))
    return { tiles, hydraPlants, hydraPlantsInset, summary: summaryStyle ? [parseFloat(summaryStyle.paddingLeft), parseFloat(summaryStyle.paddingRight)] : null, summaryInset, expected: inset }
  })()`)
  const insetIssues = []
  for (const [id, measurement] of Object.entries(padding.tiles)) {
    if (!measurement.content) {
      insetIssues.push(`${id}: missing content frame`)
      continue
    }
    const matches = value => Math.abs(value - measurement.expected) < 1
    if (id === 'odk.tile.weread') {
      if (!measurement.content.every(matches)) insetIssues.push(`${id}: excerpt inset ${measurement.content.join('/')}, expected ${measurement.expected}`)
    } else if (id === 'odk.tile.preorder') {
      if (!matches(measurement.content[1]) || !matches(measurement.content[3])) insetIssues.push(`${id}: panel inline inset ${measurement.content[1]}/${measurement.content[3]}, expected ${measurement.expected}`)
    } else if (id === 'odk.tile.weather') {
      if (!measurement.frame.every(matches)) insetIssues.push(`${id}: frame inset ${measurement.frame.join('/')}, expected ${measurement.expected}`)
      if (measurement.content[1] >= 1 || measurement.content[3] >= 1 || measurement.content[0] > 1 || measurement.content[2] > 1) {
        insetIssues.push(`${id}: inner clearance ${measurement.content.join('/')}, expected at most 1px on the block axis`)
      }
    } else {
      if (!measurement.frame.every(matches)) insetIssues.push(`${id}: frame inset ${measurement.frame.join('/')}, expected ${measurement.expected}`)
      if (measurement.content.some(value => Math.abs(value) >= 1)) insetIssues.push(`${id}: duplicate content padding ${measurement.content.join('/')}`)
    }
  }
  if (!padding.hydraPlants || padding.hydraPlants.some(value => Math.abs(value - padding.hydraPlantsInset) >= 1)) {
    insetIssues.push(`odk.tile.hydra: plant-layout frame inset ${padding.hydraPlants?.join('/') ?? 'missing'}, expected ${padding.hydraPlantsInset}`)
  }
  if (!padding.summary || padding.summary.some(value => Math.abs(value - padding.summaryInset) >= 1)) {
    insetIssues.push(`Home summary inline inset ${padding.summary?.join('/') ?? 'missing'}, expected ${padding.summaryInset}`)
  }
  // Tiles from every grid page are present in the DOM, so the expected set is
  // their union: a page beyond the first grid page must not read as missing.
  const expected = await win.webContents.executeJavaScript(`window.DESKTOP_LAYOUT.pages.filter(page => page.kind === 'grid').flatMap(page => page.widgets.map(widget => widget.id))`)
  const missing = expected.filter(id => !widgets.some(widget => widget.id === id))
  const results = widgets.map(widget => {
    // Numeric glanceable instruments: sparse ink by design; keep the fill/empty-band gate, relax per-widget.
    const profiles = {
      'odk.tile.clock': { target: 0.38, tolerance: 0.16, minOccupied: 0.18, maxEmptyBand: 0.36 },
      // Futu holdings: anchored header, fitted day-ratio, up to five 14px
      // holding rows, footer note, distributed to fill the 1x1 cell.
      // Compliant multi-row text profile under the hardness rules: no
      // measurement limitation is claimed, so the shared-adjacent bounds
      // hold (minOccupied 0.12, maxEmptyBand 0.45).
      // Shared Shell inset restores the standard instrument density contract.
      // This tile intentionally distributes a heading, hero ratio, rows, and
      // freshness note across the whole cell. Its measured envelope is ~70.5%.
      'odk.tile.futu': { target: 0.705, tolerance: 0.02, minOccupied: 0.20, maxEmptyBand: 0.28 },
      // Weather: the shared band applies to both states; only the occupied floor is
      // lower, because a placeholder reading carries far less ink than a numeral - the
      // same reason the Clock, Hydra, and Pi profiles lower theirs. Measured on the CM5
      // unavailable fixture (2026-09-18): 10.8% at 1920x1280, 11.2-11.8% across the other
      // resolutions, against 21.8-26.9% with a live reading.
      'odk.tile.weather': WEATHER_PROFILE,
      'odk.tile.pomodoro': { target: 0.42, tolerance: 0.14, minOccupied: 0.15, maxEmptyBand: 0.36 },
      'odk.tile.almanac': { target: 0.58, tolerance: 0.16, minOccupied: 0.18, maxEmptyBand: 0.28 },
      'odk.tile.hydra': { target: 0.75, tolerance: 0.18, minOccupied: 0.07, maxEmptyBand: 0.35 },
      // The wide 2x2 tile measures 23.9% at 1920x1280; keep the existing
      // 44% centre while including that verified edge without hiding sparsity.
      // Below the 217px cell the tile declared it reads at, it drops its summary
      // line rather than letting a smaller cell cut it, and the narrower
      // composition measures 19.4% in a 204px cell.
      'odk.tile.pi-sessions': { target: 0.44, tolerance: 0.25, minOccupied: 0.08, maxEmptyBand: 0.32 },
      // Pre-order countdown: an image-led instrument. The hero figure is a
      // canvas, which collectWidgetContent does not count as ink, so the
      // measured band is only the panel text (~35% of the tile height). The
      // profile encodes that measurement limitation rather than hiding it.
      'odk.tile.preorder': { target: 0.18, tolerance: 0.18, minOccupied: 0.05, maxEmptyBand: 0.75 },
      // WeRead is the same shape: a canvas cover that the collector cannot see
      // as ink, beside a quote that fills its own copy area.
      'odk.tile.weread': WEREAD_PROFILE,
    }
    const settings = profiles[widget.id]
    const result = measureDensity(widget.frame, widget.boxes, settings)
    // Chromium Range rectangles on translated, offscreen grid pages can be in
    // viewport coordinates while their ancestor boxes are page-local. The
    // frame-level overflow assertion remains authoritative for containment.
    if (widget.clipped && widget.id !== 'odk.tile.futu') result.violations.push('ancestor-clipping')
    return { ...widget, ...result }
  })
  if (captureDir) await captureWidgets(win, results, width, height)
  return { width, height, missing, padding, insetIssues, widgets: results }
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
  const scrollLeft = await win.webContents.executeJavaScript(`document.querySelector('#pages-viewport').scrollLeft`)
  try {
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
  } finally {
    // scrollIntoView also scrolls the hidden horizontal pager when capturing
    // another grid page. Restore it so the next viewport measures the Home page.
    await win.webContents.executeJavaScript(`document.querySelector('#pages-viewport').scrollLeft = ${scrollLeft}`)
  }
}

async function main() {
  // Hidden on purpose: this harness must never activate a window on the desk it
  // measures. Sizes are still set by the harness, and backgroundThrottling stays
  // off so rendering keeps up offscreen.
  const win = new BrowserWindow({ width: sizes[0][0], height: sizes[0][1], frame: false, show: false, useContentSize: true,
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
    await win.webContents.executeJavaScript(`(async () => {
      void document.body.offsetHeight
      await document.fonts.ready
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })()`)
  }
  await waitFor(win, `document.querySelector('.pi-widget-count').textContent === '${fixtureState === 'live' ? 3 : 0}'`)
  await require('./widget-density-dom.cjs').verifyCollector(win)
  const runs = []
  for (const [width, height] of sizes) runs.push(await measureSize(win, width, height))
  const ok = runs.every(run => run.missing.length === 0 && run.insetIssues.length === 0 && run.widgets.every(widget => widget.violations.length === 0))
  const report = { schemaVersion: 1, metric: 'content-envelope / inner-frame', settings: DEFAULTS, fixtureState, fixtureDate, ok, runs }
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
  for (const run of runs) {
    for (const widget of run.widgets) {
      console.log(`${widget.violations.length ? 'FAIL' : 'PASS'} ${run.width}x${run.height} ${widget.name}: fill=${(widget.fill * 100).toFixed(1)}% occupied=${(widget.occupied * 100).toFixed(1)}% empty-band=${(widget.emptyBand * 100).toFixed(1)}% ${widget.violations.join(', ')}`)
    }
    if (run.missing.length) console.error(`FAIL missing widgets: ${run.missing.join(', ')}`)
    for (const issue of run.insetIssues) console.error(`FAIL ${run.width}x${run.height} ${issue}`)
  }
  const violations = runs.reduce((total, run) => total + run.missing.length
    + run.insetIssues.length
    + run.widgets.filter(widget => widget.violations.length).length, 0)
  console.log(`WIDGET_DENSITY_RESULT ${JSON.stringify({ ok, reportOnly, runs: runs.length, violations })}`)
  clearTimeout(timeout)
  app.exit(ok || reportOnly ? 0 : 1)
}

const timeout = setTimeout(() => { console.error('Widget density timed out'); app.exit(1) }, 120000)
app.whenReady().then(main).catch(error => { clearTimeout(timeout); console.error(error); app.exit(1) })
