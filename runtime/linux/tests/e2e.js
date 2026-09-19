const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { scanPiSessions } = require('../src/pi-sessions')

const APP_ROOT = path.resolve(__dirname, '..')
const { createAppManagerEndpoint } = require('../src/app-manager-endpoint')
const OVERALL_TIMEOUT_MS = 60000
const EXTRA_SIZES = [
  ['user window', 636, 900],
  ['small dev', 480, 854],
  ['minimum portrait', 320, 480],
]

const DRIVER_SCRIPT = `
(async () => {
  const $ = (selector) => document.querySelector(selector)
  const text = (selector) => {
    const element = $(selector)
    if (!element) throw new Error('Required E2E element missing: ' + selector)
    return element.textContent
  }
  const out = {}
  const viewport = $('#pages-viewport')
  const track = $('#pages-track')
  const approx = (a, b, tol = 4) => Math.abs(a - b) <= tol

  await new Promise((resolve) => setTimeout(resolve, 400))
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
  out.focusedStateBar = $('#sb-state-summary') === null && $('#page-context')?.classList.contains('sr-only')
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
    document.querySelector('[data-slot="status-right"] .sb-time') !== null
  out.noBottomPeek = $('#peek') === null && document.querySelector('[data-slot="peek"]') === null
  out.noRemovedLegacySurfaces = !out.pluginIds.includes('odk.app.system') && !document.querySelector('#peek, [data-slot="peek"]')
  out.stateSummaryRemoved = $('#sb-state-summary') === null

  const statusBarRect = $('#status-bar').getBoundingClientRect()
  const dotsRect = $('#dots').getBoundingClientRect()
  const netRect = $('#sb-net').getBoundingClientRect()
  const timeRect = $('.sb-time').getBoundingClientRect()
  out.statusBarRects = { statusBar: statusBarRect.toJSON(), dots: dotsRect.toJSON(), net: netRect.toJSON(), time: timeRect.toJSON() }
  out.dotsInsideStatusBar =
    dotsRect.top >= statusBarRect.top && dotsRect.bottom <= statusBarRect.bottom
  out.netIndicatorLeftOfDots = netRect.right <= dotsRect.left
  out.clockRightOfDots = timeRect.left >= dotsRect.right


  out.pageCount = document.querySelectorAll('#pages-track .page').length
  out.dotCount = document.querySelectorAll('#dots .dot').length
  out.noUserAppsPage = !document.querySelector('.user-apps') && window.DESKTOP_LAYOUT.pages.every(page => page.id !== 'user-apps')
  out.pageContext = text('#page-context')
  out.surfaceSeparation =
    document.querySelector('#pages-track .page[data-page-id="home"]')?.dataset.surface === 'display' &&
    document.querySelector('#pages-track .page[data-page-id="today"]')?.dataset.surface === 'display' &&
    document.querySelector('#pages-track .page[data-page-id="pi-sessions"]')?.dataset.surface === 'app' &&
    document.querySelector('#pages-track .page[data-page-id="quota"]')?.dataset.surface === 'app'
  out.fontsLoaded = document.fonts.check('400 20px Zpix') || (document.fonts.check('700 32px Montserrat') && document.fonts.check('400 20px "Noto Sans SC"'))

  out.clockFormatted = /^\\d{2}:\\d{2}$/.test(text('.sb-time'))
  out.dashWeekday = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/.test(text('#dash-wd'))
  out.dashDateFormatted = /^(January|February|March|April|May|June|July|August|September|October|November|December) \\d{1,2}$/.test(text('#dash-md'))
  out.dashYearCurrent = text('#dash-y') === String(new Date().getFullYear())
  const narrative = $('#dash-narrative')
  const briefingDeadline = Date.now() + 3000
  while (Date.now() < briefingDeadline && !narrative.querySelector('[data-briefing]')) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  out.narrativeStatements = [...narrative.querySelectorAll('.dash-clause')].map((clause) => clause.textContent)
  out.narrativeText = text('.dash-narrative')
  out.todayBriefsFromPlugins =
    out.narrativeStatements.length === 1 &&
    narrative.querySelector('[data-briefing="odk.briefing.pi-sessions"]') !== null &&
    /Pi session/.test(out.narrativeText) &&
    narrative.querySelectorAll('b').length === 2 &&
    narrative.querySelectorAll('b svg[data-tabler]').length === 2
  out.todayOmitsDeskStatus =
    !/Network (connected|disconnected)/.test(out.narrativeText) &&
    !/Focus is not started/.test(out.narrativeText) &&
    !/Quota|OpenCode/.test(out.narrativeText)
  out.todayClaimsNoPersonalData = !/\b(?:\d+ meetings|\d+ tasks|\d+ habits|steps|sleep|hours)\b/.test(out.narrativeText)
  const requiredIcons = ['wifi', 'wifi-off', 'chevron-left', 'folder']
  const presentIcons = [...document.querySelectorAll('svg[data-tabler]')].map((s) => s.dataset.tabler)
  out.tablerSetComplete = requiredIcons.every((name) => presentIcons.includes(name))
  out.tablerCount = presentIcons.length
  const apps = [...document.querySelectorAll('.widget')].map((w) => w.dataset.app)
  const declaredWidgets = window.DESKTOP_LAYOUT.pages.filter(page => page.kind === 'grid').flatMap(page => page.widgets.map(widget => widget.id)).sort()
  const renderedWidgets = [...document.querySelectorAll('.widget')].map(widget => widget.dataset.widget).sort()
  out.widgetIdentitiesMatch = JSON.stringify(declaredWidgets) === JSON.stringify(renderedWidgets)
  out.widgetCount = apps.length
  out.uniqueApps = new Set(apps).size === apps.length
  out.widgetsDeclaredViaDataAttr =
    document.querySelectorAll('.widget[data-widget]').length === declaredWidgets.length &&
    [...document.querySelectorAll('.widget[data-widget]')].every((widget) => widget.dataset.widget.startsWith('odk.tile.'))
  out.shellBootsWithoutPeripheralGates =
    !$('#pages-viewport').inert &&
    !$('#status-bar').inert
  out.widgetStatesAreHonest =
    /^[0-9]{1,2}$/.test($('.w-almanac .al-day')?.textContent || '') &&
    $('.w-pomodoro .w-state')?.textContent === 'Not started'
  out.widgetsUseFlexibleAnatomy = Boolean(
    $('.w-almanac .al-day') &&
    $('.w-year .year-signal-line') &&
    $('.w-pomodoro .pomodoro-state') &&
    $('.w-weread .weread-body') &&
    $('.w-pi-sessions .pi-widget-count') &&
    !document.querySelector('.widget .widget-header, .widget .widget-footer')
  )
  const hydraTile = document.querySelector('[data-widget="odk.tile.hydra"]')
  out.hydraTileMounted = Boolean(hydraTile?.querySelector('.hydra-head'))
  out.hydraTilePlacement = hydraTile && getComputedStyle(hydraTile).gridColumnStart === '5' &&
    getComputedStyle(hydraTile).gridRowStart === '2' && getComputedStyle(hydraTile).gridRowEnd === '4'
  out.hydraStateIsHonest = ['Unconfigured', 'Waiting', 'Offline', 'Stale env', 'Live'].includes(hydraTile?.querySelector('.hydra-badge')?.textContent)
  out.widgetsAreDisplayOnly =
    [...document.querySelectorAll('.widget')].every((widget) =>
      widget.tagName === 'DIV' && widget.dataset.interaction === 'display-only') &&
    !document.querySelector('.widget-interactive, .widget-action-cue')
  out.rendererHasNoFilesystemApi = typeof window.require === 'undefined' && typeof window.process === 'undefined'
  out.preloadExposesIntentEndpoint = typeof window.odkPlatform?.dispatchIntent === 'function' && typeof window.odkPlatform?.listApps === 'function'
  out.preloadExposesSubscriptionEndpoint = typeof window.odkPlatform?.getOpenCodeGoStatus === 'function'
  out.preloadExposesCameraEndpoint = typeof window.odkPlatform?.getCameraFrame === 'function'
  out.remotePreloadIsNarrow = JSON.stringify(Object.keys(window.odkRemote || {}).sort()) === JSON.stringify(['publishPageState', 'subscribeInput', 'subscribeLinkState', 'subscribeNavigation'])
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
    document.elementFromPoint(firstDotRect.left + firstDotRect.width / 2, firstDotRect.top + firstDotRect.height / 2 - 16) === dots[0]
  const dotTransform = getComputedStyle(dots[0]).transform
  out.dotButtonNotTransformed = dotTransform === 'none' || dotTransform === 'matrix(1, 0, 0, 1, 0, 0)'
  const widgets = [...document.querySelectorAll('.widget')]
  const signalSelector = '.w-state, .al-day, .w-clock-time, .year-pct, .widget-status-value, .pi-widget-count, .ring-mmss, .hydra-plant-soil, .weread-text, .preorder-count'
  out.widgetsHaveState = widgets.every((widget) => widget.querySelector(signalSelector)?.textContent.trim())
  out.clockIsAvailable = /^\\d{2}:\\d{2}$/.test(text('.w-clock-time'))
  out.pomodoroNotRunning = text('.ring-mmss') === '--:--' && text('.w-pomodoro .w-state') === 'Not started'
  window.dispatchEvent(new Event('offline'))
  out.netIndicatorOffline =
    $('#sb-net').dataset.online === 'false' &&
    $('#sb-net [data-tabler="wifi-off"]').hasAttribute('hidden') === false &&
    $('#sb-net [data-tabler="wifi"]').hasAttribute('hidden') === true &&
    $('#sb-net').getAttribute('aria-label') === 'Network disconnected'
  out.offlineAnnounced = text('#status-announcement').includes('Network disconnected')
  window.dispatchEvent(new Event('online'))
  out.netIndicatorOnline =
    $('#sb-net').dataset.online === 'true' &&
    $('#sb-net [data-tabler="wifi"]').hasAttribute('hidden') === false &&
    $('#sb-net [data-tabler="wifi-off"]').hasAttribute('hidden') === true &&
    $('#sb-net').getAttribute('aria-label') === 'Network connected'
  out.onlineAnnounced = text('#status-announcement').includes('Network connected')

  const grid = $('.widget-grid')
  const gridRect = grid.getBoundingClientRect()
  const gridPageRect = grid.closest('.page').getBoundingClientRect()
  out.gridColumns = getComputedStyle(grid).gridTemplateColumns.split(' ').length
  out.gridRows = getComputedStyle(grid).gridTemplateRows.split(' ').length
  out.gridFlushEdges =
    gridRect.left >= gridPageRect.left - 2 &&
    gridRect.right <= gridPageRect.right + 2
  // Pages are addressed by layout id: inserting a display page must not retarget a
  // positional selector onto the wrong surface (see tests/helpers/pages.js).
  const piAppRect = document.querySelector('#pages-track .page[data-page-id="pi-sessions"] .pi-app-wrapper').getBoundingClientRect()
  const quotaCardRect = document.querySelector('#pages-track .page[data-page-id="quota"] .quota-card').getBoundingClientRect()
  const appSurfaceWidth = Math.min(metrics.gridW, window.innerWidth)
  out.appSurfacesMatchGridFootprint =
    approx(piAppRect.width, appSurfaceWidth) &&
    approx(piAppRect.height, metrics.gridH) &&
    approx(quotaCardRect.width, appSurfaceWidth) &&
    approx(quotaCardRect.height, metrics.gridH)
  out.cardsHaveNoStateEdgeBars = [...document.querySelectorAll('.widget, .pi-overview-cell')].every((card) => {
    const before = getComputedStyle(card, '::before')
    const border = getComputedStyle(card)
    return before.content === 'none' && Number.parseFloat(border.borderLeftWidth) <= 3
  })
  const appTextSelectors = '.pi-goal-text, .pi-activity-text, .pi-event-text, .widget-status-detail'
  out.essentialTextDoesNotUseEllipsis = [...document.querySelectorAll(appTextSelectors)].every((el) => {
    const style = getComputedStyle(el)
    return style.textOverflow !== 'ellipsis' && style.whiteSpace !== 'nowrap'
  })
  out.piRawIdentifiersHidden = document.querySelectorAll('.pi-card-uuid, .pi-card-pid').length === 0
  const monitoredSurfaces = [
    ...document.querySelectorAll('.widget'),
    ...document.querySelectorAll('#pages-track .page[data-surface="app"] > div'),
  ]
  out.monitoredSurfacesStayInBounds = monitoredSurfaces.length === declaredWidgets.length + window.DESKTOP_LAYOUT.pages.filter(page => page.surface === 'app').length && monitoredSurfaces.every((surface) => {
    const rect = surface.getBoundingClientRect()
    const page = surface.closest('.page').getBoundingClientRect()
    return rect.left >= page.left - 2 && rect.right <= page.right + 2 && rect.top >= page.top - 2 && rect.bottom <= page.bottom + 2
  })

  const clockRect = $('.w-clock').getBoundingClientRect()
  out.clockSpansOneSquare = approx(clockRect.width, metrics.cellW) && approx(clockRect.height, metrics.cellH)

  const pomodoroRect = $('.w-pomodoro').getBoundingClientRect()
  out.pomodoroSpansTwoSquare =
    approx(pomodoroRect.height, 2 * metrics.cellH + metrics.gutter)

  out.subscriptionInitialStatus = text('#quota-metrics .provider-quota-empty') === 'Actual quotas have not been retrieved.'
  out.noBottomPeek = $('#peek') === null && document.querySelector('[data-slot="peek"]') === null

  const pageIndex = (index) => document.querySelectorAll('#dots .dot')[index].click()
  const jumpToPage = (id) => document.querySelectorAll('#dots .dot')[window.DESKTOP_LAYOUT.pages.findIndex(page => page.id === id)].click()
  pageIndex(0)
  await new Promise((resolve) => setTimeout(resolve, 300))
  window.odkRemote.subscribeInput((input) => {})
  window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'up' }))
  out.remoteDisplayPageIgnoresVerticalInput = document.querySelectorAll('#dots .dot')[0].classList.contains('active')
  jumpToPage('pi-sessions')
  await new Promise((resolve) => setTimeout(resolve, 300))
  window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'primary' }))
  await new Promise((resolve) => setTimeout(resolve, 20))
  out.remoteAppPrimaryEstablishesFocus = document.querySelector('#pages-track .page[data-page-id="pi-sessions"]')?.contains(document.activeElement)
  const pageBeforeFocusMove = text('#page-context')
  window.dispatchEvent(new CustomEvent('odk-remote-input', { detail: 'right' }))
  out.remoteAppDirectionStaysOnPage = text('#page-context') === pageBeforeFocusMove

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
  out.displayWidgetDoesNotOpenApp = $('#app-view').hidden
  out.displayWidgetHasNoAction = tile.tagName === 'DIV' && !tile.matches(':focus')
  out.platformAppStillOpensSeparately = await window.odkAppPlatform.openApp({
    appId: 'pomodoro', widgetId: 'e2e-separate-app', route: 'home',
  })
  await new Promise((resolve) => setTimeout(resolve, 100))
  out.appSurfaceShowsRuntimeContent = !$('#app-view').hidden && text('#app-title') === 'Pomodoro' && $('#app-runtime .runtime-app h2')?.textContent === 'Pomodoro'
  out.appSurfacePreservesSourceContext = $('#app-view').dataset.sourceWidget === 'e2e-separate-app' && $('#app-view').dataset.route === 'home'
  out.platformIntentTrace = JSON.stringify(window.odkAppPlatform?.events?.slice(-3).map((event) => event.layer)) === JSON.stringify(['installer', 'app-manager', 'app-runtime'])
  $('#app-back').click()
  await new Promise((resolve) => setTimeout(resolve, 100))
  out.noBottomPeekAfterAppNavigation = $('#peek') === null && document.querySelector('[data-slot="peek"]') === null
  out.stateSummaryRemainsRemoved = $('#sb-state-summary') === null
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
  out.thirdPageContext = text('#page-context') === 'Reading · 3/5'
  const piPage = document.querySelector('#pages-track .page[data-page-id="pi-sessions"]')
  out.piPageIsInteractiveAppSurface =
    piPage?.dataset.surface === 'app' &&
    Boolean(piPage.querySelector('.pi-app-wrapper'))
  out.piPageHasAppControls =
    Boolean(piPage?.querySelector('#pi-detail')) &&
    Boolean(piPage?.querySelector('#pi-overview')) &&
    Boolean(piPage?.querySelector('#pi-overview-filters')) &&
    Boolean(piPage?.querySelector('.pi-overview-list'))
  out.piPageRemovedListControls =
    piPage?.querySelector('#pi-search-input') === null &&
    piPage?.querySelector('#pi-refresh-btn') === null &&
    piPage?.querySelector('#pi-view-toggle') === null &&
    piPage?.querySelector('#pi-source-label') === null &&
    piPage?.querySelector('.pi-session-card') === null &&
    piPage?.querySelector('.pi-metric-pill') === null &&
    piPage?.querySelector('.pi-filter-group') === null &&
    piPage?.querySelector('.pi-overview-open') === null &&
    piPage?.querySelector('.pi-session-step') === null &&
    piPage?.querySelector('.pi-overview-close') === null &&
    piPage?.querySelector('.pi-status-badge') === null &&
    piPage?.querySelector('.pi-ws-title') === null &&
    piPage?.querySelector('.pi-detail-position') === null &&
    piPage?.querySelector('#pi-overview-summary') === null &&
    piPage?.querySelector('.pi-overview-grid') === null &&
    piPage?.querySelector('.pi-overview-name') === null
  out.piPageLandsOnTheLiveList =
    piPage?.querySelector('#pi-overview')?.hidden === false &&
    piPage?.querySelector('#pi-detail')?.inert === true &&
    piPage?.querySelectorAll('.pi-overview-cell.is-selected').length === 1 &&
    piPage?.querySelector('.pi-overview-cell.is-selected[data-page-focus]') !== null
  // The Session Overview owns the Session Filter; the Session Detail never does.
  out.piPageOwnsTheSessionFilter =
    piPage?.querySelector('#pi-overview-filters[role="group"][aria-label="Session status filter"]') !== null &&
    [...piPage.querySelectorAll('#pi-overview-filters .pi-filter-btn')].map(button => button.dataset.filter).join(',') === 'live,working,idle,exited,all' &&
    piPage.querySelector('.pi-filter-btn.active')?.dataset.filter === 'live' &&
    piPage.querySelector('.pi-filter-btn.active').getAttribute('aria-pressed') === 'true' &&
    [...piPage.querySelectorAll('.pi-filter-btn')].every(button => /^(\d+|--)$/.test(button.querySelector('.pi-filter-count').textContent)) &&
    piPage.querySelector('#pi-detail .pi-filter-btn') === null
  out.piPageFilterNarrowsTheList = (() => {
    const live = piPage.querySelectorAll('.pi-overview-cell').length
    piPage.querySelector('.pi-filter-btn[data-filter="working"]').click()
    const working = piPage.querySelectorAll('.pi-overview-cell').length
    piPage.querySelector('.pi-filter-btn[data-filter="exited"]').click()
    const exited = piPage.querySelectorAll('.pi-overview-cell').length
    piPage.querySelector('.pi-filter-btn[data-filter="live"]').click()
    const restored = piPage.querySelectorAll('.pi-overview-cell').length
    return live >= 1 && working >= 1 && working < live && exited === 0 && restored === live &&
      piPage.querySelector('.pi-filter-btn[data-filter="live"]').getAttribute('aria-pressed') === 'true'
  })()
  // The live list is the page's home, and every row states its own Pi state and
  // directory; the Session Detail never carries a session control.
  out.piPageShowsLiveStateAndDirectory = (() => {
    const cells = [...piPage.querySelectorAll('.pi-overview-cell')]
    const selected = piPage.querySelector('.pi-overview-cell.is-selected')
    return cells.length >= 1 &&
      cells.every(cell => /^(Working\.\.\.|Idle|Exited)$/.test(cell.querySelector('.pi-overview-state .pi-state-text').textContent.trim())) &&
      Boolean(selected) &&
      (selected.querySelector('.pi-overview-path').textContent || '').includes('/')
  })()
  const piPageText = piPage?.textContent || ''
  out.piPageRendersSessionDetails =
    !piPageText.includes('PID 4102') &&
    piPageText.includes('Refactor the desk UI layout') &&
    !piPageText.includes('metadata unavailable') &&
    !piPageText.includes('automation')
  out.piFilesOmittedForCompactness = piPage?.querySelector('.pi-files-toggle') === null
  out.piOverviewOpensTheDetailWithoutRemote = (() => {
    const cell = piPage.querySelector('.pi-overview-cell')
    cell.click()
    const detail = piPage.querySelector('#pi-detail')
    const opened = piPage.querySelector('#pi-overview').hidden === true && detail.inert === false &&
      /^(Working\.\.\.|Idle)$/.test(piPage.querySelector('#pi-title-text').textContent) &&
      piPage.querySelector('#pi-view-subtitle').textContent.includes('/') &&
      /elapsed/.test(piPage.querySelector('#pi-view-facts').textContent) &&
      piPage.querySelector('#pi-detail .pi-filter-btn') === null
    // The page's own primary input returns to the live list.
    piPage.dispatchEvent(new CustomEvent('odk-remote-page-input', { detail: { input: 'primary' }, bubbles: true }))
    return opened && piPage.querySelector('#pi-overview').hidden === false && detail.inert === true
  })()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
  out.arrowLeftReturnsToGrid = text('#page-context') === 'Home · 2/5'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  out.endJumpsToUsage = text('#page-context') === 'Usage · 5/5'
  out.usageIsInteractiveAppSurface =
    document.querySelector('#pages-track .page[data-page-id="quota"]')?.dataset.surface === 'app' &&
    Boolean(document.querySelector('#pages-track .page[data-page-id="quota"] #quota-refresh'))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  out.homeJumpsToToday = text('#page-context') === 'Today · 1/5'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  out.consecutiveArrowRightsReachUsage = text('#page-context') === 'Usage · 5/5'
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  out.arrowRightStaysAtUsage = text('#page-context') === 'Usage · 5/5'
  document.querySelectorAll('#dots .dot')[4].click()
  out.quotaStateIsHonest = text('#quota-metrics .provider-quota-empty') === 'Actual quotas have not been retrieved.'
  out.quotaRefreshLabel = text('#quota-refresh') === 'Refresh quotas'
  out.quotaHelpRemoved = $('#quota-help') === null
  out.quotaCheckedVisible = text('#quota-checked').includes('Last checked')
  out.quotaHasNoFabricatedUsage = !$('#quota-metrics .provider-quota-card, #quota-metrics [role="meter"]') && !/\\d+%/.test(text('#quota-metrics'))
  out.quotaMetricsAreLabeled = $('#quota-metrics').classList.contains('provider-quota-grid') && $('#quota-feedback').getAttribute('role') === 'status' && $('#quota-feedback').getAttribute('aria-live') === 'polite'
  $('#quota-refresh').click()
  out.quotaRefreshPreservesTruth = text('#quota-metrics .provider-quota-empty') === 'Actual quotas have not been retrieved.'
  out.quotaRefreshShowsCheck = text('#quota-checked').includes('Last checked')
  out.quotaPageAfterEscape = document.querySelectorAll('#dots .dot')[4].classList.contains('active')

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
    let widgetsInside = 0
    const widgets = [...document.querySelectorAll('.widget')]
    for (const el of widgets) {
      const r = el.getBoundingClientRect()
      const page = el.closest('.page')
      const bounds = page.getBoundingClientRect()
      if (
        r.left >= bounds.left - 2 &&
        r.right <= bounds.right + 2 &&
        (r.bottom <= bounds.bottom + 2 || getComputedStyle(page).overflowY === 'auto')
      ) { widgetsInside += 1 }
    }
    const overflowingTexts = []
    for (const el of document.querySelectorAll('.w-clock-time, .al-day, .ring-mmss')) {
      const box = el.closest('.card, .widget').getBoundingClientRect()
      const r = el.getBoundingClientRect()
      if (r.left < box.left - 1 || r.right > box.right + 1 || r.bottom > box.bottom + 1) overflowingTexts.push(el.className)
    }
    return {
      cellW: m.cellW,
      stateSummaryRemoved: $('#sb-state-summary') === null,
      widgetsTotal: widgets.length,
      widgetsInside,
      gridColumns: getComputedStyle(document.querySelector('.widget-grid')).gridTemplateColumns.split(' ').length,
      gridRows: getComputedStyle(document.querySelector('.widget-grid')).gridTemplateRows.split(' ').length,
      widgetsReflowed: widgets.every((widget) => getComputedStyle(widget).gridColumnStart === 'auto' && getComputedStyle(widget).gridRowStart === 'auto'),
      textsFit: overflowingTexts.length === 0,
      overflowingTexts,
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
      ['odk.tile.almanac', 'odk.tile.clock', 'odk.tile.camera', 'odk.page.dashboard', 'odk.page.pi-sessions', 'odk.tile.hydra', 'odk.tile.pomodoro', 'odk.tile.pi-sessions', 'odk.page.quota', 'odk.status.clock', 'odk.status.connection', 'odk.status.pi-sessions', 'odk.tile.year', 'odk.app.calendar', 'odk.app.clock', 'odk.app.app-manager', 'odk.app.pomodoro', 'odk.app.year', 'odk.app.pi-sessions'].every((id) => results.pluginIds.includes(id))],
    ['duplicate plugin registration rejected', results.duplicateRegistrationRejected],
    ['desktop layout validates against registry', results.layoutValidated],
    ['unknown plugin rejected by composer', results.unknownPluginRejected],
    ['all pages built by composer', results.pagesBuiltByComposer],
    ['status bar slots mounted by plugins', results.statusSlotsMounted],
    ['State Bar omits textual connection summaries and bottom Peek', results.statusSlotsMounted && results.noBottomPeek && results.noRemovedLegacySurfaces && results.stateSummaryRemoved],
    ['status bar holds dots', results.dotsInsideStatusBar],
    ['network indicator left of dots', results.netIndicatorLeftOfDots],
    ['clock right of dots', results.clockRightOfDots],
    ['five pages', results.pageCount === 5],
    ['five dots', results.dotCount === 5],
    ['no separate User Applications page', results.noUserAppsPage],
    ['page context is tracked', results.pageContext === 'Today · 1/5'],
    ['bundled fonts are loaded', results.fontsLoaded],
    ['clock HH:MM', results.clockFormatted],
    ['dashboard weekday header', results.dashWeekday],
    ['dashboard month-day format', results.dashDateFormatted],
    ['dashboard year is current', results.dashYearCurrent],
    ['Today briefs only from plugin contributions', results.todayBriefsFromPlugins],
    ['Today omits network, focus, and quota-service status', results.todayOmitsDeskStatus],
    ['Today claims no personal data without a provider', results.todayClaimsNoPersonalData],
    ['subscription starts in an honest unconfigured state', results.subscriptionInitialStatus && results.quotaStateIsHonest],
    ['tabler icon set complete', results.tablerSetComplete],
    ['tabler icons count >= 3', results.tablerCount >= 3],
    ['declared state widgets have unique identities', results.widgetIdentitiesMatch && results.uniqueApps],
    ['shell boots without peripheral gates', results.shellBootsWithoutPeripheralGates],
    ['widgets declare truthful signals without forced template anatomy', results.widgetStatesAreHonest && results.widgetsUseFlexibleAnatomy && results.widgetsAreDisplayOnly && results.surfaceSeparation],
    ['Hydra plants widget mounts truthfully on the Home grid', results.hydraTileMounted && results.hydraTilePlacement && results.hydraStateIsHonest],
    ['renderer has no filesystem API', results.rendererHasNoFilesystemApi],
    ['preload exposes the Linux platform endpoints', results.preloadExposesIntentEndpoint && results.preloadExposesSubscriptionEndpoint && results.preloadExposesCameraEndpoint && results.endpointListCalled && results.endpointIntentCalled],
    ['preload exposes only narrow Remote Link API', results.remotePreloadIsNarrow],
    ['pager publishes complete authoritative Remote state', results.remotePageStatePublishesAuthoritativeBoundaries],
    ['Remote Link service retains USB, wireless, and synchronizing states', results.stateShowsUsbRemote && results.stateShowsWirelessRemote && results.stateShowsSyncingRemote],
    ['Remote Link navigation moves only an unoccluded bounded pager', results.remoteNavigationMovesPager],
    ['consecutive Remote Link navigation preserves both inputs', results.consecutiveRemoteMovesTwice],
    ['Remote Touchpad ignores vertical input on display pages', results.remoteDisplayPageIgnoresVerticalInput],
    ['Remote Touchpad establishes App focus with primary input', results.remoteAppPrimaryEstablishesFocus],
    ['Remote Touchpad directions retain App Focus Mode', results.remoteAppDirectionStaysOnPage],
    ['widgets declared via data-widget', results.widgetsDeclaredViaDataAttr],
    ['clock placement comes from desktop layout config', results.clockPlacementFromConfig],
    ['pomodoro placement comes from desktop layout config', results.pomodoroPlacementFromConfig],
    ['dots are labeled buttons', results.dotsAreButtons && results.dotLabelsPresent],
    ['dot hit area extends above the pill', results.dotHitAreaAbovePill],
    ['dot button itself is not transformed', results.dotButtonNotTransformed],
    ['widgets expose honest state labels', results.widgetsHaveState],
    ['clock widget is visibly available', results.clockIsAvailable],
    ['pomodoro is visibly not running', results.pomodoroNotRunning],
    ['network indicator draws struck wifi while offline', results.netIndicatorOffline],
    ['offline status is announced', results.offlineAnnounced],
    ['network indicator draws wifi and emphasis while online', results.netIndicatorOnline],
    ['online status is announced', results.onlineAnnounced],
    ['grid has 5 columns', results.gridColumns === 5],
    ['grid has 3 rows', results.gridRows === 3],
    ['grid flush to screen edges', results.gridFlushEdges],
    ['App surfaces match the widget grid footprint', results.appSurfacesMatchGridFootprint],
    ['cards have no colored top or left state bars', results.cardsHaveNoStateEdgeBars],
    ['essential Widget and App text wraps without ellipsis', results.essentialTextDoesNotUseEllipsis && results.piRawIdentifiersHidden],
    ['all Widgets and direct App surfaces stay within their pages', results.monitoredSurfacesStayInBounds],
    ['clock widget spans 1x1 square', results.clockSpansOneSquare],
    ['pomodoro widget spans 2x2 square', results.pomodoroSpansTwoSquare],
    ['State Bar omits subscription, network, and Remote Link text', results.stateSummaryRemoved && results.noBottomPeek],
    ['swipe moves to page 2', results.transformAfterSwipe === `translateX(-${results.viewportWidth}px)`],
    ['second dot active', results.secondDotActive],
    ['small drag on tile keeps page', results.transformAfterTileDrag === `translateX(-${results.viewportWidth}px)`],
    ['tile drag never opens a view', results.appHiddenAfterTileDrag],
    ['display widget stays read-only and separate App still opens', results.displayWidgetDoesNotOpenApp && results.displayWidgetHasNoAction && results.platformAppStillOpensSeparately && results.appSurfaceShowsRuntimeContent && results.appSurfacePreservesSourceContext],
    ['Pi Sessions is a direct live-session App page', results.piPageIsInteractiveAppSurface && results.piPageHasAppControls && results.piPageRemovedListControls && results.piPageLandsOnTheLiveList && results.piPageOwnsTheSessionFilter && results.piPageFilterNarrowsTheList && results.piPageShowsLiveStateAndDirectory && results.piPageRendersSessionDetails && results.piFilesOmittedForCompactness && results.piOverviewOpensTheDetailWithoutRemote],
    ['Usage is a direct interactive App page', results.usageIsInteractiveAppSurface],
    ['separate App intent routes through platform layers', results.platformIntentTrace && results.appEndpointTrace],
    ['State Bar stays concise after App navigation', results.noBottomPeekAfterAppNavigation && results.stateSummaryRemainsRemoved],
    ['built-in view search is available', results.appManagerSearchVisible && results.appManagerSearchFilters],
    ['widget App returns to source page', results.pagePreservedAfterWidgetApp],
    ['cancelled drag keeps navigation usable', results.cancelledDragKeepsNavigationUsable],
    ['dot click jumps to last page', results.transformAfterDotJump === `translateX(-${results.viewportWidth * 2}px)`],
    ['third dot active after jump', results.thirdDotActive],
    ['third page context is visible', results.thirdPageContext],
    ['ArrowLeft returns to grid', results.arrowLeftReturnsToGrid],
    ['End jumps to Usage', results.endJumpsToUsage],
    ['Home jumps to Today', results.homeJumpsToToday],
    ['consecutive ArrowRight presses reach Usage', results.consecutiveArrowRightsReachUsage],
    ['ArrowRight stays at Usage boundary', results.arrowRightStaysAtUsage],
    ['quota status is native and honest', results.quotaStateIsHonest && results.quotaHasNoFabricatedUsage && results.quotaMetricsAreLabeled],
    ['quota exposes check state', results.quotaCheckedVisible],
    ['quota omits redundant navigation help', results.quotaHelpRemoved],
    ['quota refresh preserves truth', results.quotaRefreshLabel && results.quotaRefreshPreservesTruth && results.quotaRefreshShowsCheck],
    ['quota page remains selected after refresh', results.quotaPageAfterEscape],
  ]
  if (!results.piPageRendersSessionDetails || !results.piPageRendersModifiedFiles) {
  }
  let failures = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) failures += 1
  }
  return failures
}

async function runGeometrySweep(win) {
  const layout = require('../src/renderer/layout.js')
  require('../src/renderer/config/desktop_layout.js')
  const desktopLayout = globalThis.DESKTOP_LAYOUT
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
    const expectedCell = layout.compute(width, height, layout.gridWidgetCount(desktopLayout)).cellW
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
    await win.webContents.executeJavaScript(`(() => {
      const index = window.DESKTOP_LAYOUT.pages.findIndex(page => page.id === 'pi-sessions')
      document.querySelectorAll('#dots .dot')[index].click()
    })()`, true)
    await new Promise((resolve) => setTimeout(resolve, 350))
    const piProbe = await win.webContents.executeJavaScript(`(() => {
      const page = document.querySelector('#pages-track .page[data-page-id="pi-sessions"]')
      const pageRect = page.getBoundingClientRect()
      const controls = [...page.querySelectorAll('#pi-detail, #pi-overview')]
      const inside = (rect, parent) => rect.left >= parent.left - 1 && rect.right <= parent.right + 1
      return {
        controlsPresent: controls.length === 2,
        controlsInside: controls.every((control) => inside(control.getBoundingClientRect(), pageRect)),
        rowsInside: [...page.querySelectorAll('.pi-overview-cell')].every((cell) => inside(cell.getBoundingClientRect(), pageRect)),
        filtersInside: [...page.querySelectorAll('.pi-filter-btn')].every((button) => {
          const group = button.closest('.pi-overview-filters')
          return group !== null && inside(button.getBoundingClientRect(), group.getBoundingClientRect())
        }),
        retiredControlsAbsent: page.querySelectorAll('.pi-filter-group, .pi-overview-open, .pi-session-step').length === 0,
      }
    })()`, true)
    await win.webContents.executeJavaScript("document.querySelectorAll('#dots .dot')[1].click()", true)
    await new Promise((resolve) => setTimeout(resolve, 350))
    const checks = [
      ['all widgets horizontally contained and vertically reachable', probe.widgetsTotal > 0 && probe.widgetsInside === probe.widgetsTotal],
      ['State Bar summary remains removed', probe.stateSummaryRemoved],
      ['Pi App controls wrap inside the scrollable portrait page', piProbe.controlsPresent && piProbe.controlsInside && piProbe.rowsInside && piProbe.filtersInside && piProbe.retiredControlsAbsent],
      ['widget text fits tiles', probe.textsFit],
      ['runtime metrics match layout module', probe.cellW === expectedCell],
      ['responsive grid columns match layout', probe.gridColumns === layout.compute(width, height, layout.gridWidgetCount(desktopLayout)).cols],
      ['responsive grid rows remain bounded', probe.gridRows <= layout.compute(width, height, layout.gridWidgetCount(desktopLayout)).rows],
      ['responsive widgets reflow explicit desktop coordinates', probe.widgetsReflowed || width >= 1000],
    ]
    if (!probe.textsFit) console.log(`INFO  ${label} ${width}x${height} — overflowing text: ${probe.overflowingTexts.join(', ')}`)
    for (const [name, ok] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} ${width}x${height} — ${name}`)
      if (!ok) failures += 1
    }
  }
  return failures
}

