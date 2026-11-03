// The generation contract comes from the OpenUI component library, not a hand-written essay.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generationSystemPrompt, parseSuggestionDocument, openuiFormatCorrection, OPENUI_EXAMPLE,
} from '../src/openui-contract.mjs'

const PRIMITIVES = ['Suggestions', 'Suggestion', 'Advice', 'Readings', 'Reading', 'ApprovedAction', 'OwnerStep']

test('the library generates the contract and carries host authority rules', () => {
  assert.ok(generationSystemPrompt.length < 5000, `contract is ${generationSystemPrompt.length} chars`)
  assert.match(generationSystemPrompt, /openui-lang/i)
  for (const name of PRIMITIVES) assert.match(generationSystemPrompt, new RegExp(`\\b${name}\\b`))
  for (const rule of [/Only the host binds approved actions/, /cited observations/, /at most three Reading/, /never invent/, /no current need/])
    assert.match(generationSystemPrompt, rule)
  assert.match(generationSystemPrompt, /root = Suggestions\(/)
})

test('an OpenUI document parses into the host candidate shape', () => {
  const parsed = parseSuggestionDocument(OPENUI_EXAMPLE)
  assert.equal(parsed.suggestions.length, 1)
  const s = parsed.suggestions[0]
  assert.equal(s.topicId, 'commute-anomaly')
  assert.equal(s.key, 'k-commute')
  assert.equal(s.advice, '通勤比平时多了28分钟。')
  assert.deepEqual(s.evidenceIds, ['e0', 'e1'])
  assert.equal(s.actionId, 'open')
  assert.deepEqual(s.preview.items, [
    { label: '通勤用时', value: '52分钟', tone: 'warn' },
    { label: '平时用时', value: '24分钟' },
  ])
})

test('a document with no current need yields no candidates', () => {
  assert.deepEqual(parseSuggestionDocument('root = Suggestions([])'), { suggestions: [] })
})

test('an Intent preview carries a read-only OwnerStep', () => {
  const doc = `root = Suggestions([s1])
s1 = Suggestion([a1, n1],"ride","k-ride",["e3"])
a1 = Advice("查看行程候选。")
n1 = OwnerStep("选择起终点。")`
  const s = parseSuggestionDocument(doc).suggestions[0]
  assert.equal(s.nextStep, '选择起终点。')
  assert.equal(Object.hasOwn(s, 'actionId'), false)
})

test('malformed documents are rejected before judgment', () => {
  const four = `root = Suggestions([s1])
s1 = Suggestion([a1, r1, b1],"t","k",["e0"])
a1 = Advice("变了。")
r1 = Readings([c1,c2,c3,c4])
c1 = Reading("a","1")
c2 = Reading("b","2")
c3 = Reading("c","3")
c4 = Reading("d","4")
b1 = ApprovedAction("open")`
  for (const doc of [
    'root = NotAComponent([])',
    'root = Suggestions([ghost])',
    four,
    'root = Suggestions([s1])\ns1 = Suggestion([b1],"t","k",["e0"])\nb1 = ApprovedAction("open")',
    '',
  ]) assert.throws(() => parseSuggestionDocument(doc), undefined, doc.slice(0, 40))
})

test('the format correction never echoes private model output', () => {
  const secret = 'PRIVATE_MODEL_RESPONSE_9f8e'
  const text = openuiFormatCorrection(new Error(secret))
  assert.ok(!text.includes(secret))
  assert.ok(text.length < 1200)
  assert.match(text, /root = Suggestions/)
})
