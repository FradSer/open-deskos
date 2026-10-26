import { createHash } from 'node:crypto'
const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
const key = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  digest = /^[a-f0-9]{64}$/
const identifier = (value) => typeof value === 'string' && key.test(value)
const privateProvenance = (p) =>
  p?.ownerOnly === true &&
  p.privateData === true &&
  p.untrusted === true &&
  p.learningEligible === false
const bounded = (value) =>
  typeof value === 'string' &&
  value.trim() &&
  value.length <= 1000 &&
  !/[\x00-\x08]/.test(value)
export function validPrivateSourceSnapshot(s) {
  return (
    !!s &&
    Object.keys(s).sort().join(',') ===
      'accountKey,bindingKey,connectorId,connectorRevision,epoch,eventKey,handle,observedAt,sourceId' &&
    identifier(s.sourceId) &&
    identifier(s.connectorId) &&
    digest.test(s.connectorRevision) &&
    Number.isSafeInteger(s.epoch) &&
    s.epoch >= 0 &&
    digest.test(s.accountKey) &&
    digest.test(s.bindingKey) &&
    digest.test(s.eventKey) &&
    s.handle === s.eventKey &&
    Number.isFinite(Date.parse(s.observedAt))
  )
}
export const privateEventReceiptKey = (sourceId, eventKey) =>
  hash(['private-source-event-v1', sourceId, eventKey])
export const privateRule = (rule) =>
  !!rule && identifier(rule.privateSourceId) && digest.test(rule.privateEventKey)