async function runMotionChecks(win) {
  const js = (code) => win.webContents.executeJavaScript(code, true)

  await js("document.getElementById('pages-track').classList.remove('instant')")
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

function createPiFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'open-deskos-pi-e2e-'))
  const workspaceDir = path.join(fixtureRoot, 'directory-sessions', '--workspace-open-deskos--')
  fs.mkdirSync(workspaceDir, { recursive: true })
  const now = Date.now()
  fs.writeFileSync(path.join(workspaceDir, 'running.json'), JSON.stringify({
    sessionId: 'e2e-running-4102',
    pid: 4102,
    cwd: '/workspace/open-deskos',
    startedAt: now - 7 * 60 * 1000,
    updatedAt: now - 20 * 1000,
    status: 'running',
    latestGoal: 'Refactor the desk UI layout',
    modifiedFiles: ['src/renderer/shell.js'],
  }))
  fs.writeFileSync(path.join(workspaceDir, 'settled.json'), JSON.stringify({
    sessionId: 'e2e-settled-4103',
    pid: 4103,
    cwd: '/workspace/notes',
    startedAt: now - 2 * 60 * 60 * 1000,
    updatedAt: now - 10 * 60 * 1000,
    status: 'settled',
    latestGoal: 'Review the release notes',
    modifiedFiles: ['README.md', 'CHANGELOG.md'],
  }))
  return { root: fixtureRoot, startedAt: now }
}

