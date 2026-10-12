'use strict'

const healthPort = id => `odk:plugin-health/${id}/v1`

function sourceHealth(source, resolveState, states, timestamp = snapshot => snapshot?.updatedAt) {
  if (typeof source?.snapshot !== 'function') return { state: 'unknown', reason: 'snapshot-unavailable' }
  const snapshot = source.snapshot()
  if (typeof snapshot?.then === 'function') {
    void Promise.resolve(snapshot).catch(() => {})
    return { state: 'failed', reason: 'invalid-source-snapshot' }
  }
  const sourceState = resolveState(snapshot)
  const state = Object.hasOwn(states, sourceState) ? states[sourceState] : 'unknown'
  const updatedAt = timestamp(snapshot)
  return { state, ...(state === 'healthy' ? {} : { reason: state === 'unknown' ? 'source-state-unknown' : sourceState }),
    ...(Number.isFinite(updatedAt) ? { updatedAt } : {}) }
}

module.exports = { healthPort, sourceHealth }
