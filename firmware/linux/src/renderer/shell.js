const SWIPE_THRESHOLD_RATIO = 0.18
const DRAG_SUPPRESS_PX = 10

let geometryRaf = 0
let pagerRef = null

function applyGeometry() {
  const m = odkLayout.compute(window.innerWidth, window.innerHeight)
  const root = document.documentElement.style
  const cellDim = m.cellDim || Math.min(m.cellW, m.cellH)
  root.setProperty('--status-h', `${m.statusH}px`)
  root.setProperty('--gutter', `${m.gutter}px`)
  root.setProperty('--cell-w', `${m.cellW}px`)
  root.setProperty('--cell-h', `${m.cellH}px`)
  root.setProperty('--cell-dim', `${cellDim}px`)
  root.setProperty('--radius', `${m.radius}px`)
  root.setProperty('--stroke-w', `${m.stroke}px`)
  root.setProperty('--peek-h', `${m.peekH}px`)
  root.setProperty('--peek-inset', `${m.peekInset}px`)
  root.setProperty('--bar-icon', `${Math.floor(20 * m.fit + 0.5)}px`)
  window.__odkGrid = m
  return m
}

window.addEventListener('resize', () => {
  cancelAnimationFrame(geometryRaf)
  geometryRaf = requestAnimationFrame(() => {
    applyGeometry()
    if (pagerRef) pagerRef.refresh()
  })
})

function createPager(viewport, track, pageNames, onIndexChange) {
  let index = 0
  let startX = null
  let dx = 0
  let suppressClick = false

  function pageCount() {
    return track.children.length
  }

  function pageWidth() {
    return viewport.clientWidth
  }

  function setIndex(next) {
    index = Math.max(0, Math.min(pageCount() - 1, next))
    track.style.transform = `translateX(${-index * pageWidth()}px)`
    renderDots()
    onIndexChange(index)
  }

  function refresh() {
    setIndex(index)
  }

  function renderDots() {
    for (const [i, dot] of [...document.querySelectorAll('#dots .dot')].entries()) {
      const active = i === index
      dot.classList.toggle('active', active)
      if (active) dot.setAttribute('aria-current', 'page')
      else dot.removeAttribute('aria-current')
    }
  }

  function buildDots(container) {
    container.replaceChildren()
    for (let i = 0; i < pageCount(); i += 1) {
      const dot = document.createElement('button')
      dot.type = 'button'
      dot.className = 'dot'
      dot.setAttribute('aria-label', `Page ${i + 1}, ${pageNames[i] ?? ''}`)
      dot.addEventListener('click', () => setIndex(i))
      container.append(dot)
    }
    renderDots()
  }

  viewport.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary) return
    startX = event.clientX
    dx = 0
    track.classList.add('dragging')
    try {
      viewport.setPointerCapture(event.pointerId)
    } catch {
      /* synthetic pointers (tests) cannot be captured */
    }
  })

  viewport.addEventListener('pointermove', (event) => {
    if (startX === null || !event.isPrimary) return
    dx = event.clientX - startX
    track.style.transform = `translateX(${dx - index * pageWidth()}px)`
  })

  function endDrag(wasCancelled) {
    if (startX === null) return
    track.classList.remove('dragging')
    suppressClick = !wasCancelled && Math.abs(dx) > DRAG_SUPPRESS_PX
    const threshold = pageWidth() * SWIPE_THRESHOLD_RATIO
    if (dx < -threshold) setIndex(index + 1)
    else if (dx > threshold) setIndex(index - 1)
    else setIndex(index)
    startX = null
    dx = 0
  }

  viewport.addEventListener('pointerup', () => endDrag(false))
  viewport.addEventListener('pointercancel', () => endDrag(true))

  window.addEventListener('pointerdown', () => { suppressClick = false }, true)

  viewport.addEventListener('click', (event) => {
    if (!suppressClick) return
    suppressClick = false
    event.stopPropagation()
    event.preventDefault()
  }, true)

  return {
    setIndex,
    buildDots,
    currentIndex: () => index,
    refresh,
  }
}

