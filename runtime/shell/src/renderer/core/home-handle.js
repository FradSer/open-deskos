;(function (root) {
  'use strict'

  // Self-contained so the same detector can run in the opaque App bootstrap.
  function bindPinch({ root, owns, enabled, onStart = () => {}, onReturn, signal }) {
    const options = { signal }
    let pinch = null
    let touchCount = 0
    let pinchBlocked = false
    function cancel() { pinch = null; pinchBlocked = touchCount > 0 }
    const touchOptions = { ...options, capture: true, passive: false }
    function pair(event) {
      const touches = Array.from(event.touches)
      return touches.length === 2 && touches.every(touch => owns(touch.target)
        && Number.isFinite(touch.clientX) && Number.isFinite(touch.clientY))
        && touches[0].identifier !== touches[1].identifier ? touches : null
    }
    function geometry(touches) {
      const [a, b] = touches
      return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
    }
    root.addEventListener('touchstart', event => {
      if (touchCount === 0) pinchBlocked = false
      touchCount = event.touches.length
      const touches = pair(event)
      if (!touches || !enabled()) {
        pinch = null
        if (touchCount >= 2) pinchBlocked = true
        return
      }
      if (pinchBlocked) return
      onStart()
      const start = geometry(touches)
      pinch = { start, ids: touches.map(touch => touch.identifier), accepted: false }
    }, touchOptions)
    root.addEventListener('touchmove', event => {
      if (!pinch) return
      const touches = pair(event)
      if (!touches || !enabled()
        || !touches.every(touch => pinch.ids.includes(touch.identifier))) return cancel()
      const current = geometry(touches)
      // Distance contraction distinguishes a pinch from parallel two-finger scrolling.
      pinch.accepted = event.cancelable
        && pinch.start.distance - current.distance >= Math.max(48, pinch.start.distance * 0.25)
        && Math.hypot(current.x - pinch.start.x, current.y - pinch.start.y) <= Math.max(24, pinch.start.distance * 0.2)
      if (pinch.accepted) event.preventDefault()
    }, touchOptions)
    root.addEventListener('touchend', event => {
      const accept = pinch?.accepted && enabled() && event.touches.length < 2
      touchCount = event.touches.length
      pinch = null
      pinchBlocked = touchCount > 0
      if (accept) { event.preventDefault(); onReturn() }
    }, touchOptions)
    root.addEventListener('touchcancel', event => {
      touchCount = event.touches.length
      cancel()
    }, touchOptions)
    root.addEventListener('blur', cancel, options)
    root.addEventListener('resize', cancel, options)
    root.addEventListener('odk-personal-agent-visibility', cancel, options)
    return { cancel }
  }

  function bind({ handle, card, isOpen, canPinch = isOpen, canReturn = isOpen, blocked, returnHome, reportError }) {
    const events = new AbortController()
    const options = { signal: events.signal }
    let drag = null
    let returning = false

    function cancelDrag() {
      const pointer = drag?.id
      drag = null
      card.style.removeProperty('transform')
      card.style.removeProperty('opacity')
      handle.removeAttribute('data-dragging')
      if (pointer !== undefined && handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer)
    }

    function cancel() {
      cancelDrag()
      pinchGesture.cancel()
    }

    function requestReturn() {
      if (returning || !canReturn() || blocked()) return
      returning = true
      // The App platform owns resource release and its existing failure/retry UI.
      Promise.resolve().then(returnHome).catch(reportError).finally(() => {
        returning = false
        cancel()
      })
    }

    handle.addEventListener('pointerdown', event => {
      if (!isOpen() || blocked() || event.button !== 0 || !event.isPrimary) return
      cancel()
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dy: 0, vertical: false }
      handle.setPointerCapture(event.pointerId)
    }, options)
    handle.addEventListener('pointermove', event => {
      if (!drag || event.pointerId !== drag.id) return
      if (!isOpen() || blocked()) return cancel()
      drag.dx = event.clientX - drag.x
      drag.dy = event.clientY - drag.y
      drag.vertical = drag.dy < -10 && -drag.dy > Math.abs(drag.dx) * 1.25
      if (!drag.vertical) {
        card.style.removeProperty('transform')
        card.style.removeProperty('opacity')
        return
      }
      handle.dataset.dragging = 'true'
      // Track the finger directly, including with reduced motion. There is no
      // autonomous bounce or delayed close after release.
      card.style.transform = `translateY(${drag.dy}px)`
      card.style.opacity = String(1 - Math.min(0.18, -drag.dy / Math.max(1, card.clientHeight) * 0.4))
    }, options)
    handle.addEventListener('pointerup', event => {
      if (!drag || event.pointerId !== drag.id) return
      const threshold = Math.min(96, Math.max(48, card.clientHeight * 0.12))
      const accept = drag.vertical && -drag.dy >= threshold
      cancel()
      if (accept) requestReturn()
    }, options)
    handle.addEventListener('pointercancel', cancel, options)
    handle.addEventListener('lostpointercapture', event => {
      if (drag && event.pointerId === drag.id) cancel()
    }, options)
    root.addEventListener('pointerdown', event => {
      if (drag && !event.isPrimary) cancelDrag()
    }, options)
    const pinchGesture = bindPinch({ root, owns: target => card.contains(target),
      enabled: () => isOpen() && canPinch() && !blocked() && !returning,
      onStart: cancelDrag, onReturn: requestReturn, signal: events.signal })
    for (const type of ['blur', 'resize', 'odk-personal-agent-visibility']) root.addEventListener(type, cancel, options)
    handle.addEventListener('keydown', event => {
      if (!isOpen() || !['ArrowUp', 'Enter', ' '].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) requestReturn()
    }, options)
    handle.addEventListener('click', event => {
      if (!isOpen()) return
      event.preventDefault()
      event.stopImmediatePropagation()
      // Assistive activation and keyboard clicks use the same return control.
      // Pointer taps have no return action.
      if (event.detail === 0 && event.target.closest('.dot')?.classList.contains('active')) requestReturn()
    }, { ...options, capture: true })
    return { cancel, requestReturn, destroy() { cancel(); events.abort() } }
  }

  const api = { bind, bindPinch }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else root.odkHomeHandle = api
})(typeof window !== 'undefined' ? window : globalThis)
