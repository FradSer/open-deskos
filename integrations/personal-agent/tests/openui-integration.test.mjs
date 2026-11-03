// End-to-end contract: OpenUI owns syntax, the host still owns authority.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSuggestionDocument, OPENUI_EXAMPLE, generationSystemPrompt } from '../src/openui-contract.mjs'
import { validateGeneratedBatch } from '../src/proactive-generation.mjs'

const topics = [{
  id: 'commute-anomaly',
  goal: 'Tell me when the commute departs from its normal duration.',
  actions: [{ id: 'open', label: '查看通勤安排' }],
  evidence: [
    { id: 'e0', readingId: 'commute.traffic', field: 'minutes', value: 52, state: 'live', measuredAt: new Date().toISOString() },
    { id: 'e1', readingId: 'commute.traffic', field: 'baselineMinutes', value: 24, state: 'live', measuredAt: new Date().toISOString() },
  ],
}]

test('the generated contract declares the host authority boundary once', () => {
  assert.match(generationSystemPrompt, /Only the host binds approved actions/)
  assert.match(generationSystemPrompt, /host independently judges every returned candidate/)
})

test('a parsed OpenUI document still passes the host validator', () => {
  const { suggestions } = parseSuggestionDocument(OPENUI_EXAMPLE)
  const result = validateGeneratedBatch({ suggestions }, topics, 8)
  assert.equal(result.length, 1)
  assert.equal(result[0].nextStep, '查看通勤安排', 'the host binds the action label; OpenUI never does')
  assert.equal(result[0].evidence.length, 2, 'the host binds the full approved evidence set')
})

test('an OpenUI document cannot smuggle an unapproved action past the host', () => {
  const { suggestions } = parseSuggestionDocument(OPENUI_EXAMPLE)
  const forged = suggestions.map(s => ({ ...s, actionId: 'deploy-everything' }))
  assert.throws(() => validateGeneratedBatch({ suggestions: forged }, topics, 8), /Invalid generated suggestion/)
})

test('an OpenUI document cannot cite an observation the host did not issue', () => {
  const { suggestions } = parseSuggestionDocument(OPENUI_EXAMPLE)
  const forged = suggestions.map(s => ({ ...s, evidenceIds: ['e999'] }))
  assert.throws(() => validateGeneratedBatch({ suggestions: forged }, topics, 8), /Invalid generated suggestion/)
})

test('advice that restates the action label is still rejected after parsing', () => {
  const doc = `root = Suggestions([s1])
s1 = Suggestion([a1, b1],"commute-anomaly","k",["e0"])
a1 = Advice("通勤变慢了，请查看通勤安排。")
b1 = ApprovedAction("open")`
  const { suggestions } = parseSuggestionDocument(doc)
  assert.throws(() => validateGeneratedBatch({ suggestions }, topics, 8), /action label/i)
})
