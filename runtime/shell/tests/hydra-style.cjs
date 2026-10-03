'use strict'
// The Hydra composition harness: the same cell seam the Futu tile uses.
//
// Hydra is a tall instrument: its full composition is a 1x2 slot, so the question
// this gate answers is what the tile does in a cell that cannot hold that. Three
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
const root = path.resolve(__dirname, '..')
app.commandLine.appendSwitch('ozone-platform', 'headless')
app.disableHardwareAcceleration()
// The host decides where a temporary directory lives, so this gate runs on the
// reference host and on a Windows host alike.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-hydra-style-'))
app.setPath('userData', userData)
app.on('will-quit', () => { try { fs.rmSync(userData, { recursive: true, force: true }) } catch {} })
const timer = setTimeout(() => app.exit(1), 60000)

const THEMES = ['instrument', 'pixel', 'border-beam']
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
  ['reference tall', 348, 724, 'tall'],
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
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  const result = await win.webContents.executeJavaScript(`(async () => {
    const SNAPSHOTS = ${JSON.stringify(SNAPSHOTS)}
    const CAPTION_FLOOR = ${CAPTION_FLOOR}
    const DATA_FLOOR = ${DATA_FLOOR}
    const mount = async (theme, width, height, snapshot) => {
      document.documentElement.dataset.theme = theme
      await new Promise(resolve => setTimeout(resolve, 120))
      const host = document.createElement('div')
      host.className = 'widget widget-display-only w-hydra'
      host.style.cssText = 'position:fixed;left:0;top:0;width:' + width + 'px;height:' + height + 'px;--cell-dim:' + Math.min(width, height) + 'px;'
      document.body.append(host)
      window.odkPlatform = { getHydraStatus: async () => snapshot }
      window.odkPlugins.get('odk.tile.hydra').mount(host, { onTick() {}, trackCleanup() {} })
      await new Promise(resolve => setTimeout(resolve, 160))
      return host
    }
    const cases = []
    for (const [name, width, height] of ${JSON.stringify(CELLS.map(([name, width, height]) => [name, width, height]))}) {
      for (const theme of ${JSON.stringify(THEMES)}) {
        const host = await mount(theme, width, height, SNAPSHOTS.live)
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
          escaping,
          contained: host.scrollHeight <= host.clientHeight + 1,
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
        host.remove()
      }
    }
    // An unconfigured bridge states itself at every cell rather than drawing
    // readings it does not have.
    const unconfigured = []
    for (const [name, width, height] of ${JSON.stringify(CELLS.map(([name, width, height]) => [name, width, height]))}) {
      const host = await mount('instrument', width, height, SNAPSHOTS.unconfigured)
      unconfigured.push({
        name, cell: width + 'x' + height,
        badge: host.querySelector('.hydra-badge').textContent,
        readings: [...new Set([...host.querySelectorAll('.hydra-env-value, .hydra-plant-soil')]
          .filter(node => node.getBoundingClientRect().height > 0)
          .map(node => node.textContent))],
        contained: host.scrollHeight <= host.clientHeight + 1,
      })
      host.remove()
    }
    return { cases, unconfigured }
  })()`)

  let checked = 0
  for (const row of result.cases) {
    const where = JSON.stringify(row)
    assert.deepEqual(row.escaping, [], where)
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
  for (const row of result.unconfigured) {
    const where = JSON.stringify(row)
    assert.equal(row.badge, 'Unconfigured', where)
    // No reading is invented in any shape; a shape too small to draw a reading
    // draws none at all rather than a fabricated one.
    assert.deepEqual(row.readings, row.readings.length === 0 ? [] : ['--'], where)
    assert.equal(row.contained, true, where)
  }
  console.log(`HYDRA_STYLE_PASS ${checked} composition cases, ${result.unconfigured.length} unconfigured cases`)
  win.destroy()
}).then(() => { clearTimeout(timer); app.exit(0) }).catch(error => { clearTimeout(timer); console.error(error); app.exit(1) })
