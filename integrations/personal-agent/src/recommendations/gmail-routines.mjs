import { createHash } from 'node:crypto'
import { createIntervalClock } from './routine-schedule.mjs'
import { validGmailBinding } from './intents.mjs'
import { PRIVATE_SOURCE_PROVENANCE } from './private-mcp-observer.mjs'
import { createGmailRecommendationSource, gmailAccountKey, gmailMessageKey, gmailPayload, requireGmailAccountPin } from './gmail-recommendation-source.mjs'

const mailId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const historyId = value => typeof value === 'string' && /^\d{1,32}$/.test(value)
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/
const prefix = 'gmail-routine-'
export const isGmailRoutineSource = id => typeof id === 'string' && id.startsWith(prefix) && uuid.test(id.slice(prefix.length))
export const GMAIL_ROUTINE_SUGGESTION_AGE_MS = 24 * 60 * 60 * 1000
const maxReceipts = 1024
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000
const slotKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}:\d{4}$/.test(value)
const keyFor = gmail => createHash('sha256').update(JSON.stringify([gmail.accountKey, gmail.labelId, gmail.historyId, gmail.since])).digest('hex')
const tools = ['gmail_status', 'gmail_read', 'gmail_label_changes']

function validCursor(cursor) {
  return cursor && typeof cursor === 'object' && !Array.isArray(cursor)
    && Object.keys(cursor).every(key => ['historyId', 'pageToken', 'offset', 'recovering'].includes(key))
    && historyId(cursor.historyId)
    && (cursor.pageToken === undefined || (typeof cursor.pageToken === 'string' && cursor.pageToken.length > 0
      && cursor.pageToken.length <= 2048 && !/[\x00-\x1f\x7f]/.test(cursor.pageToken)))
    && (cursor.offset === undefined || (Number.isSafeInteger(cursor.offset) && cursor.offset > 0))
    && (cursor.recovering === undefined || cursor.recovering === true)
}

export function validGmailRoutineState(state) {
  return state && typeof state === 'object' && !Array.isArray(state) && Object.keys(state).length <= 16
    && Object.entries(state).every(([id, entry]) => uuid.test(id) && entry
      && Object.keys(entry).every(key => ['binding', 'cursor', 'slot', 'since', 'seen', 'pending'].includes(key))
      && hex(entry.binding) && validCursor(entry.cursor) && (entry.slot === undefined || slotKey(entry.slot))
      && timestamp(entry.since) && entry.seen && typeof entry.seen === 'object' && !Array.isArray(entry.seen)
      && Object.keys(entry.seen).length <= maxReceipts
      && Object.entries(entry.seen).every(([key, at]) => hex(key) && timestamp(at) && at >= entry.since)
      && (entry.pending === undefined || (entry.pending && typeof entry.pending === 'object' && !Array.isArray(entry.pending)
        && Object.keys(entry.pending).length <= 64 && Object.entries(entry.pending).every(([key, reference]) => hex(key)
          && reference && Object.keys(reference).sort().join(',') === 'messageId,revision' && mailId(reference.messageId)
          && Number.isSafeInteger(reference.revision) && reference.revision > 0))))
}

export function pruneGmailRoutineBindings(state, proposals) {
  const live = new Set(proposals.filter(p => p.status === 'pending' && isGmailRoutineSource(p.privateSourceId))
    .map(p => p.privateSourceId + ':' + p.privateEventKey))
  for (const [id, entry] of Object.entries(state)) {
    if (entry.pending) entry.pending = Object.fromEntries(Object.entries(entry.pending)
      .filter(([key]) => live.has(prefix + id + ':' + key)))
  }
}

