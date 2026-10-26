import { createHash } from 'node:crypto'
import { PRIVATE_SOURCE_PROVENANCE } from './private-mcp-observer.mjs'

export const GMAIL_OBSERVATION_FIELDS = Object.freeze(['subject', 'body0', 'body1', 'body2', 'body3', 'bodyTruncated', 'receivedAt'])
export const GMAIL_REVIEW_KIND = 'private-source-review'
const unavailable = () => Error('Private source is unavailable or changed.')
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const clean = value => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
function bounded(value, limit) {
  let result = ''
  for (const character of clean(value)) { if (result.length + character.length > limit) break; result += character }
  return result
}
function chunks(body) {
  let remaining = clean(body)
  const result = []
  for (let index = 0; index < 4; index++) { const part = bounded(remaining, 256); result.push(part); remaining = remaining.slice(part.length) }
  return { result, truncated: remaining.length > 0 }
}
function semanticReading(value) {
  const { result: body, truncated } = chunks(value.body)
  return { subject: bounded(value.subject, 160), body0: body[0], body1: body[1], body2: body[2], body3: body[3],
    // This conservative legacy field also marks a shortened subject.
    bodyTruncated: value.truncated || truncated || value.subject.length > 160, receivedAt: value.receivedAt }
}
const semanticBindingKey = value => digest(['gmail-semantic-binding', value])

function account(value) {
  if (!object(value) || value.state !== 'connected' || typeof value.emailAddress !== 'string' || value.emailAddress.length > 320
      || !/^[^\s@]+@[^\s@]+$/.test(value.emailAddress)) throw unavailable()
  return digest(['gmail-account', value.emailAddress.toLowerCase()])
}
function payload(result) {
  if (!object(result) || result.isError || !object(result.structuredContent)) throw unavailable()
  return result.structuredContent
}
function requireAccountPin(context) {
  for (const name of ['gmail_search', 'gmail_read']) {
    const property = context.schema(name)?.properties?.expectedAccountKey
    if (property?.type !== 'string' || property.pattern !== '^[a-f0-9]{64}$') throw unavailable()
  }
}
function message(value, expectedId) {
  if (!object(value) || value.id !== expectedId || value.untrusted !== true || typeof value.body !== 'string' || value.body.length > 16000
      || typeof value.subject !== 'string' || value.subject.length > 1024 || typeof value.truncated !== 'boolean') throw unavailable()
  return { subject: clean(value.subject), body: clean(value.body), truncated: value.truncated,
    receivedAt: typeof value.internalDate === 'string' && /^\d{1,16}$/.test(value.internalDate)
      && Number.isFinite(Number(value.internalDate)) && Number(value.internalDate) <= 8640000000000000 ? new Date(Number(value.internalDate)).toISOString() : 'unknown' }
}

/** Private observations never register a public producer port or alter Gmail.
 * The caller selects this source through an owner-controlled recommendation goal.
 */
