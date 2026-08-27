const { app, BrowserWindow, ipcMain } = require('electron')
const http = require('node:http')
const path = require('node:path')

const APP_ROOT = path.resolve(__dirname, '..')
const { resolveCompanionHealthUrl } = require('../src/companion-endpoint')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const OVERALL_TIMEOUT_MS = 60000
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
  await document.fonts.ready

  const metrics = window.__odkGrid
  out.metricsExposed = Boolean(metrics && metrics.cellW)

  out.appViewDisplayOnLoad = getComputedStyle($('#app-view')).display

  out.pluginIds = window.odkPlugins ? [...window.odkPlugins.ids()].sort() : []
  out.pluginsHaveCompleteLifecycle = out.pluginIds.every((id) => {
    const lifecycle = window.odkPlugins.get(id).lifecycle
    return ['install', 'enable', 'mount', 'start', 'pause', 'resume', 'stop', 'unmount', 'disable', 'uninstall']
      .every((phase) => typeof lifecycle?.[phase] === 'function')
  })
  out.unifiedAppEntry = $('#sb-app-manager')?.tagName === 'BUTTON' && $('#sb-app-manager')?.textContent.includes('应用')
  out.noDockOrDesktopIconPile = !$('#dock') && document.querySelectorAll('.desktop-icon').length === 0
  let dupThrown = false
  try { window.odkPlugins.register({ id: out.pluginIds[0], mount() {} }) } catch { dupThrown = true }
  out.duplicateRegistrationRejected = dupThrown
  out.layoutValidated = (() => {
    try { return odkComposer.validate(window.DESKTOP_LAYOUT) === true } catch { return false }
  })()
  let ghostThrown = false
  try {
    odkComposer.validate({ pages: [{ id: 'ghost', name: 'ghost', kind: 'grid', widgets: [{ id: 'nope' }] }] })
  } catch { ghostThrown = true }
  out.unknownPluginRejected = ghostThrown
  out.pagesBuiltByComposer = [...document.querySelectorAll('#pages-track .page')]
    .every((page) => page.dataset.builtBy === 'composer')
  out.statusSlotsMounted =
    document.querySelector('[data-slot="status-left"] #sb-net') !== null &&
    document.querySelector('[data-slot="status-left"] #sb-app-manager') !== null &&
    document.querySelector('[data-slot="status-right"] .sb-time') !== null
  out.peekSlotMounted =
    document.querySelector('[data-slot="peek"] #peek-bridge') !== null &&
    document.querySelector('[data-slot="peek"] #peek-network') !== null

  const statusBarRect = $('#status-bar').getBoundingClientRect()
  const dotsRect = $('#dots').getBoundingClientRect()
  const boltRect = $('#sb-net').getBoundingClientRect()
  const timeRect = $('.sb-time').getBoundingClientRect()
  out.statusBarRects = { statusBar: statusBarRect.toJSON(), dots: dotsRect.toJSON(), bolt: boltRect.toJSON(), time: timeRect.toJSON() }
  out.dotsInsideStatusBar =
    dotsRect.top >= statusBarRect.top && dotsRect.bottom <= statusBarRect.bottom
  out.boltLeftOfDots = boltRect.right <= dotsRect.left
  out.clockRightOfDots = timeRect.left >= dotsRect.right


  out.pageCount = document.querySelectorAll('#pages-track .page').length
  out.dotCount = document.querySelectorAll('#dots .dot').length
  out.pageContext = $('#page-context').textContent
  out.fontsLoaded = document.fonts.check('700 32px Montserrat') && document.fonts.check('400 20px "Noto Sans SC"')

  out.clockFormatted = /^\\d{2}:\\d{2}$/.test($('.sb-time').textContent)
  out.dashWeekday = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/.test($('#dash-wd').textContent)
  out.dashDateFormatted = /^(January|February|March|April|May|June|July|August|September|October|November|December) \\d{1,2}$/.test($('#dash-md').textContent)
  out.dashYearCurrent = $('#dash-y').textContent === String(new Date().getFullYear())
  out.narrativeGroups = document.querySelectorAll('.dash-narrative .grp').length
  out.narrativeText = document.querySelector('.dash-narrative').textContent
  out.dashConnectLabel = $('#dash-connect')?.textContent.trim() === '连接 Mac'
  out.dashSupportText = $('.dash-support')?.textContent.includes('真实日程与用量')
  out.dashInitialBridgeStatus = $('#dash-narrative').textContent.includes('Mac')
  out.statRowRemoved = !document.querySelector('.dash-stats')
  const requiredIcons = ['bolt', 'message', 'settings', 'chevron-left']
  const presentIcons = [...document.querySelectorAll('svg[data-tabler]')].map((s) => s.dataset.tabler)
  out.tablerSetComplete = requiredIcons.every((name) => presentIcons.includes(name))
  out.tablerCount = presentIcons.length
  const apps = [...document.querySelectorAll('.widget')].map((w) => w.dataset.app)
  out.widgetCount = apps.length
  out.uniqueApps = new Set(apps).size === apps.length
  out.widgetsDeclaredViaDataAttr =
    document.querySelectorAll('.widget[data-widget]').length === 6
  out.widgetStatesAreHonest =
    $('.w-almanac .w-state')?.textContent === '可查看' &&
    $('.w-pomodoro .w-state')?.textContent === '未启动'
  out.widgetIntentMetadata =
    document.querySelector('.widget[data-widget="almanac"]')?.dataset.interaction === 'open-app' &&
    document.querySelector('.widget[data-widget="pomodoro"]')?.dataset.interaction === 'open-app'
  out.rendererHasNoFilesystemApi = typeof window.require === 'undefined' && typeof window.process === 'undefined'
  out.preloadExposesIntentEndpoint = typeof window.odkCompanion?.dispatchIntent === 'function' && typeof window.odkCompanion?.listApps === 'function'
  const clockPlacement = getComputedStyle(document.querySelector('[data-widget="clock"]'))
  out.clockPlacementFromConfig = clockPlacement.gridColumnStart === '2' && clockPlacement.gridColumnEnd === '4'
  const pomodoroPlacement = getComputedStyle(document.querySelector('[data-widget="pomodoro"]'))
  out.pomodoroPlacementFromConfig =
    pomodoroPlacement.gridRowStart === '2' && pomodoroPlacement.gridRowEnd === '4'
  const dots = [...document.querySelectorAll('#dots .dot')]
  out.dotsAreButtons = dots.length > 0 && dots.every((d) => d.tagName === 'BUTTON')
  out.dotLabelsPresent = dots.every((d) => (d.getAttribute('aria-label') ?? '').length > 0)
  const firstDotRect = dots[0].getBoundingClientRect()
  out.dotHitAreaAbovePill =
    document.elementFromPoint(firstDotRect.left + firstDotRect.width / 2, Math.max(1, firstDotRect.top - 16)) === dots[0]
  const dotTransform = getComputedStyle(dots[0]).transform
  out.dotButtonNotTransformed = dotTransform === 'none' || dotTransform === 'matrix(1, 0, 0, 1, 0, 0)'
  const widgets = [...document.querySelectorAll('.widget')]
  out.widgetsHaveState = widgets.every((widget) => widget.querySelector('.w-state')?.textContent.trim())
  out.clockIsAvailable = $('.w-clock .w-state').textContent === '可查看'
  out.pomodoroNotRunning = $('.ring-mmss').textContent === '--:--' && $('.w-pomodoro .w-state').textContent === '未启动'
  window.dispatchEvent(new Event('offline'))
  out.boltGreyOffline = !$('#sb-net').classList.contains('on')
  out.offlineAnnounced = $('#status-announcement').textContent.includes('网络未连接')
  window.dispatchEvent(new Event('online'))
  out.boltLitOnline = $('#sb-net').classList.contains('on')
  out.onlineAnnounced = $('#status-announcement').textContent.includes('网络已连接')

  const grid = $('.widget-grid')
  const gridRect = grid.getBoundingClientRect()
  const gridPageRect = grid.closest('.page').getBoundingClientRect()
  out.gridColumns = getComputedStyle(grid).gridTemplateColumns.split(' ').length
  out.gridFlushEdges =
    Math.abs(gridRect.left - gridPageRect.left) <= 2 &&
    Math.abs(gridPageRect.right - gridRect.right) <= 2

  const clockRect = $('.w-clock').getBoundingClientRect()
  out.clockSpansTwoColumns = approx(clockRect.width, 2 * metrics.colW + metrics.gutter)

  const pomodoroRect = $('.w-pomodoro').getBoundingClientRect()
  out.pomodoroSpansTwoByTwo =
    approx(pomodoroRect.width, 2 * metrics.colW + metrics.gutter) &&
    approx(pomodoroRect.height, 2 * metrics.cellH + metrics.gutter)

  const peekRect = $('#peek').getBoundingClientRect()
  const expectedPeekWidth = window.innerWidth - 2 * metrics.peekInset
  out.peekHasStatus = $('#peek').textContent.includes('Mac 尚未连接') && $('#peek').textContent.includes('网络')
  out.bridgeHealthUrl = window.__ODK_COMPANION_HEALTH_URL
  out.bridgeInitialStatus = $('#peek-bridge').textContent === 'Mac 尚未连接'
  out.peekWidthMatchesInset = approx(peekRect.width, expectedPeekWidth)
  out.peekBottomInsetSymmetric = approx(
    window.innerHeight - peekRect.bottom,
    peekRect.left,
  )

  const midY = viewport.getBoundingClientRect().top + viewport.getBoundingClientRect().height / 2
  const x0 = viewport.getBoundingClientRect().left + viewport.clientWidth * 0.8
  const x1 = viewport.getBoundingClientRect().left + viewport.clientWidth * 0.2
  const pointerEvent = (type, x, py) =>
    new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 7, clientX: x, clientY: py ?? midY, buttons: 1 })

  // A cancelled drag must not leave click suppression stuck: the visible
  // page-level action on the current page stays tappable.
  viewport.dispatchEvent(pointerEvent('pointerdown', x0))
  viewport.dispatchEvent(pointerEvent('pointermove', x0 - 60))
  viewport.dispatchEvent(pointerEvent('pointercancel', x0 - 60))
  await new Promise((resolve) => setTimeout(resolve, 50))
  $('#dash-connect').click()
  out.connectOpensAfterCancelledDrag = !$('#app-view').hidden && $('#app-title').textContent === '连接 Mac'
  out.cancelledDragKeepsFirstPage = document.querySelectorAll('#dots .dot')[0].classList.contains('active')
  $('#app-back').click()

  viewport.dispatchEvent(pointerEvent('pointerdown', x0))
  viewport.dispatchEvent(pointerEvent('pointermove', (x0 + x1) / 2))
  viewport.dispatchEvent(pointerEvent('pointermove', x1))
  viewport.dispatchEvent(pointerEvent('pointerup', x1))
  await new Promise((resolve) => setTimeout(resolve, 350))

  out.viewportWidth = viewport.clientWidth
  out.transformAfterSwipe = track.style.transform
  out.secondDotActive = document.querySelectorAll('#dots .dot')[1].classList.contains('active')

  const tileRect = document.querySelector('.widget').getBoundingClientRect()
  const tileX = tileRect.left + tileRect.width / 2
  const tileY = tileRect.top + tileRect.height / 2
  viewport.dispatchEvent(pointerEvent('pointerdown', tileX, tileY))
  viewport.dispatchEvent(pointerEvent('pointermove', tileX + 70, tileY))
  viewport.dispatchEvent(pointerEvent('pointerup', tileX + 70, tileY))
  await new Promise((resolve) => setTimeout(resolve, 50))
  // Browsers emit a compatibility click after a real pointer release; synthetic
  // PointerEvents do not, so emit it explicitly to mirror device behavior.
  viewport.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise((resolve) => setTimeout(resolve, 300))
  out.transformAfterTileDrag = track.style.transform
  out.appHiddenAfterTileDrag = $('#app-view').hidden

  const tile = document.querySelector('.widget[data-widget="pomodoro"]')
  tile.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  out.widgetTapOpensContinuationApp = !$('#app-view').hidden && $('#app-title').textContent === '番茄钟'
  out.widgetSourceContextPreserved = $('#app-view').dataset.sourceWidget === 'pomodoro' && $('#app-view').dataset.route === 'today'
  out.widgetAppShowsRuntimeContent = $('#app-runtime .runtime-app h2')?.textContent === '番茄钟'
  out.platformIntentTrace = JSON.stringify(window.odkAppPlatform?.events?.slice(-3).map((event) => event.layer)) === JSON.stringify(['installer', 'app-manager', 'app-runtime'])
  out.pomodoroTileStateAfterOpen = document.querySelector('.widget[data-widget="pomodoro"] .w-state')?.textContent === '运行中'
  const managerEntry = $('#sb-app-manager')
  managerEntry.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  out.appManagerSearchVisible = Boolean($('#app-runtime .app-manager .app-search'))
  const appList = $('#app-runtime .app-manager .app-list')
  const countBeforeSearch = appList?.querySelectorAll('li').length || 0
  const search = $('#app-runtime .app-manager .app-search')
  if (search) { search.value = '番茄钟'; search.dispatchEvent(new Event('input', { bubbles: true })) }
  out.appManagerSearchFilters = countBeforeSearch > 1 && appList.querySelectorAll('li').length === 1
  $('#app-back').click()
  out.appEndpointTrace = window.odkAppPlatform?.endpoint === 'main-process'
  $('#app-back').click()
  out.pagePreservedAfterWidgetApp = document.querySelectorAll('#dots .dot')[1].classList.contains('active')

  document.querySelectorAll('#dots .dot')[2].click()
  await new Promise((resolve) => setTimeout(resolve, 350))
  out.transformAfterDotJump = track.style.transform
  out.thirdDotActive = document.querySelectorAll('#dots .dot')[2].classList.contains('active')
  out.thirdPageContext = $('#page-context').textContent === '用量 · 3/3'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  out.arrowLeftReturnsToGrid = $('#page-context').textContent === '应用 · 2/3'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  out.endJumpsToQuota = $('#page-context').textContent === '用量 · 3/3'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  out.homeJumpsToOverview = $('#page-context').textContent === '概览 · 1/3'
  document.querySelectorAll('#dots .dot')[2].click()
  out.quotaStateSeparatesBridge = $('#quota-state').textContent.includes('Mac 尚未连接') && $('#quota-state').textContent.includes('网络')
  out.quotaConnectLabel = $('#quota-connect').textContent === '连接 Mac'
  out.quotaRefreshLabel = $('#quota-refresh').textContent === '重新检查状态'
  out.quotaHelpLabel = $('#quota-help').textContent === '操作说明'
  out.quotaCheckedVisible = $('#quota-checked').textContent.includes('最近检查')
  $('#quota-help').click()
  out.helpViewVisible = !$('#app-view').hidden && $('#app-help').textContent.includes('滑动')
  out.helpBackgroundHidden = $('#pages-viewport').getAttribute('aria-hidden') === 'true' && $('#pages-viewport').inert
  $('#app-back').click()
  $('#quota-refresh').click()
  out.quotaRefreshPreservesTruth = $('#quota-state').textContent.includes('Mac 尚未连接')
  out.quotaRefreshShowsCheck = $('#quota-checked').textContent.includes('最近检查')
  $('#quota-connect').click()
  out.bridgeInfoVisible = !$('#app-view').hidden && $('#app-title').textContent === '连接 Mac' && $('#app-empty').textContent.includes('网络')
  out.bridgeInfoHasDialogSemantics = $('#app-view').getAttribute('role') === 'dialog' && $('#app-view').getAttribute('aria-modal') === 'true'
  out.bridgeInfoFocusBack = document.activeElement?.id === 'app-back'
  document.getElementById('app-back').focus()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
  out.tabFromBackStaysInDialog = ['app-back', 'app-action'].includes(document.activeElement?.id)
  document.getElementById('app-back').focus()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }))
  out.shiftTabFromBackStaysInDialog = ['app-back', 'app-action'].includes(document.activeElement?.id)
  out.bridgeInfoHasSteps = !$('#app-steps').hidden && $('#app-steps').querySelectorAll('li').length === 3
  out.bridgeInfoHasTroubleshooting = !$('#app-troubleshooting').hidden && $('#app-troubleshooting').querySelectorAll('li').length === 3
  out.bridgeInfoHasRefresh = !$('#app-action').hidden && $('#app-action').textContent === '重新检查状态'
  $('#app-action').click()
  out.bridgeInfoRefreshStatus = $('#app-action-status').textContent.includes('最近检查')
  out.bridgeHealthCanRefresh = window.__ODK_COMPANION_HEALTH_URL?.includes('127.0.0.1')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  out.escapeClosesBridgeInfo = $('#app-view').hidden
  out.quotaPageAfterEscape = $('#dots .dot[aria-current="page"]')?.getAttribute('aria-label') === '第 3 页，用量'

  // Return to the grid page so the geometry sweep measures on-screen rects.
  document.querySelectorAll('#dots .dot')[1].click()
  await new Promise((resolve) => setTimeout(resolve, 350))

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
    for (const el of document.querySelectorAll('.w-clock-time, .al-day, .ring-mmss')) {
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
    ['plugins expose complete lifecycle', results.pluginsHaveCompleteLifecycle],
    ['unified App Manager entry replaces dock', results.unifiedAppEntry && results.noDockOrDesktopIconPile],
    ['plugin registry includes shell, state and app plugins',
      ['almanac', 'chat', 'clock', 'dashboard-page', 'peek-bridge', 'pomodoro', 'quota-page', 'settings', 'status-apps', 'status-clock', 'status-connection', 'year', 'app-calendar', 'app-clock', 'app-app-manager', 'app-pomodoro', 'app-year'].every((id) => results.pluginIds.includes(id))],
    ['duplicate plugin registration rejected', results.duplicateRegistrationRejected],
    ['desktop layout validates against registry', results.layoutValidated],
    ['unknown plugin rejected by composer', results.unknownPluginRejected],
    ['all pages built by composer', results.pagesBuiltByComposer],
    ['status bar slots mounted by plugins', results.statusSlotsMounted],
    ['peek slot mounted by plugin', results.peekSlotMounted],
    ['status bar holds dots', results.dotsInsideStatusBar],
    ['bolt left of dots', results.boltLeftOfDots],
    ['clock right of dots', results.clockRightOfDots],
    ['three pages', results.pageCount === 3],
    ['three dots', results.dotCount === 3],
    ['page context is visible', results.pageContext === '概览 · 1/3'],
    ['bundled fonts are loaded', results.fontsLoaded],
    ['clock HH:MM', results.clockFormatted],
    ['dashboard weekday header', results.dashWeekday],
    ['dashboard month-day format', results.dashDateFormatted],
    ['dashboard year is current', results.dashYearCurrent],
    ['narrative waits for mac without fabricated counts',
      results.narrativeGroups >= 2 &&
      !/\d/.test(results.narrativeText) &&
      /mac/i.test(results.narrativeText)],
    ['dashboard has one connection action', results.dashConnectLabel && results.dashSupportText],
    ['companion health endpoint is configured', results.bridgeHealthUrl?.includes('127.0.0.1')],
    ['companion initial status is honest', results.bridgeInitialStatus],
    ['stats row removed', results.statRowRemoved],
    ['tabler icon set complete', results.tablerSetComplete],
    ['tabler icons count >= 4', results.tablerCount >= 4],
    ['six state widgets with unique identities', results.widgetCount === 6 && results.uniqueApps],
    ['widgets declare truthful state and App continuation', results.widgetStatesAreHonest && results.widgetIntentMetadata],
    ['renderer has no filesystem API', results.rendererHasNoFilesystemApi],
    ['preload exposes the App Manager endpoint', results.preloadExposesIntentEndpoint],
    ['widgets declared via data-widget', results.widgetsDeclaredViaDataAttr],
    ['clock placement comes from desktop layout config', results.clockPlacementFromConfig],
    ['pomodoro placement comes from desktop layout config', results.pomodoroPlacementFromConfig],
    ['dots are labeled buttons', results.dotsAreButtons && results.dotLabelsPresent],
    ['dot hit area extends above the pill', results.dotHitAreaAbovePill],
    ['dot button itself is not transformed', results.dotButtonNotTransformed],
    ['widgets expose honest state labels', results.widgetsHaveState],
    ['clock widget is visibly available', results.clockIsAvailable],
    ['pomodoro is visibly not running', results.pomodoroNotRunning],
    ['bolt greys on offline event', results.boltGreyOffline],
    ['offline status is announced', results.offlineAnnounced],
    ['bolt lights on online event', results.boltLitOnline],
    ['online status is announced', results.onlineAnnounced],
    ['grid has 3 columns', results.gridColumns === 3],
    ['grid flush to screen edges', results.gridFlushEdges],
    ['clock widget spans 2 columns', results.clockSpansTwoColumns],
    ['pomodoro widget spans 2x2', results.pomodoroSpansTwoByTwo],
    ['peek shows bridge and network status', results.peekHasStatus],
    ['peek width matches inset', results.peekWidthMatchesInset],
    ['peek bottom inset symmetric', results.peekBottomInsetSymmetric],
    ['swipe moves to page 2', results.transformAfterSwipe === `translateX(-${results.viewportWidth}px)`],
    ['second dot active', results.secondDotActive],
    ['small drag on tile keeps page', results.transformAfterTileDrag === `translateX(-${results.viewportWidth}px)`],
    ['tile drag never opens a view', results.appHiddenAfterTileDrag],
    ['widget tap opens its continuation App', results.widgetTapOpensContinuationApp && results.widgetSourceContextPreserved && results.widgetAppShowsRuntimeContent],
    ['widget intent routes through platform layers', results.platformIntentTrace && results.appEndpointTrace],
    ['pomodoro Widget follows App state', results.pomodoroTileStateAfterOpen],
    ['App Manager search is available', results.appManagerSearchVisible && results.appManagerSearchFilters],
    ['widget App returns to source page', results.pagePreservedAfterWidgetApp],
    ['cancelled drag keeps page and does not suppress next tap',
      results.connectOpensAfterCancelledDrag === true && results.cancelledDragKeepsFirstPage],
    ['dot click jumps to last page', results.transformAfterDotJump === `translateX(-${results.viewportWidth * 2}px)`],
    ['third dot active after jump', results.thirdDotActive],
    ['third page context is visible', results.thirdPageContext],
    ['ArrowLeft returns to grid', results.arrowLeftReturnsToGrid],
    ['End jumps to quota', results.endJumpsToQuota],
    ['Home jumps to overview', results.homeJumpsToOverview],
    ['quota separates bridge and network state', results.quotaStateSeparatesBridge],
    ['quota has primary connection action', results.quotaConnectLabel],
    ['quota exposes check state', results.quotaCheckedVisible],
    ['quota has operation guide', results.quotaHelpLabel && results.helpViewVisible],
    ['dialog hides background from assistive tech', results.helpBackgroundHidden],
    ['quota has network connection action', results.quotaConnectLabel],
    ['quota has status refresh action', results.quotaRefreshLabel && results.quotaRefreshPreservesTruth && results.quotaRefreshShowsCheck],
    ['network connection info opens', results.bridgeInfoVisible],
    ['network connection info has dialog semantics', results.bridgeInfoHasDialogSemantics && results.bridgeInfoFocusBack],
    ['dialog Tab focus stays contained', results.tabFromBackStaysInDialog && results.shiftTabFromBackStaysInDialog],
    ['network connection info has three steps', results.bridgeInfoHasSteps],
    ['network connection info has troubleshooting', results.bridgeInfoHasTroubleshooting],
    ['network connection info has refresh action', results.bridgeInfoHasRefresh && results.bridgeInfoRefreshStatus && results.bridgeHealthCanRefresh],
    ['Escape closes connection info', results.escapeClosesBridgeInfo],
    ['Escape preserves quota page', results.quotaPageAfterEscape],
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
    // Desktop window servers deliver resize to occluded/hidden windows
    // unreliably (rAF throttling varies with z-order), so re-dispatch the
    // resize event in the page: same handler path as the OS event, and the
    // handler is idempotent if the OS event also arrives.
    await win.webContents.executeJavaScript("window.dispatchEvent(new Event('resize'))", true)
    // The renderer recomputes geometry on resize via requestAnimationFrame;
    // a blind sleep races cold-start rAF throttling in hidden windows, so
    // poll until the applied metrics match the layout module (bounded).
    const expectedCell = layout.compute(width, height).cellW
    const deadline = Date.now() + 5000
    let settled = false
    let lastApplied = null
    while (Date.now() < deadline) {
      lastApplied = await win.webContents.executeJavaScript('window.__odkGrid ? window.__odkGrid.cellW : 0', true)
      if (lastApplied === expectedCell) { settled = true; break }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!settled) {
      const bounds = win.getContentBounds()
      const inner = await win.webContents.executeJavaScript('window.innerWidth', true)
      console.log(`WARN  ${label} ${width}x${height} — resize metrics never settled within 5s (applied=${lastApplied} expected=${expectedCell} content=${bounds.width}x${bounds.height} innerWidth=${inner})`)
    }
    // refresh() re-applies the pager transform, which animates over 260ms;
    // probing mid-transition displaces widget rects out of the viewport.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await new Promise((resolve) => setTimeout(resolve, 100))
    const probe = await win.webContents.executeJavaScript(GEOMETRY_PROBE, true)
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

async function runMotionChecks(win) {
  const js = (code) => win.webContents.executeJavaScript(code, true)

  await win.webContents.debugger.attach('1.3')
  try {
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    })
    const reduced = await js(
      "getComputedStyle(document.getElementById('pages-track')).transitionDuration",
    )
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    })
    const restored = await js(
      "getComputedStyle(document.getElementById('pages-track')).transitionDuration",
    )

    const checks = [
      ['reduced motion zeroes pager transitions', reduced === '0s'],
      ['motion restored when preference is no-preference', restored !== '0s'],
    ]
    let failures = 0
    for (const [name, ok] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
      if (!ok) failures += 1
    }
    return failures
  } finally {
    await win.webContents.debugger.detach()
  }
}

