'use strict'

const { requestLocalControl } = require('./local-control-client')
const { parseHome, READING_ID } = require('./odk-data-registry')
const PRODUCER_INTERFACE = 'odk:producer-projection/v1'

/** Retain only service declarations. Every value is read from its current owner. */
function createPersonalAgentReadingSource({ request = requestLocalControl, signal, ...connection } = {}) {
  const lifetime = new AbortController()
  const requestSignal = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
  let declarations = []
  let closed = false
  let refreshing = null
  const pending = new Set()
  const current = () => !closed && !requestSignal.aborted
  async function ask(command, readingId) {
    if (!current()) throw Error('resident readings unavailable')
    const result = await request({ ...connection, signal: requestSignal, label: 'resident source projection',
      request: { command, interface: PRODUCER_INTERFACE, ...(readingId ? { readingId } : {}) }, maxResponseBytes: 256 * 1024 })
    if (!current() || result?.interface !== PRODUCER_INTERFACE) throw Error('resident readings unavailable')
    return result
  }
  function own(operation) {
    const result = Promise.resolve().then(operation)
    pending.add(result)
    void result.finally(() => pending.delete(result)).catch(() => {})
    return result
  }
  function parse(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some(key => !['id', 'label', 'kind', 'home'].includes(key))
      || typeof entry.id !== 'string' || !READING_ID.test(entry.id) || entry.kind !== 'service'
      || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 128 || /[\x00-\x1f]/.test(entry.label)) throw Error('invalid resident reading declaration')
    const home = parseHome(entry.home)
    if (!home || home.fields.some(field => ['__proto__', 'prototype', 'constructor'].includes(field))) throw Error('invalid resident reading fields')
    return { id: entry.id, label: entry.label, kind: 'service', home }
  }
  async function read(entry) {
    const result = await ask('producer_read', entry.id)
    const reading = result.reading
    if (!declarations.includes(entry) || reading?.id !== entry.id || !['live', 'stale', 'unavailable', 'unconfigured', 'error'].includes(reading.state)
      || (reading.value !== null && (typeof reading.value !== 'object' || Array.isArray(reading.value)))
      || Buffer.byteLength(JSON.stringify(reading)) > 65536
      || (reading.value && Object.keys(reading.value).some(key => !entry.home.fields.includes(key)))) throw Error('invalid resident reading')
    return { state: reading.state, value: structuredClone(reading.value), ...(Number.isFinite(reading.updatedAt) ? { updatedAt: reading.updatedAt } : {}) }
  }
  return {
    readings: () => current() ? declarations.map(entry => ({ ...entry, read: () => own(() => read(entry)) })) : [],
    refresh() {
      if (!current()) return Promise.resolve()
      if (refreshing) return refreshing
      refreshing = own(async () => {
        try {
          const response = await ask('producer_list')
          if (!Array.isArray(response.readings) || response.readings.length > 2048) throw Error('invalid producer inventory')
          const counts = new Map()
          for (const entry of response.readings) if (typeof entry?.id === 'string' && READING_ID.test(entry.id)) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1)
          const next = []
          for (const entry of response.readings) {
            if (counts.get(entry?.id) !== 1) continue
            try { next.push(parse(entry)) } catch { /* An incompatible declaration cannot remove healthy siblings. */ }
          }
          if (current()) declarations = next.map(entry => declarations.find(previous => previous.id === entry.id
            && JSON.stringify(previous) === JSON.stringify(entry)) || entry)
        } catch { if (current()) declarations = [] }
      }).finally(() => { refreshing = null })
      return refreshing
    },
    async close() { closed = true; lifetime.abort(); declarations = []; await Promise.allSettled([...pending]) },
  }
}

module.exports = { createPersonalAgentReadingSource, PRODUCER_INTERFACE }
