'use strict'

function createPiReadSource({ read, unavailable, signal, coalesce = false }) {
  const controller = new AbortController()
  const pending = new Set()
  let current = null
  const abort = () => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })

  // Parallel child requests retain ownership even if their parent fails early.
  const own = value => {
    const operation = Promise.resolve(value)
    pending.add(operation)
    void operation.then(() => pending.delete(operation), () => pending.delete(operation))
    return operation
  }
  const source = (...args) => {
    if (controller.signal.aborted) return Promise.resolve(unavailable())
    if (coalesce && current) return current
    let resolve
    let reject
    const result = new Promise((yes, no) => { resolve = yes; reject = no })
    const release = () => {
      pending.delete(operation)
      if (current === operation) current = null
    }
    const operation = result
      .then(value => {
        release()
        return controller.signal.aborted ? unavailable() : value
      }, error => {
        release()
        if (controller.signal.aborted) return unavailable()
        throw error
      })
    pending.add(operation)
    if (coalesce) current = operation
    try { resolve(read(controller.signal, own, ...args)) } catch (error) { reject(error) }
    return operation
  }
  source.stop = async () => {
    abort()
    signal?.removeEventListener('abort', abort)
    await Promise.allSettled([...pending])
  }
  return source
}

module.exports = { createPiReadSource }
