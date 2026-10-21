'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')
if (process.platform === 'linux') app.disableHardwareAcceleration()
ipcMain.handle('odk-remote-link-state', () => ({ state: 'disconnected', sequence: 0 }))
ipcMain.handle('odk-renderer-development-plugins', () => [])
ipcMain.handle('odk-personal-bot-status', () => ({ state: 'unavailable' }))
const { collectWidgetContent, measureDensity } = require('./helpers/widget-density')
const { resolvePages } = require('./helpers/pages')

const root = path.resolve(__dirname, '..')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-weather-layout-'))
app.setPath('userData', scratch)
const captureDir = process.argv.find(arg => arg.startsWith('--capture-dir='))?.slice('--capture-dir='.length)
const live = {
  status: 'live', place: 'Shenzhen', unit: '°C', updatedAt: 1_700_000_000_000,
  current: { temperature: 25, unit: '°C', condition: 'Partly cloudy', sky: 'cloud' },
  daily: { high: 27, low: 21 },
}
const cases = [
  ['live', live],
  ['waiting', null],
  ['stale', { ...live, status: 'stale' }],
  ['unavailable', { status: 'unavailable', place: 'Shenzhen', unit: '°C', current: null, daily: null }],
  ['unconfigured', { status: 'unconfigured', unit: '°C', current: null, daily: null }],
  ['malformed', { status: 'live', place: 'Shenzhen', current: null, daily: null }],
  ['negative', { ...live, current: { ...live.current, temperature: -12, condition: 'Heavy snow', sky: 'snow' }, daily: { high: -4, low: -18 } }],
  ['three-digits', { ...live, current: { ...live.current, temperature: 100 }, daily: { high: 100, low: 95 } }],
  ['minimum', { ...live, current: { ...live.current, temperature: -100 }, daily: { high: -95, low: -100 } }],
  ['long-place', { ...live, place: 'ABCDEFGHIJKLMNOPQRST', current: { ...live.current, condition: 'Light freezing drizzle', sky: 'rain' } }],
  ['cjk-stale', { ...live, status: 'stale', place: '深圳市南山区粤海街道', current: { ...live.current, condition: 'Thunderstorm with hail', sky: 'thunder' } }],
  ['zero', { ...live, current: { ...live.current, temperature: 0, condition: 'Clear sky', sky: 'sun' }, daily: { high: 0, low: 0 } }],
  ...['WWWWWWWWWWWWWWWWWWWW', '深圳市南山区粤海街道'].flatMap((place, index) => [
    [`wide-${index}-live`, { ...live, place, current: { ...live.current, condition: 'Light freezing drizzle', sky: 'rain' } }],
    [`wide-${index}-stale`, { ...live, place, status: 'stale', current: { ...live.current, condition: 'Thunderstorm with hail', sky: 'thunder' } }],
    [`wide-${index}-unavailable`, { status: 'unavailable', place, unit: '°C', current: null, daily: null }],
  ]),
]
let snapshot = live
ipcMain.handle('odk-weather-status', () => snapshot)
// The real shell and preload, but no main-process services, network or personal data.
ipcMain.handle('odk-opencode-go-status', () => ({ state: 'unconfigured' }))
ipcMain.handle('odk-remote-publish-page-state', () => true)
ipcMain.handle('odk-user-apps-list', () => ({ ok: true, apps: [] }))
ipcMain.handle('odk-weread-highlight', () => ({ status: 'unconfigured', highlight: null }))
ipcMain.handle('odk-pi-sessions', () => ({ summary: { running: 0, total: 0 }, sessions: [] }))
ipcMain.handle('odk-hydra-status', () => ({ configured: false, connected: false, env: null, nodes: [] }))
ipcMain.handle('odk-futu-holdings', () => ({ state: 'unavailable' }))
ipcMain.handle('odk-camera-frame', () => ({ status: 'unavailable', frame: null }))

