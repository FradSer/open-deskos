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
  const gamepadSubs = new Set()
  let gamepadState = Object.freeze({ connected: false, readable: false, id: null })
  const tickSubs = new Set()
  const briefingSubs = new Set()
  const briefings = new Map()
  const briefingSignatures = new Map()
  let stopTickTimer = null

  function addSubscriber(subscribers, callback) {
    const listener = value => callback(value)
    subscribers.add(listener)
    return () => subscribers.delete(listener)
  }

  function subscribeRetained(subscribers, callback, value) {
    const release = addSubscriber(subscribers, callback)
    try {
      callback(value)
    } catch (error) {
      release()
      throw error
    }
    return release
  }

  function notify(subs, arg) {
    for (const cb of subs) {
      try {
        cb(arg)
      } catch (error) {
        console.error('odk service callback failed:', error)
      }
    }
  }

  const homeSubs = new Set()
  let homeFrame = { state: 'unavailable', items: [], generatedAt: 0, omittedSources: 0 }
  let homeRevision = 0
  function receiveHome(status) {
    homeRevision++
    if (status?.briefing) homeFrame = status.briefing
    else if (status?.state === 'unavailable') homeFrame = { ...homeFrame, state: homeFrame.items.length ? 'stale' : 'unavailable' }
    else return
    notify(homeSubs, homeFrame)
  }
  const homeBriefing = {
    snapshot: () => homeFrame,
    subscribe(callback) {
      return subscribeRetained(homeSubs, callback, homeFrame)
    },
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
      return subscribeRetained(remoteLinkSubs, callback, remoteLinkState)
    },
  }

  const connection = {
    online: () => navigator.onLine,
    label: () => NETWORK_LABELS[navigator.onLine ? 'connected' : 'disconnected'],
    labelFor: (online) => NETWORK_LABELS[online ? 'connected' : 'disconnected'],
    subscribe(callback) {
      return subscribeRetained(connSubs, callback, navigator.onLine)
    },
  }

  const gamepad = {
    snapshot: () => gamepadState,
    subscribe(callback) {
      const release = addSubscriber(gamepadSubs, callback)
      notify(new Set([callback]), gamepadState)
      return release
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
      return subscribeRetained(cameraSubs, callback, cameraFrame)
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
      return subscribeRetained(subscriptionSubs, callback, subscriptionStatus)
    },
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
      return subscribeRetained(briefingSubs, callback, briefing.list())
    },
  }

  const serviceInstances = new Map()
  const defaultInputs = new Map()

  function completeServiceId(serviceId) {
    return serviceId.startsWith('odk.service.') ? serviceId : `odk.service.${serviceId}`
  }

  function registerService(serviceId, instance) {
    if (!serviceId || !instance) return
    const id = completeServiceId(serviceId)
    const inputs = defaultInputs.get(id)
    if (serviceInstances.get(id) === instance && (!inputs || inputs.active)) return
    inputs?.release?.()
    if (inputs) inputs.release = null
    serviceInstances.set(id, instance)
    if (instance !== inputs?.instance) return
    let active = true
    inputs.active = true
    const guard = callback => (...args) => {
      if (active) return callback(...args)
    }
    const release = inputs.connect(guard)
    inputs.release = () => {
      active = false
      inputs.active = false
      release?.()
    }
    // Resync only after cleanup is owned; consumers can select another service here.
    inputs.resync?.(guard)
  }

  function unregisterService(serviceId) {
    if (!serviceId) return
    const id = completeServiceId(serviceId)
    const inputs = defaultInputs.get(id)
    inputs?.release?.()
    if (inputs) inputs.release = null
    serviceInstances.delete(id)
  }

  function registerDefaultService(serviceId, instance, connect, resync) {
    defaultInputs.set(serviceId, { instance, connect, resync, active: false, release: null })
    registerService(serviceId, instance)
  }

  function getService(serviceId) {
    if (!serviceId) return null
    return serviceInstances.get(completeServiceId(serviceId)) || null
  }

  function hasService(serviceId) {
    return Boolean(getService(serviceId))
  }

  function listServices() {
    return Array.from(serviceInstances.keys())
  }

  registerDefaultService('odk.service.connection', connection, guard => {
    if (typeof root.addEventListener !== 'function') return
    const listeners = [true, false].map(online => {
      const listener = guard(() => {
        notify(connSubs, online)
        if (typeof CustomEvent !== 'undefined' && typeof root.dispatchEvent === 'function') {
          root.dispatchEvent(new CustomEvent('odk-connection-announcement', {
            detail: NETWORK_LABELS[online ? 'connected' : 'disconnected'],
          }))
        }
      })
      const event = online ? 'online' : 'offline'
      root.addEventListener(event, listener)
      return () => root.removeEventListener?.(event, listener)
    })
    return () => listeners.forEach(release => release())
  }, guard => guard(() => notify(connSubs, navigator.onLine))())
  function receiveGamepadState(state) {
    gamepadState = Object.freeze({
      connected: state?.connected === true,
      readable: state?.readable === true,
      id: typeof state?.id === 'string' ? state.id : null,
    })
    notify(gamepadSubs, gamepadState)
  }

  registerDefaultService('odk.service.gamepad', gamepad, guard => {
    if (typeof root.addEventListener !== 'function') return
    const listener = guard(event => receiveGamepadState(event.detail))
    root.addEventListener('odk-gamepad-state', listener)
    return () => root.removeEventListener?.('odk-gamepad-state', listener)
  }, guard => {
    root.odkGamepadInput?.createGamepadInput({ onConnection: guard(receiveGamepadState) }).poll()
  })
  registerService('odk.service.subscription', subscription)
  registerService('odk.service.camera', camera)
  registerDefaultService('odk.service.remoteLink', remoteLink, guard =>
    root.odkRemote?.subscribeLinkState?.(guard(updateRemoteLinkState)))
  registerService('odk.service.briefing', briefing)
  registerDefaultService('odk.service.homeBriefing', homeBriefing, guard => {
    const release = root.odkPersonalBot?.subscribe(guard(receiveHome))
    const initialHomeRevision = homeRevision
    root.odkPersonalBot?.getStatus().then(guard(status => {
      if (homeRevision === initialHomeRevision) receiveHome(status)
    })).catch(guard(() => {
      if (homeRevision === initialHomeRevision) receiveHome({ state: 'unavailable' })
    }))
    return release
  })

  function refreshService(serviceId) {
    try {
      Promise.resolve(getService(serviceId)?.refresh?.()).catch(error => {
        console.error('odk service refresh failed:', error)
      })
    } catch (error) {
      console.error('odk service refresh failed:', error)
    }
  }

  root.odkServices = {
    NETWORK_LABELS,
    REMOTE_LINK_LABELS,
    SUBSCRIPTION_LABELS,
    formatCheckTime,
    get connection() { return getService('odk.service.connection') },
    get gamepad() { return getService('odk.service.gamepad') },
    get subscription() { return getService('odk.service.subscription') },
    get camera() { return getService('odk.service.camera') },
    get remoteLink() { return getService('odk.service.remoteLink') },
    get briefing() { return getService('odk.service.briefing') },
    get homeBriefing() { return getService('odk.service.homeBriefing') },
    registerService,
    unregisterService,
    get: getService,
    has: hasService,
    list: listServices,
    onTick(callback) {
      const release = addSubscriber(tickSubs, callback)
      try {
        callback(new Date())
      } catch (error) {
        console.error('odk service callback failed:', error)
      }
      if (!stopTickTimer) {
        let active = true
        let tickCounter = 0
        const timer = setInterval(() => {
          if (!active) return
          const now = new Date()
          notify(tickSubs, now)
          if (!active) return
          tickCounter += 1
          if (tickCounter % 15 === 0) refreshService('odk.service.camera')
          if (active && tickCounter % 60 === 0) refreshService('odk.service.subscription')
        }, 1000)
        stopTickTimer = () => {
          active = false
          clearInterval(timer)
          stopTickTimer = null
        }
      }
      return () => {
        const removed = release()
        if (tickSubs.size === 0) stopTickTimer?.()
        return removed
      }
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
