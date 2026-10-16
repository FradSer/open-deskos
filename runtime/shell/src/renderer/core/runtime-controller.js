;(function (root) {
  'use strict'

  function create({ registry, composer, layout, track, context, onPlacementsChanged, onTransition = () => {}, onStop = () => {} }) {
    let pending = Promise.resolve()
    let closing = false
    let stopping = null

    function serial(operation) {
      const result = pending.then(operation)
      pending = result.catch(() => {})
      return result
    }

    function requireOpen() {
      if (closing) throw Error('renderer runtime is shutting down')
    }

    async function transition(operation, { receipt = false } = {}) {
      requireOpen()
      return serial(async () => {
        requireOpen()
        onTransition(true)
        try {
          const result = await operation()
          requireOpen()
          const failures = []
          for (const reconcile of [() => composer.reconcile(layout, track, context), () => composer.reconcileStatus(context)]) {
            requireOpen()
            try { await reconcile() } catch (error) { failures.push(error) }
          }
          requireOpen()
          if (failures.length) throw new AggregateError(failures, 'renderer runtime reconciliation failed')
          return receipt ? result : registry.catalog()
        } finally {
          if (!closing) {
            try { onPlacementsChanged() } finally { onTransition(false) }
          }
        }
      })
    }


    return {
      setEnabled: (id, enabled) => transition(() => registry.setEnabled(id, enabled)),
      replace: def => transition(() => registry.replace(def)),
      restoreDefault: id => transition(() => registry.restoreDefault(id), { receipt: true }),
      stop() {
        closing = true
        if (stopping) return stopping
        // Fence registry work immediately; its Host drains owned releases.
        // The controller still waits for all queued publication work to settle.
        const stopped = (async () => registry.stop())()
        const servicesStopped = (async () => onStop())()
        const result = Promise.allSettled([pending, stopped, servicesStopped]).then(results => {
          const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
          if (failures.length === 1) throw failures[0]
          if (failures.length) throw new AggregateError(failures, 'renderer shutdown failed', { cause: failures[0] })
          return results[1].value
        })
        stopping = result
        result.then(() => { stopping = null }, () => { stopping = null })
        return result
      },
    }
  }

  root.odkRendererRuntimeController = { create }
})(typeof window !== 'undefined' ? window : globalThis)
