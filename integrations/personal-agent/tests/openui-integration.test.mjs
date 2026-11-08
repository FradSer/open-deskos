// End-to-end contract: OpenUI owns syntax and the full UI tree; the host still owns authority.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSuggestionDocument, OPENUI_EXAMPLE, OPENUI_EXAMPLES, generationSystemPrompt, visibleUiText } from '../src/recommendations/index.mjs'
import { validateGeneratedBatch } from '../src/recommendations/index.mjs'
import {
  FULL_TREE_DOCUMENT, FULL_TREE_TYPE_COUNTS, EXTRA_DOCUMENT,
  componentNames, uiNodes, uiTypes, uiTypeCounts,
} from './openui-fixtures.test.mjs'

const stamp = '2026-11-03T09:40:00.000Z'
const actionLabel = '查看通勤安排'
const VALUES = { e0: 52, e1: 24, e2: 28, e3: '14:00', e4: 12, e5: 34 }
const evidence = id => ({ id, readingId: 'commute.traffic', field: id === 'e0' ? 'minutes' : 'baselineMinutes', value: VALUES[id] ?? 1, state: 'live', measuredAt: stamp })
const topics = [{
  id: 'commute-anomaly',
  goal: 'Tell me when the commute departs from its normal duration.',
  actions: [{ id: 'open', label: actionLabel }],
  evidence: Object.keys(VALUES).map(evidence),
}]
const example = parseSuggestionDocument(OPENUI_EXAMPLE).suggestions[0]
const exampleTopics = [{
  id: example.topicId,
  goal: 'Use the current observations.',
  actions: [{ id: example.actionId, label: 'host-approved control' }],
  evidence: example.evidenceIds.map(evidence),
}]

test('the generated contract declares the host authority boundary once', () => {
  for (const phrase of ['Only the host binds approved actions', 'Compose the card freely', 'Every number the owner can see']) {
    assert.equal(generationSystemPrompt.split(phrase).length - 1, 1, `${phrase} appears once`)
  }
  assert.match(generationSystemPrompt, /Only the host binds approved actions/)
  assert.match(generationSystemPrompt, /Compose the card freely/i)
  assert.match(generationSystemPrompt, /Every number the owner can see/i)
  assert.doesNotMatch(generationSystemPrompt, /preview\.items|boundedPreview|generationInstructions/)
  assert.ok(componentNames(OPENUI_EXAMPLE).length >= 6, 'OPENUI_EXAMPLE uses at least six primitive types')
})

test('a parsed OpenUI document still passes the host validator with its full UI tree', () => {
  const { suggestions } = parseSuggestionDocument(FULL_TREE_DOCUMENT)
  assert.equal(suggestions.length, 1)
  const result = validateGeneratedBatch({ suggestions }, topics, 8)
  assert.equal(result.length, 1)
  assert.equal(result[0].nextStep, actionLabel, 'the host binds the action label; OpenUI never does')
  assert.deepEqual(result[0].evidence.map(entry => entry.id), Object.keys(VALUES), 'the host binds the full approved evidence set')
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
  assert.throws(() => validateGeneratedBatch({ suggestions: [{ ...suggestions[0], ui: forgedUi }] }, topics, 8), /UI and host candidate fields disagree/)
})

test('advice that restates the action label is still rejected after parsing', () => {
  const doc = `root = Suggestions([s1])
s1 = Suggestion([a1, b1],"commute-anomaly","k",["e0"])
a1 = Advice("通勤变慢了，请${actionLabel}。")
b1 = ApprovedAction("open")`
  const { suggestions } = parseSuggestionDocument(doc)
  assert.throws(() => validateGeneratedBatch({ suggestions }, topics, 8), /action label/i)
})

test('the host refuses unresolved template markers and non-string semantic keys', () => {
  const { suggestions } = parseSuggestionDocument(OPENUI_EXAMPLE)
  const base = suggestions[0]
  for (const key of ['{{SECRET_marker}}', '${placeholder}', '{%template%}', '{key}', 'a}b', '{{', '}}']) {
    assert.throws(() => validateGeneratedBatch({ suggestions: [{ ...base, key }] }, topics, 8),
      /Invalid generated suggestion/, `brace key must be refused: ${key}`)
  }
  for (const key of [undefined, null, 7, {}, []]) {
    assert.throws(() => validateGeneratedBatch({ suggestions: [{ ...base, key }] }, topics, 8),
      /Invalid generated suggestion/, `non-string key must be refused: ${String(key)}`)
  }
  // The allowlist still admits an ordinary semantic key.
  const renamed = structuredClone(base)
  renamed.key = 'commute-delay'
  renamed.ui.props.key = renamed.key
  assert.equal(validateGeneratedBatch({ suggestions: [renamed] }, topics, 8).length, 1)
})

