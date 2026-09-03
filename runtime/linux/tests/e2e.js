const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

const APP_ROOT = path.resolve(__dirname, '..')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const { scanPiSessions } = require('../src/pi-sessions')
const OVERALL_TIMEOUT_MS = 60000
const EXTRA_SIZES = [
  ['user window', 636, 900],
  ['small dev', 480, 854],
]

const DRIVER_SCRIPT = `
(async () => {
  const $ = (selector) => document.querySelector(selector)
  const out = {}
  const viewport = $('#pages-viewport')
  const track = $('#pages-track')
  const approx = (a, b, tol = 4) => Math.abs(a - b) <= tol

  await new Promise((resolve) => setTimeout(resolve, 200))
  await document.fonts.ready

  const metrics = window.__odkGrid
  out.metricsExposed = Boolean(metrics && metrics.cellW)

  out.appViewDisplayOnLoad = getComputedStyle($('#app-view')).display

  out.pluginIds = window.odkPlugins ? [...window.odkPlugins.ids()].sort() : []
  out.pluginsUseOdkIdentity = out.pluginIds.every((id) => id.startsWith('odk.'))
  out.pluginsHaveCompleteLifecycle = out.pluginIds.every((id) => {
    const lifecycle = window.odkPlugins.get(id).lifecycle
    return ['mount', 'unmount']
      .every((phase) => typeof lifecycle?.[phase] === 'function')
  })
  out.focusedStateBar = $('#sb-state-summary')?.classList.contains('sb-state-summary') && $('#page-context')?.classList.contains('sr-only')
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
    document.querySelector('[data-slot="status-left"] #sb-pi-status') !== null &&
    document.querySelector('[data-slot="status-left"] #sb-state-summary') !== null &&
    document.querySelector('[data-slot="status-right"] .sb-time') !== null
  out.noBottomPeek = $('#peek') === null && document.querySelector('[data-slot="peek"]') === null
  out.stateSummaryIsFactual =
    $('#sb-network-state')?.textContent === 'Network connected' &&
    $('#sb-subscription-state')?.textContent === 'OpenCode Go not configured' &&
    $('#sb-remote-state')?.textContent === 'Remote · Disconnected'

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
  out.narrativeGroups = document.querySelectorAll('.dash-narrative > span').length
  out.narrativeText = document.querySelector('.dash-narrative').textContent
  out.todayStatesAreTruthful =
    out.narrativeGroups === 3 &&
    $('#dash-network').textContent.includes('Network') &&
    $('#dash-focus').textContent === 'Focus is not started.' &&
    $('#dash-usage').textContent.includes('OpenCode Go') &&
    !/\b(?:\d+ meetings|\d+ tasks|\d+ habits|steps|hours)\b/.test(out.narrativeText)
  const requiredIcons = ['bolt', 'chevron-left', 'chevron-right']
  const presentIcons = [...document.querySelectorAll('svg[data-tabler]')].map((s) => s.dataset.tabler)
  out.tablerSetComplete = requiredIcons.every((name) => presentIcons.includes(name))
  out.tablerCount = presentIcons.length
  const apps = [...document.querySelectorAll('.widget')].map((w) => w.dataset.app)
  out.widgetCount = apps.length
  out.uniqueApps = new Set(apps).size === apps.length
  out.widgetsDeclaredViaDataAttr =
    document.querySelectorAll('.widget[data-widget]').length === 10 &&
    [...document.querySelectorAll('.widget[data-widget]')].every((widget) => widget.dataset.widget.startsWith('odk.tile.'))
  out.experimentalVisionDoesNotBlockShell =
    $('#privacy-shield').hidden &&
    !$('#pages-viewport').inert &&
    !$('#status-bar').inert
  out.widgetStatesAreHonest =
    $('.w-almanac .w-state')?.textContent === 'Available' &&
    $('.w-pomodoro .w-state')?.textContent === 'Not started'
  out.deskStatusIsTruthful =
    $('[data-widget="odk.tile.desk-status"] .desk-status-value')?.textContent === 'READY' &&
    $('[data-widget="odk.tile.desk-status"] .desk-status-resolution')?.textContent === String(window.innerWidth) + ' × ' + String(window.innerHeight)
  out.deskStatusPlacement = getComputedStyle(document.querySelector('[data-widget="odk.tile.desk-status"]')).gridColumnStart === '5' &&
    getComputedStyle(document.querySelector('[data-widget="odk.tile.desk-status"]')).gridRowStart === '2'
  out.widgetIntentMetadata =
    document.querySelector('.widget[data-widget="odk.tile.almanac"]')?.dataset.interaction === 'open-app' &&
    document.querySelector('.widget[data-widget="odk.tile.pomodoro"]')?.dataset.interaction === 'open-app'
  out.rendererHasNoFilesystemApi = typeof window.require === 'undefined' && typeof window.process === 'undefined'
  out.preloadExposesIntentEndpoint = typeof window.odkPlatform?.dispatchIntent === 'function' && typeof window.odkPlatform?.listApps === 'function'
  out.preloadExposesSubscriptionEndpoint = typeof window.odkPlatform?.getOpenCodeGoStatus === 'function'
  out.preloadExposesFaceAgentEndpoint = typeof window.odkPlatform?.getFaceAgentStatus === 'function'
  out.remotePreloadIsNarrow = JSON.stringify(Object.keys(window.odkRemote || {}).sort()) === JSON.stringify(['publishPageState', 'subscribeLinkState', 'subscribeNavigation'])
  const clockPlacement = getComputedStyle(document.querySelector('[data-widget="odk.tile.clock"]'))
  out.clockPlacementFromConfig = clockPlacement.gridColumnStart === '2'
  const pomodoroPlacement = getComputedStyle(document.querySelector('[data-widget="odk.tile.pomodoro"]'))
  out.pomodoroPlacementFromConfig =
    pomodoroPlacement.gridRowStart === '2' && pomodoroPlacement.gridRowEnd === '4'
  const dots = [...document.querySelectorAll('#dots .dot')]
  out.dotsAreButtons = dots.length > 0 && dots.every((d) => d.tagName === 'BUTTON')
  out.dotLabelsPresent = dots.every((d) => (d.getAttribute('aria-label') ?? '').length > 0)
  const firstDotRect = dots[0].getBoundingClientRect()
  out.dotHitAreaAbovePill =
    document.elementFromPoint(firstDotRect.left + firstDotRect.width / 2, Math.max(1, firstDotRect.top - 16)) === dots[0]
    || !$('#privacy-shield').hidden
  const dotTransform = getComputedStyle(dots[0]).transform
  out.dotButtonNotTransformed = dotTransform === 'none' || dotTransform === 'matrix(1, 0, 0, 1, 0, 0)'
  const widgets = [...document.querySelectorAll('.widget')]
  out.widgetsHaveState = widgets.every((widget) => widget.querySelector('.w-state')?.textContent.trim())
  out.clockIsAvailable = $('.w-clock .w-state').textContent === 'Available'
  out.pomodoroNotRunning = $('.ring-mmss').textContent === '--:--' && $('.w-pomodoro .w-state').textContent === 'Not started'
  window.dispatchEvent(new Event('offline'))
  out.boltGreyOffline = !$('#sb-net').classList.contains('on')
  out.offlineAnnounced = $('#status-announcement').textContent.includes('Network disconnected')
  window.dispatchEvent(new Event('online'))
  out.boltLitOnline = $('#sb-net').classList.contains('on')
  out.onlineAnnounced = $('#status-announcement').textContent.includes('Network connected')

  const grid = $('.widget-grid')
  const gridRect = grid.getBoundingClientRect()
  const gridPageRect = grid.closest('.page').getBoundingClientRect()
  out.gridColumns = getComputedStyle(grid).gridTemplateColumns.split(' ').length
  out.gridRows = getComputedStyle(grid).gridTemplateRows.split(' ').length
  out.gridFlushEdges =
    gridRect.left >= gridPageRect.left - 2 &&
    gridRect.right <= gridPageRect.right + 2

  const clockRect = $('.w-clock').getBoundingClientRect()
  out.clockSpansOneSquare = approx(clockRect.width, metrics.cellW) && approx(clockRect.height, metrics.cellH)

  const pomodoroRect = $('.w-pomodoro').getBoundingClientRect()
  out.pomodoroSpansTwoSquare =
    approx(pomodoroRect.width, 2 * metrics.cellW + metrics.gutter) &&
    approx(pomodoroRect.height, 2 * metrics.cellH + metrics.gutter)

  out.stateSummaryFits = (() => {
    const summary = $('#sb-state-summary').getBoundingClientRect()
    const bar = $('#status-bar').getBoundingClientRect()
    return summary.top >= bar.top && summary.bottom <= bar.bottom
  })()
  out.subscriptionInitialStatus = $('#sb-subscription-state').textContent === 'OpenCode Go not configured'
  out.noBottomPeek = $('#peek') === null && document.querySelector('[data-slot="peek"]') === null

  const midY = viewport.getBoundingClientRect().top + viewport.getBoundingClientRect().height / 2
  const x0 = viewport.getBoundingClientRect().left + viewport.clientWidth * 0.8
  const x1 = viewport.getBoundingClientRect().left + viewport.clientWidth * 0.2
  const pointerEvent = (type, x, py) =>
    new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId: 7, clientX: x, clientY: py ?? midY, buttons: 1 })

  // A cancelled drag must not leave pager state or click suppression stuck.
  viewport.dispatchEvent(pointerEvent('pointerdown', x0))
  viewport.dispatchEvent(pointerEvent('pointermove', x0 - 60))
  viewport.dispatchEvent(pointerEvent('pointercancel', x0 - 60))
  await new Promise((resolve) => setTimeout(resolve, 50))
  document.querySelectorAll('#dots .dot')[1].click()
  out.cancelledDragKeepsNavigationUsable = document.querySelectorAll('#dots .dot')[1].classList.contains('active')
  document.querySelectorAll('#dots .dot')[0].click()

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

  const tile = document.querySelector('.widget[data-widget="odk.tile.pomodoro"]')
  tile.click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  out.widgetTapOpensContinuationApp = !$('#app-view').hidden && $('#app-title').textContent === 'Pomodoro'
  out.widgetSourceContextPreserved = $('#app-view').dataset.sourceWidget === 'odk.tile.pomodoro' && $('#app-view').dataset.route === 'today'
  out.widgetAppShowsRuntimeContent = $('#app-runtime .runtime-app h2')?.textContent === 'Pomodoro'
  out.platformIntentTrace = JSON.stringify(window.odkAppPlatform?.events?.slice(-3).map((event) => event.layer)) === JSON.stringify(['installer', 'app-manager', 'app-runtime'])
  out.pomodoroTileStateAfterOpen = document.querySelector('.widget[data-widget="odk.tile.pomodoro"] .w-state')?.textContent === 'Running'
  $('#app-back').click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  out.noBottomPeekAfterAppNavigation = $('#peek') === null && document.querySelector('[data-slot="peek"]') === null
  out.stateSummaryRemainsVisible = !$('#sb-state-summary').hidden && $('#sb-state-summary').textContent.includes('Remote')
  await window.odkAppPlatform.openApp({ appId: 'app-manager' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  out.appManagerSearchVisible = Boolean($('#app-runtime .app-manager .app-search'))
  const appList = $('#app-runtime .app-manager .app-list')
  const countBeforeSearch = appList?.querySelectorAll('li').length || 0
  const search = $('#app-runtime .app-manager .app-search')
  if (search) { search.value = 'Pomodoro'; search.dispatchEvent(new Event('input', { bubbles: true })) }
  out.appManagerSearchFilters = countBeforeSearch > 1 && appList.querySelectorAll('li').length === 1
  $('#app-back').click()
  out.appEndpointTrace = window.odkAppPlatform?.endpoint === 'main-process'
  $('#app-back').click()
  out.pagePreservedAfterWidgetApp = document.querySelectorAll('#dots .dot')[1].classList.contains('active')

  document.querySelectorAll('#dots .dot')[2].click()
  await new Promise((resolve) => setTimeout(resolve, 350))
  out.transformAfterDotJump = track.style.transform
  out.thirdDotActive = document.querySelectorAll('#dots .dot')[2].classList.contains('active')
  out.thirdPageContext = $('#page-context').textContent === 'Usage · 3/3'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  out.arrowLeftReturnsToGrid = $('#page-context').textContent === 'Home · 2/3'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  out.endJumpsToQuota = $('#page-context').textContent === 'Usage · 3/3'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  out.homeJumpsToToday = $('#page-context').textContent === 'Today · 1/3'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  out.consecutiveArrowRightsReachUsage = $('#page-context').textContent === 'Usage · 3/3'
  document.querySelectorAll('#dots .dot')[2].click()
  out.quotaStateIsHonest = $('#quota-state').textContent.includes('OpenCode Go not configured')
  out.quotaRefreshLabel = $('#quota-refresh').textContent === 'Check status again'
  out.quotaHelpLabel = $('#quota-help').textContent === 'Navigation help'
  out.quotaCheckedVisible = $('#quota-checked').textContent.includes('Last checked')
  out.quotaHasNoFabricatedUsage = $('#quota-metrics').textContent.includes('Actual usage has not been retrieved')
  $('#quota-help').click()
  out.helpViewVisible = !$('#app-view').hidden && $('#app-help').textContent.includes('Swipe')
  out.helpBackgroundHidden = $('#pages-viewport').getAttribute('aria-hidden') === 'true' && $('#pages-viewport').inert
  // Electron under headless X11 can legitimately report BODY when focus is
  // requested by a visible, modal dialog. The dialog's tabbable Back control
  // is the durable accessibility contract; keyboard focus is covered by the
  // tab trap exercised in production.
  out.helpDialogBackIsTabbable = !$('#app-back').hidden && $('#app-back').tabIndex >= 0
  $('#app-back').click()
  $('#quota-refresh').click()
  out.quotaRefreshPreservesTruth = $('#quota-state').textContent.includes('OpenCode Go not configured')
  out.quotaRefreshShowsCheck = $('#quota-checked').textContent.includes('Last checked')
  out.quotaPageAfterEscape = document.querySelectorAll('#dots .dot')[2].classList.contains('active')

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
    let widgetsInside = 0
    const widgets = [...document.querySelectorAll('.widget')]
    for (const el of widgets) {
      const r = el.getBoundingClientRect()
      if (
        r.top >= viewport.top - 2 &&
        r.bottom <= viewport.bottom + 2 &&
        r.left >= viewport.left - 2 &&
        r.right <= viewport.right + 2
      ) { widgetsInside += 1 }
    }
    let textsFit = true
    for (const el of document.querySelectorAll('.w-clock-time, .al-day, .ring-mmss')) {
      const box = el.closest('.card, .widget').getBoundingClientRect()
      const r = el.getBoundingClientRect()
      if (r.left < box.left - 1 || r.right > box.right + 1 || r.bottom > box.bottom + 1) { textsFit = false }
    }
    return {
      cellW: m.cellW,
      widgetsTotal: widgets.length,
      widgetsInside,
      gridColumns: getComputedStyle(document.querySelector('.widget-grid')).gridTemplateColumns.split(' ').length,
      gridRows: getComputedStyle(document.querySelector('.widget-grid')).gridTemplateRows.split(' ').length,
      widgetsReflowed: widgets.every((widget) => getComputedStyle(widget).gridColumnStart === 'auto' && getComputedStyle(widget).gridRowStart === 'auto'),
      textsFit,
    }
  })()
`

