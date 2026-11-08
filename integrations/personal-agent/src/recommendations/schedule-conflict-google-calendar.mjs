import { readProactiveFile } from '../proactive-private.mjs'
import { calendarInstant, MAX_CALENDAR_EVENTS, readCalendarSnapshot } from './schedule-conflict-calendar.mjs'

export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const EVENTS_ROOT = 'https://www.googleapis.com/calendar/v3/calendars/'
const DAY_MS = 86400000
const MAX_PAGES = 8
const unavailable = () => Error('Google Calendar is unavailable.')
const tokenText = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\s\u0000-\u001f\u007f]/.test(value)

function credentials(path) {
  const value = JSON.parse(readProactiveFile(path, 32768))
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'clientId,clientSecret,refreshToken,schemaVersion,scope'
    || value.schemaVersion !== 1 || value.scope !== GOOGLE_CALENDAR_SCOPE
    || !tokenText(value.clientId, 255) || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.clientId)
    || !tokenText(value.clientSecret, 8192) || !tokenText(value.refreshToken, 8192)) throw unavailable()
  return value
}

async function json(response, limit) {
  if (!response.ok || !response.body) throw unavailable()
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw unavailable()
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => {})
  }
}

/** Convert date-only calendar boundaries in the calendar's timezone, including DST. */
function midnight(date, zone) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  const local = calendarInstant(date + 'T00:00:00Z')
  if (!local) return undefined
  const expected = Date.parse(local)
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  function localTime(instant) {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, part.value]))
    return Date.parse(parts.year.padStart(4, '0') + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute + ':' + parts.second + 'Z')
  }
  // Check the offsets on both sides of a transition at local midnight.
  const possibilities = [expected - DAY_MS, expected, expected + DAY_MS].map(instant => expected - (localTime(instant) - instant))
  const matching = possibilities.filter(instant => localTime(instant) === expected)
  return matching.length ? new Date(Math.min(...matching)).toISOString() : undefined
}

function eventReading(event, zone) {
  if (event?.status === 'cancelled') return undefined
  if (!event || !['confirmed', 'tentative'].includes(event.status) || (event.transparency !== undefined && !['opaque', 'transparent'].includes(event.transparency))
    || (event.attendees !== undefined && !Array.isArray(event.attendees))) throw unavailable()
  const allDay = event.start?.date !== undefined || event.end?.date !== undefined
  if (allDay && (event.start?.dateTime !== undefined || event.end?.dateTime !== undefined)) throw unavailable()
  const startsAt = allDay ? midnight(event.start?.date, zone) : calendarInstant(event.start?.dateTime)
  const endsAt = allDay ? midnight(event.end?.date, zone) : calendarInstant(event.end?.dateTime)
  if (!startsAt || !endsAt || startsAt >= endsAt) throw unavailable()
  const declined = event.attendees?.some(person => person?.self === true && person.responseStatus === 'declined')
  const recurring = event.recurringEventId !== undefined
  if (recurring && !tokenText(event.recurringEventId, 1024)) throw unavailable()
  return { uid: event.iCalUID, organizer: event.organizer?.email, sequence: event.sequence === undefined ? 0 : event.sequence, startsAt, endsAt,
    busy: event.transparency !== 'transparent' && !declined, ...(recurring ? { recurring: true } : {}) }
}

/** Read one explicitly selected calendar using a private, offline, read-only grant. */
export function createGoogleCalendarReader({ calendarId, credentialsFile, readingId, fetchImpl = globalThis.fetch, now = Date.now }) {
  // Avoid "primary", which could refer to another calendar after credential replacement.
  if (!tokenText(calendarId, 320) || !/^[^@/\\?#]+@[^@/\\?#]+$/.test(calendarId)) throw unavailable()
  return async (id, signal = undefined) => {
    if (id !== readingId || signal?.aborted) return undefined
    try {
      const grant = credentials(credentialsFile)
      const deadline = AbortSignal.timeout(15000)
      const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
      const authorization = await json(await fetchImpl(TOKEN_URL, {
        method: 'POST', redirect: 'error', signal: requestSignal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: grant.clientId, client_secret: grant.clientSecret, refresh_token: grant.refreshToken }),
      }), 32768)
      if (authorization?.scope !== GOOGLE_CALENDAR_SCOPE || authorization.token_type?.toLowerCase() !== 'bearer'
        || !tokenText(authorization.access_token, 8192) || requestSignal.aborted) return undefined

      const measuredAt = Math.floor(now() / 1000) * 1000
      const asOf = new Date(measuredAt).toISOString()
      const coverageStart = new Date(measuredAt - DAY_MS).toISOString()
      const coverageEnd = new Date(measuredAt + 14 * DAY_MS).toISOString()
      const url = new URL(encodeURIComponent(calendarId) + '/events', EVENTS_ROOT)
      url.search = new URLSearchParams({ timeMin: coverageStart, timeMax: coverageEnd, singleEvents: 'true', showDeleted: 'false', maxResults: '64',
        fields: 'accessRole,timeZone,nextPageToken,items(status,transparency,iCalUID,sequence,organizer(email),start(date,dateTime),end(date,dateTime),recurringEventId,attendees(self,responseStatus))' }).toString()

      const events = [], pageTokens = new Set()
      let timeZone, itemsSeen = 0
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await json(await fetchImpl(url.href, {
          method: 'GET', redirect: 'error', signal: requestSignal, headers: { Authorization: 'Bearer ' + authorization.access_token },
        }), 256 * 1024)
        if (requestSignal.aborted || !['owner', 'writer', 'writerWithoutPrivateAccess', 'reader'].includes(result?.accessRole)
          || !tokenText(result?.timeZone, 128) || !Array.isArray(result.items) || result.items.length > 64
          || (timeZone !== undefined && timeZone !== result.timeZone)) return undefined
        timeZone = result.timeZone
        itemsSeen += result.items.length
        if (itemsSeen > MAX_CALENDAR_EVENTS) return undefined
        for (const item of result.items) {
          const event = eventReading(item, timeZone)
          if (event) events.push(event)
        }
        if (result.nextPageToken === undefined) {
          const frame = { id, kind: 'service', state: 'live', value: { asOf, coverageStart, coverageEnd, events } }
          const snapshot = await readCalendarSnapshot(async () => frame, id, now, requestSignal)
          return snapshot ? { ...frame, value: snapshot } : undefined
        }
        if (!tokenText(result.nextPageToken, 4096) || pageTokens.has(result.nextPageToken)) return undefined
        pageTokens.add(result.nextPageToken)
        url.searchParams.set('pageToken', result.nextPageToken)
      }
    } catch {
      // OAuth, provider, parsing, and path errors carry no content into Agent status.
    }
    return undefined
  }
}
