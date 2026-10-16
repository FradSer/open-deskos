'use strict'

function createFrameReadyEvents({ report = error => console.error(`frame listener failed: ${error.message}`) } = {}) {
  const listeners = new Set()
  const failed = error => {
    try { report(error) } catch { /* Reporting cannot prevent other frame listeners from running. */ }
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(frame) {
      for (const listener of [...listeners]) {
        if (!listeners.has(listener)) continue
        try { Promise.resolve(listener(frame)).catch(failed) } catch (error) { failed(error) }
      }
    },
  }
}

module.exports = { createFrameReadyEvents }
