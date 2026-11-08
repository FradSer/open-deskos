import assert from 'node:assert/strict'
import { linkSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { protectProactivePath } from '../src/proactive-private.mjs'
import { readCalendarSnapshot } from '../src/recommendations/index.mjs'
import { createGoogleCalendarReader, GOOGLE_CALENDAR_SCOPE } from '../src/recommendations/index.mjs'

const READING_ID = 'calendar.google'
const CALENDAR_ID = 'owner@example.test'
const NOW = Date.parse('2026-11-06T08:00:00.100Z')
const timed = { iCalUID: 'a@example.test', sequence: 2, status: 'confirmed', organizer: { email: 'org@example.test' },
  start: { dateTime: '2026-11-06T13:00:00-05:00' }, end: { dateTime: '2026-11-06T14:00:00-05:00' } }
const page = (items, fields = {}) => ({ accessRole: 'owner', timeZone: 'America/New_York', items, ...fields })
const token = (fields = {}) => ({ token_type: 'Bearer', scope: GOOGLE_CALENDAR_SCOPE, access_token: 'test-access', ...fields })
function fixture(t, replies) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'odk-calendar-test-')))
  protectProactivePath(dir)
  const credentialsFile = join(dir, 'credentials.json')
  writeFileSync(credentialsFile, JSON.stringify({ schemaVersion: 1, scope: GOOGLE_CALENDAR_SCOPE,
    clientId: 'test.apps.googleusercontent.com', clientSecret: 'test-client-secret', refreshToken: 'test-refresh' }), { mode: 0o600 })
  protectProactivePath(credentialsFile)
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const requests = []
  const read = createGoogleCalendarReader({ calendarId: CALENDAR_ID, credentialsFile, readingId: READING_ID, now: () => NOW,
    fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init })
      return Response.json(replies.shift() ?? { unexpected: true })
    } })
  return { read, requests, credentialsFile }
}

test('reads only fixed endpoints and assembles every calendar page', async t => {
  const second = { ...timed, iCalUID: 'b@example.test', recurringEventId: 'series', transparency: 'transparent' }
  const { read, requests } = fixture(t, [token(), page([timed], { nextPageToken: 'next' }), page([second])])
  assert.equal(await read('other'), undefined)
  const snapshot = await readCalendarSnapshot(read, READING_ID, NOW)
  assert.equal(snapshot.events.length, 2)
  assert.deepEqual(snapshot.events[0], { uid: timed.iCalUID, organizer: timed.organizer.email, sequence: 2,
    startsAt: '2026-11-06T18:00:00.000Z', endsAt: '2026-11-06T19:00:00.000Z', busy: true })
  assert.equal(snapshot.events[1].recurring, true)
  assert.equal(snapshot.events[1].busy, false)
  assert.equal(requests[0].url.href, 'https://oauth2.googleapis.com/token')
  assert.equal(requests[0].init.method, 'POST')
  assert.equal(requests[0].init.body.get('grant_type'), 'refresh_token')
  assert.equal(requests[1].url.pathname, '/calendar/v3/calendars/owner%40example.test/events')
  assert.equal(requests[1].init.method, 'GET')
  assert.equal(requests[1].init.headers.Authorization, 'Bearer test-access')
  assert.equal(requests[1].url.searchParams.get('singleEvents'), 'true')
  assert.equal(requests[1].url.searchParams.get('timeMin'), '2026-11-05T08:00:00.000Z')
  assert.equal(requests[1].url.searchParams.get('timeMax'), '2026-11-20T08:00:00.000Z')
  assert.equal(requests[2].url.searchParams.get('pageToken'), 'next')
  assert(requests.every(({ init }) => init.redirect === 'error'))
})

test('maps all-day busy to the calendar zone and excludes explicitly declined events', async t => {
  const allDay = { ...timed, iCalUID: 'all-day@example.test', start: { date: '2026-11-06' }, end: { date: '2026-11-07' } }
  const declined = { ...timed, attendees: [{ self: true, responseStatus: 'declined' }] }
  const { read } = fixture(t, [token(), page([allDay, declined, { status: 'cancelled' }])])
  const snapshot = await readCalendarSnapshot(read, READING_ID, NOW)
  assert.deepEqual(snapshot.events.map(({ startsAt, endsAt, busy }) => ({ startsAt, endsAt, busy })), [
    { startsAt: '2026-11-06T05:00:00.000Z', endsAt: '2026-11-07T05:00:00.000Z', busy: true },
    { startsAt: '2026-11-06T18:00:00.000Z', endsAt: '2026-11-06T19:00:00.000Z', busy: false },
  ])
})

test('rejects broad grants, incomplete pages, invalid event timing and unsafe credentials', async t => {
  for (const responses of [
    [token({ scope: GOOGLE_CALENDAR_SCOPE + ' https://www.googleapis.com/auth/calendar' })],
    [token(), page([timed], { nextPageToken: 'loop' }), page([], { nextPageToken: 'loop' })],
    [token(), page([{ ...timed, start: { date: '2026-02-30' } }])],
    [token(), page([timed], { accessRole: 'freeBusyReader' })],
  ]) assert.equal(await fixture(t, responses).read(READING_ID), undefined)

  const insecure = fixture(t, [token()])
  linkSync(insecure.credentialsFile, insecure.credentialsFile + '.alias')
  assert.equal(await insecure.read(READING_ID), undefined)
  assert.equal(insecure.requests.length, 0)
})
