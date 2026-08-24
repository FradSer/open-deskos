const SWIPE_THRESHOLD_RATIO = 0.18
const DRAG_SUPPRESS_PX = 10

let geometryRaf = 0
let pagerRef = null

function applyGeometry() {
  const m = odkLayout.compute(window.innerWidth, window.innerHeight)
  const root = document.documentElement.style
  root.setProperty('--status-h', `${m.statusH}px`)
  root.setProperty('--gutter', `${m.gutter}px`)
  root.setProperty('--cell-w', `${m.cellW}px`)
  root.setProperty('--cell-h', `${m.cellH}px`)
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
      dot.setAttribute('aria-label', `第 ${i + 1} 页，${pageNames[i] ?? ''}`)
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

  return { setIndex, buildDots, refresh }
}

function main() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('kiosk') === '1') document.body.classList.add('kiosk')
  if (params.get('companion')) window.__ODK_COMPANION_HEALTH_URL = params.get('companion')

  applyGeometry()
  odkServices.connection.refresh()

  const appView = document.getElementById('app-view')
  const appTitle = document.getElementById('app-title')
  const appEmpty = document.getElementById('app-empty')
  const appHelp = document.getElementById('app-help')
  const appEmptySub = document.getElementById('app-empty-sub')
  const appSteps = document.getElementById('app-steps')
  const appTroubleshooting = document.getElementById('app-troubleshooting')
  const appAction = document.getElementById('app-action')
  const appActionStatus = document.getElementById('app-action-status')
  const appContent = document.getElementById('app-content')
  let lastFocusedElement = null
  let appDisposers = []

  function setBackgroundInert(inert) {
    for (const element of [document.getElementById('status-bar'), document.getElementById('pages-viewport'), document.getElementById('peek')]) {
      element.inert = inert
      if (inert) element.setAttribute('aria-hidden', 'true')
      else element.removeAttribute('aria-hidden')
    }
  }

  function openInfoView(title, message, detail, showSteps = false, action = null) {
    lastFocusedElement = document.activeElement
    appTitle.textContent = title
    appContent.hidden = true
    appEmpty.hidden = false
    appEmpty.textContent = message
    appHelp.hidden = true
    appEmptySub.textContent = detail
    appSteps.hidden = !showSteps
    appTroubleshooting.hidden = !showSteps
    appAction.hidden = !action
    appActionStatus.hidden = !action
    appActionStatus.textContent = action ? odkServices.connection.lastCheck() : ''
    appAction.onclick = action
      ? async () => {
          await action.onClick()
          appActionStatus.textContent = odkServices.connection.lastCheck()
        }
      : null
    if (action) appAction.textContent = action.label
    appView.hidden = false
    setBackgroundInert(true)
    document.getElementById('app-back').focus()
  }

  function openAppView(title, app) {
    lastFocusedElement = document.activeElement
    appTitle.textContent = title
    for (const element of [appEmpty, appHelp, appEmptySub, appSteps, appTroubleshooting, appAction, appActionStatus]) element.hidden = true
    appContent.replaceChildren()
    appContent.hidden = false
    const disposer = app.mount(appContent, uiCtx)
    if (typeof disposer === 'function') appDisposers.push(disposer)
    appView.hidden = false
    setBackgroundInert(true)
    document.getElementById('app-back').focus()
  }

  function closeInfoView() {
    appView.hidden = true
    for (const dispose of appDisposers) dispose()
    appDisposers = []
    appContent.replaceChildren()
    appAction.onclick = null
    appActionStatus.textContent = ''
    setBackgroundInert(false)
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus()
    lastFocusedElement = null
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
  // plus the shared tick/connection stores.
  const uiCtx = {
    BRIDGE_LABELS: odkServices.BRIDGE_LABELS,
    NETWORK_LABELS: odkServices.NETWORK_LABELS,
    connection: odkServices.connection,
    onTick: odkServices.onTick,
    openDialog: openInfoView,
    openNavigationHelp() {
      openInfoView('操作说明', '', '', false)
      appHelp.hidden = false
      appEmptySub.textContent = ''
    },
  }

  // Status-bar and peek plugins own everything visible outside the pages;
  // the skeleton only provides empty slots.
  window.addEventListener('odk-connection-announcement', (event) => {
    document.getElementById('status-announcement').textContent = event.detail
  })
  for (const def of odkPlugins.byKind('status')) {
    def.mount(document.querySelector(`[data-slot="status-${def.slot}"]`), uiCtx)
  }
  const peekDef = odkPlugins.byKind('peek')[0]
  if (peekDef) {
    peekDef.mount(document.querySelector('[data-slot="peek"]'), uiCtx)
    uiCtx.openCompanionGuide = () => peekDef.activate(uiCtx)
  }

  odkComposer.build(window.DESKTOP_LAYOUT, document.getElementById('pages-track'), uiCtx)

  function openApp(tile) {
    const plugin = odkPlugins.get(tile.dataset.widget)
    if (plugin.appView) {
      openAppView(plugin.app, plugin.appView)
      return
    }
    if (typeof plugin.activate === 'function' && plugin.activate(uiCtx)) return
    openInfoView(plugin.app, `「${plugin.app}」当前尚未接入。`, '此功能将在后续平台版本提供；当前可以返回桌面使用已开放的功能。')
  }

  for (const tile of document.querySelectorAll('.widget')) {
    tile.addEventListener('click', () => openApp(tile))
  }

  document.getElementById('app-back').addEventListener('click', closeInfoView)
  if (peekDef) document.getElementById('peek').addEventListener('click', () => uiCtx.openCompanionGuide())

  const pageNames = window.DESKTOP_LAYOUT.pages.map((page) => page.name)
  const viewport = document.getElementById('pages-viewport')
  const track = document.getElementById('pages-track')

  function updatePageContext(index) {
    document.getElementById('page-context').textContent = `${pageNames[index] ?? '页面'} · ${index + 1}/${pageNames.length}`
  }

  pagerRef = createPager(viewport, track, pageNames, updatePageContext)
  pagerRef.buildDots(document.getElementById('dots'))
  updatePageContext(0)

  window.addEventListener('keydown', (event) => {
    if (!appView.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeInfoView()
        return
      }
      trapDialogFocus(event)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const dots = [...document.querySelectorAll('#dots .dot')]
    const current = dots.findIndex((dot) => dot.hasAttribute('aria-current'))
    if (event.key === 'Home') pagerRef.setIndex(0)
    else if (event.key === 'End') pagerRef.setIndex(dots.length - 1)
    else pagerRef.setIndex(current + (event.key === 'ArrowLeft' ? -1 : 1))
  })
}

main()