function main() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('kiosk') === '1') document.body.classList.add('kiosk')
  applyGeometry()
  odkServices.subscription.refresh()

  const appView = document.getElementById('app-view')
  let privacyShield = null
  let privacyProtectedElements = []
  const appTitle = document.getElementById('app-title')
  const appEmpty = document.getElementById('app-empty')
  const appHelp = document.getElementById('app-help')
  const appEmptySub = document.getElementById('app-empty-sub')
  const appAction = document.getElementById('app-action')
  const appActionStatus = document.getElementById('app-action-status')
  let lastFocusedElement = null
  let activeFrame = null

  function setBackgroundInert(inert) {
    for (const element of [document.getElementById('status-bar'), document.getElementById('pages-viewport'), document.getElementById('peek')]) {
      element.inert = inert
      if (inert) element.setAttribute('aria-hidden', 'true')
      else if (odkServices.faceAgent.status()?.unlocked === true) element.removeAttribute('aria-hidden')
    }
  }

  function syncPrivacyShield(status = odkServices.faceAgent.status()) {
    const unlocked = status?.unlocked === true
    const dialogOpen = !appView.hidden
    privacyShield.hidden = unlocked
    privacyShield.inert = unlocked
    for (const element of privacyProtectedElements) {
      const hiddenFromBackground = element === appView ? !unlocked : !unlocked || dialogOpen
      element.inert = hiddenFromBackground
      if (hiddenFromBackground) element.setAttribute('aria-hidden', 'true')
      else element.removeAttribute('aria-hidden')
    }
    document.body.classList.toggle('screen-locked', !unlocked)
  }

  function openInfoView(title, message, detail, showSteps = false, action = null) {
    const preservesActiveApp = Boolean(appPlatform?.active())
    setBackgroundInert(true)
    if (appView.hidden) lastFocusedElement = document.activeElement
    appView.dataset.infoView = preservesActiveApp ? 'active-error' : 'standalone'
    appView.removeAttribute('data-source-widget')
    appView.removeAttribute('data-route')
    appTitle.textContent = title
    appEmpty.hidden = false
    appEmpty.textContent = message
    appHelp.hidden = true
    appEmptySub.textContent = detail
    appAction.hidden = !action
    appActionStatus.hidden = !action
    appActionStatus.textContent = action?.status || ''
    appAction.onclick = action
      ? async () => {
          appAction.disabled = true
          try {
            const result = await action.onClick()
            if (!appView.hidden) {
              appActionStatus.textContent = action.statusAfter?.(result) || action.status || ''
              if (result === true && appView.dataset.infoView === 'active-error') closeInfoView()
            }
          } catch (error) {
            appActionStatus.textContent = error.message || 'Action failed'
          } finally {
            appAction.disabled = false
          }
        }
      : null
    if (action) appAction.textContent = action.label
    runtimeRoot().hidden = !preservesActiveApp
    appView.hidden = false
    syncPrivacyShield()
    focusDialogBack()
  }

  function focusDialogBack() {
    const back = document.getElementById('app-back')
    back.focus()
    if (document.activeElement !== back) {
      back.setAttribute('tabindex', '0')
      back.focus()
    }
  }

  function renderAppFrame({ plugin, source }) {
    appTitle.textContent = plugin.app || plugin.name || plugin.id
    appView.dataset.sourceWidget = source.widgetId || ''
    appView.dataset.route = source.route || ''
    appEmpty.hidden = true
    appHelp.hidden = true
    appEmptySub.textContent = ''
    appAction.hidden = true
    appActionStatus.hidden = true
    runtimeRoot().hidden = false
  }

  function closeInfoView() {
    setBackgroundInert(false)
    const restoringActiveApp = appView.dataset.infoView === 'active-error' && appPlatform?.active() && activeFrame
    appView.hidden = true
    syncPrivacyShield()
    appAction.onclick = null
    appActionStatus.textContent = ''
    appView.removeAttribute('data-info-view')
    if (restoringActiveApp) {
      renderAppFrame(activeFrame)
      appView.hidden = false
      syncPrivacyShield()
      focusDialogBack()
      return
    }
    activeFrame = null
    runtimeRoot().replaceChildren()
    runtimeRoot().hidden = false
    appView.removeAttribute('data-source-widget')
    appView.removeAttribute('data-route')
    setBackgroundInert(false)
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus()
    lastFocusedElement = null
  }

  function openAppFrame({ plugin, source }) {
    activeFrame = { plugin, source }
    if (appView.hidden) lastFocusedElement = document.activeElement
    appView.removeAttribute('data-info-view')
    renderAppFrame({ plugin, source })
    appView.hidden = false
    syncPrivacyShield()
    focusDialogBack()
  }

  function openMissingApp(appId) {
    openInfoView('App not installed', `Cannot open ${appId}.`, 'Verify its installation status in App Manager.')
  }

  function openRuntimeUnavailable(appId, reason, retry = null) {
    openInfoView(
      'App unavailable',
      `Cannot start ${appId}.`,
      `Runtime returned ${reason || 'an unknown error'}. The foreground App was not changed.`,
      false,
      retry ? {
        label: 'Retry',
        onClick: retry,
        status: 'You can try starting it again.',
        statusAfter: (result) => result ? 'The start request was resubmitted.' : 'Retry failed.',
      } : null,
    )
  }

  function openAppActionError(intent, reason, retry = null) {
    const action = intent.action || intent.type || 'action'
    openInfoView(
      'App action failed',
      `Cannot complete ${action}.`,
      `App Manager returned ${reason || 'an unknown error'}.`,
      false,
      retry ? {
        label: 'Retry',
        onClick: retry,
        status: 'You can try this action again.',
        statusAfter: (result) => result ? 'Action completed.' : 'Retry failed.',
      } : null,
    )
  }

  function showAppError(message, retry) {
    appActionStatus.hidden = false
    appActionStatus.textContent = message
    appAction.hidden = false
    appAction.textContent = 'Retry'
    appAction.onclick = async () => {
      appAction.disabled = true
      try {
        const result = await retry()
        appActionStatus.textContent = result ? 'Action completed.' : 'Retry failed.'
        if (result && appView.dataset.infoView === 'active-error') closeInfoView()
      } catch (error) {
        appActionStatus.textContent = error.message || 'Action failed'
      } finally {
        appAction.disabled = false
      }
    }
  }

  function runtimeRoot() {
    return document.getElementById('app-runtime')
  }

  function dialogControls() {
    return [...appView.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((control) => !control.hidden && control.getClientRects().length > 0)
  }

  function trapDialogFocus(event) {
    if (appView.hidden || event.key !== 'Tab') return
    const controls = dialogControls()
    if (controls.length === 0) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // Services handed to every plugin: dialogs owned by the shell frame,
  // plus the shared tick, network, subscription, and Remote Link stores.
  let appPlatform = null
  const uiCtx = {
    NETWORK_LABELS: odkServices.NETWORK_LABELS,
    SUBSCRIPTION_LABELS: odkServices.SUBSCRIPTION_LABELS,
    REMOTE_LINK_LABELS: odkServices.REMOTE_LINK_LABELS,
    connection: odkServices.connection,
    subscription: odkServices.subscription,
    faceAgent: odkServices.faceAgent,
    remoteLink: odkServices.remoteLink,
    onTick: odkServices.onTick,
    openDialog: openInfoView,
    emitIntent(intent) {
      return appPlatform?.emitIntent(intent) || false
    },
    openNavigationHelp() {
      openInfoView('Navigation help', '', '', false)
      appHelp.hidden = false
      appEmptySub.textContent = ''
    },
  }

  // Status-bar and peek plugins own everything visible outside the pages;
  // the skeleton only provides empty slots.
  window.addEventListener('odk-connection-announcement', (event) => {
    document.getElementById('status-announcement').textContent = event.detail
  })
  appPlatform = window.odkAppPlatform.create({
    host: {
      context: () => uiCtx,
      runtimeRoot,
      closeAppFrame: closeInfoView,
      openAppFrame,
      openMissingApp,
      openRuntimeUnavailable,
      openAppActionError,
      showAppError,
    },
  })
  window.odkAppPlatform = appPlatform
  uiCtx.platform = appPlatform
  uiCtx.appPlatform = appPlatform
  uiCtx.onPlatformState = appPlatform.subscribe
  for (const def of odkPlugins.byKind('status')) {
    const slot = document.querySelector(`[data-slot="status-${def.slot}"]`)
    const host = document.createElement('span')
    host.className = `status-plugin status-${def.id}`
    slot.append(host)
    odkPlugins.activate(def, host, uiCtx)
  }

  const peekDef = odkPlugins.byKind('peek')[0]
  if (peekDef) {
    odkPlugins.activate(peekDef, document.querySelector('[data-slot="peek"]'), uiCtx)
  }

  odkComposer.build(window.DESKTOP_LAYOUT, document.getElementById('pages-track'), uiCtx)
  privacyShield = document.getElementById('privacy-shield')
  privacyProtectedElements = [
    document.getElementById('status-bar'),
    document.getElementById('pages-viewport'),
    document.getElementById('peek'),
    appView,
  ]
  odkServices.faceAgent.subscribe(syncPrivacyShield)
  void odkServices.faceAgent.refresh()

  document.getElementById('app-back').addEventListener('click', async () => {
    if (appView.dataset.infoView) closeInfoView()
    else if (appPlatform.active()) await appPlatform.closeApp()
    else closeInfoView()
  })
  if (peekDef) document.getElementById('peek').addEventListener('click', () => {
    if (appPlatform.active()) appPlatform.openApp({
      appId: appPlatform.active().appId,
      widgetId: appPlatform.active().sourceWidget,
      route: appPlatform.active().route,
    })
    else if (peekDef?.activate) peekDef.activate(uiCtx)
  })

  const pageNames = window.DESKTOP_LAYOUT.pages.map((page) => page.name)
  const viewport = document.getElementById('pages-viewport')
  const track = document.getElementById('pages-track')

  let currentPageState = null

  function publishPageState() {
    if (!currentPageState) return
    window.odkRemote?.publishPageState(currentPageState)?.catch(() => {})
  }

  function updatePageContext(index) {
    const page = index + 1
    const name = pageNames[index] ?? 'Page'
    currentPageState = {
      page,
      pages: pageNames.length,
      name,
      canPrev: page > 1,
      canNext: page < pageNames.length,
    }
    document.getElementById('page-context').textContent = `${name} · ${page}/${pageNames.length}`
    publishPageState()
  }

  pagerRef = createPager(viewport, track, pageNames, updatePageContext)
  pagerRef.buildDots(document.getElementById('dots'))
  updatePageContext(0)
  setInterval(publishPageState, 5000)

  let lastNavTime = 0
  const NAV_DEBOUNCE_MS = 1250

  function navigate(direction) {
    if (!appView.hidden) return
    const now = Date.now()
    if (now - lastNavTime < NAV_DEBOUNCE_MS) return
    lastNavTime = now
    pagerRef.setIndex(pagerRef.currentIndex() + direction)
  }

  window.odkRemote?.subscribeNavigation((direction) => {
    navigate(direction === 'previous' ? -1 : 1)
  })

  window.addEventListener('keydown', (event) => {
    if (!appView.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (appView.dataset.infoView) closeInfoView()
        else if (appPlatform.active()) appPlatform.closeApp()
        else closeInfoView()
        return
      }
      trapDialogFocus(event)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.repeat) return
    if (event.key === 'ArrowLeft') return navigate(-1)
    if (event.key === 'ArrowRight') return navigate(1)
    const dots = [...document.querySelectorAll('#dots .dot')]
    if (event.key === 'Home') pagerRef.setIndex(0)
    else pagerRef.setIndex(dots.length - 1)
  })
}

main()
