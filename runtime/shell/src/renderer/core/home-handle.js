;(function (root) {
  'use strict'

  function bind({ handle, card, isOpen, blocked, returnHome, reportError }) {
    const events = new AbortController()
    const options = { signal: events.signal }
    let drag = null
    let returning = false

    function cancel() {
      const pointer = drag?.id
      drag = null
      card.style.removeProperty('transform')
      card.style.removeProperty('opacity')
      handle.removeAttribute('data-dragging')
      if (pointer !== undefined && handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer)
    }

    function requestReturn() {
      if (returning || !isOpen() || blocked()) return
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
      if (drag && !event.isPrimary) cancel()
    }, options)
    root.addEventListener('blur', cancel, options)
    root.addEventListener('resize', cancel, options)
    root.addEventListener('odk-personal-bot-visibility', cancel, options)
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

  root.odkHomeHandle = { bind }
})(window)
