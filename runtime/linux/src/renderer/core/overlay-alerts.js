;(function (root) {
  'use strict'

  function createOverlayAlertsManager({ container, onAnnouncement } = {}) {
    const alerts = new Map()
    let nextId = 1

    function dismiss(id) {
      const alert = alerts.get(id)
      if (!alert) return
      if (alert.timer) clearTimeout(alert.timer)
      if (alert.element) alert.element.remove()
      alerts.delete(id)
    }

    function postAlert(payload) {
      if (!payload || typeof payload !== 'object' || (!payload.title && !payload.message)) {
        throw new Error('invalid-alert-payload: title or message required')
      }

      const id = `alert-${nextId++}`
      const level = payload.level || 'info'
      const timeoutMs = typeof payload.timeoutMs === 'number' ? payload.timeoutMs : 4000
      const title = payload.title || 'System Alert'
      const message = payload.message || ''

      const card = document.createElement('div')
      card.className = `system-overlay-alert alert-${level}`
      card.dataset.alertId = id
      card.dataset.level = level
      card.setAttribute('role', level === 'critical' ? 'alert' : 'status')
      card.setAttribute('aria-live', level === 'critical' ? 'assertive' : 'polite')

      card.innerHTML = `
        <div class="alert-content">
          <strong class="alert-title">${title}</strong>
          <span class="alert-message">${message}</span>
        </div>
        <button type="button" class="alert-close" aria-label="Close notification">×</button>
      `

      const closeBtn = card.querySelector?.('.alert-close')
      if (closeBtn) closeBtn.addEventListener('click', () => dismiss(id))

      if (container && typeof container.append === 'function') {
        container.append(card)
      }

      let timer = null
      if (timeoutMs > 0) {
        timer = setTimeout(() => dismiss(id), timeoutMs)
      }

      alerts.set(id, { id, payload, element: card, timer })
      if (onAnnouncement) onAnnouncement(`${title}: ${message}`)
      return id
    }

    return {
      postAlert,
      dismiss,
      activeAlerts: () => Array.from(alerts.values()),
    }
  }

  root.odkOverlayAlerts = {
    create: createOverlayAlertsManager,
  }
})(typeof window !== 'undefined' ? window : globalThis)