// A bubble already renders advice. The host refuses a restated advice
// sentence and repeated reading pairs, and binds every visible number to a
// host-issued observation. uiText records exactly what the host validated.
test('the host refuses a restated advice sentence and a repeated reading', () => {
  const supported = parseSuggestionDocument(`root = Suggestions([s1])
s1 = Suggestion([a1, r1, b1],"commute-anomaly","k",["e0","e1"])
a1 = Advice("通勤比平时多了28分钟。")
r1 = Readings([c1, c2])
c1 = Reading("通勤用时","52分钟","warn")
c2 = Reading("平时用时","24分钟")
b1 = ApprovedAction("open")`).suggestions[0]
  assert.equal(validateGeneratedBatch({ suggestions: [supported] }, topics, 8).length, 1)
  assert.deepEqual(visibleUiText(supported.ui), ['通勤用时', '52分钟', '平时用时', '24分钟'])

  const restated = structuredClone(supported)
  uiNodes(restated.ui).find(node => node.type === 'Readings').children.unshift({ type: 'Heading', props: { value: supported.advice }, children: [] })
  assert.throws(() => validateGeneratedBatch({ suggestions: [restated] }, topics, 8), /restates advice/i)

  const repeated = structuredClone(supported)
  uiNodes(repeated.ui).find(node => node.type === 'Readings').children.push(structuredClone(uiNodes(repeated.ui).find(node => node.type === 'Reading')))
  assert.throws(() => validateGeneratedBatch({ suggestions: [repeated] }, topics, 8), /repeats a reading/i)
})

test('a concise heading or badge may name the subject of read-only Intent advice', () => {
  const document = `root = Suggestions([s1])
s1 = Suggestion([a1, h1, badge1, r1, n1],"intent-walk","walk-jacket",["e0"])
a1 = Advice("当前温度适合为下次散步准备轻外套。")
h1 = Heading("散步准备")
badge1 = Badge("准备轻外套")
r1 = Reading("当前温度","23.5°C")
n1 = OwnerStep("出门前带上轻外套。")`
  const parsed = parseSuggestionDocument(document)
  const topic = { id: 'intent-walk', intentPreview: true, intentCondition: 'Consider a light jacket below 30°C.',
    evidence: [{ id: 'e0', readingId: 'odk.tile.weather', field: 'temperatureC', value: 23.5, state: 'live', measuredAt: stamp }] }
  const [result] = validateGeneratedBatch(parsed, [topic], 1)
  assert.equal(result.nextStep, '出门前带上轻外套。')
  assert.equal(Object.hasOwn(result, 'actionId'), false)
  assert.deepEqual(result.evidence, topic.evidence)
  for (const type of ['Heading', 'Badge', 'Text']) {
    for (const value of [result.advice, '提示：' + result.advice + '请留意。']) {
      const repeated = structuredClone(parsed)
      repeated.suggestions[0].ui.children.push({ type, props: { value }, children: [] })
      assert.throws(() => validateGeneratedBatch(repeated, [topic], 1), /restates advice/i)
    }
  }
})

test('short reading labels and distinct readings are never a style-score false positive', () => {
  const label = parseSuggestionDocument(`root = Suggestions([s1])
s1 = Suggestion([a1, r1, b1],"commute-anomaly","k",["e0"])
a1 = Advice("会议室温度已升到52度，建议通风。")
r1 = Readings([c1])
c1 = Reading("温度","52度","warn")
b1 = ApprovedAction("open")`).suggestions[0]
  assert.doesNotThrow(() => validateGeneratedBatch({ suggestions: [label] }, topics, 8), '温度 occurs in advice but is a reading label')

  const distinct = parseSuggestionDocument(`root = Suggestions([s1])
s1 = Suggestion([a1, r1, b1],"commute-anomaly","k",["e0","e1"])
a1 = Advice("两项读数不同。")
r1 = Readings([c1, c2])
c1 = Reading("甲","52")
c2 = Reading("乙","52")
b1 = ApprovedAction("open")`).suggestions[0]
  assert.doesNotThrow(() => validateGeneratedBatch({ suggestions: [distinct] }, topics, 8), 'equal values under distinct labels are not duplicates')
})

test('a Reading value with an uncited number is refused mechanically', () => {
  const invented = parseSuggestionDocument(`root = Suggestions([s1])
s1 = Suggestion([a1, r1, b1],"commute-anomaly","k",["e0","e1"])
a1 = Advice("两项读数不同。")
r1 = Readings([c1])
c1 = Reading("预计到达","18:15")
b1 = ApprovedAction("open")`).suggestions[0]
  assert.throws(() => validateGeneratedBatch({ suggestions: [invented] }, topics, 8), /number no cited observation supplies/i)
})

