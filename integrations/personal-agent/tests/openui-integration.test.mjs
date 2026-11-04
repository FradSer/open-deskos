// End-to-end contract: OpenUI owns syntax and the full UI tree; the host still owns authority.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSuggestionDocument, OPENUI_EXAMPLE, generationSystemPrompt } from '../src/openui-contract.mjs'
import { validateGeneratedBatch } from '../src/proactive-generation.mjs'
import {
  FULL_TREE_DOCUMENT, FULL_TREE_TYPE_COUNTS, EXTRA_DOCUMENT,
  componentNames, uiNodes, uiTypes, uiTypeCounts,
} from './openui-fixtures.test.mjs'

const stamp = '2026-11-03T09:40:00.000Z'
const actionLabel = '查看通勤安排'
const evidence = id => ({ id, readingId: 'commute.traffic', field: id === 'e0' ? 'minutes' : 'baselineMinutes', value: id === 'e0' ? 52 : 24, state: 'live', measuredAt: stamp })
const topics = [{
  id: 'commute-anomaly',
  goal: 'Tell me when the commute departs from its normal duration.',
  actions: [{ id: 'open', label: actionLabel }],
  evidence: [evidence('e0'), evidence('e1')],
}]
const example = parseSuggestionDocument(OPENUI_EXAMPLE).suggestions[0]
const exampleTopics = [{
  id: example.topicId,
  goal: 'Use the current observations.',
  actions: [{ id: example.actionId, label: 'host-approved control' }],
  evidence: example.evidenceIds.map(evidence),
}]

test('the generated contract declares the host authority boundary once', () => {
  for (const phrase of ['Only the host binds approved actions', 'host independently judges every returned candidate', 'never invent facts']) {
    assert.equal(generationSystemPrompt.split(phrase).length - 1, 1, `${phrase} appears once`)
  }
  assert.match(generationSystemPrompt, /Only the host binds approved actions/)
  assert.match(generationSystemPrompt, /host independently judges every returned candidate/i)
  assert.match(generationSystemPrompt, /never invent facts/i)
  assert.doesNotMatch(generationSystemPrompt, /preview\.items|boundedPreview|generationInstructions/)
  assert.ok(componentNames(OPENUI_EXAMPLE).length >= 6, 'OPENUI_EXAMPLE uses at least six primitive types')
})

test('a parsed OpenUI document still passes the host validator with its full UI tree', () => {
  const { suggestions } = parseSuggestionDocument(FULL_TREE_DOCUMENT)
  assert.equal(suggestions.length, 1)
  const result = validateGeneratedBatch({ suggestions }, topics, 8)
  assert.equal(result.length, 1)
  assert.equal(result[0].nextStep, actionLabel, 'the host binds the action label; OpenUI never does')
  assert.deepEqual(result[0].evidence.map(entry => entry.id), ['e0', 'e1'], 'the host binds the full approved evidence set')
  assert.deepEqual(result[0].ui, suggestions[0].ui, 'host validation preserves the full UI tree')
  assert.deepEqual(uiTypeCounts(result[0].ui), FULL_TREE_TYPE_COUNTS, 'no emitted node is dropped')
  assert.deepEqual(JSON.parse(JSON.stringify(result[0].ui)), result[0].ui, 'the validated UI tree stays plain JSON')
  assert.equal(Object.hasOwn(result[0], 'preview'), false)
  assert.equal(JSON.stringify(result[0].ui).includes('"items"'), false)
  for (const extra of ['Heading', 'Badge', 'Divider']) {
    assert.ok(uiTypes(result[0].ui).includes(extra), `${extra} survives parsing and host validation`)
  }
})

test('OPENUI_EXAMPLE keeps at least six primitive types through host validation', () => {
  const { suggestions } = parseSuggestionDocument(OPENUI_EXAMPLE)
  const before = new Set(uiTypes(suggestions[0].ui))
  assert.ok(componentNames(OPENUI_EXAMPLE).length >= 6)
  assert.ok(before.size >= 6, `parsed example has ${before.size} distinct node types`)
  const [result] = validateGeneratedBatch({ suggestions }, exampleTopics, 8)
  assert.deepEqual(result.ui, suggestions[0].ui)
  assert.deepEqual([...new Set(uiTypes(result.ui))].sort(), [...before].sort())
  assert.equal(result.nextStep, 'host-approved control')
})

test('an extra emitted component survives parsing into ui', () => {
  const { suggestions } = parseSuggestionDocument(EXTRA_DOCUMENT)
  assert.equal(suggestions.length, 1)
  const [s] = suggestions
  assert.deepEqual(uiTypeCounts(s.ui), {
    Suggestion: 1, Heading: 1, Advice: 1, Badge: 1, Divider: 1, ApprovedAction: 1,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(s.ui)), s.ui)
  const [result] = validateGeneratedBatch({ suggestions }, topics, 8)
  assert.deepEqual(result.ui, s.ui)
})

test('an OpenUI document cannot smuggle an unapproved action past the host', () => {
  const { suggestions } = parseSuggestionDocument(EXTRA_DOCUMENT)
  const forged = suggestions.map(s => ({ ...s, actionId: 'deploy-everything' }))
  assert.throws(() => validateGeneratedBatch({ suggestions: forged }, topics, 8), /Invalid generated suggestion/)
})

test('an OpenUI document cannot cite an observation the host did not issue', () => {
  const { suggestions } = parseSuggestionDocument(EXTRA_DOCUMENT)
  const forged = suggestions.map(s => ({ ...s, evidenceIds: ['e999'] }))
  assert.throws(() => validateGeneratedBatch({ suggestions: forged }, topics, 8), /Invalid generated suggestion/)
})

test('forged evidence inside the UI tree cannot replace host-issued evidence', () => {
  const { suggestions } = parseSuggestionDocument(EXTRA_DOCUMENT)
  const forgedUi = structuredClone(suggestions[0].ui)
  const suggestionNode = uiNodes(forgedUi).find(node => node.type === 'Suggestion')
  assert.ok(suggestionNode)
  suggestionNode.props.evidenceIds = ['e999']
  const [result] = validateGeneratedBatch({ suggestions: [{ ...suggestions[0], ui: forgedUi }] }, topics, 8)
  assert.deepEqual(result.evidence.map(entry => entry.id), ['e0', 'e1'])
  assert.deepEqual(result.ui, forgedUi, 'the host does not project OpenUI-owned nodes')
})

test('advice that restates the action label is still rejected after parsing', () => {
  const doc = `root = Suggestions([s1])
s1 = Suggestion([a1, b1],"commute-anomaly","k",["e0"])
a1 = Advice("通勤变慢了，请${actionLabel}。")
b1 = ApprovedAction("open")`
  const { suggestions } = parseSuggestionDocument(doc)
  assert.throws(() => validateGeneratedBatch({ suggestions }, topics, 8), /action label/i)
})
