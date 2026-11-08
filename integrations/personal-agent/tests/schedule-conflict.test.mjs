import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ProactiveWatch } from '../src/recommendations/index.mjs'
import { defaultProactiveConfig } from '../src/recommendations/index.mjs'
import { proposalStateStore } from '../src/recommendations/index.mjs'
import { createConfiguredScheduleConflict, validatePrivateRecommendationConfig } from '../src/recommendations/index.mjs'
import { createGmailTools } from '../../gmail/src/index.mjs'
import { answerSuggestions } from '../src/recommendations/index.mjs'

const now = Date.parse('2026-11-06T09:00:00Z')
const time = hours => new Date(now + hours * 3600000).toISOString()
const organizer = 'host@example.com'
const gmailAccount = 'owner@example.com'
const source = 'calendar.work'
const accountKey = createHash('sha256').update(JSON.stringify(['gmail-account', gmailAccount])).digest('hex')
const request = {
  messageId: 'aabb12', uid: 'meeting', organizer, sequence: 1, method: 'REQUEST',
  startsAt: time(2), endsAt: time(3), receivedAt: time(0),
}
const original = { uid: 'meeting', organizer, sequence: 0, startsAt: time(1), endsAt: time(2), busy: true }
const busy = { uid: 'other', organizer, sequence: 0, startsAt: time(2.5), endsAt: time(3.5), busy: true }

function fixture(t, clock = () => now) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'odk-calendar-proposal-')))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const store = proposalStateStore(join(directory, 'state.json'))
  const config = { version: 1, sources: [], scheduleConflict: { gmailAccount, calendarReadingId: source, timeZone: 'UTC' } }
  const cursors = []
  const f = {
    page: { cursor: 'checkpoint', complete: true, untrusted: true, events: [request] },
    events: [original, busy], connected: true, reads: 0, cursors,
    boot(selection = config) {
      const catalog = { package: async () => ({
        revision: 'a'.repeat(64), snapshot: { schemaVersion: 1, kind: 'mcp', id: 'gmail', name: 'Gmail',
          policy: { privateData: true, ownerOnly: true }, transport: { type: 'stdio', command: process.execPath, args: [] } },
      }) }
      const tools = createGmailTools({ scheduleChanges({ expectedAccountKey, cursor }) {
        cursors.push(cursor)
        if (!f.connected || expectedAccountKey !== accountKey) throw Error('Wrong account')
        return f.page
      } })
      const scheduleConflict = createConfiguredScheduleConflict({ config: selection, catalog, openSession: async () => ({
        tools: async () => tools,
        call: async (name, args) => {
          assert.equal(name, 'gmail_schedule_changes')
          return tools.find(tool => tool.name === name).execute(undefined, args)
        },
        close: async () => {},
      }) })
      const watch = new ProactiveWatch({ config: defaultProactiveConfig(), scheduleConflict, now: clock,
        read: async id => {
          assert.equal(id, source)
          f.reads++
          return { id, kind: 'service', state: 'live', value: { asOf: new Date(clock()).toISOString(),
            coverageStart: time(-1), coverageEnd: time(8), events: f.events } }
        },
        generate: () => assert.fail('No model generation'),
        execute: () => assert.fail('No action execution'),
        publish: value => { f.frame = value }, loadState: store.load, saveState: store.save,
      })
      t.after(() => watch.close())
      return watch
    },
  }
  return f
}

test('an authorized change produces one source-bound read-only conversation proposal across polling and restart', async t => {
  const f = fixture(t)
  const watch = f.boot()
  await watch.tick()
  const [card] = f.frame.proposals
  assert.equal(f.frame.popup, false)
  assert.equal(card.action, null)
  assert.deepEqual(card.evidence.map(({ value }) => value), [busy.startsAt, busy.endsAt])
  await assert.rejects(watch.respond(card.id, 'accept'), /unavailable/)
  assert.equal(card.offered, true)
  assert.deepEqual(card.sources, [{ kind: 'gmail', label: 'Gmail', messageId: 'aabb12' },
    { kind: 'calendar', label: 'Calendar', readingId: source }])
  assert.doesNotMatch(await answerSuggestions(watch), /改约|Gmail/)
  await watch.tick()
  assert.deepEqual(f.frame.proposals.map(p => p.id), [card.id])
  await watch.respond(card.id, 'ignore')
  await watch.close()

  const restarted = f.boot()
  await restarted.tick()
  assert.equal(f.frame.proposals.filter(p => p.status === 'pending').length, 0)
  assert.deepEqual(f.frame.proposals.map(p => p.id), [card.id])
  assert.deepEqual(f.cursors, [undefined, 'checkpoint', 'checkpoint'])

  f.page.events = [{ ...request, messageId: 'bbcc12', sequence: 2, startsAt: time(2.25) }]
  await restarted.tick()
  assert.equal(f.frame.proposals.length, 1)
  assert.notEqual(f.frame.proposals[0].id, card.id, 'obsolete feedback cannot apply to the new slot')
  await assert.rejects(restarted.respond(card.id, 'ignore'), /no longer pending/)
  assert.equal(f.frame.proposals[0].status, 'pending')
  assert.equal(f.frame.proposals[0].sources[0].messageId, 'bbcc12')
})