test('a number in prose, a badge or an option label is bound like any other fact', () => {
  const cases = [
    `h1 = Heading("第 3 次观察")`,
    `badge1 = Badge("已超限 300%","warn")`,
    `options1 = OptionSet([o1])\no1 = Option("5 分钟后","later")`,
  ]
  for (const extra of cases) {
    const doc = `root = Suggestions([s1])
s1 = Suggestion([a1, ${extra.startsWith('h1') ? 'h1' : extra.startsWith('badge') ? 'badge1' : 'options1'}, b1],"commute-anomaly","k",["e0"])
a1 = Advice("两项读数不同。")
${extra}
b1 = ApprovedAction("open")`
    const [s] = parseSuggestionDocument(doc).suggestions
    assert.throws(() => validateGeneratedBatch({ suggestions: [s] }, topics, 8), /number no cited observation supplies/i)
  }
})

test('a number in advice is bound to the cited observations', () => {
  const doc = `root = Suggestions([s1])
s1 = Suggestion([a1, r1, b1],"commute-anomaly","k",["e0","e1"])
a1 = Advice("比平时多了 987 分钟。")
r1 = Readings([c1])
c1 = Reading("用时","52分钟")
b1 = ApprovedAction("open")`
  const [s] = parseSuggestionDocument(doc).suggestions
  assert.throws(() => validateGeneratedBatch({ suggestions: [s] }, topics, 8), /number no cited observation supplies/i)
})

test('the read-only Intent example binds measured evidence without borrowing its condition threshold', () => {
  const doc = OPENUI_EXAMPLES.find(example => example.includes('OwnerStep('))
  assert.ok(doc)
  const parsed = parseSuggestionDocument(doc)
  const [suggestion] = parsed.suggestions
  const topic = {
    id: suggestion.topicId, intentPreview: true, intentCondition: 'Suggest a review when more than 2 items are pending.',
    evidence: [{ id: 'e0', readingId: 'source.items', field: 'pending', value: 3, state: 'live', measuredAt: stamp }],
  }
  const [result] = validateGeneratedBatch(parsed, [topic], 1)
  assert.equal(result.nextStep, suggestion.nextStep)
  assert.equal(Object.hasOwn(result, 'actionId'), false)
  assert.deepEqual(result.evidence, topic.evidence)
  assert.throws(() => validateGeneratedBatch(
    parseSuggestionDocument(doc.replace('Reading("待处理事项","3")', 'Reading("待处理事项","2")')), [topic], 1,
  ), /number no cited observation supplies/i)
})

test('the shipped examples compose visibly different generic trees', () => {
  assert.ok(OPENUI_EXAMPLES.length >= 3)
  const shapes = []
  for (const doc of OPENUI_EXAMPLES) {
    const [s] = parseSuggestionDocument(doc).suggestions
    assert.ok(s.advice && s.ui && (s.actionId || s.nextStep))
    assert.ok(s.evidenceIds.length > 0)
    const values = visibleUiText(s.ui)
    assert.equal(values.length, new Set(values).size, `example repeats a card value: ${values.join(', ')}`)
    shapes.push([...new Set(uiTypes(s.ui))].sort().join(','))
  }
  assert.ok(new Set(shapes).size >= 3, `examples must differ in composition, got ${JSON.stringify(shapes)}`)
  assert.match(generationSystemPrompt, /Different topics deserve different compositions/i)
  assert.match(generationSystemPrompt, /Compose the card freely/i)
})

test('a narrative card string is host-validated, not refused by a style score', () => {
  const narrative = parseSuggestionDocument(`root = Suggestions([s1])
s1 = Suggestion([a1, badge1, r1, b1],"commute-anomaly","k",["e0","e1"])
a1 = Advice("通勤比平时多了28分钟。")
badge1 = Badge("偏离常态","warn")
r1 = Readings([c1, c2])
c1 = Reading("通勤用时","52分钟","warn")
c2 = Reading("平时用时","24分钟")
b1 = ApprovedAction("open")`).suggestions[0]
  const [result] = validateGeneratedBatch({ suggestions: [narrative] }, topics, 8)
  assert.ok(result.uiText.includes('偏离常态'), 'the narrative string is recorded as host-validated presentation')
  assert.equal(result.uiText.filter(value => /28分钟/.test(value)).length, 0, 'no card string restates the advice sentence')
})

test('tone and direction attributes are not counted as visible card text', () => {
  const [s] = parseSuggestionDocument(`root = Suggestions([s1])
s1 = Suggestion([a1, badge1, stack1, b1],"commute-anomaly","k",["e0"])
a1 = Advice("两项读数不同。")
badge1 = Badge("偏离常态","warn")
stack1 = Stack([t1],"vertical")
t1 = Text("以下读数来自本轮引用观察。","neutral")
b1 = ApprovedAction("open")`).suggestions
  const text = visibleUiText(s.ui)
  assert.ok(!text.includes('warn') && !text.includes('neutral') && !text.includes('vertical'),
    `tone/direction must not leak: ${JSON.stringify(text)}`)
  assert.ok(text.includes('偏离常态') && text.includes('以下读数来自本轮引用观察。'))
})
