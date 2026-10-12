'use strict'

const { createAppManagerEndpoint } = require('./manager')

exports.create = ctx => {
  const manager = createAppManagerEndpoint()
  const ipc = ctx.capability('ipc')
  let ready = false
  for (const [channel, handler] of [
    ['odk-app-manager-list', () => manager.list()],
    ['odk-app-manager-state', (_event, appId) => manager.get(appId)],
    ['odk-app-manager-intent', (_event, intent) => manager.dispatch(intent)],
  ]) {
    ipc.handle(channel, (...args) => {
      if (!ready || ctx.signal.aborted) throw Error('App Manager unavailable')
      return handler(...args)
    })
    ctx.onCleanup(() => ipc.removeHandler(channel))
  }
  return { ports: { 'odk:system/app-manager/v1': manager },
    handoff: { schema: 'odk:system/app-manager-state/v1', capture: () => manager.captureState(), restore: state => manager.restoreState(state) },
    start() { ready = true }, stop() { ready = false },
  }
}