test('a partial history page cannot publish an invite that a later page cancels', async t => {
  const f = fixture(t)
  f.page.complete = false
  const watch = f.boot()
  await watch.tick()
  assert.equal(f.reads, 0)
  assert.deepEqual(f.frame.proposals, [])
  const { uid, organizer, receivedAt } = request
  f.page = { ...f.page, complete: true, events: [{ messageId: 'ccdd12', uid, organizer, receivedAt, method: 'CANCEL', sequence: 2 }] }
  await watch.tick()
  assert.deepEqual(f.cursors, [undefined, 'checkpoint'])
  assert.deepEqual(f.frame.proposals, [])
})

test('a prior Gmail request proves the move if the calendar has already applied the new slot', async t => {
  const f = fixture(t)
  f.events = [{ ...original, sequence: 1, startsAt: request.startsAt, endsAt: request.endsAt }, busy]
  f.page.events = [request, { ...request, messageId: 'aa0012', sequence: 0, startsAt: original.startsAt, endsAt: original.endsAt }]
  await f.boot().tick()
  assert.equal(f.frame.proposals.length, 1)
  assert.equal(f.frame.proposals[0].sources[0].messageId, request.messageId)
})

test('no grant, a changed account, or invalidated calendar cannot publish a prior card', async t => {
  const f = fixture(t)
  await f.boot({ version: 1, sources: [] }).tick()
  assert.equal(f.cursors.length, 0)
  assert.equal(f.reads, 0)
  assert.throws(() => validatePrivateRecommendationConfig({ version: 1, sources: [], scheduleConflict: { gmailAccount } }), /invalid/)
  const watch = f.boot()
  await watch.tick()
  assert.equal(f.frame.proposals.length, 1)
  assert.equal(watch.push([source]), true)
  assert.deepEqual(f.frame.proposals, [])
  f.connected = false
  await watch.tick()
  assert.equal(f.reads, 1)
  assert.deepEqual(f.frame.proposals, [])
})

test('deadlines recheck snoozed cards and expire them before a heartbeat', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  const f = fixture(t, Date.now)
  const moved = { ...request, startsAt: time(2 / 60), endsAt: time(0.5) }
  f.page.events = [moved]
  f.events = [{ ...original, startsAt: time(-0.5), endsAt: time(0) },
    { ...busy, startsAt: time(1 / 60), endsAt: time(0.25) }]
  const watch = f.boot()
  watch.start()
  await watch.inflight
  const [card] = f.frame.proposals
  assert.equal(card.offered, true)
  await watch.respond(card.id, 'snooze')
  assert.equal(f.frame.proposals[0].offered, false)
  t.mock.timers.tick(60000)
  await watch.inflight
  assert.equal(f.reads, 2)
  assert.equal(f.cursors.length, 1)
  assert.equal(f.frame.proposals[0].offered, true)
  t.mock.timers.tick(60000)
  await watch.inflight
  assert.equal(f.frame.proposals[0].status, 'expired')
  assert.equal(f.cursors.length, 1)
})

test('a wall clock jump expires the visible card on the next bounded timer without a source read', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now })
  let suspendedMs = 0
  const f = fixture(t, () => Date.now() + suspendedMs)
  f.page.events = [{ ...request, startsAt: time(2 / 60), endsAt: time(0.5) }]
  f.events = [original, { ...busy, startsAt: time(1 / 60), endsAt: time(0.25) }]
  const watch = f.boot()
  watch.start()
  await watch.inflight
  assert.equal(f.frame.proposals[0].offered, true)

  t.mock.timers.tick(1000)
  assert.equal(f.frame.proposals[0].status, 'pending')
  assert.equal(f.reads, 1)
  assert.equal(f.cursors.length, 1)

  suspendedMs = 120000
  t.mock.timers.tick(1000)
  await watch.inflight
  assert.equal(f.frame.proposals.some(p => p.status === 'pending'), false)
  assert.equal(f.frame.proposals[0].status, 'expired')
  assert.equal(f.cursors.length, 1)
  assert.equal(f.reads, 1)
})
