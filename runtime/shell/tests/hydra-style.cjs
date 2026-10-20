'use strict'
// The Hydra composition harness: the same cell seam the Futu tile uses.
//
// Hydra uses a wide Desk canvas and retains smaller measured shapes. Three
// things are asserted for every cell and every theme: nothing is drawn outside
// the cell, no reading falls below the readable floor, and a shape that leaves
// readings out says how many it left out. The cell, not the window and not the
// host, is the unit: the same tile mounts into a fixed box with --cell-dim set
// to it, and no rule in the tile may know which panel the box came from.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { collectWidgetContent, measureDensity } = require('./helpers/widget-density')
const captureDir = process.argv.find(arg => arg.startsWith('--capture-dir='))?.slice('--capture-dir='.length)
const reportDensity = process.argv.includes('--density-report-only')
if (captureDir) fs.mkdirSync(captureDir, { recursive: true })
const root = path.resolve(__dirname, '..')
app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
// The host decides where a temporary directory lives, so this gate runs on the
// reference host and on a Windows host alike.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-hydra-style-'))
app.setPath('userData', userData)
app.on('will-quit', () => { try { fs.rmSync(userData, { recursive: true, force: true }) } catch {} })
const timer = setTimeout(() => app.exit(1), 60000)

const THEMES = ['instrument', 'pixel', 'border-beam', 'liquid-glass']
// A snapshot with the widest values the bridge can carry: a two-digit humidity, a
// four-figure pressure, and a lux value in the abbreviated form.
const LIVE = {
  configured: true, connected: true,
  env: { tempC: 31.3, humidity: 79.8, pressureHpa: 998.9, lux: 1234, updatedAt: Date.now(), stale: false },
  nodes: [{ id: 1, online: true, pump: false, soilPercent: 62 }, { id: 2, online: true, pump: true, soilPercent: 48 }],
}
const SNAPSHOTS = { live: LIVE, unconfigured: { configured: false, connected: false, env: null, nodes: [] } }
// Tall cells: the two promised panels, a panel a few pixels short of the promised
// minimum, and the narrowest cell the tall composition is drawn in. Square cells:
// a compact window, the cells a short window computes, and a cell too small for
// the tile's state line.
const CELLS = [
  ['Desk strip', 1103, 357, 'wide-short'],
  ['handheld Desk strip', 619, 196, 'wide-short'],
  ['short wide boundary', 560, 186, 'wide-short'],
  ['Desk canvas', 1103, 730, 'wide'],
  ['wide boundary', 480, 300, 'wide'],
  ['below wide width', 479, 300, 'compact'],
  ['below wide height', 480, 299, 'compact'],
  ['reference tall', 348, 724, 'tall'],
  ['wide reading boundary', 338, 724, 'tall'],
  ['narrow reading boundary', 334, 724, 'tall'],
  ['handheld tall', 186, 400, 'tall'],
  ['short panel tall', 168, 336, 'tall'],
  ['narrow tall floor', 120, 240, 'tall'],
  ['compact window', 292, 292, 'compact'],
  ['square cell', 168, 168, 'plants'],
  ['short window cell', 128, 128, 'plants'],
  ['narrowest plant cell', 116, 120, 'plants'],
  ['tall slot too narrow', 110, 260, 'small'],
  ['smallest computed cell', 94, 94, 'small'],
]
const CAPTION_FLOOR = 12
const DATA_FLOOR = 14

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 776, webPreferences: { offscreen: true, backgroundThrottling: false } })
  win.webContents.on('console-message', details => { if (details.level === 'error') console.error('Hydra fixture renderer:', details.message) })
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1280, height: 776, deviceScaleFactor: 1, mobile: false })
  win.webContents.setZoomFactor(1)
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
  const result = await win.webContents.executeJavaScript(`(async () => {
    if (innerWidth !== 1280 || innerHeight !== 776 || devicePixelRatio !== 1 || visualViewport.scale !== 1) throw Error('Hydra rendering scale changed')
    const SNAPSHOTS = ${JSON.stringify(SNAPSHOTS)}
    const CAPTION_FLOOR = ${CAPTION_FLOOR}
    const DATA_FLOOR = ${DATA_FLOOR}
    const mount = async (theme, width, height, snapshot) => {
      window.odkTheme.set(theme)
      await document.fonts.ready
      await new Promise(resolve => setTimeout(resolve, 120))
      const host = document.createElement('div')
      host.className = 'widget widget-display-only w-hydra'
      host.dataset.widget = 'odk.tile.hydra-preview'
      host.style.cssText = 'position:fixed;left:0;top:0;width:' + width + 'px;height:' + height + 'px;--cell-dim:' + Math.min(width, height) + 'px;'
      document.body.append(host)
      window.odkPlatform = { getHydraStatus: async () => snapshot }
      host.cleanups = []
      window.odkPlugins.get('odk.tile.hydra').mount(host, { onTick() {}, trackCleanup(cleanup) { host.cleanups.push(cleanup) } })
      await new Promise(resolve => setTimeout(resolve, 160))
      for (const fill of host.querySelectorAll('.hydra-meter-fill')) {
        for (const animation of fill.getAnimations()) animation.finish()
      }
      return host
    }
    const release = host => { for (const cleanup of host.cleanups) cleanup(); host.remove() }
    const cases = []
    for (const [name, width, height] of ${JSON.stringify(CELLS.map(([name, width, height]) => [name, width, height]))}) {
      for (const theme of ${JSON.stringify(THEMES)}) {
        const host = await mount(theme, width, height, SNAPSHOTS.live)
        if (name.endsWith('reading boundary')) {
          host.style.padding = '28px'
          await new Promise(resolve => setTimeout(resolve, 160))
        }
        const box = host.getBoundingClientRect()
        const body = host.querySelector('.hydra-body')
        // Anything drawn outside the cell: the defect this gate exists for.
        const escaping = [...host.querySelectorAll('*')].filter(node => {
          const rect = node.getBoundingClientRect()
          return rect.height > 0 && (rect.bottom > box.bottom + 1 || rect.top < box.top - 1 || rect.right > box.right + 1 || rect.left < box.left - 1)
        }).map(node => String(node.className).slice(0, 24))
        const texts = [...host.querySelectorAll('*')].filter(node => node.children.length === 0 && (node.textContent || '').trim() && node.getBoundingClientRect().height > 0)
        const envCells = [...host.querySelectorAll('.hydra-env-cell')]
        const plants = [...host.querySelectorAll('.hydra-plant')]
        const hint = host.querySelector('.hydra-hint')
        cases.push({
          name, theme, cell: width + 'x' + height,
          shape: body ? body.dataset.shape : null,
          contentWidth: body.getBoundingClientRect().width,
          environmentFont: parseFloat(getComputedStyle(host.querySelector('.hydra-env-value')).fontSize),
          plantFont: parseFloat(getComputedStyle(host.querySelector('.hydra-plant-soil')).fontSize),
          groupGaps: {
            afterHeader: host.querySelector('.hydra-plants').getBoundingClientRect().top - host.querySelector('.hydra-head').getBoundingClientRect().bottom,
            beforeEnvironment: host.querySelector('.hydra-env').getBoundingClientRect().top - host.querySelector('.hydra-plants').getBoundingClientRect().bottom,
          },
          edgeInsets: {
            top: host.querySelector('.hydra-head').getBoundingClientRect().top - host.getBoundingClientRect().top,
            expectedTop: parseFloat(getComputedStyle(host).paddingTop) + parseFloat(getComputedStyle(host).borderTopWidth),
          },
          meters: [...host.querySelectorAll('.hydra-meter-fill')].map(fill => ({
            texture: (() => {
              if (!fill.closest('.hydra-watering')) return null
              const before = getComputedStyle(fill).backgroundImage
              const previous = host.style.getPropertyValue('--odk-primary')
              const priority = host.style.getPropertyPriority('--odk-primary')
              try {
                host.style.setProperty('--odk-primary', 'rgb(17, 31, 47)')
                return { before, changed: getComputedStyle(fill).backgroundImage !== before }
              } finally {
                if (previous) host.style.setProperty('--odk-primary', previous, priority)
                else host.style.removeProperty('--odk-primary')
              }
            })(),
            layoutWidth: fill.offsetWidth,
            trackWidth: fill.parentElement.offsetWidth,
            fraction: fill.parentElement.getBoundingClientRect().width > 0
              ? fill.getBoundingClientRect().width / fill.parentElement.getBoundingClientRect().width : null,
            transition: getComputedStyle(fill).transitionProperty,
            origin: getComputedStyle(fill).transformOrigin,
          })),
          escaping,
          contained: host.scrollHeight <= host.clientHeight + 1,
          rendering: { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, zoom: visualViewport.scale, fonts: document.fonts.status, theme: window.odkTheme.get() },
          rows: new Set(envCells.filter(node => node.getBoundingClientRect().height > 0).map(node => Math.round(node.getBoundingClientRect().top))).size,
          density: (${collectWidgetContent.toString()})().find(widget => widget.id === 'odk.tile.hydra-preview'),
          plantColumns: new Set(plants.filter(node => node.getBoundingClientRect().height > 0).map(node => Math.round(node.getBoundingClientRect().left))).size,
          columns: new Set(envCells.filter(node => node.getBoundingClientRect().height > 0).map(node => Math.round(node.getBoundingClientRect().left))).size,
          envShown: envCells.filter(node => node.getBoundingClientRect().height > 0).length,
          plantsShown: plants.filter(node => node.getBoundingClientRect().height > 0).length,
          hint: hint ? hint.textContent : '',
          hintWhole: !hint || (hint.scrollWidth <= hint.clientWidth + 1),
          hintVisible: Boolean(hint && hint.getBoundingClientRect().height > 0),
          smallest: texts.length ? Math.min(...texts.map(node => parseFloat(getComputedStyle(node).fontSize))) : 0,
          smallestReading: [...host.querySelectorAll('.hydra-env-value, .hydra-plant-soil')].filter(node => node.getBoundingClientRect().height > 0)
            .map(node => parseFloat(getComputedStyle(node).fontSize)).sort((a, b) => a - b)[0] ?? 0,
          ellipsized: texts.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => String(node.className).slice(0, 24)),
        })
        release(host)
      }
    }
    // An unconfigured bridge states itself at every cell rather than drawing
    // readings it does not have.
    const unconfigured = []
    for (const [name, width, height] of ${JSON.stringify(CELLS.map(([name, width, height]) => [name, width, height]))}) {
      for (const theme of ${JSON.stringify(THEMES)}) {
        const host = await mount(theme, width, height, SNAPSHOTS.unconfigured)
        const body = host.querySelector('.hydra-body')
        const padding = getComputedStyle(host)
        unconfigured.push({
          name, theme, cell: width + 'x' + height,
          shape: body?.dataset.shape,
          padding: ['Top', 'Right', 'Bottom', 'Left'].map(side => parseFloat(padding['padding' + side])),
          badge: host.querySelector('.hydra-badge').textContent,
          instrumentName: host.querySelector('.hydra-title').textContent,
          clipped: (${collectWidgetContent.toString()})().find(widget => widget.id === 'odk.tile.hydra-preview').clipped,
          readings: [...new Set([...host.querySelectorAll('.hydra-env-value, .hydra-plant-soil')]
            .filter(node => node.getBoundingClientRect().height > 0)
            .map(node => node.textContent))],
          contained: host.scrollHeight <= host.clientHeight + 1,
        })
        release(host)
      }
    }
    return { cases, unconfigured }
  })()`)

  let checked = 0
  for (const row of result.cases) {
    const where = JSON.stringify(row)
    assert.deepEqual(row.escaping, [], where)
    if (row.theme === 'pixel' && row.name === 'wide reading boundary') { assert.equal(row.contentWidth, 280, where); assert.equal(row.environmentFont, 40, where) }
    if (row.theme === 'pixel' && row.name === 'narrow reading boundary') { assert.equal(row.contentWidth, 276, where); assert.equal(row.environmentFont, 32, where) }
    for (const [index, meter] of row.meters.entries()) {
      assert.equal(meter.layoutWidth, meter.trackWidth, where)
      assert.equal(meter.transition, row.theme === 'pixel' ? 'none' : 'transform', where)
      assert.equal(parseFloat(meter.origin), 0, where)
      if (meter.texture) assert.equal(meter.texture.changed, true, where + ' watering texture must follow the semantic primary color')
      if (meter.fraction !== null) assert.ok(Math.abs(meter.fraction - [0.62, 0.48][index]) < 0.001, where)
    }
    assert.equal(row.contained, true, where)
    assert.equal(row.ellipsized.length, 0, where)
    assert.ok(row.smallest >= CAPTION_FLOOR, where + ' caption floor ' + row.smallest)
    // A shape that shortens the readings states the count of what it left out; a
    // shape that draws no readings at all says why instead; a shape that draws the
    // whole composition has nothing to state.
    if (row.shape === 'plants') {
      assert.equal(row.hintVisible, true, where)
      assert.equal(row.hintWhole, true, where)
    } else if (row.shape === 'small') {
      assert.equal(row.hintVisible, true, where)
      assert.equal(row.hintWhole, true, where)
    } else {
      assert.equal(row.hintVisible, false, where)
    }
    if (row.plantsShown > 0) {
      assert.equal(row.plantsShown, 2, where)
      assert.ok(row.smallestReading >= DATA_FLOOR, where + ' data floor ' + row.smallestReading)
    }
    checked += 1
  }
  const wideDensity = result.cases.filter(row => row.name === 'Desk canvas').map(row => {
    const measured = measureDensity(row.density.frame, row.density.boxes,
      { target: 0.62, tolerance: 0.08, minOccupied: 0.2, maxEmptyBand: 0.28 })
    if (!reportDensity) assert.deepEqual(measured.violations, [], `${row.theme} wide instrument: ${JSON.stringify(measured)}`)
    return { theme: row.theme, ...measured }
  })
  console.log('HYDRA_WIDE_DENSITY ' + JSON.stringify(wideDensity))
  console.log('HYDRA_DENSITY_RESULT ' + JSON.stringify({ ok: wideDensity.every(row => row.violations.length === 0), reportOnly: reportDensity, gate: reportDensity ? 'comparison-only' : 'enforced', findings: wideDensity.filter(row => row.violations.length) }))
  // The declared shapes, at the cells they are drawn for.
  for (const [name] of CELLS) {
    const shapes = new Set(result.cases.filter(row => row.name === name).map(row => row.shape))
    assert.equal(shapes.size, 1, `${name} composed differently per theme: ${[...shapes]}`)
  }
  const byName = (name) => result.cases.find(row => row.name === name)
  for (const [name, , , expected] of CELLS) {
    const row = byName(name)
    assert.equal(row.shape, expected, JSON.stringify(row))
    if (expected === 'tall') {
      assert.equal(row.envShown, 4, JSON.stringify(row))
      // The tall composition stacks the instrument rows: one column of readings.
      assert.equal(row.columns, 1, JSON.stringify(row))
    }
    if (expected === 'wide') {
      assert.equal(row.envShown, 4, JSON.stringify(row))
      assert.equal(row.columns, 4, JSON.stringify(row))
      assert.equal(row.rows, 1, JSON.stringify(row))
      assert.equal(row.plantColumns, 2, JSON.stringify(row))
      assert.ok(row.environmentFont >= 24 && row.environmentFont <= 40, JSON.stringify(row))
      assert.ok(row.plantFont > row.environmentFont, JSON.stringify(row))
    }
    if (expected === 'wide-short') {
      assert.equal(row.envShown, 4, JSON.stringify(row))
      assert.equal(row.columns, 2, JSON.stringify(row))
      assert.equal(row.rows, 2, JSON.stringify(row))
      assert.equal(row.plantColumns, 2, JSON.stringify(row))
      assert.ok(row.plantFont > row.environmentFont, JSON.stringify(row))
    }
    if (expected === 'compact') {
      assert.equal(row.envShown, 4, JSON.stringify(row))
      // The compact composition pairs the readings two to a row.
      assert.equal(row.columns, 2, JSON.stringify(row))
    }
    if (expected === 'plants') {
      // The environment is the reading that goes first, and the tile says so.
      assert.equal(row.envShown, 0, JSON.stringify(row))
      assert.equal(row.hint, 'Not shown · 4', JSON.stringify(row))
    }
    if (expected === 'small') {
      // A cell too small for the tile's own state line says it cannot draw the
      // readings rather than drawing a fragment of them.
      assert.equal(row.envShown, 0, JSON.stringify(row))
      assert.equal(row.plantsShown, 0, JSON.stringify(row))
      assert.match(row.hint, /small/i, JSON.stringify(row))
    }
  }
  for (const row of result.cases.filter(row => row.shape === 'wide')) {
    assert.ok(Math.abs(row.edgeInsets.top - row.edgeInsets.expectedTop) < 1, `${row.theme} ${row.name} top inset: ${JSON.stringify(row.edgeInsets)}`)
    assert.ok(Object.values(row.groupGaps).every(gap => gap >= 12 && gap <= 20.1), `${row.theme} ${row.name} bounded group gaps: ${JSON.stringify(row.groupGaps)}`)
  }
  for (const row of result.unconfigured) {
    const where = JSON.stringify(row)
    assert.equal(row.badge, 'Unconfigured', where)
    assert.equal(row.instrumentName, 'Hydra', where)
    assert.equal(row.clipped, false, where)
    if (row.shape === 'plants') {
      const [width, height] = row.cell.split('x').map(Number)
      const inset = Math.max(12, Math.min(Math.min(width, height) * 0.08, 28))
      assert.ok(row.padding.every(value => Math.abs(value - inset) < 1), where + ` plant inset should be ${inset}px`)
    }
    // No reading is invented in any shape; a shape too small to draw a reading
    // draws none at all rather than a fabricated one.
    assert.deepEqual(row.readings, row.readings.length === 0 ? [] : ['--'], where)
    assert.equal(row.contained, true, where)
  }
  if (captureDir) {
    for (const theme of THEMES) {
      await win.webContents.executeJavaScript(`(async () => {
        window.odkTheme.set('${theme}');
        const host = document.createElement('div');
        host.className = 'widget widget-display-only w-hydra';
        host.id = 'hydra-capture';
        host.style.cssText = 'position:fixed;z-index:1000;left:0;top:0;width:1103px;height:730px;--cell-dim:357px';
        document.body.append(host);
        window.odkPlatform = { getHydraStatus: async () => (${JSON.stringify(LIVE)}) };
        window.hydraCaptureCleanups = [];
        window.odkPlugins.get('odk.tile.hydra').mount(host, { onTick() {}, trackCleanup(cleanup) { window.hydraCaptureCleanups.push(cleanup) } });
        await document.fonts.ready;
        await new Promise(r => setTimeout(r, 300));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      })()`)
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1103, height: 730 })
      assert.equal(image.isEmpty(), false)
      const normalized = image.resize({ width: 1103, height: 730 })
      assert.deepEqual(normalized.getSize(), { width: 1103, height: 730 })
      fs.writeFileSync(path.join(captureDir, `hydra-wide-${theme}.png`), normalized.toPNG())
      await win.webContents.executeJavaScript('window.hydraCaptureCleanups.forEach(cleanup => cleanup()); document.getElementById("hydra-capture").remove(); delete window.hydraCaptureCleanups')
    }
    fs.writeFileSync(path.join(captureDir, 'report.json'), JSON.stringify({ cases: result.cases, wideDensity }, null, 2))
  }
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  const reduced = await win.webContents.executeJavaScript(`(() => {
    const fill = document.createElement('div')
    fill.className = 'hydra-meter-fill'
    document.body.append(fill)
    const style = getComputedStyle(fill)
    const result = { property: style.transitionProperty, duration: style.transitionDuration }
    fill.remove()
    return result
  })()`)
  assert.deepEqual(reduced, { property: 'none', duration: '0s' })
  win.webContents.debugger.detach()
  console.log(`${reportDensity ? 'HYDRA_COMPOSITION_PASS' : 'HYDRA_STYLE_PASS'} ${checked} composition cases, ${result.unconfigured.length} unconfigured cases`)
  win.destroy()
}).then(() => { clearTimeout(timer); app.exit(0) }).catch(error => { clearTimeout(timer); console.error(error); app.exit(1) })
