;
(function (root) {
  'use strict'

  const NETWORK_LABELS = {
    connected: 'Network connected',
    disconnected: 'Network disconnected',
  }
  const REMOTE_LINK_LABELS = {
    disconnected: 'Disconnected',
    usb: 'Connected by USB',
    wireless: 'Connected wirelessly',
    syncing: 'Synchronizing',
  }
  const SUBSCRIPTION_LABELS = {
    unconfigured: 'Quota service not configured',
    available: 'Quotas synchronized',
    unauthorized: 'Quota service credentials invalid',
    unavailable: 'Quotas unavailable',
  }
  let subscriptionStatus = { state: 'unconfigured', missing: [] }
  let checkInFlight = false
  let checkPromise = null
  let lastCheckAt = null
  let remoteLinkState = 'disconnected'
  const unavailableCameraFrame = () => ({ status: 'unavailable', frame: null, capturedAt: null })
  let cameraFrame = unavailableCameraFrame()
  let cameraCheckInFlight = false
  const DEFAULT_BRIEFING_ORDER = 100
  const ICON_MARKUP = /^<svg\b(?=[^>]*\bdata-tabler="[a-z0-9-]+")[^>]*\bviewBox="[^"]+"[^>]*>[\s\S]*<\/svg>$/
  const UNTRUSTED_MARKUP = /<script|on[a-z]+\s*=/i
  const remoteLinkSubs = new Set()
  const subscriptionSubs = new Set()
  const cameraSubs = new Set()
  const connSubs = new Set()
  const tickSubs = new Set()
  const briefingSubs = new Set()
  const briefings = new Map()
  const briefingSignatures = new Map()
  let tickTimer = null

  function notify(subs, arg) {
    for (const cb of subs) {
      try {
        cb(arg)
      } catch (error) {
        console.error('odk service callback failed:', error)
      }
    }
  }

  function formatCheckTime() {
    return lastCheckAt
      ? `Last checked ${lastCheckAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
      : 'Not checked yet'
  }

  function updateRemoteLinkState(next) {
    if (!Object.hasOwn(REMOTE_LINK_LABELS, next) || remoteLinkState === next) return
    remoteLinkState = next
    notify(remoteLinkSubs, remoteLinkState)
  }

  const remoteLink = {
    state: () => remoteLinkState,
    label: () => REMOTE_LINK_LABELS[remoteLinkState],
    subscribe(callback) {
      remoteLinkSubs.add(callback)
      callback(remoteLinkState)
      return () => remoteLinkSubs.delete(callback)
    },
  }

  const connection = {
    online: () => navigator.onLine,
    label: () => NETWORK_LABELS[navigator.onLine ? 'connected' : 'disconnected'],
    labelFor: (online) => NETWORK_LABELS[online ? 'connected' : 'disconnected'],
    subscribe(callback) {
      connSubs.add(callback)
      callback(navigator.onLine)
      return () => connSubs.delete(callback)
    },
  }

  const camera = {
    status: () => cameraFrame,
    refresh: async () => {
      if (cameraCheckInFlight) return cameraFrame
      cameraCheckInFlight = true
      try {
        const next = await root.odkPlatform.getCameraFrame()
        cameraFrame = next?.status ? next : unavailableCameraFrame()
      } catch {
        cameraFrame = unavailableCameraFrame()
      } finally {
        cameraCheckInFlight = false
      }
      notify(cameraSubs, cameraFrame)
      return cameraFrame
    },
    subscribe(callback) {
      cameraSubs.add(callback)
      callback(cameraFrame)
      return () => cameraSubs.delete(callback)
    },
  }

  const subscription = {
    status: () => subscriptionStatus,
    label: () => SUBSCRIPTION_LABELS[subscriptionStatus.state] || SUBSCRIPTION_LABELS.unavailable,
    snapshot: () => subscriptionStatus.snapshot || null,
    lastCheck: formatCheckTime,
    refresh: async () => {
      if (checkInFlight) return checkPromise
      checkInFlight = true
      checkPromise = (async () => {
        lastCheckAt = new Date()
        try {
          subscriptionStatus = await root.odkPlatform.getOpenCodeGoStatus()
        } catch (error) {
          subscriptionStatus = { state: 'unavailable', reason: error.message || 'Request failed' }
        }
        notify(subscriptionSubs, subscriptionStatus)
        return subscriptionStatus
      })().finally(() => {
        checkInFlight = false
        checkPromise = null
      })
      return checkPromise
    },
    subscribe(callback) {
      subscriptionSubs.add(callback)
      callback(subscriptionStatus)
      return () => subscriptionSubs.delete(callback)
    },
  }

  if (root.odkRemote?.subscribeLinkState) {
    root.odkRemote.subscribeLinkState(updateRemoteLinkState)
  }

  // Briefing store: Today renders statements, not markup. Any plugin can
  // publish an ordered statement of plain connectives and emphasized signals;
  // the page owns the typography so every contributor reads as one voice.
  function normalizeBriefingParts(parts) {
    if (!Array.isArray(parts)) return []
    const normalized = []
    for (const part of parts) {
      if (!part || typeof part.text !== 'string' || part.text.length === 0) continue
      const entry = { text: part.text }
      if (part.emphasis === true) entry.emphasis = true
      if (typeof part.icon === 'string' && ICON_MARKUP.test(part.icon) && !UNTRUSTED_MARKUP.test(part.icon)) {
        entry.icon = part.icon
      }
      normalized.push(entry)
    }
    return normalized
  }

  const briefing = {
    list: () => [...briefings.values()].sort((a, b) => a.order - b.order),
    contribute(statement) {
      const parts = normalizeBriefingParts(statement?.parts)
      if (typeof statement?.id !== 'string' || !statement.id.startsWith('odk.') || parts.length === 0) return false
      const order = Number.isFinite(statement.order) ? statement.order : DEFAULT_BRIEFING_ORDER
      const signature = JSON.stringify([order, parts])
      if (briefingSignatures.get(statement.id) === signature) return true
      briefingSignatures.set(statement.id, signature)
      briefings.set(statement.id, { id: statement.id, order, parts })
      notify(briefingSubs, briefing.list())
      return true
    },
    withdraw(id) {
      briefingSignatures.delete(id)
      if (!briefings.delete(id)) return false
      notify(briefingSubs, briefing.list())
      return true
    },
    subscribe(callback) {
      briefingSubs.add(callback)
      callback(briefing.list())
      return () => briefingSubs.delete(callback)
    },
  }

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('online', () => {
      notify(connSubs, true)
      if (typeof CustomEvent !== 'undefined' && typeof root.dispatchEvent === 'function') {
        root.dispatchEvent(new CustomEvent('odk-connection-announcement', { detail: NETWORK_LABELS.connected }))
      }
    })
    root.addEventListener('offline', () => {
      notify(connSubs, false)
      if (typeof CustomEvent !== 'undefined' && typeof root.dispatchEvent === 'function') {
        root.dispatchEvent(new CustomEvent('odk-connection-announcement', { detail: NETWORK_LABELS.disconnected }))
      }
    })
  }

  const serviceInstances = new Map()

  function registerService(serviceId, instance) {
    if (!serviceId || !instance) return
    serviceInstances.set(serviceId, instance)
    const shortName = serviceId.replace(/^odk\.service\./, '')
    if (shortName !== serviceId) {
      serviceInstances.set(shortName, instance)
    }
  }

  function unregisterService(serviceId) {
    if (!serviceId) return
    serviceInstances.delete(serviceId)
    const shortName = serviceId.replace(/^odk\.service\./, '')
    if (shortName !== serviceId) {
      serviceInstances.delete(shortName)
    }
  }

  function getService(serviceId) {
    if (!serviceId) return null
    return serviceInstances.get(serviceId) || serviceInstances.get(serviceId.replace(/^odk\.service\./, '')) || null
  }

  function hasService(serviceId) {
    return Boolean(getService(serviceId))
  }

  function listServices() {
    return Array.from(new Set(serviceInstances.keys())).filter((k) => k.startsWith('odk.service.'))
  }

  registerService('odk.service.connection', connection)
  registerService('odk.service.subscription', subscription)
  registerService('odk.service.camera', camera)
  registerService('odk.service.remoteLink', remoteLink)
  registerService('odk.service.briefing', briefing)

  root.odkServices = {
    NETWORK_LABELS,
    REMOTE_LINK_LABELS,
    SUBSCRIPTION_LABELS,
    formatCheckTime,
    connection,
    subscription,
    camera,
    remoteLink,
    briefing,
    registerService,
    unregisterService,
    get: getService,
    has: hasService,
    list: listServices,
    onTick(callback) {
      tickSubs.add(callback)
      try {
        callback(new Date())
      } catch (error) {
        console.error('odk service callback failed:', error)
      }
      if (!tickTimer) {
        let tickCounter = 0
        tickTimer = setInterval(() => {
          const now = new Date()
          notify(tickSubs, now)
          tickCounter += 1
          if (tickCounter % 15 === 0) void camera.refresh()
          if (tickCounter % 60 === 0) void subscription.refresh()
        }, 1000)
      }
      return () => tickSubs.delete(callback)
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
