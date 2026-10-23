;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.odkLiquidGlassAppearance = api.createLiquidGlassAppearance(root, document)
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict'

  const TARGETS = '#pages-viewport .widget[data-interaction="display-only"], #app-view:not([hidden]), #personal-agent .agent-composer'
  const MAX_SURFACES = 10

  function createLiquidGlassAppearance(root, doc) {
    let active = false
    let generation = 0
    let startTask
    let sdkTask
    let glassScene
    let glassSdk
    let rootElement
    let contentElement
    let backdropElement
    let resizeObserver
    let mutationObserver
    let observing = false
    let frame = 0
    let readinessTimer
    let glassReady = false
    let sceneFailed = false
    let adapterTask
    const surfaces = new Map()
    const listeners = []
    const lifecycleListeners = []

    function setStatus(value) {
      doc.documentElement.dataset.liquidGlass = value
    }

    function addListener(target, type, listener, options, persistent = false) {
      target?.addEventListener?.(type, listener, options)
      if (target?.addEventListener) (persistent ? lifecycleListeners : listeners).push(() => target.removeEventListener?.(type, listener, options))
    }

    function hasReducedTransparency() {
      return root.matchMedia?.('(prefers-reduced-transparency: reduce)').matches
        || root.matchMedia?.('(prefers-contrast: more)').matches
        || root.matchMedia?.('(forced-colors: active)').matches
    }

    function ensureSurface(target) {
      let surface = surfaces.get(target)
      if (surface) return surface
      surface = { target, remove: undefined }
      surfaces.set(target, surface)
      return surface
    }

    function surfaceTargets() {
      if (!rootElement || !contentElement) return []
      const rootBox = rootElement.getBoundingClientRect()
      const viewport = doc.getElementById('pages-viewport')?.getBoundingClientRect()
      return [...doc.querySelectorAll(TARGETS)].filter(target => {
        const box = target.getBoundingClientRect()
        if (root.getComputedStyle?.(target)?.visibility === 'hidden') return false
        if (box.width < 2 || box.height < 2 || box.right <= rootBox.left || box.left >= rootBox.right
          || box.bottom <= rootBox.top || box.top >= rootBox.bottom) return false
        if (target.closest('#pages-viewport') && viewport
          && (box.right <= viewport.left || box.left >= viewport.right || box.bottom <= viewport.top || box.top >= viewport.bottom)) return false
        return true
      }).slice(0, MAX_SURFACES)
    }

    function registerSurface(surface) {
      if (!glassScene || surface.remove) return
      glassReady = false
      setStatus('pending')
      surface.remove = glassScene.addSurface(surface.target, {
        material: 'regular',
        appearance: 'dark',
        radius: Math.min(Number.parseFloat(root.getComputedStyle?.(surface.target)?.borderTopLeftRadius) || 24, 32),
        refraction: 24,
        interactive: false,
        motion: 'none',
      })
      surface.target.classList.add('lg-surface')
      if (!glassReady) waitForGlassMaps(generation)
    }

    function reconcile() {
      frame = 0
      if (!active || !rootElement || !contentElement) return
      const targets = new Set(surfaceTargets())
      for (const [target, surface] of surfaces) {
        if (targets.has(target)) continue
        surface.remove?.()
        surface.target.classList.remove('lg-surface')
        surfaces.delete(target)
      }
      for (const target of targets) {
        const surface = ensureSurface(target)
        registerSurface(surface)
      }
    }

    function scheduleReconcile() {
      if (!active || frame) return
      const requestFrame = root.requestAnimationFrame || (callback => root.setTimeout(callback, 16))
      frame = requestFrame(reconcile)
    }

    function stopObservers() {
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
      resizeObserver = undefined
      mutationObserver = undefined
      observing = false
      for (const remove of listeners.splice(0)) remove()
      if (frame) (root.cancelAnimationFrame || root.clearTimeout)?.(frame)
      frame = 0
    }

    function stopScene(clearCache) {
      if (readinessTimer) root.clearTimeout(readinessTimer)
      readinessTimer = undefined
      glassReady = false
      for (const surface of surfaces.values()) {
        surface.remove?.()
        surface.remove = undefined
        surface.target.classList.remove('lg-surface')
      }
      glassScene?.dispose()
      glassScene = undefined
      rootElement?.classList.remove('lg-scene')
      if (rootElement) delete rootElement.dataset.glassReady
      if (clearCache) glassSdk?.clearMaterialMapCache?.()
    }

    function waitForGlassMaps(token) {
      if (readinessTimer) root.clearTimeout(readinessTimer)
      readinessTimer = root.setTimeout(() => {
        readinessTimer = undefined
        if (!active || token !== generation || glassReady || !glassScene) return
        stopScene(true)
        setStatus('fallback')
      }, 8000)
    }

    function stopAll() {
      stopObservers()
      stopScene(true)
      surfaces.clear()
      if (backdropElement) backdropElement.hidden = true
      rootElement = undefined
      contentElement = undefined
      backdropElement = undefined
      setStatus('inactive')
    }

    function observeContent() {
      if (observing) return
      observing = true
      if (root.ResizeObserver) {
        resizeObserver = new root.ResizeObserver(scheduleReconcile)
        resizeObserver.observe(rootElement)
        for (const id of ['home-summary', 'pages-viewport', 'app-view', 'personal-agent']) {
          const element = doc.getElementById(id)
          if (element) resizeObserver.observe(element)
        }
      }
      if (root.MutationObserver) {
        mutationObserver = new root.MutationObserver(scheduleReconcile)
        mutationObserver.observe(contentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] })
        const agent = doc.getElementById('personal-agent')
        if (agent) mutationObserver.observe(agent, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'data-mode'] })
      }
      addListener(root, 'resize', scheduleReconcile, { passive: true })
      addListener(doc.getElementById('pages-viewport'), 'scroll', scheduleReconcile, { passive: true })
      addListener(doc, 'odk-page-shown', scheduleReconcile, true)
    }

    function getAdapter() {
      if (!adapterTask) {
        adapterTask = Promise.resolve().then(() => root.navigator?.gpu?.requestAdapter?.())
          .then(adapter => Boolean(adapter), () => false)
      }
      return adapterTask
    }

    function loadSdk() {
      if (root.odkLiquidGlassSdk?.createGlassScene) return Promise.resolve(root.odkLiquidGlassSdk)
      if (sdkTask) return sdkTask
      sdkTask = new Promise((resolve, reject) => {
        const script = doc.createElement('script')
        script.src = 'themes/liquid-glass-sdk.js'
        script.async = true
        script.onload = () => root.odkLiquidGlassSdk?.createGlassScene
          ? resolve(root.odkLiquidGlassSdk)
          : reject(Error('Liquid Glass SDK bundle did not expose its DOM API'))
        script.onerror = () => reject(Error('Liquid Glass SDK bundle failed to load'))
        doc.head.appendChild(script)
      }).catch(error => {
        sdkTask = undefined
        throw error
      })
      return sdkTask
    }

    async function start(token) {
      setStatus('pending')
      if (doc.readyState === 'loading') await new Promise(resolve => doc.addEventListener('DOMContentLoaded', resolve, { once: true }))
      if (!active || token !== generation) return
      rootElement = doc.getElementById('home-desk')
      contentElement = doc.getElementById('desk-content')
      backdropElement = doc.getElementById('liquid-glass-backdrop')
      if (!rootElement || !contentElement || !backdropElement) {
        setStatus('fallback')
        return
      }
      backdropElement.hidden = false
      observeContent()
      reconcile()
      if (hasReducedTransparency()) {
        backdropElement.hidden = true
        setStatus('fallback')
        return
      }
      if (!await getAdapter()) {
        setStatus('fallback')
        return
      }
      const sdk = await loadSdk().catch(() => undefined)
      if (!active || token !== generation) return
      if (!sdk?.createGlassScene) {
        setStatus('fallback')
        return
      }
      try {
        glassSdk = sdk
        sceneFailed = false
        glassReady = false
        setStatus('pending')
        glassScene = sdk.createGlassScene(rootElement, {
          maxSurfaces: MAX_SURFACES,
          onDiagnostic(diagnostic) {
            if (!active || !glassScene) return
            if (diagnostic?.error) {
              sceneFailed = true
              stopScene(true)
              setStatus('fallback')
              return
            }
            glassReady = diagnostic.surfaces > 0 && diagnostic.maps === diagnostic.surfaces
            if (glassReady) {
              if (readinessTimer) root.clearTimeout(readinessTimer)
              readinessTimer = undefined
              setStatus('sdk')
            }
          },
        })
        rootElement.classList.add('lg-scene')
        glassScene.setContent(backdropElement)
        for (const surface of surfaces.values()) registerSurface(surface)
        if (sceneFailed) return
        if (glassReady) setStatus('sdk')
        else {
          setStatus('pending')
          waitForGlassMaps(token)
        }
      } catch {
        stopScene(true)
        setStatus('fallback')
      }
    }

    function setActive(value) {
      const next = Boolean(value)
      if (active === next) return startTask || Promise.resolve()
      active = next
      const token = ++generation
      if (!active) {
        stopAll()
        startTask = undefined
        return Promise.resolve()
      }
      startTask = start(token).finally(() => {
        if (token === generation) startTask = undefined
      })
      return startTask
    }

    function refreshForPreference() {
      if (!active) return
      const token = ++generation
      stopScene(true)
      startTask = start(token).finally(() => {
        if (token === generation) startTask = undefined
      })
    }

    for (const query of ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)', '(forced-colors: active)']) {
      const media = root.matchMedia?.(query)
      addListener(media, 'change', refreshForPreference, undefined, true)
    }
    addListener(root, 'pagehide', () => setActive(false), undefined, true)
    addListener(root, 'pageshow', () => {
      if (doc.documentElement.dataset.theme === 'liquid-glass') setActive(true)
    }, undefined, true)

    return { setActive, isActive: () => active }
  }

  return { createLiquidGlassAppearance }
})
