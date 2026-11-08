import { randomUUID } from 'node:crypto'
import { generationKey } from './proactive-lifecycle.mjs'
import { readCalendarSnapshot, findScheduleConflict } from './schedule-conflict-calendar.mjs'

const RULE = '@schedule-conflict'
const POLL_MS = 5 * 60000
const BACKLOG_MS = 15000
const RETENTION_MS = 14 * 86400000
const MAX_UPDATES = 256
const CURSOR = /^[A-Za-z0-9_-]{1,4096}$/
const HASH = /^[a-f0-9]{64}$/
const MESSAGE = /^[A-Za-z0-9_-]{1,128}$/
const MAILBOX = /^[^\s@<>]+@[^\s@<>]+$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === keys
const checkChange = change => (exact(change, 'messageId,method,organizer,receivedAt,sequence,uid')
    || exact(change, 'endsAt,messageId,method,organizer,receivedAt,sequence,startsAt,uid'))
  && typeof change.messageId === 'string' && MESSAGE.test(change.messageId) && text(change.uid, 256) && text(change.organizer, 320) && MAILBOX.test(change.organizer)
  && change.organizer === change.organizer.toLowerCase() && Number.isSafeInteger(change.sequence) && change.sequence >= 0
  && instant(change.receivedAt) && (change.method === 'CANCEL'
    ? change.startsAt === undefined || (instant(change.startsAt) && instant(change.endsAt) && change.startsAt < change.endsAt)
    : change.method === 'REQUEST' && instant(change.startsAt) && instant(change.endsAt) && change.startsAt < change.endsAt)
const slot = ({ startsAt, endsAt }) => generationKey([startsAt, endsAt])

export const isScheduleProposal = proposal => proposal?.ruleId === RULE

export function validScheduleState(state) {
  return exact(state, 'cursor,scope,updates') && HASH.test(state.scope)
    && (state.cursor === null || (typeof state.cursor === 'string' && CURSOR.test(state.cursor)))
    && Array.isArray(state.updates) && state.updates.length <= MAX_UPDATES
    && state.updates.every(row => (exact(row, 'ambiguous,change,dismissedSlot') || exact(row, 'ambiguous,change,dismissedSlot,prior'))
      && checkChange(row.change) && (row.prior === undefined || (checkChange(row.prior) && row.prior.method === 'REQUEST'
        && row.prior.uid === row.change.uid && row.prior.organizer === row.change.organizer && row.prior.sequence < row.change.sequence))
      && typeof row.ambiguous === 'boolean' && (row.dismissedSlot === null || HASH.test(row.dismissedSlot)))
}

export function validScheduleProposal(p) {
  const [mail, calendar] = Array.isArray(p.sources) ? p.sources : []
  return isScheduleProposal(p) && p.action === null && p.confirmation === '' && !p.privateData
    && ['pending', 'ignored', 'expired'].includes(p.status) && HASH.test(p.subject) && HASH.test(p.ruleVersion)
    && instant(p.scheduleExpiresAt) && p.sources?.length === 2
    && exact(mail, 'kind,label,messageId') && mail.kind === 'gmail' && mail.label === 'Gmail'
    && typeof mail.messageId === 'string' && MESSAGE.test(mail.messageId)
    && exact(calendar, 'kind,label,readingId') && calendar.kind === 'calendar' && calendar.label === 'Calendar'
    && typeof calendar.readingId === 'string' && ID.test(calendar.readingId)
}