const COMPANION_CONNECTED_SCRIPT = `
  (async () => {
    const $ = (selector) => document.querySelector(selector)
    const out = {}
    await new Promise((resolve) => setTimeout(resolve, 1500))
    out.dashConnected = $('#dash-narrative').textContent.includes('Mac 已连接')
    out.peekConnected = $('#peek-bridge').textContent.includes('Mac 已连接')
    out.dashGreenVoice = getComputedStyle(document.querySelector('#dash-narrative .connected-word')).color === 'rgb(52, 199, 89)'
    out.peekGreenVoice = getComputedStyle($('#peek-bridge')).color === 'rgb(52, 199, 89)'
    ;[...document.querySelectorAll('#dots .dot')][2].click()
    await new Promise((resolve) => setTimeout(resolve, 400))
    out.quotaConnected = $('#quota-state').textContent.includes('Mac 已连接')
    out.quotaChecked = $('#quota-checked').textContent.includes('最近检查')
    return out
  })()
`

function startCompanionMock() {
  let payload = { status: 200, body: {} }
  const server = http.createServer((request, response) => {
    response.writeHead(payload.status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(payload.body))
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        setPayload(next) { payload = next },
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

async function runCompanionChecks() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const js = (win, code) => win.webContents.executeJavaScript(code, true)
  const mock = await startCompanionMock()
  const companionOk = {
    status: 200,
    body: { service: 'OpenDeskOS companion', ready: true, sidecar: 'Healthy' },
  }
  mock.setPayload(companionOk)

  let win
  try {
    win = new BrowserWindow({
      width: 568,
      height: 1232,
      useContentSize: true,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(APP_ROOT, 'src', 'preload.js'),
      },
    })
    await win.loadFile(path.join(APP_ROOT, 'src/renderer/index.html'), {
      search: `?companion=${encodeURIComponent(`http://127.0.0.1:${mock.port}/health`)}`,
    })

    const connected = await js(win, COMPANION_CONNECTED_SCRIPT)

    // A non-OpenDeskOS 200 (e.g. the Wispr sidecar alone) must stay disconnected.
    mock.setPayload({ status: 200, body: { ok: true } })
    await js(win, "document.querySelector('#quota-refresh').click()")
    await sleep(800)
    const identityRejected = await js(
      win,
      "document.querySelector('#quota-state').textContent.includes('Mac 尚未连接')",
    )

    // Restoring the OpenDeskOS identity reconnects on the next manual check.
    mock.setPayload(companionOk)
    await js(win, "document.querySelector('#quota-refresh').click()")
    await sleep(800)
    const reconnects = await js(
      win,
      "document.querySelector('#quota-state').textContent.includes('Mac 已连接')",
    )

    const checks = [
      ['dashboard shows Mac connected', connected.dashConnected],
      ['peek shows Mac connected', connected.peekConnected],
      ['connected state carries Open DeskOS green voice', connected.dashGreenVoice && connected.peekGreenVoice],
      ['quota shows Mac connected after startup check', connected.quotaConnected],
      ['quota shows last check time when connected', connected.quotaChecked],
      ['non-companion HTTP 200 stays disconnected', identityRejected],
      ['recheck reconnects once identity returns', reconnects],
    ]
    let failures = 0
    for (const [name, ok] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
      if (!ok) failures += 1
    }
    return failures
  } finally {
    if (win) win.destroy()
    await mock.close()
  }
}

function runEndpointChecks() {
  const checks = [
    ['default companion endpoint uses loopback', resolveCompanionHealthUrl({}) === 'http://127.0.0.1:8788/health'],
    ['companion host builds a network endpoint', resolveCompanionHealthUrl({ ODK_COMPANION_HOST: '192.168.1.20' }) === 'http://192.168.1.20:8788/health'],
    ['explicit companion URL takes precedence', resolveCompanionHealthUrl({
      ODK_COMPANION_HOST: '192.168.1.20',
      ODK_COMPANION_HEALTH_URL: 'http://mac.local:9000/status',
    }) === 'http://mac.local:9000/status'],
  ]
  let failures = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) failures += 1
  }
  return failures
}

