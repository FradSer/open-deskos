'use strict'

function createQuotaSource({ read, signal } = {}) {
  if (typeof read !== 'function') throw TypeError('Quota source requires a read operation')
  const controller = new AbortController()
  const pending = new Set()
  const unavailable = () => ({ state: 'unavailable', reason: 'Quota source stopped' })
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  return {
    async read() {
      if (controller.signal.aborted) return unavailable()
      const operation = Promise.resolve().then(() => controller.signal.aborted ? unavailable() : read({ signal: controller.signal }))
      pending.add(operation)
      try {
        const value = await operation
        return controller.signal.aborted ? unavailable() : value
      } catch (error) {
        if (controller.signal.aborted) return unavailable()
        throw error
      } finally { pending.delete(operation) }
    },
    async stop() {
      abort()
      signal?.removeEventListener('abort', abort)
      await Promise.allSettled([...pending])
    },
  }
}

module.exports = { createQuotaSource }
