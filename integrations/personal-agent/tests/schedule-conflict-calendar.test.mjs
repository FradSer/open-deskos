import test from 'node:test'
import assert from 'node:assert/strict'
import { readCalendarSnapshot, findScheduleConflict } from '../src/recommendations/index.mjs'

const ID = 'service.calendar'
const NOW = Date.parse('2026-11-06T08:00:00Z')
const prior = { uid: 'original', organizer: 'org@example.test', sequence: 2, startsAt: '2026-11-06T09:00:00Z', endsAt: '2026-11-06T10:00:00Z', busy: true }
const change = { ...prior, sequence: 3, startsAt: '2026-11-06T12:00:00.000Z', endsAt: '2026-11-06T13:00:00.000Z' }
const blocking = { ...prior, uid: 'other', sequence: 0, startsAt: '2026-11-06T20:30:00+08:00', endsAt: '2026-11-06T21:30:00+08:00' }
function reading(events = [prior, blocking], value = {}) {
  return { id: ID, kind: 'service', state: 'live', value: { asOf: '2026-11-06T08:00:00Z',
    coverageStart: '2026-11-06T00:00:00Z', coverageEnd: '2026-11-07T00:00:00Z', events, ...value } }
}
const snapshot = (frame = reading()) => readCalendarSnapshot(async () => frame, ID, NOW)

test('uses the exact live reading and normalizes offset instants before matching', async () => {
  const controller = new AbortController()
  const value = await readCalendarSnapshot(async (id, signal) => {
    assert.equal(id, ID)
    assert.equal(signal, controller.signal)
    return reading()
  }, ID, () => NOW, controller.signal)
  assert.equal(value.events[1].startsAt, '2026-11-06T12:30:00.000Z')
  assert.equal(findScheduleConflict(change, value), value.events[1])
})

test('refuses stale, future, untrusted, malformed, and wrong-source readings', async () => {
  for (const frame of [
    { ...reading(), id: 'other.calendar' },
    { ...reading(), state: 'stale' },
    { ...reading(), untrusted: true },
    reading([], { asOf: '2026-11-06T07:54:59Z' }),
    reading([], { asOf: '2026-11-06T08:00:01Z' }),
    reading([], { coverageEnd: '2026-11-05T00:00:00Z' }),
    reading([{ ...prior, startsAt: '2026-11-06T09:00:00' }]),
    reading([{ ...prior, startsAt: '2026-02-30T09:00:00Z' }]),
    reading([{ ...prior, sequence: -1 }]),
    reading([{ ...prior, busy: 'yes' }]),
    reading([prior, { ...prior }]),
  ]) assert.equal(await snapshot(frame), undefined)

  assert.equal(await readCalendarSnapshot(async () => { throw Error('source failed') }, ID, NOW), undefined)
  assert.equal(await readCalendarSnapshot(async () => assert.fail('read cancelled'), ID, NOW, AbortSignal.abort()), undefined)
})

test('requires a newer matching calendar event and complete coverage of both slots', async () => {
  const value = await snapshot()
  for (const update of [
    { ...change, uid: 'other-uid' },
    { ...change, organizer: 'other@example.test' },
    { ...change, sequence: 2 },
    { ...change, startsAt: prior.startsAt, endsAt: prior.endsAt },
  ]) assert.equal(findScheduleConflict(update, value), undefined)
  for (const frame of [
    reading([prior, blocking], { coverageStart: '2026-11-06T09:30:00Z' }),
    reading([prior, blocking], { coverageEnd: '2026-11-06T12:45:00Z' }),
    reading([{ ...prior, recurring: true }, blocking]),
  ]) assert.equal(findScheduleConflict(change, await snapshot(frame)), undefined)
})

test('excludes the event being moved and nonbusy or boundary-touching events', async () => {
  const stillPrior = { ...prior, endsAt: '2026-11-06T12:30:00Z' }
  const nonbusy = { ...blocking, busy: false }
  const touching = { ...blocking, uid: 'touch', startsAt: change.endsAt, endsAt: '2026-11-06T14:00:00Z' }
  assert.equal(findScheduleConflict(change, await snapshot(reading([stillPrior, nonbusy, touching]))), undefined)

  const repeat = { ...blocking, recurring: true }
  const nextRepeat = { ...repeat, startsAt: '2026-11-06T14:00:00Z', endsAt: '2026-11-06T15:00:00Z' }
  const value = await snapshot(reading([prior, repeat, nextRepeat]))
  assert.equal(findScheduleConflict(change, value), value.events[1])
})
