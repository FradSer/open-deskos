;
(function (root) {
  'use strict'

  /*
   * Shared runtime services handed to every plugin through its mount context:
   * one-second tick broadcast (single interval owned by the shell) and the
   * connection state store. Status vocabulary lives here so every consumer
   * states the same truth.
   */
  const BRIDGE_STATUS = 'Mac bridge 未配置'
  const NETWORK_LABELS = {
    connected: '网络已连接',
    disconnected: '网络未连接',
  }

  const tickSubs = new Set()
  let tickTimer = null
  function notify(subs, arg) {
    for (const cb of subs) cb(arg)
  }

  const connection = {
    online: () => navigator.onLine,
    label: () => (navigator.onLine ? NETWORK_LABELS.connected : NETWORK_LABELS.disconnected),
    refresh: () => notify(connSubs, navigator.onLine),
    subscribe(cb) {
      connSubs.add(cb)
      cb(navigator.onLine)
      return () => connSubs.delete(cb)
    },
  }
  const connSubs = new Set()
  root.addEventListener('online', () => notify(connSubs, true))
  root.addEventListener('offline', () => notify(connSubs, false))

  root.odkServices = {
    BRIDGE_STATUS,
    NETWORK_LABELS,
    connection,
    onTick(cb) {
      tickSubs.add(cb)
      cb(new Date())
      if (!tickTimer) tickTimer = setInterval(() => notify(tickSubs, new Date()), 1000)
      return () => tickSubs.delete(cb)
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