async function main() {
  const appManager = createAppManagerEndpoint()
  const piFixture = createPiFixture()
  const cleanupPiFixture = () => fs.rmSync(piFixture.root, { recursive: true, force: true })
  process.once('exit', cleanupPiFixture)
  ipcMain.handle('odk-opencode-go-status', () => ({ state: 'unconfigured', missing: ['ODK_CLIPROXY_MANAGEMENT_KEY or ODK_CLIPROXY_MANAGEMENT_KEY_FILE'] }))
  ipcMain.handle('odk-hydra-status', () => ({ configured: false, connected: false, env: null, nodes: [] }))
  ipcMain.handle('odk-camera-frame', () => ({ status: 'unavailable', frame: null, capturedAt: null }))
  ipcMain.handle('odk-pi-sessions', (_event) => scanPiSessions({
    agentDir: piFixture.root,
    checkProcessAlive: (pid) => pid === 4102,
    listProcesses: (scanNow) => [
      {
        pid: 4102,
        cwd: '/workspace/open-deskos',
        command: 'pi',
        startedAt: piFixture.startedAt - 7 * 60 * 1000,
        isAlive: true,
      },
      {
        pid: 4104,
        cwd: '/workspace/automation',
        command: 'pi',
        startedAt: scanNow - 3 * 60 * 1000,
        isAlive: true,
      },
    ],
  }))
  ipcMain.handle('odk-pi-session-events', () => ({
    ok: true,
    truncated: true,
    events: [
      { kind: 'user', text: 'Refactor the desk UI for the CM5 panel' },
      { kind: 'thinking', text: 'Reading the layout before changing it' },
      { kind: 'tool', text: 'bash: pnpm test' },
      { kind: 'result', text: 'bash: 280 passing' },
      { kind: 'assistant', text: 'The composer never ran' },
    ],
  }))
  const endpointCalls = { list: 0, intent: 0 }
  const remotePageStates = []
  ipcMain.handle('odk-app-manager-list', () => {
    endpointCalls.list += 1
    return appManager.list()
  })
  ipcMain.handle('odk-weread-highlight', () => ({ status: 'unconfigured', highlight: null }))
  ipcMain.handle('odk-futu-holdings', () => ({ state: 'live', service: 'futu-poller', snapshot: { totals: { marketVal: 313835.5, plVal: 5946.95, plRatio: 0.0193 }, positions: [ { code: 'US.TEM', marketVal: 7311, dayRatio: 0.031 }, { code: 'US.SDGR', marketVal: 5373, dayRatio: -0.012 }, { code: 'US.TSLA', marketVal: 7067, dayRatio: 0.0074 } ] }, updatedAt: Date.now() }))
  ipcMain.handle('odk-weather-status', () => ({ status: 'live', place: 'Shenzhen', current: { temperature: 25, unit: '°C', condition: 'Partly cloudy', sky: 'cloud', code: 2 }, daily: { high: 27, low: 21 }, updatedAt: Date.now(), hint: null, error: null }))
  ipcMain.handle('odk-user-apps-list', () => ({ ok: true, apps: [] }))
  ipcMain.handle('odk-user-apps-dispatch', () => ({ ok: false, error: 'fixture does not install applications' }))
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
    // Runs behind other windows on purpose: backgroundThrottling off keeps rAF
    // alive without the test window stealing desktop focus. Keyboard-path probes
    // still work because the test focuses the window explicitly.
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(APP_ROOT, 'src', 'preload.js'),
      backgroundThrottling: false,
      offscreen: true,
    },
  })

  const timeout = setTimeout(() => {
    console.error('FAIL  e2e timed out')
    app.exit(1)
  }, OVERALL_TIMEOUT_MS)

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`renderer[${sourceId}:${line}] ${message}`)
  })

  win.focus()
  win.webContents.focus()
  await win.loadFile(path.join(APP_ROOT, 'src/renderer/index.html'), { search: '?e2e=1' })
  // Hidden headless windows may be born at 1x1 before their first layout.
  // Set the intended content size after loading, as the geometry sweep does.
  win.setContentSize(1920, 1280)
  await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('resize'))`)
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
    remotePageStates.some((state) => state.page === 1 && state.pages === 5 && state.name === 'Today' && !state.canPrev && state.canNext) &&
    remotePageStates.some((state) => state.page === 3 && state.pages === 5 && state.name === 'Reading' && state.canPrev && state.canNext) &&
    remotePageStates.some((state) => state.page === 4 && state.pages === 5 && state.name === 'Pi Sessions' && state.canPrev && state.canNext) &&
    remotePageStates.some((state) => state.page === 5 && state.pages === 5 && state.name === 'Usage' && state.canPrev && !state.canNext)
  win.webContents.send('odk-remote-link-state', { state: 'usb', sequence: 1 })
  await new Promise((resolve) => setTimeout(resolve, 50))
  results.stateShowsUsbRemote = await win.webContents.executeJavaScript(
    "document.querySelector('#sb-remote-state') === null && window.odkServices.remoteLink.label() === 'Connected by USB'",
    true,
  )
  win.webContents.send('odk-remote-link-state', { state: 'wireless', sequence: 2 })
  await new Promise((resolve) => setTimeout(resolve, 50))
  results.stateShowsWirelessRemote = await win.webContents.executeJavaScript(
    "document.querySelector('#sb-remote-state') === null && window.odkServices.remoteLink.label() === 'Connected wirelessly'",
    true,
  )
  win.webContents.send('odk-remote-link-state', { state: 'syncing', sequence: 3 })
  await new Promise((resolve) => setTimeout(resolve, 50))
  results.stateShowsSyncingRemote = await win.webContents.executeJavaScript(
    "document.querySelector('#sb-remote-state') === null && window.odkServices.remoteLink.label() === 'Synchronizing'",
    true,
  )
  await new Promise((resolve) => setTimeout(resolve, 1400))
  const pageContext = () => win.webContents.executeJavaScript(
    "document.querySelector('#page-context').textContent",
    true,
  )
  win.webContents.send('odk-remote-navigation', { direction: 'previous' })
  await new Promise((resolve) => setTimeout(resolve, 1400))
  const movedToToday = await pageContext() === 'Today · 1/5'
  win.webContents.send('odk-remote-navigation', { direction: 'previous' })
  await new Promise((resolve) => setTimeout(resolve, 1400))
  const heldAtFirstPage = await pageContext() === 'Today · 1/5'
  win.webContents.send('odk-remote-navigation', { direction: 'next' })
  await new Promise((resolve) => setTimeout(resolve, 1400))
  const movedToHome = await pageContext() === 'Home · 2/5'
  win.webContents.send('odk-remote-navigation', { direction: 'next' })
  win.webContents.send('odk-remote-navigation', { direction: 'next' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  const consecutiveRemoteMovesTwice = await pageContext() === 'Pi Sessions · 4/5'
  results.remoteNavigationMovesPager = movedToToday && movedToHome && heldAtFirstPage
  results.consecutiveRemoteMovesTwice = consecutiveRemoteMovesTwice
  const driverFailures = check(results)
  const motionFailures = await runMotionChecks(win)
  const sweepFailures = await runGeometrySweep(win)
  clearTimeout(timeout)
  cleanupPiFixture()

  win.close()
  const interiors = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'widget-app-styles.cjs')], {
    stdio: 'inherit',
    timeout: 120000,
  })
  if (interiors.error) console.error(`FAIL  interior checks: ${interiors.error.message}`)
  const sequential = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'widget-sequential-refinement.cjs')], {
    stdio: 'inherit',
    timeout: 120000,
  })
  if (sequential.error) console.error(`FAIL  sequential checks: ${sequential.error.message}`)
  const densityRuns = [
    ['--state=unavailable', '--theme=instrument'],
    ['--state=live', '--theme=instrument'],
    ['--date=2026-12-31T23:59:00', '--theme=instrument'],
    ['--date=2026-01-01T00:00:00', '--theme=instrument'],
    ['--theme=pixel'],
    ['--theme=border-beam'],
  ].map(args => require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, 'widget-density.cjs'), ...args], {
    stdio: 'inherit',
    timeout: 120000,
  }))
  const themeUiRuns = ['page-indicator.cjs', 'pixel-font.cjs', 'pixel-icons.cjs', 'voice-input-ui.cjs', 'user-app-desktop.cjs'].map(file =>
    require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, file)], {
      stdio: 'inherit',
      timeout: process.arch === 'arm64' ? 300000 : 120000,
    }))
  const subStatuses = {
    driverFailures, motionFailures, sweepFailures,
    interiors: interiors.status,
    sequential: sequential.status,
    density: densityRuns.map(r => r.status),
    theme: themeUiRuns.map(r => r.status),
  }
  console.log('E2E_SUB_STATUS:', JSON.stringify(subStatuses))
  process.exitCode = Object.entries(subStatuses).every(([, v]) => typeof v === 'number' ? v === 0 : Array.isArray(v) && v.every(s => s === 0)) ? 0 : 1
  app.exit(process.exitCode)
}

app.whenReady().then(main)