async function waitFor(win, expression) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression)) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Weather did not settle: ${expression}`)
}

// Measure visible text line boxes as well as layout boxes: an inline parent can
// fit while its font's ascenders, unit, or wrapped second line does not.
function inspect() {
  const tile = document.querySelector('[data-widget="odk.tile.weather"]')
  const bounds = tile.getBoundingClientRect()
  const rect = selector => {
    const r = tile.querySelector(selector).getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
  }
  const boxes = []
  const issues = []
  const primaryFont = parseFloat(getComputedStyle(tile.querySelector('.w-weather-number')).fontSize)
  const lane = tile.querySelector('.w-weather-hero').getBoundingClientRect().height
  const rangeFont = Math.max(...[...tile.querySelectorAll('.w-weather-range-value')].map(node => parseFloat(getComputedStyle(node).fontSize)))
  if (['live', 'stale'].includes(tile.dataset.state) && primaryFont < rangeFont * 1.5) issues.push(`current temperature loses priority: ${primaryFont}px / range ${rangeFont}px`)
  if (primaryFont < 14) issues.push(`primary reading below 14px: ${primaryFont}`)
  // A reading that beats its own captions can still under-fill the lane it owns. The
  // lane's ceiling is what a short numeral may grow into, so its share of the lane is
  // the readable floor. A longer value spends its lane width on more glyphs and is
  // judged by the same value's share elsewhere instead.
  if (['live', 'stale'].includes(tile.dataset.state) && String(tile.querySelector('.w-weather-number').textContent).length <= 2 && primaryFont < lane * 0.6) issues.push(`current temperature under-fills its reading lane: ${primaryFont}px in ${lane}px`)
  const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    const parent = node.parentElement
    if (!node.textContent.trim() || parent.closest('svg') || !parent.getClientRects().length) continue
    const style = getComputedStyle(parent)
    if (style.fontFamily.startsWith('Montserrat') && style.fontWeight !== '700') issues.push(`unshipped font weight: ${parent.className}`)
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => Number(value) / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    }
    const foreground = luminance(style.color)
    const background = luminance(getComputedStyle(tile).backgroundColor)
    const contrast = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
    if (contrast < 4.5) issues.push(`text contrast: ${parent.className} (${contrast.toFixed(2)})`)
    if (parseFloat(style.fontSize) < 12) issues.push(`small text: ${parent.className}`)
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const r of range.getClientRects()) {
      if (r.left < bounds.left || r.top < bounds.top || r.right > bounds.right || r.bottom > bounds.bottom) issues.push(`text overflow: ${parent.className}`)
      boxes.push({ name: parent.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom })
    }
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (const other of boxes.slice(i + 1)) {
      const box = boxes[i]
      if (Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1
        && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1) issues.push(`text overlap: ${box.name} / ${other.name}`)
    }
  }
  const glyph = rect('.w-weather-glyph')
  const reading = rect('.w-weather-reading')
  const head = rect('.w-weather-head')
  const main = rect('.w-weather-main')
  const support = rect('.w-weather-support')
  if (reading.bottom > support.y + 1) issues.push('reading overlaps its supporting group')
  if (head.bottom > main.y + 1) issues.push('header crowds the main reading')
  if (main.bottom > support.y + 1) issues.push('reading crowds the supporting group')
  if (glyph.right > bounds.right || glyph.bottom > bounds.bottom) issues.push('sky overflow')
  const hero = rect('.w-weather-hero')
  if (reading.right > hero.right + 1 || glyph.right > hero.right + 1) issues.push('hero escapes content inset')
  if (reading.bottom > hero.bottom + 1) issues.push('reading escapes its row')
  if (tile.scrollWidth > tile.clientWidth + 1 || tile.scrollHeight > tile.clientHeight + 1) issues.push('tile overflow')
  if (tile.querySelector('button, input, a, [tabindex]')) issues.push('interactive widget')
  const rangeHalves = [...tile.querySelectorAll('.w-weather-range-label, .w-weather-range-value')]
  if (rangeHalves.length !== 4) issues.push('the daily range keeps one label and one value per half')
  if (rangeHalves[0].textContent !== 'H:' || rangeHalves[2].textContent !== 'L:') issues.push('the range reads high then low')
  if (rangeHalves[0].getBoundingClientRect().right > rangeHalves[1].getBoundingClientRect().left + 1) issues.push('range label not before its value')
  if (rangeHalves[1].getBoundingClientRect().right > rangeHalves[2].getBoundingClientRect().left + 1) issues.push('range halves collide')
  if (rangeHalves[1].getBoundingClientRect().right > tile.getBoundingClientRect().right + 1) issues.push('range escapes the tile')
  const pixel = document.documentElement.dataset.theme === 'pixel'
  if (pixel && (glyph.width % 24 !== 0 || glyph.height % 24 !== 0)) issues.push('fractional pixel grid')
  if (pixel && getComputedStyle(tile.querySelector('svg')).stroke !== 'none') issues.push('stroked pixel icon')
  return {
    issues, primaryFont, rangeFont, lane, glyph, reading, head, main, support, range: rect('.w-weather-range'),
    state: tile.dataset.state, place: tile.querySelector('.w-weather-place').textContent,
    badge: tile.querySelector('.w-weather-badge').textContent,
    badgeVisible: tile.querySelector('.w-weather-badge').getClientRects().length > 0,
    sharedState: tile.querySelector('.w-state')?.textContent,
    visibleText: tile.innerText,
    number: tile.querySelector('.w-weather-number').textContent,
    unit: tile.querySelector('.w-weather-unit').textContent,
    high: tile.querySelector('#w-weather-high').textContent,
    low: tile.querySelector('#w-weather-low').textContent,
  }
}

async function main() {
  const win = new BrowserWindow({ width: 1920, height: 1280, show: false, frame: false, useContentSize: true,
    webPreferences: { preload: path.join(root, 'src/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, offscreen: true },
  })
  await win.loadFile(path.join(root, 'src/renderer/index.html'))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await waitFor(win, 'Boolean(window.__odkGrid)')
  const home = (await resolvePages(win)).dot('home')
  const runs = []
  const failures = []
  for (const theme of ['pixel', 'instrument', 'border-beam', 'liquid-glass']) {
    await win.webContents.executeJavaScript(`window.odkTheme.set(${JSON.stringify(theme)}); document.querySelectorAll('.dot')[${home}].click()`)
    await win.webContents.executeJavaScript(`Promise.all([document.fonts.load('400 16px "Zpix"'), document.fonts.load('700 32px "Montserrat"'), document.fonts.load('400 16px "Noto Sans SC"')])`)
    for (const [width, height] of [[1920, 1280], [1920, 1080], [1280, 800], [960, 640], [480, 854], [320, 480]]) {
      win.setContentSize(width, height)
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await win.webContents.executeJavaScript('window.dispatchEvent(new Event("resize"))')
      await waitFor(win, `window.__odkGrid?.width === ${width} && window.__odkGrid?.height === ${height}`)
      // Check the existing instance before any remount/provider reply: icon sizing
      // must follow the live theme and container, not the five-second refresh.
      await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
      const switched = await win.webContents.executeJavaScript(`(${inspect.toString()})()`)
      assert.ok(!switched.issues.includes('fractional pixel grid'))
      assert.ok(!switched.issues.includes('stroked pixel icon'))
      for (const [name, fixture] of cases) {
        snapshot = fixture
        await win.webContents.executeJavaScript(`(async () => {
          const tile = document.querySelector('[data-widget="odk.tile.weather"]')
          const plugin = window.odkPlugins.get('odk.tile.weather')
          // A release is asynchronous, and the registry refuses a mount on an element
          // whose release has not settled yet. Awaiting it keeps the fixture remount
          // deterministic instead of leaving the tile on its first frame.
          await window.odkPlugins.deactivate(plugin, tile)
          window.odkPlugins.activate(plugin, tile, { onTick: () => () => {} })
          tile.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
        })()`)
        const expected = name === 'waiting' ? 'waiting' : name === 'malformed' ? 'unavailable' : fixture.status
        await waitFor(win, `document.querySelector('[data-widget="odk.tile.weather"]').dataset.state === ${JSON.stringify(expected)}`)
        await win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        const measured = await win.webContents.executeJavaScript(`(${inspect.toString()})()`)
        assert.equal(measured.place, fixture?.place || 'Weather')
        assert.equal(measured.number, fixture?.current ? String(fixture.current.temperature) : '--')
        assert.equal(measured.high, fixture?.daily ? `${fixture.daily.high}°` : '--')
        assert.equal(measured.low, fixture?.daily ? `${fixture.daily.low}°` : '--')
        if (expected === 'stale') assert.equal(measured.badge, 'Stale')
        if (expected === 'live') assert.equal(measured.badge, '')
        assert.equal(measured.badgeVisible, expected !== 'live')
        assert.ok(measured.sharedState, 'the shared Widget state remains readable')
        assert.doesNotMatch(measured.visibleText, /\bLive\b|\d{2}:\d{2}/, 'no success or refresh metadata')
        const content = (await win.webContents.executeJavaScript(`(${collectWidgetContent.toString()})()`)).find(tile => tile.id === 'odk.tile.weather')
        // Sparse single-digit and waiting readings need the existing weather
        // instrument profile, not fabricated ink. All fixtures share every gate.
        const density = measureDensity(content.frame, content.boxes, { minOccupied: 0.1 })
        measured.issues.push(...density.violations)
        if (content.clipped) measured.issues.push('ancestor-clipping')
        const label = `${theme}/${width}x${height}/${name}`
        if (measured.issues.length) failures.push({ label, issues: measured.issues })
        runs.push({ label, ...measured, density })
        if (captureDir && ['live', 'unavailable', 'cjk-stale', 'minimum', 'wide-0-unavailable'].includes(name) && [1920, 480].includes(width) && height !== 1080) {
          fs.mkdirSync(captureDir, { recursive: true })
          if (name === 'live' && width === 1920) {
            const page = await win.webContents.capturePage({ x: 0, y: 0, width, height })
            fs.writeFileSync(path.join(captureDir, `${theme}-home.png`), page.resize({ width, height }).toPNG())
          }
          const bounds = await win.webContents.executeJavaScript(`(() => {
            const r = document.querySelector('[data-widget="odk.tile.weather"]').getBoundingClientRect()
            return { x: Math.ceil(r.x), y: Math.ceil(r.y), width: Math.floor(r.width), height: Math.floor(r.height) }
          })()`)
          const image = await win.webContents.capturePage(bounds)
          fs.writeFileSync(path.join(captureDir, `${theme}-${width}-${name}.png`), image.resize({ width: bounds.width, height: bounds.height }).toPNG())
        }
      }
    }
  }
  // Native Chromium zoom is independent from a narrow viewport. Keep the current
  // provider reading and exercise all theme changes without remounting the tile.
  for (const theme of ['pixel', 'instrument', 'border-beam', 'liquid-glass']) {
    await win.webContents.executeJavaScript(`window.odkTheme.set(${JSON.stringify(theme)})`)
    await win.webContents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride')
    win.setContentSize(960, 640)
    win.webContents.setZoomFactor(2)
    await win.webContents.executeJavaScript('window.dispatchEvent(new Event("resize"))')
    await waitFor(win, 'innerWidth === 480 && window.__odkGrid?.width === 480')
    await win.webContents.executeJavaScript('document.querySelector("[data-widget=\\"odk.tile.weather\\"]").scrollIntoView({block:"center", behavior:"instant"}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    const measured = await win.webContents.executeJavaScript(`(${inspect.toString()})()`)
    const content = (await win.webContents.executeJavaScript(`(${collectWidgetContent.toString()})()`)).find(tile => tile.id === 'odk.tile.weather')
    const density = measureDensity(content.frame, content.boxes, { minOccupied: 0.1 })
    measured.issues.push(...density.violations)
    if (content.clipped) measured.issues.push('ancestor-clipping')
    if (measured.issues.length) failures.push({ label: `${theme}/200%-zoom`, issues: measured.issues })
    runs.push({ label: `${theme}/200%-zoom`, ...measured, density })
  }
  // A pressure fixture isolates the CSS reading floor from the supported desk
  // composition. It does not claim this short lane occurs in a production slot.
  for (const theme of ['pixel', 'instrument', 'border-beam', 'liquid-glass']) {
    await win.webContents.executeJavaScript(`window.odkTheme.set(${JSON.stringify(theme)})`)
    const floor = await win.webContents.executeJavaScript(`(() => {
      const hero = document.querySelector('.w-weather-hero')
      const previous = hero.style.height
      try {
        hero.style.height = '16px'
        return { laneHeight: hero.getBoundingClientRect().height,
          fontSize: parseFloat(getComputedStyle(hero.querySelector('.w-weather-number')).fontSize) }
      } finally { hero.style.height = previous }
    })()`)
    const label = `${theme}/constrained-reading-lane`
    const issues = []
    if (Math.abs(floor.laneHeight - 16) > 0.01) issues.push('pressure reading lane did not settle at 16px')
    if (!Number.isFinite(floor.fontSize) || floor.fontSize < 14) issues.push(`primary reading below 14px: ${floor.fontSize}`)
    if (issues.length) failures.push({ label, issues })
    runs.push({ label, pressureFixtureOnly: true, ...floor, issues })
  }
  // A compact Cell must not shrink the reading: the numeral keeps the share of its own
  // reading lane that the widest Cell gives it, so the desk's primary answer stays
  // primary wherever the desk places it. A ratio against supporting captions cannot
  // establish this, because both can shrink together.
  const shares = new Map()
  for (const run of runs) {
    if (run.pressureFixtureOnly || !['live', 'stale'].includes(run.state) || !run.lane) continue
    // A value that needs more room fits less by design, so readings of the same length
    // are the ones that must hold the same share of their lane.
    const key = `${run.label.split('/')[0]}/${String(run.number).length}`
    const share = run.primaryFont / run.lane
    const entry = shares.get(key) || { min: Infinity, max: 0, label: null }
    if (share < entry.min) { entry.min = share; entry.label = run.label }
    entry.max = Math.max(entry.max, share)
    shares.set(key, entry)
  }
  for (const [key, entry] of shares) {
    // A width-fit factor is metric-dependent across fonts and hosts, so the share
    // tolerance leaves room for glyph variation while a step-down rule fails it.
    if (entry.min < entry.max * 0.8) {
      failures.push({ label: `${key}/reading-lane-share`, issues: [`the primary reading keeps ${entry.min.toFixed(3)} of its reading lane, against ${entry.max.toFixed(3)} at its widest Cell: ${entry.label}`] })
    }
  }
  if (captureDir) fs.writeFileSync(path.join(captureDir, 'report.json'), JSON.stringify({ runs, failures }, null, 2))
  console.log(JSON.stringify(failures, null, 2))
  console.log(`WEATHER_LAYOUT_RESULT ${JSON.stringify({ ok: failures.length === 0, cases: runs.length, failures: failures.length })}`)
  win.destroy()
  finish(failures.length ? 1 : 0)
}

function finish(code) {
  clearTimeout(timeout)
  try { fs.rmSync(scratch, { recursive: true, force: true }) } catch (error) {
    console.error('Weather profile cleanup deferred:', error.code)
  } finally { app.exit(code) }
}
const timeout = setTimeout(() => { console.error('Weather layout timed out'); finish(1) }, 120000)
app.whenReady().then(main).catch(error => { console.error(error); finish(1) })
