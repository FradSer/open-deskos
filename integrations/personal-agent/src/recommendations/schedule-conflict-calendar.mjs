const READING_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
const MAX_AGE_MS = 5 * 60 * 1000
export const MAX_CALENDAR_EVENTS = 128

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const bounded = (value, length) => typeof value === 'string' && value.length > 0 && value.length <= length
  && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)

export function calendarInstant(value) {
  const match = typeof value === 'string' ? TIMESTAMP.exec(value) : null
  if (!match) return undefined
  const local = match[1] + '.' + (match[2] ?? '').padEnd(3, '0')
  const asUtc = Date.parse(local + 'Z')
  const instant = Date.parse(value)
  if (!Number.isFinite(instant) || !Number.isFinite(asUtc) || new Date(asUtc).toISOString() !== local + 'Z') return undefined
  const iso = new Date(instant).toISOString()
  return iso.length === 24 ? iso : undefined
}

function meeting(value) {
  if (!record(value) || !bounded(value.uid, 255) || !bounded(value.organizer, 320)
    || !/^[^\s@<>]+@[^\s@<>]+$/.test(value.organizer)
    || !Number.isInteger(value.sequence) || value.sequence < 0 || value.sequence > 2147483647) return undefined
  const startsAt = calendarInstant(value.startsAt)
  const endsAt = calendarInstant(value.endsAt)
  if (!startsAt || !endsAt || startsAt >= endsAt) return undefined
  return { uid: value.uid, organizer: value.organizer.toLowerCase(), sequence: value.sequence, startsAt, endsAt }
}

const meetingKey = event => JSON.stringify([event.uid, event.organizer])

/** Read a single owner-selected, complete Calendar snapshot. */
export async function readCalendarSnapshot(read, readingId, now, signal) {
  if (typeof read !== 'function' || typeof readingId !== 'string' || !READING_ID.test(readingId) || signal?.aborted) return undefined
  try {
    const reading = await read(readingId, signal)
    if (signal?.aborted || reading?.id !== readingId || reading.state !== 'live' || reading.untrusted === true || reading.kind === 'package') return undefined
    const value = reading.value
    if (!record(value) || Object.keys(value).some(key => !['asOf', 'coverageStart', 'coverageEnd', 'events'].includes(key))
      || !Array.isArray(value.events) || value.events.length > MAX_CALENDAR_EVENTS) return undefined
    const asOf = calendarInstant(value.asOf)
    const coverageStart = calendarInstant(value.coverageStart)
    const coverageEnd = calendarInstant(value.coverageEnd)
    const currentTime = typeof now === 'function' ? now() : now
    const age = currentTime - Date.parse(asOf)
    if (!Number.isFinite(currentTime) || !asOf || !coverageStart || !coverageEnd || coverageStart >= coverageEnd
      || age < 0 || age > MAX_AGE_MS) return undefined

    const events = []
    const known = new Map()
    for (const event of value.events) {
      const parsed = meeting(event)
      if (!parsed || typeof event.busy !== 'boolean' || (event.recurring !== undefined && typeof event.recurring !== 'boolean')
        || Object.keys(event).some(key => !['uid', 'organizer', 'sequence', 'startsAt', 'endsAt', 'busy', 'recurring'].includes(key))) return undefined
      const key = meetingKey(parsed)
      const recurring = event.recurring === true
      if (known.has(key) && !(known.get(key) && recurring)) return undefined
      known.set(key, recurring)
      events.push({ ...parsed, busy: event.busy, ...(recurring ? { recurring: true } : {}) })
    }
    return { asOf, coverageStart, coverageEnd, events }
  } catch {
    return undefined
  }
}

/** A recommendation needs an authoritative old time and a separate overlapping busy event. */
export function findScheduleConflict(change, snapshot, previousRequest = undefined) {
  const update = meeting(change)
  if (!update || !snapshot || (change.method !== undefined && change.method !== 'REQUEST')) return undefined
  const sameMeeting = event => event.uid === update.uid && event.organizer === update.organizer
  const current = snapshot.events.find(event => !event.recurring && sameMeeting(event))
  if (!current || current.sequence > update.sequence) return undefined
  const sameTime = event => update.startsAt === event.startsAt && update.endsAt === event.endsAt
  // A provider can apply the new slot before the Watch reads the calendar.
  const prior = current.sequence < update.sequence ? current
    : sameTime(current) && previousRequest?.method === 'REQUEST' ? meeting(previousRequest) : undefined
  if (!prior || !sameMeeting(prior) || update.sequence <= prior.sequence || sameTime(prior)) return undefined
  const covered = event => event.startsAt >= snapshot.coverageStart && event.endsAt <= snapshot.coverageEnd
  if (!covered(prior) || !covered(update)) return undefined
  return snapshot.events.find(event => event.busy && !sameMeeting(event)
    && event.startsAt < update.endsAt && event.endsAt > update.startsAt)
}
