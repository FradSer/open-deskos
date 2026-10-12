'use strict'

const { startUserAppSystem } = require('./src/user-app-system')
let started = false

exports.create = ctx => {
  const config = ctx.capability('desk.user-apps')
  const data = ctx.get('odk:system/data/v1')
  return { async start() {
    if (ctx.signal.aborted) return
    await startUserAppSystem({ ...config.options, store: ctx.get('odk:system/package-catalog/v1'), odkData: data, onCleanup: ctx.onCleanup,
      isStopping: () => ctx.signal.aborted || config.isStopping() })
    if (ctx.signal.aborted) return
    if (!started && !config.smokeMode) {
      const syncing = Promise.resolve(data?.syncPackages())
      ctx.onCleanup(() => syncing.catch(() => {}))
      void syncing.catch(() => console.error('Initial user application data synchronization failed'))
    }
    started = true
  } }
}
