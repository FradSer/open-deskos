'use strict'

const PROTOCOL_VERSION = 1
const LINK_STATES = new Set(['disconnected', 'syncing', 'usb', 'wireless'])
const NAVIGATION_DIRECTIONS = new Set(['previous', 'next'])
const REMOTE_INPUTS = new Set(['left', 'right', 'up', 'down', 'primary', 'secondary', 'back', 'mic', 'action'])

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
  if (record.mode !== undefined && !['browse', 'focus'].includes(record.mode)) return { ok: false, error: 'invalid-mode' }
  if (record.canFocus !== undefined && typeof record.canFocus !== 'boolean') return { ok: false, error: 'invalid-focus-state' }
  if (record.actions !== undefined) {
    if (!Array.isArray(record.actions)) return { ok: false, error: 'invalid-actions' }
    for (const item of record.actions) {
      if (!item || typeof item !== 'object') return { ok: false, error: 'invalid-actions' }
      const id = item.id || item.action
      const label = item.label || item.name
      if (typeof id !== 'string' || !id || typeof label !== 'string' || !label) {
        return { ok: false, error: 'invalid-actions' }
      }
    }
  }
  return { ok: true }
}

function validateNavigate(record) {
  if (!isVersionedRecord(record)) return { ok: false, error: 'unsupported-version' }
  if (record.type !== 'navigate') return { ok: false, error: 'unexpected-type' }
  if (!NAVIGATION_DIRECTIONS.has(record.direction)) return { ok: false, error: 'invalid-direction' }
  return { ok: true }
}

function validateRemoteInput(record) {
  if (!isVersionedRecord(record)) return { ok: false, error: 'unsupported-version' }
  if (record.type === 'action') {
    const actionId = record.action || record.id
    if (typeof actionId !== 'string' || !actionId) return { ok: false, error: 'invalid-action' }
    return { ok: true }
  }
  if (record.type !== 'input') return { ok: false, error: 'unexpected-type' }
  if (record.input === 'action') {
    const actionId = record.action || record.id
    if (typeof actionId !== 'string' || !actionId) return { ok: false, error: 'invalid-action' }
    return { ok: true }
  }
  if (!REMOTE_INPUTS.has(record.input)) return { ok: false, error: 'invalid-input' }
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
  REMOTE_INPUTS,
  PROTOCOL_VERSION,
  createLinkState,
  encodeJsonLine,
  parseJsonLine,
  validateNavigate,
  validateRemoteInput,
  validateShellState,
}
