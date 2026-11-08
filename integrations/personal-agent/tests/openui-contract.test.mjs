// OpenUI owns the generation contract, syntax, parser and full UI tree.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generationSystemPrompt, parseSuggestionDocument, openuiFormatCorrection, OPENUI_EXAMPLE, OPENUI_EXAMPLES,
} from '../src/recommendations/index.mjs'
import {
  REGISTERED_PRIMITIVES, EMPTY_DOCUMENT, FULL_TREE_DOCUMENT, FULL_TREE_TYPE_COUNTS,
  componentNames, openuiSuggestion, uiNodes, uiTypes, uiTypeCounts,
} from './openui-fixtures.test.mjs'

test('the library generates the contract and carries host authority rules', () => {
  assert.match(generationSystemPrompt, /openui-lang/i)
  assert.match(generationSystemPrompt, /root = Suggestions\(/)
  assert.ok(generationSystemPrompt.length < 12000, `contract is ${generationSystemPrompt.length} chars`)
  for (const name of REGISTERED_PRIMITIVES) assert.match(generationSystemPrompt, new RegExp(`\\b${name}\\b`), name)
  for (const rule of [
    /Only the host binds approved actions/,
    /prefer the host prepare_reply action/,
    /Preparing a draft never sends it/,
    /One recommendation proposes one logical next step/,
    /OptionSet is only for choosing necessary parameters/,
    /Every number the owner can see/i,
    /Advice is one short sentence/i,
    /Omit a Suggestion.*no current need/i,
    /Compose the card freely/i,
    /Never emit source, timestamp, state or provenance metadata as card text/i,
    /session source on the left and a Reply control on the right/i,
  ]) assert.match(generationSystemPrompt, rule)
  assert.doesNotMatch(generationSystemPrompt, /preview\.items|boundedPreview|generationInstructions/)
})

test('the generated prompt distinguishes read-only Intent steps from approved actions', () => {
  assert.match(generationSystemPrompt, /intentPreview.*true.*exactly one OwnerStep/i)
  assert.match(generationSystemPrompt, /intentPreview.*true.*no ApprovedAction/i)
  assert.match(generationSystemPrompt, /ordinary topic.*exactly one ApprovedAction/i)
  assert.match(generationSystemPrompt, /intentConditionMet.*host has verified the owner condition.*one read-only suggestion/i)
  assert.match(generationSystemPrompt, /threshold.*approved observation/i)
  const readOnly = OPENUI_EXAMPLES.map(example => parseSuggestionDocument(example).suggestions[0])
    .find(suggestion => suggestion.nextStep && !suggestion.actionId)
  assert.ok(readOnly, 'the shipped generation prompt includes a complete read-only example')
  assert.equal(uiTypes(readOnly.ui).filter(type => type === 'OwnerStep').length, 1)
  assert.equal(uiTypes(readOnly.ui).includes('ApprovedAction'), false)
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

test('reply draft documents reuse shared primitives and return only an unsent notice and draft paragraphs', async () => {
  const { parseReplyDraftDocument, replyDraftSystemPrompt } = await import('../src/recommendations/index.mjs')
  const doc = [
    'root = Suggestions([s1])',
    's1 = Suggestion([a1,h1,stack1],"reply-draft","reply-draft",["source"])',
    'a1 = Advice("回复草稿，尚未发送。")',
    'h1 = Heading("回复内容")',
    'stack1 = Stack([t1,row1,d1])',
    't1 = Text("您好，感谢邀请。")',
    'row1 = Row([t2])',
    't2 = Text("这个时间方便，期待交流。")',
    'd1 = Divider()',
  ].join('\n')
  assert.equal(typeof parseReplyDraftDocument, 'function')
  assert.match(replyDraftSystemPrompt, /no tools|zero tools/i)
  assert.match(replyDraftSystemPrompt, /reply-draft/)
  assert.deepEqual(parseReplyDraftDocument(doc), { text: '回复草稿，尚未发送。\n\n您好，感谢邀请。\n\n这个时间方便，期待交流。' })
  const extraTextNames = Array.from({ length: 6 }, (_, i) => 'extra' + i)
  const eightParagraphs = doc.replace('a1,h1,stack1', 'a1,h1,stack1,' + extraTextNames.join(','))
    + '\n' + extraTextNames.map(name => name + ' = Text("感谢。")').join('\n')
  assert.equal(parseReplyDraftDocument(eightParagraphs).text.split('\n\n').length, 9)
  assert.throws(() => parseReplyDraftDocument(eightParagraphs.replace('a1,h1,stack1', 'a1,h1,stack1,ninth') + '\nninth = Text("再见。")'))
  for (const forbidden of ['ApprovedAction("send")', 'OwnerStep("Send")', 'Option("Send","send")', 'OptionSet([])',
    'Reading("State","Ready")', 'Readings([r1])', 'Metric("Count","1")', 'Badge("Ready")']) {
    const invalid = doc.replace('a1,h1,stack1', 'a1,h1,stack1,bad').replace('d1 = Divider()', 'd1 = Divider()\nbad = ' + forbidden + (forbidden.startsWith('Readings') ? '\nr1 = Reading("State","Ready")' : ''))
    assert.throws(() => parseReplyDraftDocument(invalid), undefined, forbidden)
  }
  for (const invalid of [
    doc.replace('["source"]', '["another"]'),
    doc.replace('"reply-draft","reply-draft"', '"other","reply-draft"'),
    doc.replace('您好，感谢邀请。', '   '),
    doc.replace('您好，感谢邀请。', 'sourceSnapshot: private-origin'),
    doc.replace('您好，感谢邀请。', 'x'.repeat(4000)),
    doc.replace('回复草稿，尚未发送。', '已发送回复。'),
    doc.replace('Suggestions([s1])', 'Suggestions([s1,s1])'),
    doc.replace('a1,h1,stack1', 'a1,h1').replace(/stack1 = [\s\S]*/, ''),
    doc.replace('a1,h1,stack1', 'a1,h1,stack1,a2') + '\na2 = Advice("未发送草稿。")',
    doc.replace('a1,h1,stack1', 'a1,h1,stack1,s2') + '\ns2 = Suggestion([],"reply-draft","reply-draft",["source"])',
  ]) assert.throws(() => parseReplyDraftDocument(invalid))
})