export function createScheduleConflict({ selection, observer, calendarRead = undefined }) {
  const accountKey = generationKey(['gmail-account', selection.gmailAccount.toLowerCase()])
  const { calendarReadingId, timeZone } = selection
  const scope = generationKey([accountKey, calendarReadingId, selection.googleCalendar ?? null])
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const displaySlot = ({ startsAt, endsAt }) => date.formatRange(new Date(startsAt), new Date(endsAt))
  const subject = change => generationKey([scope, change.uid, change.organizer])
  const currentRows = watch => watch.scheduleState
  let mailReady = false
  let calendarReadyUntil = 0
  let nextCheckAt = 0

  function reconcile(watch, state, snapshot) {
    const active = new Set()
    for (const { change, ambiguous, dismissedSlot, prior } of state.updates) {
      if (ambiguous || change.method !== 'REQUEST' || Date.parse(change.startsAt) <= watch.now()) continue
      const conflict = findScheduleConflict(change, snapshot, prior)
      if (!conflict) continue
      const key = subject(change)
      const revision = slot(change)
      active.add(key)
      const previous = watch.proposals.find(p => isScheduleProposal(p) && p.subject === key)
      if (!previous && dismissedSlot === revision) continue
      const current = previous?.ruleVersion === revision
      const status = dismissedSlot === revision ? 'ignored' : 'pending'
      const card = {
        id: current ? previous.id : randomUUID(), ruleId: RULE, subject: key, ruleVersion: revision, status,
        advice: `Gmail 提议改至 ${displaySlot(change)}，与日历的忙碌时段 ${displaySlot(conflict)} 重叠（${timeZone}）。`,
        action: null, confirmation: '', result: '', createdAt: current ? previous.createdAt : new Date(watch.now()).toISOString(),
        offered: current && previous.status !== 'expired' ? previous.offered : false,
        presented: current && previous.status !== 'expired' ? previous.presented : false,
        scheduleExpiresAt: change.startsAt,
        evidence: [
          { readingId: calendarReadingId, field: 'busyStartsAt', value: conflict.startsAt, state: 'live', measuredAt: snapshot.asOf, ruleId: RULE },
          { readingId: calendarReadingId, field: 'busyEndsAt', value: conflict.endsAt, state: 'live', measuredAt: snapshot.asOf, ruleId: RULE },
        ],
        sources: [{ kind: 'gmail', label: 'Gmail', messageId: change.messageId },
          { kind: 'calendar', label: 'Calendar', readingId: calendarReadingId }],
        ...(current && previous.snoozedUntil > watch.now() ? { snoozedUntil: previous.snoozedUntil, feedback: 'snooze' } : {}),
      }
      if (previous) {
        delete previous.snoozedUntil
        delete previous.feedback
        Object.assign(previous, card)
      }
      else if (watch.proposals.length < 64) watch.proposals.push(card)
      else {
        const replace = watch.proposals.findIndex(p => isScheduleProposal(p) && p.status !== 'pending')
        if (replace !== -1) watch.proposals.splice(replace, 1, card)
      }
    }
    for (const p of watch.proposals) if (isScheduleProposal(p) && p.status === 'pending' && !active.has(p.subject)) p.status = 'expired'
  }

  return {
    calendarReadingId,
    restore(state) { return validScheduleState(state) && state.scope === scope ? state : { scope, cursor: null, updates: [] } },
    isReady(now) { return mailReady && now < calendarReadyUntil },
    invalidateCalendar() { calendarReadyUntil = 0 },
    matches(proposal, state) { return state.updates.some(row => subject(row.change) === proposal.subject) },
    expire(proposal, now) { return Date.parse(proposal.scheduleExpiresAt) <= now },
    hasExpiry(watch) {
      const now = watch.now()
      return (calendarReadyUntil > 0 && now >= calendarReadyUntil)
        || watch.proposals.some(p => isScheduleProposal(p) && p.status === 'pending' && this.expire(p, now))
    },
    nextWake(watch) {
      const now = watch.now()
      return Math.min(nextCheckAt || Infinity, this.isReady(now) ? calendarReadyUntil : Infinity,
        ...watch.proposals.filter(p => isScheduleProposal(p) && p.status === 'pending')
          .flatMap(p => [Date.parse(p.scheduleExpiresAt), ...(this.isReady(now) && p.snoozedUntil ? [p.snoozedUntil] : [])]))
    },
    dismiss(watch, p) {
      const row = currentRows(watch).updates.find(row => subject(row.change) === p.subject)
      if (row) row.dismissedSlot = p.ruleVersion
      p.status = 'ignored'
    },
    async refresh(watch, trigger) {
      const state = currentRows(watch)
      const now = watch.now()
      const readMail = trigger.kind === 'heartbeat' || !nextCheckAt || nextCheckAt <= now
      const shouldReadCalendar = readMail || trigger.readingIds.includes(calendarReadingId)
        || (trigger.kind === 'schedule_due' && !this.isReady(now))
        || watch.proposals.some(p => isScheduleProposal(p) && p.status === 'pending' && p.snoozedUntil && p.snoozedUntil <= now && !p.offered)
      if (!shouldReadCalendar) return
      const signal = watch.controller.signal
      const revision = watch.sourceRevisions.get(calendarReadingId)
      if (readMail) {
        nextCheckAt = now + POLL_MS
        try {
          const { value } = await observer.run(async ({ call, schema }) => {
            if (schema('gmail_schedule_changes')?.properties?.expectedAccountKey?.pattern !== '^[a-f0-9]{64}$') throw Error('Gmail account pin unavailable')
            return call('gmail_schedule_changes', { expectedAccountKey: accountKey, ...(state.cursor ? { cursor: state.cursor } : {}) })
          }, { signal })
          if (signal.aborted) return
          const page = value?.structuredContent
          if (value?.isError || page?.untrusted !== true || typeof page.complete !== 'boolean' || typeof page.cursor !== 'string'
              || !CURSOR.test(page.cursor) || !Array.isArray(page.events) || page.events.length > 64 || !page.events.every(checkChange)) throw Error('Invalid Gmail changes')
          const updates = new Map(state.updates.filter(({ change }) => Date.parse(change.receivedAt) >= now - RETENTION_MS)
            .map(row => [subject(row.change), structuredClone(row)]))
          for (const change of page.events) {
            if (Date.parse(change.receivedAt) < now - RETENTION_MS || Date.parse(change.receivedAt) > watch.now()) continue
            const key = subject(change)
            const previous = updates.get(key)
            if (!previous || change.sequence > previous.change.sequence || (change.sequence === previous.change.sequence
                && change.method === 'CANCEL' && previous.change.method !== 'CANCEL')) {
              const prior = previous?.ambiguous ? undefined : previous?.change.method === 'REQUEST' && previous.change.sequence < change.sequence
                ? previous.change : previous?.prior
              updates.set(key, { change, ambiguous: false, dismissedSlot: previous?.dismissedSlot ?? null, ...(prior ? { prior } : {}) })
            } else if (previous && change.method === 'REQUEST' && change.sequence < previous.change.sequence
                && (!previous.prior || change.sequence > previous.prior.sequence)) previous.prior = change
            else if (previous?.prior && change.method === 'REQUEST' && change.sequence === previous.prior.sequence
                && slot(change) !== slot(previous.prior)) previous.ambiguous = true
            else if (change.sequence === previous.change.sequence && change.method === 'REQUEST'
                && previous.change.method === 'REQUEST' && slot(change) !== slot(previous.change)) previous.ambiguous = true
          }
          if (updates.size > MAX_UPDATES) throw Error('Too many current Gmail changes')
          state.updates = [...updates.values()]
          state.cursor = page.cursor
          mailReady = page.complete
          if (!page.complete) {
            nextCheckAt = now + BACKLOG_MS
            return
          }
        } catch { mailReady = false; return }
      } else if (!mailReady) return
      const snapshot = await readCalendarSnapshot(calendarRead ?? watch.read, calendarReadingId, watch.now, signal)
      if (signal.aborted) return
      calendarReadyUntil = snapshot && watch.sourceRevisions.get(calendarReadingId) === revision
        ? Date.parse(snapshot.asOf) + POLL_MS : 0
      if (this.isReady(watch.now())) reconcile(watch, state, snapshot)
    },
    close: () => observer.close(),
  }
}
