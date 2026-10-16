'use strict'

// Independent acceptance implementation with an injected frame provider.
// It uses no default source, capture command, or built-in plugin factory.
exports.create = context => {
  const configuration = context.capability('source.camera')
  const { present, captureFrame, now, width, height, minIntervalMs, maxFrameBytes } = configuration.provider(configuration.options)
  const unavailable = () => ({ status: 'unavailable', frame: null, capturedAt: null, width, height })
  let cached = unavailable()
  let lastAttempt = 0
  let stopped = context.signal.aborted
  const pending = new Set()
  const cancel = () => { stopped = true; cached = unavailable() }
  context.signal.addEventListener('abort', cancel, { once: true })
  const source = {
    snapshot: () => cached,
    refresh() {
      if (stopped) return Promise.resolve(cached)
      let resolve
      let reject
      const operation = new Promise((yes, no) => { resolve = yes; reject = no })
      pending.add(operation)
      operation.then(() => pending.delete(operation), () => pending.delete(operation))
      capture().then(resolve, reject)
      return operation
    },
    stop() {
      cancel()
      context.signal.removeEventListener('abort', cancel)
      return Promise.allSettled([...pending]).then(() => {})
    },
  }
  async function capture() {
    const time = now()
    if (!present()) return (cached = unavailable())
    if (time - lastAttempt < minIntervalMs) return cached
    lastAttempt = time
    try {
      const bytes = await captureFrame()
      if (bytes.length < 4096 || bytes.length > maxFrameBytes || bytes[0] !== 255 || bytes[1] !== 216) throw Error('invalid frame')
      if (!stopped) cached = { status: 'live', frame: `data:image/jpeg;base64,${bytes.toString('base64')}`, capturedAt: time, width, height }
    } catch {
      if (!stopped) cached = unavailable()
    }
    return cached
  }
  context.onCleanup(() => source.stop())
  const ipc = context.capability('ipc')
  ipc.handle('odk-camera-frame', async () => { await source.refresh(); return source.snapshot() })
  context.onCleanup(() => ipc.removeHandler('odk-camera-frame'))
  return { ports: {
    'odk:source/camera/v1': source,
    'odk:plugin-health/odk.source.camera/v1': { snapshot() {
      return cached.status === 'live'
        ? { state: 'healthy', reason: 'cached-frame', updatedAt: cached.capturedAt }
        : { state: 'failed', reason: 'unavailable' }
    } },
  } }
}
