;(function (root) {
  'use strict'

  function nonce() {
    if (root.crypto?.randomUUID) return root.crypto.randomUUID()
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  // The Shell owns the appearance; a package only receives it. Every frame is told
  // which theme it is rendering under, and told again when that changes, so a package
  // needs no release and no theme detection of its own.
  function activeTheme() {
    return root.odkTheme?.get?.() || root.document?.documentElement?.dataset?.theme || 'instrument'
  }

  // The tile radius is a grid value, not a cell ratio, so the package is handed the
  // measured one and can match the frame it renders inside.
  function hostRadius(container) {
    try {
      const value = root.getComputedStyle?.(container)?.borderTopLeftRadius
      return typeof value === 'string' && value.endsWith('px') ? value : ''
    } catch {
      return ''
    }
  }

  function mount(container, { id, name, revision, url, timeoutMs = 8000, onError } = {}) {
    if (!container || typeof container.appendChild !== 'function') throw new TypeError('container is required')
    if (!url) throw new TypeError('user app URL is required')
    const token = nonce()
    const frame = container.ownerDocument.createElement('iframe')
    frame.title = name || id || 'User application'
    frame.className = 'user-app-frame'
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.dataset.appId = id || ''
    frame.dataset.revision = revision || ''
    const target = new URL(url, root.location?.href || 'http://localhost/')
    target.searchParams.set('token', token)
    target.searchParams.set('theme', activeTheme())
    const radius = hostRadius(container)
    if (radius) target.searchParams.set('radius', radius)
    const publishTheme = (theme) => {
      // The host and the package both see the appearance this frame renders under; the
      // message keeps a loading frame's copy in step with the URL it was served with.
      frame.dataset.theme = theme
      try { frame.contentWindow?.postMessage({ type: 'odk-user-app-theme', token, theme, radius: hostRadius(container) }, '*') } catch {}
    }
    let resolveReady
    let rejectReady
    let settled = false
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    let timer
    const observer = observerFor(publishTheme)
    const resizeListener = () => publishTheme(activeTheme())
    // Readiness is settled once; the appearance subscription lives as long as the frame,
    // so stopping the readiness watch must not disconnect the theme observer.
    const stopReadyWatch = () => {
      root.removeEventListener('message', onMessage)
      if (timer) { clearTimeout(timer); timer = null }
    }
    const teardown = () => {
      stopReadyWatch()
      root.removeEventListener('resize', resizeListener)
      observer?.disconnect()
    }
    const fail = (message) => {
      if (settled) return
      settled = true
      teardown()
      const error = new Error(message)
      frame.remove()
      rejectReady(error)
      if (typeof onError === 'function') onError(error)
    }
    const onMessage = (event) => {
      const data = event.data
      if (event.source !== frame.contentWindow || !data || data.token !== token) return
      if (data.type === 'odk-user-app-error') { fail(data.error || 'user app failed during startup'); return }
      if (data.type !== 'odk-user-app-ready') return
      if (!settled) { settled = true; stopReadyWatch(); resolveReady(frame) }
    }
    root.addEventListener('message', onMessage)
    publishTheme(activeTheme())
    frame.addEventListener('load', () => publishTheme(activeTheme()))
    // A collapsed grid changes the tile radius; the package follows it without a reload.
    root.addEventListener('resize', resizeListener)
    timer = setTimeout(() => fail('user app readiness timed out'), timeoutMs)
    frame.src = target.href
    container.appendChild(frame)
    return {
      frame,
      ready,
      dispose() {
        // A settled frame still holds the theme observer and the resize listener; both
        // belong to the frame's lifetime, not to readiness.
        if (!settled) fail('user app disposed')
        else teardown()
        frame.remove()
      },
    }
  }

  /*
   * Watches the Shell's own theme attribute. A test or a host without a MutationObserver
   * simply gets the theme captured at mount.
   */
  function observerFor(publish) {
    const documentElement = root.document?.documentElement
    if (!documentElement || typeof root.MutationObserver !== 'function') return null
    const observer = new root.MutationObserver(() => publish(activeTheme()))
    observer.observe(documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return observer
  }

  const api = { mount }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.odkUserAppFrame = api
})(typeof window !== 'undefined' ? window : globalThis)