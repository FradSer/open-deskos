;
(function (root) {
  'use strict'

  /*
   * Shared runtime services handed to every plugin through its mount context:
   * one-second tick broadcast (single interval owned by the shell) and the
   * connection state store. Status vocabulary lives here so every consumer
   * states the same truth.
   */
  const BRIDGE_LABELS = {
    connected: 'Mac 已连接',
    disconnected: 'Mac 尚未连接',
  }
  const NETWORK_LABELS = {
    connected: '网络已连接',
    disconnected: '网络未连接',
  }
  let bridgeConnected = false
  let lastCheckAt = null
  let checkInFlight = false
  let checkPromise = null
  const formatCheckTime = () => lastCheckAt
    ? `最近检查 ${lastCheckAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '尚未检查'

  const tickSubs = new Set()
  let tickTimer = null
  function notify(subs, arg) {
    for (const cb of subs) cb(arg)
  }

  const connection = {
    online: () => navigator.onLine,
    label: () => (navigator.onLine ? NETWORK_LABELS.connected : NETWORK_LABELS.disconnected),
    refresh: async () => {
      if (checkInFlight) return checkPromise
      checkInFlight = true
      checkPromise = (async () => {
        lastCheckAt = new Date()
        bridgeConnected = await checkCompanion()
        notify(connSubs, navigator.onLine)
        notify(bridgeSubs, bridgeConnected)
        return formatCheckTime()
      })().finally(() => {
        checkInFlight = false
        checkPromise = null
      })
      return checkPromise
    },
    lastCheck: () => formatCheckTime(),
    bridgeConnected: () => bridgeConnected,
    subscribeBridge(cb) {
      bridgeSubs.add(cb)
      cb(bridgeConnected)
      return () => bridgeSubs.delete(cb)
    },
    subscribe(cb) {
      connSubs.add(cb)
      cb(navigator.onLine)
      return () => connSubs.delete(cb)
    },
  }
  const connSubs = new Set()
  const bridgeSubs = new Set()
  const configuredEndpoint = new URLSearchParams(root.location?.search ?? '').get('companion')
  const checkCompanion = async () => {
    const endpoint = configuredEndpoint || root.__ODK_COMPANION_HEALTH_URL || 'http://127.0.0.1:8788/health'
    root.__ODK_COMPANION_HEALTH_URL = endpoint
    try {
      if (root.odkCompanion?.checkHealth) return await root.odkCompanion.checkHealth(endpoint)
      return false
    } catch {
      return false
    }
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
    BRIDGE_LABELS,
    NETWORK_LABELS,
    formatCheckTime,
    connection,
    onTick(cb) {
      tickSubs.add(cb)
      cb(new Date())
      if (!tickTimer) tickTimer = setInterval(() => notify(tickSubs, new Date()), 1000)
      return () => tickSubs.delete(cb)
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
