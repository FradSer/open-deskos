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
    unconfigured: 'OpenCode Go not configured',
    available: 'OpenCode Go synchronized',
    unauthorized: 'OpenCode Go credentials invalid',
    unavailable: 'OpenCode Go unavailable',
  }
  let subscriptionStatus = { state: 'unconfigured', missing: [] }
  let checkInFlight = false
  let checkPromise = null
  let lastCheckAt = null
  let remoteLinkState = 'disconnected'
  const unavailableFaceAgentStatus = () => ({ state: 'unavailable', facesCount: null, emotion: null, unlocked: false })
  let faceAgentStatus = unavailableFaceAgentStatus()
  let faceAgentCheckInFlight = false
  const remoteLinkSubs = new Set()
  const subscriptionSubs = new Set()
  const faceAgentSubs = new Set()
  const connSubs = new Set()
  const tickSubs = new Set()
  let tickTimer = null

  function notify(subs, arg) {
    for (const cb of subs) cb(arg)
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
    label: () => (navigator.onLine ? NETWORK_LABELS.connected : NETWORK_LABELS.disconnected),
    subscribe(callback) {
      connSubs.add(callback)
      callback(navigator.onLine)
      return () => connSubs.delete(callback)
    },
  }

  const faceAgent = {
    status: () => faceAgentStatus,
    refresh: async () => {
      if (faceAgentCheckInFlight) return faceAgentStatus
      faceAgentCheckInFlight = true
      try {
        const next = await root.odkPlatform.getFaceAgentStatus()
        faceAgentStatus = next?.state ? next : unavailableFaceAgentStatus()
      } catch {
        faceAgentStatus = unavailableFaceAgentStatus()
      } finally {
        faceAgentCheckInFlight = false
      }
      notify(faceAgentSubs, faceAgentStatus)
      return faceAgentStatus
    },
    subscribe(callback) {
      faceAgentSubs.add(callback)
      callback(faceAgentStatus)
      return () => faceAgentSubs.delete(callback)
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

  root.addEventListener('online', () => {
    notify(connSubs, true)
    root.dispatchEvent(new CustomEvent('odk-connection-announcement', { detail: NETWORK_LABELS.connected }))
  })
  root.addEventListener('offline', () => {
    notify(connSubs, false)
    root.dispatchEvent(new CustomEvent('odk-connection-announcement', { detail: NETWORK_LABELS.disconnected }))
  })

  root.odkServices = {
    NETWORK_LABELS,
    REMOTE_LINK_LABELS,
    SUBSCRIPTION_LABELS,
    formatCheckTime,
    connection,
    subscription,
    faceAgent,
    remoteLink,
    onTick(callback) {
      tickSubs.add(callback)
      callback(new Date())
      if (!tickTimer) {
        let tickCounter = 0
        tickTimer = setInterval(() => {
          const now = new Date()
          notify(tickSubs, now)
          tickCounter += 1
          if (tickCounter % 2 === 0) void faceAgent.refresh()
          if (tickCounter % 60 === 0) void subscription.refresh()
        }, 1000)
      }
      return () => tickSubs.delete(callback)
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
