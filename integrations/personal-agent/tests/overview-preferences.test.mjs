import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_OVERVIEW_PREFERENCES, normalizeOverviewPreferences, loadOverviewPreferences, overviewPreferencesPath, isPrivateOverviewSource } from '../src/overview-preferences.mjs'
import { homeFactVariables, fallbackHomeSelection, generateHomeSelection } from '../src/home-template.mjs'
import { resolveHomeTemplate } from '../src/home-template.mjs'

const source = (id, icon, value) => ({ id, label: id, state: 'live', value, home: { mode: 'optional', priority: 0, icon, fields: Object.keys(value) } })
const futu = () => source('odk.service.futu-main', 'portfolio', { todayChangePercent: 6.4 })
const quota = () => source('quota', 'quota', { accounts: [{ name: 'Main', remainingPercent: 3 }] })
const pi = () => source('odk.app.pi-sessions', 'sessions', {
  sessions: [1, 2, 3, 4, 5].map(index => ({ id: `s${index}`, project: `Project ${index}`, goal: `Private goal ${index}`, state: 'running' })),
})
const prefs = (mustShow = [], privateSources = []) => ({ version: 1, mustShow, privateSources })

test('an invalid preference file keeps the privacy-safe default policy', async () => {
  assert.deepEqual(DEFAULT_OVERVIEW_PREFERENCES.privateSources, ['odk.app.pi-sessions'])
  assert.equal(isPrivateOverviewSource('odk.app.pi-sessions'), true)
  assert.equal(isPrivateOverviewSource('quota'), false)
  assert.throws(() => normalizeOverviewPreferences({ version: 2, mustShow: [], privateSources: [] }), /Invalid/)
  assert.throws(() => normalizeOverviewPreferences({ version: 1, mustShow: ['bad id'], privateSources: [] }), /Invalid/)
  const loaded = await loadOverviewPreferences({ env: { ODK_OVERVIEW_PREFERENCES_FILE: '/no/such/file' }, read: async () => '{ invalid json' })
  assert.deepEqual(loaded, DEFAULT_OVERVIEW_PREFERENCES)
  const oversized = await loadOverviewPreferences({ env: { ODK_OVERVIEW_PREFERENCES_FILE: '/x' }, read: async () => 'x'.repeat(9000) })
  assert.deepEqual(oversized, DEFAULT_OVERVIEW_PREFERENCES)
  assert.match(overviewPreferencesPath({ ODK_OVERVIEW_PREFERENCES_FILE: '/owner/file.json' }), /owner/)
})

test('Pi sessions never disclose their goals, projects or activity', () => {
  const readings = [pi()]
  const facts = homeFactVariables(readings, Date.now(), DEFAULT_OVERVIEW_PREFERENCES)
  const summary = facts.find(fact => fact.factId.endsWith(':@summary'))
  assert.ok(summary)
  assert.notEqual(summary.displayable, false)
  assert.ok(facts.filter(fact => fact !== summary).every(fact => fact.displayable === false))
  const text = resolveHomeTemplate(fallbackHomeSelection(readings, Date.now(), DEFAULT_OVERVIEW_PREFERENCES), readings)
    .items.map(item => item.text).join(' ')
  assert.doesNotMatch(text, /Private goal|Project 1|Private goal 3/)
  assert.match(text, /Sessions is 5/)
})

test('a required Futu holding stays visible through the local fallback', () => {
  const readings = [quota(), futu()]
  const preferences = prefs(['odk.service.futu-main'], ['odk.app.pi-sessions'])
  const text = resolveHomeTemplate(fallbackHomeSelection(readings, Date.now(), preferences), readings)
    .items.map(item => item.text).join(' ')
  assert.match(text, /Today change is \+6\.40%/)
})

test('a selector cannot drop a required Futu holding', async () => {
  const readings = [quota(), futu()]
  const preferences = prefs(['odk.service.futu-main'], ['odk.app.pi-sessions'])
  const raw = await generateHomeSelection(readings, { preferences, choose: async () => ({ items: [] }) })
  const text = resolveHomeTemplate(raw, readings).items.map(item => item.text).join(' ')
  assert.match(text, /Today change is \+6\.40%/)
})

test('the displayed value stays bound to the current local reading', () => {
  const readings = [futu()]
  const preferences = prefs(['odk.service.futu-main'], ['odk.app.pi-sessions'])
  const first = resolveHomeTemplate(fallbackHomeSelection(readings, Date.now(), preferences), readings)
  assert.match(first.items.map(item => item.text).join(' '), /Today change is \+6\.40%/)
  readings[0].value.todayChangePercent = -1.25
  const second = resolveHomeTemplate(fallbackHomeSelection(readings, Date.now(), preferences), readings)
  assert.match(second.items.map(item => item.text).join(' '), /-1\.25%/)
})
