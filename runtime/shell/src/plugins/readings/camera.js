'use strict'

const { sourceHealth } = require('../health')

function getCameraHealth(source) {
  const health = sourceHealth(source, snapshot => snapshot?.status,
    { live: 'healthy', unavailable: 'failed' }, snapshot => snapshot?.capturedAt)
  return health.state === 'healthy' ? { ...health, reason: 'cached-frame' } : health
}

module.exports = { getCameraHealth }
