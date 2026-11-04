// OpenUI owns the generation contract, syntax, parser and full UI tree.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generationSystemPrompt, parseSuggestionDocument, openuiFormatCorrection, OPENUI_EXAMPLE,
} from '../src/openui-contract.mjs'
import {
  REGISTERED_PRIMITIVES, EMPTY_DOCUMENT, FULL_TREE_DOCUMENT, FULL_TREE_TYPE_COUNTS,
  componentNames, openuiSuggestion, uiNodes, uiTypes, uiTypeCounts,
} from './openui-fixtures.test.mjs'

test('the library generates the contract and carries host authority rules', () => {
  assert.match(generationSystemPrompt, /openui-lang/i)
  assert.match(generationSystemPrompt, /root = Suggestions\(/)
  assert.ok(generationSystemPrompt.length < 8000, `contract is ${generationSystemPrompt.length} chars`)
  for (const name of REGISTERED_PRIMITIVES) assert.match(generationSystemPrompt, new RegExp(`\\b${name}\\b`), name)
  for (const rule of [
    /Only the host binds approved actions/,
    /never invent facts/i,
    /cited observations/i,
    /Advice.*one short natural sentence/i,
    /copied from a cited observation/i,
    /Omit a Suggestion.*no current need/i,
    /host independently judges every returned candidate/i,
  ]) assert.match(generationSystemPrompt, rule)
  assert.doesNotMatch(generationSystemPrompt, /preview\.items|boundedPreview|generationInstructions/)
})

test('OPENUI_EXAMPLE is valid and uses at least six distinct primitives', () => {
  const names = componentNames(OPENUI_EXAMPLE)
  assert.ok(names.length >= 6, `example uses ${names.length} primitives: ${names.join(', ')}`)
  assert.ok(names.every(name => REGISTERED_PRIMITIVES.includes(name)))
  const { suggestions } = parseSuggestionDocument(OPENUI_EXAMPLE)
  assert.equal(suggestions.length, 1)
  const [s] = suggestions
  assert.ok(s.topicId && s.key && s.advice)
  assert.ok(Array.isArray(s.evidenceIds) && s.evidenceIds.length > 0)
  assert.ok(s.actionId || s.nextStep)
  assert.equal(s.ui.type, 'Suggestion')
  assert.ok(new Set(uiTypes(s.ui)).size >= 6, 'the parsed example keeps a composable UI tree')
  assert.deepEqual(JSON.parse(JSON.stringify(s.ui)), s.ui, 'the UI tree is plain JSON')
  assert.equal(Object.hasOwn(s, 'preview'), false)
})

test('the parsed ui keeps every emitted component node', () => {
  const { suggestions } = parseSuggestionDocument(FULL_TREE_DOCUMENT)
  assert.equal(suggestions.length, 1)
  const [s] = suggestions
  assert.equal(s.topicId, 'commute-anomaly')
  assert.equal(s.key, 'k-full')
  assert.equal(s.advice, '通勤比平时多了28分钟。')
  assert.deepEqual(s.evidenceIds, ['e0', 'e1'])
  assert.equal(s.actionId, 'open')
  assert.equal(Object.hasOwn(s, 'preview'), false)
  assert.equal(s.ui.type, 'Suggestion')
  assert.deepEqual(uiTypeCounts(s.ui), FULL_TREE_TYPE_COUNTS, 'no emitted component is dropped')
  assert.deepEqual(JSON.parse(JSON.stringify(s.ui)), s.ui, 'the UI tree is serialisable over IPC')
  assert.equal(JSON.stringify(s.ui).includes('"items"'), false, 'the tree is never collapsed to preview items')
  for (const type of ['Heading', 'Badge', 'Divider']) {
    const node = uiNodes(s.ui).find(candidate => candidate.type === type)
    assert.ok(node, `${type} survives parsing into ui`)
    assert.equal(typeof node.props, 'object')
  }
  const heading = uiNodes(s.ui).find(node => node.type === 'Heading')
  const badge = uiNodes(s.ui).find(node => node.type === 'Badge')
  const options = uiNodes(s.ui).filter(node => node.type === 'Option')
  assert.equal(heading.props.value, '通勤观察')
  assert.equal(badge.props.value, '需要留意')
  assert.deepEqual(options.map(node => node.props.value), ['open', 'later'])
})

test('a document with no current need yields no candidates', () => {
  assert.deepEqual(parseSuggestionDocument(EMPTY_DOCUMENT), { suggestions: [] })
})

test('an Intent preview carries a read-only OwnerStep and its UI node', () => {
  const s = openuiSuggestion({
    topicId: 'ride', key: 'k-ride', advice: '查看行程候选。', nextStep: '选择起终点。', evidenceIds: ['e3'],
  })
  assert.equal(s.nextStep, '选择起终点。')
  assert.equal(Object.hasOwn(s, 'actionId'), false)
  assert.ok(uiTypes(s.ui).includes('OwnerStep'))
  assert.equal(uiTypes(s.ui).includes('ApprovedAction'), false)
  assert.deepEqual(JSON.parse(JSON.stringify(s.ui)), s.ui)
})

test('malformed documents are rejected before judgment', () => {
  for (const doc of [
    'root = NotAComponent([])',
    'root = Suggestions([ghost])',
    'root = Suggestions([s1])\ns1 = Suggestion([b1],"t","k",["e0"])\nb1 = ApprovedAction("open")',
    'root = Suggestions([s1])\ns1 = Suggestion([a1],"t","k",[])\na1 = Advice("变了。")',
    'root = Suggestions([])\nh1 = Heading("orphaned")',
    '',
  ]) assert.throws(() => parseSuggestionDocument(doc), undefined, doc.slice(0, 48))
})

test('the format correction never echoes private model output', () => {
  const secret = 'PRIVATE_MODEL_OUTPUT_2b6f'
  const text = openuiFormatCorrection(new Error(secret))
  assert.ok(!text.includes(secret))
  assert.ok(text.length < 2000, `correction is ${text.length} chars`)
  assert.match(text, /root = Suggestions\(/)
  assert.ok(componentNames(text).length > 0, 'the correction supplies one valid OpenUI document')
})