async function main() {
  ipcMain.handle('odk-companion-health', async (_event, endpoint) => {
    const { checkCompanionHealth } = require('../src/companion-health')
    return checkCompanionHealth(endpoint)
  })
  const appManager = createAppManagerEndpoint()
  ipcMain.handle('odk-app-manager-list', () => appManager.list())
  ipcMain.handle('odk-app-manager-state', (_event, appId) => appManager.get(appId))
  ipcMain.handle('odk-app-manager-intent', (_event, intent) => appManager.dispatch(intent))

  const win = new BrowserWindow({
    width: 568,
    height: 1232,
    useContentSize: true,
    frame: false,
    // Visible on purpose: hidden windows do not paint frames on headless Linux
    // (GPU-less Xvfb), which freezes CSS transitions and lies to rect probes.
    // backgroundThrottling off keeps rAF alive when the desktop occludes this
    // window, so resize-driven geometry recompute cannot be frozen mid-sweep.
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(APP_ROOT, 'src', 'preload.js'),
      backgroundThrottling: false,
    },
  })

  const timeout = setTimeout(() => {
    console.error('FAIL  e2e timed out')
    app.exit(1)
  }, OVERALL_TIMEOUT_MS)

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`renderer[${sourceId}:${line}] ${message}`)
  })

  await win.loadFile(path.join(APP_ROOT, 'src/renderer/index.html'), { search: '?e2e=1' })
  let results
  try {
    results = await win.webContents.executeJavaScript(DRIVER_SCRIPT, true)
  } catch (error) {
    clearTimeout(timeout)
    console.error(`FAIL  driver script threw: ${error}`)
    app.exit(1)
    return
  }
  const endpointFailures = runEndpointChecks()
  const driverFailures = check(results)
  const motionFailures = await runMotionChecks(win)
  const sweepFailures = await runGeometrySweep(win)
  const companionFailures = await runCompanionChecks()
  clearTimeout(timeout)

  process.exitCode = endpointFailures + driverFailures + motionFailures + sweepFailures + companionFailures === 0 ? 0 : 1
  app.exit(process.exitCode)
}

app.whenReady().then(main)
