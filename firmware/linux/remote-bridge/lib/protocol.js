'use strict'

const PROTOCOL_VERSION = 1
const LINK_STATES = new Set(['disconnected', 'syncing', 'usb', 'wireless'])
const NAVIGATION_DIRECTIONS = new Set(['previous', 'next'])

function createLinkState(state) {
  if (!LINK_STATES.has(state)) throw new Error(`Unknown link state: ${state}`)
  return {
    v: PROTOCOL_VERSION,
    type: 'link',
    state,
  }
}

function parseJsonLine(line) {
  let record
  try {
    record = JSON.parse(line)
  } catch {
    return { ok: false, error: 'invalid-json' }
  }
  if (!isRecord(record)) return { ok: false, error: 'invalid-record' }
  if (record.v !== PROTOCOL_VERSION) return { ok: false, error: 'unsupported-version' }
  if (typeof record.type !== 'string') return { ok: false, error: 'invalid-type' }
  return { ok: true, record }
}

function validateShellState(record) {
  if (!isVersionedRecord(record)) return { ok: false, error: 'unsupported-version' }
  if (record.type !== 'state') return { ok: false, error: 'unexpected-type' }
  if (!isPositiveInteger(record.page) || !isPositiveInteger(record.pages) || typeof record.name !== 'string' || !record.name) {
    return { ok: false, error: 'invalid-page-state' }
  }
  if (record.page > record.pages || typeof record.canPrev !== 'boolean' || typeof record.canNext !== 'boolean') {
    return { ok: false, error: 'invalid-page-state' }
  }
  if (record.canPrev !== (record.page > 1) || record.canNext !== (record.page < record.pages)) {
    return { ok: false, error: 'inconsistent-boundaries' }
  }
  if (record.link !== undefined && typeof record.link !== 'string') return { ok: false, error: 'invalid-link' }
  return { ok: true }
}

function validateNavigate(record) {
  if (!isVersionedRecord(record)) return { ok: false, error: 'unsupported-version' }
  if (record.type !== 'navigate') return { ok: false, error: 'unexpected-type' }
  if (!NAVIGATION_DIRECTIONS.has(record.direction)) return { ok: false, error: 'invalid-direction' }
  return { ok: true }
}

function encodeJsonLine(record) {
  return `${JSON.stringify(record)}\n`
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function isVersionedRecord(value) {
  return isRecord(value) && value.v === PROTOCOL_VERSION
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

module.exports = {
  LINK_STATES,
  NAVIGATION_DIRECTIONS,
  PROTOCOL_VERSION,
  createLinkState,
  encodeJsonLine,
  parseJsonLine,
  validateNavigate,
  validateShellState,
}
