;(function (root) {
  'use strict'

  const BURST_MS = 600

  function isDirection(input) {
    return input === 'left' || input === 'right' || input === 'up' || input === 'down'
  }

  function createTracker(nowFn) {
    const now = typeof nowFn === 'function' ? nowFn : Date.now
    let lastDirection = null
    let lastAt = 0
    return {
      observe(input) {
        const at = now()
        const burst = (input === 'up' || input === 'down') &&
          lastDirection === input && at - lastAt < BURST_MS
        lastDirection = isDirection(input) ? input : null
        lastAt = at
        return burst
      },
    }
  }

  const shared = createTracker()
  const api = {
    BURST_MS,
    createTracker,
    observe(input) {
      return shared.observe(input)
    },
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else if (root) {
    root.odkRemoteBurst = api
  }
})(typeof window !== 'undefined' ? window : null)