export function createGmailRecommendationSource({ observer, now = Date.now, query = 'in:inbox', maxMessages = 1 }) {
  if (typeof query !== 'string' || !query.trim() || query.length > 1024 || /[\x00-\x1f]/.test(query)
      || !Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 8) throw unavailable()
  let accountKey, records = new Map()
  const clear = () => { records.clear() }
  function acceptAccount(value) {
    const next = account(value)
    if (accountKey !== next) { clear(); accountKey = next }
    return next
  }
  const actionRecord = action => object(action) && Object.keys(action).length === 3 && Object.keys(action).every(key => ['kind', 'sourceId', 'handle'].includes(key))
    && action.kind === GMAIL_REVIEW_KIND && action.sourceId === 'gmail' && typeof action.handle === 'string' && /^[a-f0-9]{64}$/.test(action.handle)
    ? records.get(action.handle) : undefined
  function sameSnapshot(snapshot) {
    if (!object(snapshot) || !observer.enabled || snapshot.sourceId !== 'gmail' || snapshot.connectorId !== 'gmail'
        || snapshot.accountKey !== accountKey || snapshot.epoch !== observer.epoch) return false
    const row = records.get(snapshot.handle)
    return !!row && Object.keys(row.sourceSnapshot).length === Object.keys(snapshot).length
      && Object.entries(row.sourceSnapshot).every(([key, value]) => snapshot[key] === value)
  }
  function event(row, value) {
    const asOf = new Date(now()).toISOString()
    const semantic = semanticReading(value)
    const bindingKey = semanticBindingKey(semantic)
    const previous = records.get(row.eventKey)
    const unchanged = previous && previous.accountKey === row.accountKey && previous.connectorRevision === row.connectorRevision
      && previous.epoch === row.epoch && previous.sourceSnapshot.bindingKey === bindingKey
    // observedAt identifies the first host binding, not the latest provider read.
    const observedAt = unchanged ? previous.sourceSnapshot.observedAt
      : asOf
    const sourceSnapshot = Object.freeze({ sourceId: 'gmail', connectorId: 'gmail', connectorRevision: row.connectorRevision,
      epoch: row.epoch, accountKey: row.accountKey, eventKey: row.eventKey, handle: row.eventKey, bindingKey, observedAt })
    return { eventKey: row.eventKey, provenance: PRIVATE_SOURCE_PROVENANCE, sourceSnapshot,
      reading: { id: 'private.gmail.' + row.eventKey, state: 'live', value: { ...semantic, asOf } },
      reviewAction: Object.freeze({ kind: GMAIL_REVIEW_KIND, sourceId: 'gmail', handle: row.eventKey }) }
  }
  return {
    sourceId: 'gmail',
    get enabled() { return observer.enabled },
    async observe({ signal = undefined } = {}) {
      if (!observer.enabled) { clear(); return { state: 'unavailable', events: [], provenance: PRIVATE_SOURCE_PROVENANCE } }
      try {
        const observed = await observer.run(async context => {
          requireAccountPin(context)
          const selectedAccount = acceptAccount(payload(await context.call('gmail_status')))
          const found = payload(await context.call('gmail_search', { query, maxResults: maxMessages, expectedAccountKey: selectedAccount }))
          if (found.untrusted !== true || !Array.isArray(found.messages) || found.messages.length > maxMessages
              || new Set(found.messages.map(item => item?.id)).size !== found.messages.length
              || !found.messages.every(item => object(item) && typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item.id))) throw unavailable()
          const rows = []
          for (const item of found.messages) {
            const value = message(payload(await context.call('gmail_read', { id: item.id, expectedAccountKey: selectedAccount })), item.id)
            const row = { messageId: item.id, accountKey: selectedAccount, eventKey: digest(['gmail-message', selectedAccount, item.id]),
              connectorRevision: context.connectorRevision, epoch: context.epoch }
            rows.push({ row, value })
          }
          if (account(payload(await context.call('gmail_status'))) !== selectedAccount) { clear(); accountKey = undefined; throw unavailable() }
          return rows
        }, { signal })
        const next = new Map()
        const events = observed.value.map(({ row, value }) => { const selected = event(row, value); next.set(row.eventKey, { ...row, sourceSnapshot: selected.sourceSnapshot }); return selected })
        records = next
        return { state: 'live', events, provenance: PRIVATE_SOURCE_PROVENANCE }
      } catch { clear(); return { state: 'unavailable', events: [], provenance: PRIVATE_SOURCE_PROVENANCE } }
    },
    async validateSnapshot(snapshot, { signal = undefined } = {}) {
      if (!sameSnapshot(snapshot) || !await observer.isCurrent(snapshot, { signal })) { clear(); return false }
      try {
        const selected = await observer.run(async ({ call }) => account(payload(await call('gmail_status'))), { signal })
        if (selected.value !== accountKey) { clear(); accountKey = selected.value; return false }
        return sameSnapshot(snapshot) && selected.connectorRevision === snapshot.connectorRevision && selected.epoch === snapshot.epoch
      } catch { clear(); return false }
    },
    // Synchronous routing only. Execution still revalidates account, policy and revision.
    knowsReview(action) { const row = actionRecord(action); return !!row && sameSnapshot(row.sourceSnapshot) },
    async canExecuteReview(action, { signal = undefined } = {}) { const row = actionRecord(action); return !!row && this.knowsReview(action) && await this.validateSnapshot(row.sourceSnapshot, { signal }) },
    async executeReview(action, { signal = undefined } = {}) {
      const row = actionRecord(action)
      if (!row || !sameSnapshot(row.sourceSnapshot)) throw unavailable()
      try {
        const reviewed = await observer.run(async context => {
          requireAccountPin(context)
          if (context.connectorRevision !== row.connectorRevision || context.epoch !== row.epoch) throw unavailable()
          if (acceptAccount(payload(await context.call('gmail_status'))) !== row.accountKey) throw unavailable()
          const value = message(payload(await context.call('gmail_read', { id: row.messageId, expectedAccountKey: row.accountKey })), row.messageId)
          if (semanticBindingKey(semanticReading(value)) !== row.sourceSnapshot.bindingKey) throw unavailable()
          if (account(payload(await context.call('gmail_status'))) !== row.accountKey) { clear(); accountKey = undefined; throw unavailable() }
          return value
        }, { signal })
        if (!sameSnapshot(row.sourceSnapshot)) throw unavailable()
        return { state: 'live', readonly: true, reviewed: true, eventKey: row.eventKey, value: reviewed.value,
          sourceSnapshot: row.sourceSnapshot, provenance: PRIVATE_SOURCE_PROVENANCE }
      } catch { clear(); throw unavailable() }
    },
    async setEnabled(value) { clear(); await observer.setEnabled(value) },
    async invalidate() { clear(); await observer.invalidate() },
    async close() { clear(); await observer.close() },
  }
}
