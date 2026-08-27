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
  let lastFocusedElement = null
  let activeFrame = null

  function setBackgroundInert(inert) {
    for (const element of [document.getElementById('status-bar'), document.getElementById('pages-viewport'), document.getElementById('peek')]) {
      element.inert = inert
      if (inert) element.setAttribute('aria-hidden', 'true')
      else element.removeAttribute('aria-hidden')
    }
  }

  function openInfoView(title, message, detail, showSteps = false, action = null) {
    const preservesActiveApp = Boolean(appPlatform?.active())
    if (appView.hidden) lastFocusedElement = document.activeElement
    appView.dataset.infoView = preservesActiveApp ? 'active-error' : 'standalone'
    appView.removeAttribute('data-source-widget')
    appView.removeAttribute('data-route')
    appTitle.textContent = title
    appEmpty.hidden = false
    appEmpty.textContent = message
    appHelp.hidden = true
    appEmptySub.textContent = detail
    appSteps.hidden = !showSteps
    appTroubleshooting.hidden = !showSteps
    appAction.hidden = !action
    appActionStatus.hidden = !action
    appActionStatus.textContent = action?.status || (action ? odkServices.connection.lastCheck() : '')
    appAction.onclick = action
      ? async () => {
          appAction.disabled = true
          try {
            const result = await action.onClick()
            if (!appView.hidden) {
              appActionStatus.textContent = action.statusAfter?.(result) || action.status || odkServices.connection.lastCheck()
              if (result === true && appView.dataset.infoView === 'active-error') closeInfoView()
            }
          } catch (error) {
            appActionStatus.textContent = error.message || '操作失败'
          } finally {
            appAction.disabled = false
          }
        }
      : null
    if (action) appAction.textContent = action.label
    runtimeRoot().hidden = !preservesActiveApp
    appView.hidden = false
    setBackgroundInert(true)
    document.getElementById('app-back').focus()
  }

  function renderAppFrame({ plugin, source }) {
    appTitle.textContent = plugin.app || plugin.name || plugin.id
    appView.dataset.sourceWidget = source.widgetId || ''
    appView.dataset.route = source.route || ''
    appEmpty.hidden = true
    appHelp.hidden = true
    appEmptySub.textContent = ''
    appSteps.hidden = true
    appTroubleshooting.hidden = true
    appAction.hidden = true
    appActionStatus.hidden = true
    runtimeRoot().hidden = false
  }

  function closeInfoView() {
    const restoringActiveApp = appView.dataset.infoView === 'active-error' && appPlatform?.active() && activeFrame
    appView.hidden = true
    appAction.onclick = null
    appActionStatus.textContent = ''
    appView.removeAttribute('data-info-view')
    if (restoringActiveApp) {
      renderAppFrame(activeFrame)
      appView.hidden = false
      setBackgroundInert(true)
      document.getElementById('app-back').focus()
      return
    }
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
    setBackgroundInert(true)
    document.getElementById('app-back').focus()
  }

  function openMissingApp(appId) {
    openInfoView('应用未安装', `无法打开 ${appId}。`, '请在应用管理中确认安装状态。')
  }

  function openRuntimeUnavailable(appId, reason, retry = null) {
    openInfoView(
      'App 暂不可用',
      `无法启动 ${appId}。`,
      `Runtime 返回 ${reason || '未知错误'}，当前前台 App 未改变。`,
      false,
      retry ? {
        label: '重试',
        onClick: retry,
        status: '可重新尝试启动。',
        statusAfter: (result) => result ? '已重新提交启动请求。' : '重试未成功。',
      } : null,
    )
  }

  function openAppActionError(intent, reason, retry = null) {
    const action = intent.action || intent.type || '操作'
    openInfoView(
      'App 操作失败',
      `无法执行 ${action}。`,
      `App Manager 返回 ${reason || '未知错误'}。`,
      false,
      retry ? {
        label: '重试',
        onClick: retry,
        status: '可重新尝试该操作。',
        statusAfter: (result) => result ? '操作已完成。' : '重试未成功。',
      } : null,
    )
  }

  function showAppError(message, retry) {
    appActionStatus.hidden = false
    appActionStatus.textContent = message
    appAction.hidden = false
    appAction.textContent = '重试'
    appAction.onclick = async () => {
      appAction.disabled = true
      try {
        const result = await retry()
        appActionStatus.textContent = result ? '操作已完成。' : '重试未成功。'
        if (result && appView.dataset.infoView === 'active-error') closeInfoView()
      } catch (error) {
        appActionStatus.textContent = error.message || '操作失败'
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
  // plus the shared tick/connection stores.
  let appPlatform = null
  const uiCtx = {
    BRIDGE_LABELS: odkServices.BRIDGE_LABELS,
    NETWORK_LABELS: odkServices.NETWORK_LABELS,
    connection: odkServices.connection,
    onTick: odkServices.onTick,
    openDialog: openInfoView,
    emitIntent(intent) {
      return appPlatform?.emitIntent(intent) || false
    },
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
    uiCtx.openCompanionGuide = () => peekDef.activate(uiCtx)
  }

  odkComposer.build(window.DESKTOP_LAYOUT, document.getElementById('pages-track'), uiCtx)

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
    else uiCtx.openCompanionGuide()
  })

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
    const dots = [...document.querySelectorAll('#dots .dot')]
    const current = dots.findIndex((dot) => dot.hasAttribute('aria-current'))
    if (event.key === 'Home') pagerRef.setIndex(0)
    else if (event.key === 'End') pagerRef.setIndex(dots.length - 1)
    else pagerRef.setIndex(current + (event.key === 'ArrowLeft' ? -1 : 1))
  })
}

main()
