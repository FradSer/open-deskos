const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const APP_ROOT = path.resolve(__dirname, '..')
const OVERALL_TIMEOUT_MS = 30000
const EXTRA_SIZES = [
  ['user window', 636, 1087],
  ['small dev', 480, 854],
]

const DRIVER_SCRIPT = `
(async () => {
  const $ = (selector) => document.querySelector(selector)
  const out = {}
  const viewport = $('#pages-viewport')
  const track = $('#pages-track')
  const approx = (a, b, tol = 4) => Math.abs(a - b) <= tol

  await new Promise((resolve) => setTimeout(resolve, 1200))

  const metrics = window.__odkGrid
  out.metricsExposed = Boolean(metrics && metrics.cellW)

  out.appViewDisplayOnLoad = getComputedStyle($('#app-view')).display

  const statusBarRect = $('#status-bar').getBoundingClientRect()
  const dotsRect = $('#dots').getBoundingClientRect()
  const boltRect = $('#sb-net').getBoundingClientRect()
  const timeRect = $('.sb-time').getBoundingClientRect()
  out.dotsInsideStatusBar =
    dotsRect.top >= statusBarRect.top && dotsRect.bottom <= statusBarRect.bottom
  out.boltLeftOfDots = boltRect.right <= dotsRect.left
  out.clockRightOfDots = timeRect.left >= dotsRect.right

  out.pageCount = document.querySelectorAll('#pages-track .page').length
  out.dotCount = document.querySelectorAll('#dots .dot').length

  out.clockFormatted = /^\\d{2}:\\d{2}$/.test($('.sb-time').textContent)
  out.dateFormatted = /^\\d{1,2}\\/\\d{1,2}$/.test($('.hero-date').textContent)

  const grid = $('.widget-grid')
  out.gridColumns = getComputedStyle(grid).gridTemplateColumns.split(' ').length

  const clockRect = $('.w-clock').getBoundingClientRect()
  out.clockSpansTwoColumns = approx(clockRect.width, 2 * metrics.cellW + metrics.gutter)

  const pomodoroRect = $('.w-pomodoro').getBoundingClientRect()
  out.pomodoroSpansTwoByTwo =
    approx(pomodoroRect.width, 2 * metrics.cellW + metrics.gutter) &&
    approx(pomodoroRect.height, 2 * metrics.cellW + metrics.gutter)

  const peekRect = $('#peek').getBoundingClientRect()
  const expectedPeekWidth = window.innerWidth - 2 * metrics.peekInset
  out.peekPresentAndEmpty = $('#peek').textContent.trim() === ''
  out.peekWidthMatchesInset = approx(peekRect.width, expectedPeekWidth)
  out.peekBottomInsetSymmetric = approx(
    window.innerHeight - peekRect.bottom,
    peekRect.left,
  )

  const y = viewport.getBoundingClientRect().top + viewport.getBoundingClientRect().height / 2
  const x0 = viewport.getBoundingClientRect().left + viewport.clientWidth * 0.8
  const x1 = viewport.getBoundingClientRect().left + viewport.clientWidth * 0.2
  const pointerEvent = (type, x) =>
    new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 7, clientX: x, clientY: y, buttons: 1 })
  viewport.dispatchEvent(pointerEvent('pointerdown', x0))
  viewport.dispatchEvent(pointerEvent('pointermove', (x0 + x1) / 2))
  viewport.dispatchEvent(pointerEvent('pointermove', x1))
  viewport.dispatchEvent(pointerEvent('pointerup', x1))
  await new Promise((resolve) => setTimeout(resolve, 350))

  out.viewportWidth = viewport.clientWidth
  out.transformAfterSwipe = track.style.transform
  out.secondDotActive = document.querySelectorAll('#dots .dot')[1].classList.contains('active')

  document.querySelector('.widget').click()
  out.appVisibleAfterTileTap = !$('#app-view').hidden
  out.appTitle = $('#app-title').textContent
  $('#app-back').click()
  out.appClosedAfterBack = $('#app-view').hidden
  out.stillSecondPageAfterBack = document.querySelectorAll('#dots .dot')[1].classList.contains('active')

  return out
})()
`