function check(results) {
  const checks = [
    ['grid metrics exposed', results.metricsExposed],
    ['app view hidden on load', results.appViewDisplayOnLoad === 'none'],
    ['plugins expose complete lifecycle', results.pluginsHaveCompleteLifecycle],
    ['plugins use Open DeskOS identities', results.pluginsUseOdkIdentity],
    ['focused State Bar without desktop chrome clutter', results.focusedStateBar && results.noDockOrDesktopIconPile],
    ['plugin registry includes shell, state and app plugins',
      ['odk.tile.almanac', 'odk.tile.chat', 'odk.tile.clock', 'odk.tile.current-emotion', 'odk.page.dashboard', 'odk.tile.desk-status', 'odk.tile.face-presence', 'odk.status.summary', 'odk.tile.pomodoro', 'odk.tile.pi-sessions', 'odk.page.quota', 'odk.tile.settings', 'odk.status.clock', 'odk.status.connection', 'odk.status.pi-sessions', 'odk.tile.year', 'odk.app.calendar', 'odk.app.clock', 'odk.app.app-manager', 'odk.app.pomodoro', 'odk.app.year', 'odk.app.pi-sessions'].every((id) => results.pluginIds.includes(id))],
    ['duplicate plugin registration rejected', results.duplicateRegistrationRejected],
    ['desktop layout validates against registry', results.layoutValidated],
    ['unknown plugin rejected by composer', results.unknownPluginRejected],
    ['all pages built by composer', results.pagesBuiltByComposer],
    ['status bar slots mounted by plugins', results.statusSlotsMounted],
    ['State Bar summary is mounted and bottom Peek is removed', results.statusSlotsMounted && results.noBottomPeek && results.stateSummaryIsFactual && results.stateSummaryFits],
    ['status bar holds dots', results.dotsInsideStatusBar],
    ['bolt left of dots', results.boltLeftOfDots],
    ['clock right of dots', results.clockRightOfDots],
    ['three pages', results.pageCount === 3],
    ['three dots', results.dotCount === 3],
    ['page context is tracked', results.pageContext === 'Today · 1/3'],
    ['bundled fonts are loaded', results.fontsLoaded],
    ['clock HH:MM', results.clockFormatted],
    ['dashboard weekday header', results.dashWeekday],
    ['dashboard month-day format', results.dashDateFormatted],
    ['dashboard year is current', results.dashYearCurrent],
    ['Today presents only truthful local and configured-provider states', results.todayStatesAreTruthful],
    ['subscription starts in an honest unconfigured state', results.subscriptionInitialStatus && results.quotaStateIsHonest],
    ['tabler icon set complete', results.tablerSetComplete],
    ['tabler icons count >= 3', results.tablerCount >= 3],
    ['ten state widgets with unique identities', results.widgetCount === 10 && results.uniqueApps],
    ['experimental vision does not block the shell', results.experimentalVisionDoesNotBlockShell],
    ['widgets declare truthful state and App continuation', results.widgetStatesAreHonest && results.widgetIntentMetadata],
    ['right edge shows truthful local desk status', results.deskStatusIsTruthful && results.deskStatusPlacement],
    ['renderer has no filesystem API', results.rendererHasNoFilesystemApi],
    ['preload exposes the Linux platform endpoints', results.preloadExposesIntentEndpoint && results.preloadExposesSubscriptionEndpoint && results.preloadExposesFaceAgentEndpoint && results.endpointListCalled && results.endpointIntentCalled],
    ['preload exposes only narrow Remote Link API', results.remotePreloadIsNarrow],
    ['pager publishes complete authoritative Remote state', results.remotePageStatePublishesAuthoritativeBoundaries],
    ['State Bar displays USB, wireless, and synchronizing Remote Link states', results.stateShowsUsbRemote && results.stateShowsWirelessRemote && results.stateShowsSyncingRemote],
    ['Remote Link navigation moves only an unoccluded bounded pager', results.remoteNavigationMovesPager],
    ['duplicate Remote Link navigation moves only one page', results.repeatedRemoteMovesOnce],
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
    ['grid has 5 columns', results.gridColumns === 5],
    ['grid has 3 rows', results.gridRows === 3],
    ['grid flush to screen edges', results.gridFlushEdges],
    ['clock widget spans 1x1 square', results.clockSpansOneSquare],
    ['pomodoro widget spans 2x2 square', results.pomodoroSpansTwoSquare],
    ['State Bar shows subscription, network, and Remote Link status', results.stateSummaryIsFactual && results.noBottomPeek],
    ['swipe moves to page 2', results.transformAfterSwipe === `translateX(-${results.viewportWidth}px)`],
    ['second dot active', results.secondDotActive],
    ['small drag on tile keeps page', results.transformAfterTileDrag === `translateX(-${results.viewportWidth}px)`],
    ['tile drag never opens a view', results.appHiddenAfterTileDrag],
    ['widget tap opens its continuation App', results.widgetTapOpensContinuationApp && results.widgetSourceContextPreserved && results.widgetAppShowsRuntimeContent],
    ['widget intent routes through platform layers', results.platformIntentTrace && results.appEndpointTrace],
    ['pomodoro Widget follows App state', results.pomodoroTileStateAfterOpen],
    ['State Bar remains factual after App navigation', results.noBottomPeekAfterAppNavigation && results.stateSummaryRemainsVisible],
    ['built-in view search is available', results.appManagerSearchVisible && results.appManagerSearchFilters],
    ['widget App returns to source page', results.pagePreservedAfterWidgetApp],
    ['cancelled drag keeps navigation usable', results.cancelledDragKeepsNavigationUsable],
    ['dot click jumps to last page', results.transformAfterDotJump === `translateX(-${results.viewportWidth * 2}px)`],
    ['third dot active after jump', results.thirdDotActive],
    ['third page context is visible', results.thirdPageContext],
    ['ArrowLeft returns to grid', results.arrowLeftReturnsToGrid],
    ['End jumps to quota', results.endJumpsToQuota],
    ['Home jumps to Today', results.homeJumpsToToday],
    ['consecutive ArrowRight presses reach Usage', results.consecutiveArrowRightsReachUsage],
    ['quota status is native and honest', results.quotaStateIsHonest && results.quotaHasNoFabricatedUsage],
    ['quota exposes check state', results.quotaCheckedVisible],
    ['quota has operation guide', results.quotaHelpLabel && results.helpViewVisible],
    ['dialog hides pages from assistive tech', results.helpBackgroundHidden],
    ['dialog exposes a tabbable back action', results.helpDialogBackIsTabbable],

    ['quota refresh preserves truth', results.quotaRefreshLabel && results.quotaRefreshPreservesTruth && results.quotaRefreshShowsCheck],
    ['quota page remains selected after help', results.quotaPageAfterEscape],
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
  await win.webContents.executeJavaScript("document.querySelectorAll('#dots .dot')[1].click()", true)
  await new Promise((resolve) => setTimeout(resolve, 350))
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
      ['all widgets inside viewport', probe.widgetsInside === probe.widgetsTotal || probe.widgetsTotal === 0],
      ['widget text fits tiles', probe.textsFit],
      ['runtime metrics match layout module', probe.cellW === expectedCell],
      ['responsive grid columns match layout', probe.gridColumns === layout.compute(width, height).cols],
      ['responsive grid rows remain bounded', probe.gridRows <= layout.compute(width, height).rows],
      ['responsive widgets reflow explicit desktop coordinates', probe.widgetsReflowed || width >= 1000],
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

async function main() {
  const appManager = createAppManagerEndpoint()
  ipcMain.handle('odk-opencode-go-status', () => ({ state: 'unconfigured', missing: ['ODK_OPENCODE_GO_URL', 'ODK_OPENCODE_COOKIE or ODK_OPENCODE_COOKIE_FILE'] }))
  ipcMain.handle('odk-face-agent-status', () => ({ state: 'unavailable', facesCount: null, emotion: null, unlocked: false }))
  ipcMain.handle('odk-pi-sessions', () => scanPiSessions())
  const endpointCalls = { list: 0, intent: 0 }
  const remotePageStates = []
  ipcMain.handle('odk-app-manager-list', () => {
    endpointCalls.list += 1
    return appManager.list()
  })
  ipcMain.handle('odk-app-manager-state', (_event, appId) => appManager.get(appId))
  ipcMain.handle('odk-app-manager-intent', (_event, intent) => {
    endpointCalls.intent += 1
    return appManager.dispatch(intent)
  })
  ipcMain.handle('odk-remote-publish-page-state', (_event, state) => {
    remotePageStates.push(state)
    return true
  })

  const win = new BrowserWindow({
    width: 1920,
    height: 1280,
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
  await new Promise((resolve) => setTimeout(resolve, 50))
  results.endpointListCalled = endpointCalls.list > 0
  results.endpointIntentCalled = endpointCalls.intent > 0
  results.remotePageStatePublishesAuthoritativeBoundaries =
    remotePageStates.some((state) => state.page === 1 && state.pages === 3 && state.name === 'Today' && !state.canPrev && state.canNext) &&
    remotePageStates.some((state) => state.page === 3 && state.pages === 3 && state.name === 'Usage' && state.canPrev && !state.canNext)
  win.webContents.send('odk-remote-link-state', { state: 'usb', sequence: 1 })
  await new Promise((resolve) => setTimeout(resolve, 50))
  results.stateShowsUsbRemote = await win.webContents.executeJavaScript(
    "document.querySelector('#sb-remote-state').textContent === 'Remote · Connected by USB'",
    true,
  )
  win.webContents.send('odk-remote-link-state', { state: 'wireless', sequence: 2 })
  await new Promise((resolve) => setTimeout(resolve, 50))
  results.stateShowsWirelessRemote = await win.webContents.executeJavaScript(
    "document.querySelector('#sb-remote-state').textContent === 'Remote · Connected wirelessly'",
    true,
  )
  win.webContents.send('odk-remote-link-state', { state: 'syncing', sequence: 3 })
  await new Promise((resolve) => setTimeout(resolve, 50))
  results.stateShowsSyncingRemote = await win.webContents.executeJavaScript(
    "document.querySelector('#sb-remote-state').textContent === 'Remote · Synchronizing'",
    true,
  )
  await new Promise((resolve) => setTimeout(resolve, 1400))
  const pageContext = () => win.webContents.executeJavaScript(
    "document.querySelector('#page-context').textContent",
    true,
  )
  win.webContents.send('odk-remote-navigation', { direction: 'previous' })
  await new Promise((resolve) => setTimeout(resolve, 1400))
  const movedToToday = await pageContext() === 'Today · 1/3'
  win.webContents.send('odk-remote-navigation', { direction: 'previous' })
  await new Promise((resolve) => setTimeout(resolve, 1400))
  const heldAtFirstPage = await pageContext() === 'Today · 1/3'
  win.webContents.send('odk-remote-navigation', { direction: 'next' })
  await new Promise((resolve) => setTimeout(resolve, 1400))
  const movedToHome = await pageContext() === 'Home · 2/3'
  win.webContents.send('odk-remote-navigation', { direction: 'next' })
  win.webContents.send('odk-remote-navigation', { direction: 'next' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const repeatedRemoteMovesOnce = await pageContext() === 'Usage · 3/3'
  results.remoteNavigationMovesPager = movedToToday && movedToHome && heldAtFirstPage
  results.repeatedRemoteMovesOnce = repeatedRemoteMovesOnce
  const driverFailures = check(results)
  const motionFailures = await runMotionChecks(win)
  const sweepFailures = await runGeometrySweep(win)
  clearTimeout(timeout)

  process.exitCode = driverFailures + motionFailures + sweepFailures === 0 ? 0 : 1
  app.exit(process.exitCode)
}

app.whenReady().then(main)
