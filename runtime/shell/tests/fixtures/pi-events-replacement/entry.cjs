'use strict'

// This implementation uses declared ports and capabilities without Shell imports.
exports.create = context => {
  const { readLocal } = context.capability('source.pi-events')
  if (typeof readLocal !== 'function') throw TypeError('Pi Events requires a local event reader')
  const link = context.get('odk:source/link/v1')
  const controller = new AbortController()
  let active = 0
  const drains = []
  const cancel = () => controller.abort()
  const unavailable = () => ({ ok: false, reason: 'pi-source-stopped' })
  if (context.signal.aborted) cancel()
  else context.signal.addEventListener('abort', cancel, { once: true })
  const source = async request => {
    if (controller.signal.aborted) return unavailable()
    active++
    try {
      const reported = await link.sessionEvents(request.sessionId, { hostedPi: request.hostedPi === true, signal: controller.signal })
      if (controller.signal.aborted) return unavailable()
      if (reported.ok || !['session-log-missing', 'odk-link-unconfigured', 'odk-link-unavailable'].includes(reported.reason)) return reported
      const local = await readLocal(request)
      return controller.signal.aborted ? unavailable() : local
    } catch (error) {
      if (controller.signal.aborted) return unavailable()
      throw error
    } finally {
      active--
      if (active === 0) for (const resolve of drains.splice(0)) resolve()
    }
  }
  source.stop = () => {
    cancel()
    context.signal.removeEventListener('abort', cancel)
    return active === 0 ? Promise.resolve() : new Promise(resolve => drains.push(resolve))
  }
  context.onCleanup(() => source.stop())
  const ipc = context.capability('ipc')
  ipc.handle('odk-pi-session-events', (_event, request) => source({
    cwd: typeof request?.cwd === 'string' ? request.cwd : '',
    sessionId: typeof request?.sessionId === 'string' ? request.sessionId : '',
    hostedPi: request?.hostedPi === true,
  }))
  context.onCleanup(() => ipc.removeHandler('odk-pi-session-events'))
  return { ports: { 'odk:source/pi-events/v1': source } }
}