const GEOMETRY_PROBE = `
  (() => {
    const $ = (selector) => document.querySelector(selector)
    const m = window.__odkGrid
    const viewport = $('#pages-viewport').getBoundingClientRect()
    const peek = $('#peek').getBoundingClientRect()
    let widgetsInside = 0
    let peekOverlaps = 0
    const widgets = [...document.querySelectorAll('.widget')]
    for (const el of widgets) {
      const r = el.getBoundingClientRect()
      if (
        r.top >= viewport.top - 2 &&
        r.bottom <= viewport.bottom + 2 &&
        r.left >= viewport.left - 2 &&
        r.right <= viewport.right + 2
      ) { widgetsInside += 1 }
      const separated = r.bottom < peek.top || r.top > peek.bottom || r.right < peek.left || r.left > peek.right
      if (!separated) { peekOverlaps += 1 }
    }
    let textsFit = true
    for (const el of document.querySelectorAll('.w-clock-time, .al-day, .ring-mmss, .hero-time')) {
      const box = el.closest('.card, .widget').getBoundingClientRect()
      const r = el.getBoundingClientRect()
      if (r.left < box.left - 1 || r.right > box.right + 1 || r.bottom > box.bottom + 1) { textsFit = false }
    }
    return {
      cellW: m.cellW,
      peekH: m.peekH,
      widgetsTotal: widgets.length,
      widgetsInside,
      peekOverlaps,
      textsFit,
    }
  })()
`

function check(results) {
  const checks = [
    ['grid metrics exposed', results.metricsExposed],
    ['app view hidden on load', results.appViewDisplayOnLoad === 'none'],
    ['status bar holds dots', results.dotsInsideStatusBar],
    ['bolt left of dots', results.boltLeftOfDots],
    ['clock right of dots', results.clockRightOfDots],
    ['three pages', results.pageCount === 3],
    ['three dots', results.dotCount === 3],
    ['clock HH:MM', results.clockFormatted],
    ['date M/D', results.dateFormatted],
    ['grid has 3 columns', results.gridColumns === 3],
    ['clock widget spans 2 columns', results.clockSpansTwoColumns],
    ['pomodoro widget spans 2x2', results.pomodoroSpansTwoByTwo],
    ['peek present and empty', results.peekPresentAndEmpty],
    ['peek width matches inset', results.peekWidthMatchesInset],
    ['peek bottom inset symmetric', results.peekBottomInsetSymmetric],
    ['swipe moves to page 2', results.transformAfterSwipe === `translateX(-${results.viewportWidth}px)`],
    ['second dot active', results.secondDotActive],
    ['tile opens app view', results.appVisibleAfterTileTap],
    ['app title set', typeof results.appTitle === 'string' && results.appTitle.length > 0],
    ['back closes app view', results.appClosedAfterBack],
    ['page preserved after back', results.stillSecondPageAfterBack],
  ]
  let failures = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) failures += 1
  }
  return failures
}

async function runGeometrySweep(win) {
  const layout = require('../src/renderer/layout.js')
  let failures = 0
  for (const [label, width, height] of EXTRA_SIZES) {
    win.setContentSize(width, height)
    await new Promise((resolve) => setTimeout(resolve, 500))
    const probe = await win.webContents.executeJavaScript(GEOMETRY_PROBE, true)
    const expectedCell = layout.compute(width, height).cellW
    const checks = [
      ['all widgets inside viewport', probe.widgetsInside === probe.widgetsTotal],
      ['no widget overlaps peek', probe.peekOverlaps === 0],
      ['widget text fits tiles', probe.textsFit],
      ['runtime metrics match layout module', probe.cellW === expectedCell],
    ]
    for (const [name, ok] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${width}x${height} — ${name}`)
      if (!ok) failures += 1
    }
  }
  return failures
}

async function main() {
  const win = new BrowserWindow({
    width: 568,
    height: 1232,
    useContentSize: true,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  const timeout = setTimeout(() => {
    console.error('FAIL  e2e timed out')
    app.exit(1)
  }, OVERALL_TIMEOUT_MS)

  await win.loadFile(path.join(APP_ROOT, 'src/renderer/index.html'), { search: '?e2e=1' })
  const results = await win.webContents.executeJavaScript(DRIVER_SCRIPT, true)
  const driverFailures = check(results)
  const sweepFailures = await runGeometrySweep(win)
  clearTimeout(timeout)

  process.exitCode = driverFailures + sweepFailures === 0 ? 0 : 1
  app.exit(process.exitCode)
}

app.whenReady().then(main)