/** Application-owned port. Sources are reviewed instances, never model-selected modules. */
export function createPrivateProposalSources(entries) {
  if (
    !Array.isArray(entries) ||
    entries.length > 8 ||
    new Set(entries.map((e) => e.id)).size !== entries.length
  )
    throw Error('Invalid private source selections')
  for (const e of entries)
    if (
      !identifier(e.id) ||
      !bounded(e.goal) ||
      !bounded(e.label) ||
      !e.source ||
      typeof e.source.observe !== 'function'
    )
      throw Error('Invalid private source selection')
  const lifetime = new AbortController()
  let closed = false,
    events = new Map(),
    activeSignal
  const signalFor = (signal) =>
    AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])])
  const copy = structuredClone
  const current = (s) =>
    validPrivateSourceSnapshot(s) &&
    events.get(s.sourceId + ':' + s.eventKey)?.snapshotKey === hash(s)
  const valid = (s) => {
    const e = events.get(s?.sourceId + ':' + s?.eventKey)
    try {
      return (
        !closed &&
        !activeSignal?.aborted &&
        current(s) &&
        e.entry.source.knowsReview(e.action) === true
      )
    } catch {
      return false
    }
  }
  const validate = async (s, signal = activeSignal) => {
    if (!valid(s)) return false
    const id = s.sourceId + ':' + s.eventKey,
      e = events.get(id)
    let accepted = false
    try {
      accepted =
        (await e.entry.source.validateSnapshot(copy(s), {
          signal: signalFor(signal),
        })) === true && valid(s)
    } catch {}
    if (!accepted && events.get(id) === e) events.delete(id)
    return accepted
  }
  return {
    async prepare(signal) {
      activeSignal = signal
      signal = signalFor(signal)
      const next = new Map()
      for (const entry of entries) {
        if (closed || signal?.aborted) return
        let batch
        try {
          batch = await entry.source.observe({ signal })
        } catch {
          continue
        }
        if (
          batch?.state !== 'live' ||
          !Array.isArray(batch.events) ||
          !privateProvenance(batch.provenance)
        )
          continue
        for (const event of batch.events.slice(0, 8)) {
          const s = event.sourceSnapshot,
            r = event.reading,
            a = event.reviewAction
          if (
            !privateProvenance(event.provenance) ||
            !validPrivateSourceSnapshot(s) ||
            s.sourceId !== entry.id ||
            s.eventKey !== event.eventKey ||
            !r ||
            r.state !== 'live' ||
            typeof r.id !== 'string' ||
            r.id.length > 128 ||
            !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(r.id) ||
            !r.id.startsWith('private.') ||
            !r.value ||
            typeof r.value.asOf !== 'string' ||
            a?.kind !== 'private-source-review' ||
            a.sourceId !== entry.id ||
            a.handle !== s.eventKey
          )
            continue
          const fields = Object.keys(r.value).filter((k) => k !== 'asOf')
          if (
            !fields.length ||
            fields.length > 8 ||
            !fields.every(
              (k) =>
                /^[A-Za-z][A-Za-z0-9_]*$/.test(k) &&
                ['string', 'number', 'boolean'].includes(typeof r.value[k]) &&
                (typeof r.value[k] !== 'string' || r.value[k].length <= 256) &&
                (typeof r.value[k] !== 'number' || Number.isFinite(r.value[k])),
            )
          )
            continue
          const rule = {
            id: 'private-' + privateEventReceiptKey(entry.id, s.eventKey),
            privateSourceId: entry.id,
            privateEventKey: s.eventKey,
            goal: entry.goal,
            delivery: 'immediate',
            urgent: false,
            observations: [
              { readingId: r.id, fields, measuredAtField: 'asOf' },
            ],
            actions: [
              {
                id: 'review',
                label: entry.label,
                tool: 'private_source_review',
                params: { sourceId: entry.id, handle: s.eventKey },
              },
            ],
          }
          next.set(entry.id + ':' + s.eventKey, {
            entry,
            event: copy(event),
            rule,
            snapshotKey: hash(s),
            action: {
              kind: 'private-source-review',
              sourceId: entry.id,
              handle: s.eventKey,
            },
          })
        }
      }
      if (!closed && !signal?.aborted) events = next
    },
    rules: () => (closed ? [] : [...events.values()].map((e) => copy(e.rule))),
    snapshot: (rule) =>
      copy(
        events.get(rule.privateSourceId + ':' + rule.privateEventKey)?.event
          .sourceSnapshot,
      ),
    valid,
    validate,
    async evidence(rule) {
      const e = events.get(rule.privateSourceId + ':' + rule.privateEventKey)
      if (!e || !(await validate(e.event.sourceSnapshot))) return null
      return rule.observations[0].fields.map((field) => ({
        readingId: e.event.reading.id,
        field,
        value: e.event.reading.value[field],
        state: 'live',
        measuredAt: e.event.reading.value.asOf,
        ruleId: rule.id,
      }))
    },
    canExecuteReview(params) {
      const e = params && events.get(params.sourceId + ':' + params.handle)
      return (
        !!e &&
        Object.keys(params).sort().join(',') === 'handle,sourceId' &&
        valid(e.event.sourceSnapshot)
      )
    },
    async executeReview(params, context) {
      const signal = signalFor(context?.signal)
      const e = events.get(params?.sourceId + ':' + params?.handle),
        s = context?.sourceSnapshot
      if (
        !e ||
        !current(s) ||
        !(await validate(s, signal)) ||
        context.isCurrent() !== true
      )
        throw Error('Private review expired')
      if (
        (await e.entry.source.canExecuteReview(e.action, { signal })) !==
          true ||
        !(await validate(s, signal)) ||
        context.isCurrent() !== true
      )
        throw Error('Private review unavailable')
      const r = await e.entry.source.executeReview(e.action, { signal })
      if (
        r?.reviewed !== true ||
        r.readonly !== true ||
        r.state !== 'live' ||
        r.eventKey !== s.eventKey ||
        !validPrivateSourceSnapshot(r.sourceSnapshot) ||
        hash(r.sourceSnapshot) !== hash(s) ||
        r.provenance?.ownerOnly !== true ||
        r.provenance?.privateData !== true ||
        r.provenance?.untrusted !== true ||
        r.provenance?.learningEligible !== false ||
        typeof r.value?.body !== 'string' ||
        typeof r.value?.subject !== 'string' ||
        !(await validate(s, signal)) ||
        context.isCurrent() !== true
      )
        throw Error('Private review has no current provider receipt')
      return {
        outcome: 'completed',
        text: (r.value.subject + '\n' + r.value.body).slice(0, 4096),
        receipt: {
          tool: 'private_source_review',
          sourceId: s.sourceId,
          eventKey: s.eventKey,
          readOnly: true,
          privateData: true,
        },
      }
    },
    async close() {
      if (closed) return
      closed = true
      lifetime.abort()
      events.clear()
      await Promise.allSettled(entries.map((e) => e.source.close?.()))
    },
  }
}