/** Gmail discovery is a scheduled private source. A page commits with its model outcomes in Watch state. */
export function createGmailRoutineSources({ store, makeObserver, clockNow = Date.now }) {
  const binder = makeObserver(['gmail_status', 'gmail_resolve_label'])
  const instances = new Map()
  const selected = () => {
    try { return store.list().filter(entry => entry.gmail) } catch { return [] }
  }
  function create(entry, watch) {
    const { gmail } = entry
    const binding = keyFor(gmail)
    const id = prefix + entry.id
    const observer = makeObserver(tools)
    const clock = createIntervalClock(entry.schedule, entry.timeZone)
    let attempted, page, restoring, events = new Map(), ready = new Set()
    const checkpoint = () => {
      const old = watch.gmailRoutineState[entry.id]
      if (old?.binding === binding) return old
      return { binding, cursor: { historyId: gmail.historyId }, since: gmail.since, seen: {}, pending: {} }
    }
    const current = () => selected().some(item => item.id === entry.id && item.revision === entry.revision && item.enabled)
    const source = createGmailRecommendationSource({ observer, sourceId: id, now: watch.now, maxMessages: 8, scope: {
      accountKey: gmail.accountKey, labelId: gmail.labelId,
      async select({ call }) {
        const state = checkpoint()
        let cursor = state.cursor
        const ids = new Set()
        for (let pages = 0; pages < 4; pages++) {
          const found = gmailPayload(await call('gmail_label_changes', {
            labelId: gmail.labelId, expectedAccountKey: gmail.accountKey, since: state.since, cursor,
          }))
          if (found.untrusted !== true || !validCursor(found.cursor) || typeof found.complete !== 'boolean'
            || BigInt(found.cursor.historyId) < BigInt(cursor.historyId)
            || !Array.isArray(found.ids) || found.ids.length > 4 || !found.ids.every(mailId)) throw Error('Invalid Gmail changes')
          const next = new Set([...ids, ...found.ids.filter(id => !Object.hasOwn(state.seen, gmailMessageKey(gmail.accountKey, id)))])
          if (next.size > 4) break
          for (const id of next) ids.add(id)
          cursor = found.cursor
          if (found.complete || ids.size === 4) break
        }
        page = cursor
        return { since: state.since, found: { untrusted: true,
          messages: [...new Set([...ids, ...restoring.values()].map(item => typeof item === 'string' ? item : item.messageId))]
            .map(id => ({ id })) } }
      },
    } })
    function commit(seen, pending = checkpoint().pending ?? {}) {
      const state = checkpoint()
      let since = state.since
      const keys = Object.keys(seen)
      if (keys.length > maxReceipts) {
        // Retire the oldest arrival range and reject it on later scans.
        const oldest = Object.values(seen).sort((a, b) => a - b)
        since = oldest[keys.length - maxReceipts - 1] + 1
        seen = Object.fromEntries(Object.entries(seen).filter(([, at]) => at >= since))
      }
      watch.gmailRoutineState[entry.id] = { binding, since, seen, pending,
        cursor: ready.size ? state.cursor : page, ...(ready.size ? (state.slot ? { slot: state.slot } : {}) : { slot: attempted }) }
    }
    function restore(batch) {
      const pending = { ...checkpoint().pending }
      for (const [key] of restoring) {
        const proposal = watch.proposals.find(p => p.status === 'pending' && p.privateSourceId === id && p.privateEventKey === key)
        const snapshot = batch.events.find(event => event.eventKey === key)?.sourceSnapshot
        if (proposal && snapshot?.bindingKey === proposal.sourceSnapshot.bindingKey
          && snapshot.connectorRevision === proposal.sourceSnapshot.connectorRevision && snapshot.accountKey === gmail.accountKey) {
          proposal.sourceSnapshot = snapshot
        } else {
          if (proposal) proposal.status = 'expired'
          delete pending[key]
        }
      }
      return pending
    }
    const last = () => attempted ?? checkpoint().slot ?? ''
    return {
      revision: entry.revision,
      nextWake(now) {
        const slot = clock.slot(now)
        return slot && slot > last() ? now : clock.nextWake(now)
      },
      source,
      selection: {
        id, scheduled: true, current,
        goal: entry.wish + '\nCondition: ' + entry.condition
          + '\nOnly suggest when this particular new email explicitly needs the owner to act. Return zero suggestions for informational mail or insufficient evidence. Give one practical next step.',
        label: '查看邮件', replyLabel: '准备回复',
        unseen: event => ready.has(event.eventKey),
        consume(event, hasProposal) {
          if (!current() || !ready.delete(event.eventKey)) return
          const state = checkpoint()
          const pending = { ...state.pending }
          if (hasProposal) pending[event.eventKey] = { messageId: source.messageId(event.eventKey), revision: entry.revision }
          commit({ ...state.seen, [event.eventKey]: Date.parse(event.reading.value.receivedAt) }, pending)
        },
        source: {
          ...source,
          async observe({ signal }) {
            const slot = clock.slot(clockNow())
            ready = new Set()
            if (slot && slot > last()) {
              attempted = slot
              const state = checkpoint()
              restoring = new Map(Object.entries(state.pending ?? {}).filter(([key, ref]) => ref.revision === entry.revision && !events.has(key)).slice(0, 4))
              const batch = await source.observe({ signal })
              if (!current() || signal?.aborted) return
              if (batch.state !== 'live') {
                events.clear()
                if (Object.keys(state.pending ?? {}).length) watch.gmailRoutineState[entry.id] = { ...state, pending: {} }
                return batch
              }
              for (const event of batch.events) {
                events.set(event.eventKey, event)
                if (!restoring.has(event.eventKey)) ready.add(event.eventKey)
              }
              const pending = restore(batch)
              if (!ready.size) commit(state.seen, pending)
              else watch.gmailRoutineState[entry.id] = { ...state, pending }
              events = new Map([...events].slice(-64))
            }
            return { state: 'live', events: [...events.values()], provenance: PRIVATE_SOURCE_PROVENANCE }
          },
        },
      },
    }
  }
  function active(watch) {
    const entries = selected()
    const ids = new Set(entries.filter(entry => entry.enabled).map(entry => entry.id))
    for (const [id, instance] of instances) if (!ids.has(id)) {
      instances.delete(id)
      void instance.source.close().catch(() => {})
    }
    for (const entry of entries.filter(entry => entry.enabled)) {
      const previous = instances.get(entry.id)
      if (previous?.revision === entry.revision) continue
      if (previous) void previous.source.close().catch(() => {})
      instances.set(entry.id, create(entry, watch))
    }
    return [...instances.values()]
  }
  return {
    async bind(label, previous, signal) {
      const since = Math.floor(Date.now() / 1000) * 1000
      const result = await binder.run(async context => {
        requireGmailAccountPin(context, ['gmail_resolve_label'])
        const accountKey = gmailAccountKey(gmailPayload(await context.call('gmail_status')))
        const resolved = gmailPayload(await context.call('gmail_resolve_label', { label, expectedAccountKey: accountKey }))
        if (resolved.state === 'missing') return undefined
        const binding = { label, labelId: resolved.labelId, accountKey, historyId: resolved.historyId, since }
        if (resolved.untrusted !== true || resolved.label !== label || !validGmailBinding(binding)) throw Error('Could not verify the Gmail label')
        return previous?.accountKey === accountKey && previous?.labelId === binding.labelId
          ? { ...previous, label } : binding
      }, { signal })
      if (!result.value) throw Error('The connected Gmail account does not have that exact label')
      return result.value
    },
    entries(watch) { return active(watch).map(instance => instance.selection) },
    canRestore(proposal, watch) {
      if (!isGmailRoutineSource(proposal.privateSourceId)) return false
      const id = proposal.privateSourceId.slice(prefix.length)
      const state = watch.gmailRoutineState[id]
      const reference = state?.pending?.[proposal.privateEventKey]
      if (!reference) return false
      return selected().some(entry => entry.enabled && entry.id === id && entry.revision === reference.revision && keyFor(entry.gmail) === state.binding)
    },
    nextWake(watch) {
      const now = clockNow()
      return watch.now() + Math.min(...active(watch).map(instance => instance.nextWake(now) - now))
    },
    async close() {
      await Promise.allSettled([binder.close(), ...[...instances.values()].map(instance => instance.source.close())])
      instances.clear()
    },
  }
}
