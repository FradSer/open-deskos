import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJevIntentRouter, INTENTS, createIntentTurn, guardIntentTools, proposalConfirmations } from '../src/intent-routing.mjs'
import { sessionAdapter } from '../src/agent.mjs'

function response(choice = 'task_query', overrides = {}) {
  return { model: 'jev-fixture', answers: { intent: { type: 'choice', choice, confidence: 0.96,
    probabilities: Object.fromEntries(Object.keys(INTENTS).map(key => [key, key === choice ? 1 : 0])), ...overrides } } }
}
function routerFixture(value = response()) {
  const requests = []
  const route = createJevIntentRouter({ env: { TYPESAFE_API_KEY: 'fixture-only' }, fetchImpl: async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) })
    return Response.json(value)
  } })
  return { route, requests }
}

test('every route including suggestions, confirmation and conversation uses Jev Choice', async () => {
  const examples = { session_continue: '继续 pi 的 session', task_query: '查询任务', widget_create: '创建一个 widget', app_create: '创建 app', suggestions: '有什么建议', proposal_response: '确认执行 123', conversation: '你好' }
  for (const [intent, text] of Object.entries(examples)) {
    const f = routerFixture(response(intent))
    const decision = await f.route({ text, profile: 'personal', previous: null, tools: ['coding_tasks_list'] })
    assert.equal(decision.intent, intent)
    assert.equal(f.requests.length, 1)
    assert.equal(f.requests[0].body.questions.intent.type, 'choice')
    assert.equal(f.requests[0].body.state.text, text)
    assert.equal(f.requests[0].body.model, 'jev-latest')
    assert.equal(f.requests[0].options.redirect, 'error')
  }
})

test('uncertain, no-match and conflicting distributions ask for clarification', async () => {
  for (const result of [response('clarify'), response('task_query', { confidence: 0.3 }), response('task_query', { probabilities: Object.fromEntries(Object.keys(INTENTS).map(key => [key, ['task_query', 'session_continue'].includes(key) ? 0.5 : 0])) })]) {
    assert.equal((await routerFixture(result).route({ text: '继续那个', profile: 'coding' })).intent, 'clarify')
  }
})

test('follow-up intent state excludes previous answers and tool-derived private evidence', async () => {
  const f = routerFixture(response('desk_data'))
  const turn = createIntentTurn({ route: f.route, profile: 'personal', tools: ['desk_data'] })
  const signal = new AbortController().signal
  await turn.prepare('查看桌面当前读数', signal)
  turn.complete('查看桌面当前读数', 'PRIVATE_FIXTURE_EVIDENCE from a tool response')
  await turn.prepare('再查一次', signal)
  assert.deepEqual(f.requests[1].body.state.previous, { text: '查看桌面当前读数', intent: 'desk_data' })
  await f.route({ text: '再查一次', profile: 'personal', previous: { text: '查看桌面当前读数', intent: 'desk_data', answer: 'PRIVATE_FIXTURE_EVIDENCE', result: { private: true } } })
  assert.deepEqual(f.requests[2].body.state.previous, { text: '查看桌面当前读数', intent: 'desk_data' })
  assert(!f.requests.some(request => JSON.stringify(request.body).includes('PRIVATE_FIXTURE_EVIDENCE')))
})

test('invalid provider answers and failures cannot supply an intent', async () => {
  for (const result of [response('invented'), response('task_query', { type: 'noul' }), response('task_query', { confidence: NaN }), response('task_query', { probabilities: { task_query: 1 } }), { ...response(), model: 'other-model' }]) {
    await assert.rejects(routerFixture(result).route({ text: '查询任务', profile: 'coding' }), /Jev/)
  }
  assert.throws(() => createJevIntentRouter({ env: {} }), /credential/)
  const f = createJevIntentRouter({ env: { TYPESAFE_API_KEY: 'fixture-only' }, fetchImpl: async () => { throw Error('private-provider-detail') } })
  await assert.rejects(f({ text: '你好', profile: 'personal' }), error => /Jev/.test(error.message) && !error.message.includes('private-provider-detail'))
})

test('routing precedes turn hooks, suggestion lookup and model prompt', async () => {
  const events = []
  const turn = createIntentTurn({ route: async ({ text }) => { events.push('jev'); assert.equal(text, '有什么建议'); return { intent: 'suggestions' } }, profile: 'coding', tools: [], getWatch: () => ({ list: () => [], readProposals: async () => { events.push('proposals'); return [] } }) })
  const adapter = sessionAdapter({ isStreaming: false, prompt: async () => assert.fail('no reasoning-model shortcut'), subscribe: () => () => {}, abort: async () => {} }, {
    prepareTurn: turn.prepare, beginTurn: text => { if (text) events.push('begin') },
  })
  assert.match(await adapter.prompt('有什么建议'), /没有.*建议/)
  assert.deepEqual(events, ['jev', 'proposals', 'begin'])
})

test('task query tools cannot mutate tasks and no tools run outside a routed turn', async () => {
  let intent = null, calls = 0
  const tools = guardIntentTools(['coding_tasks_list', 'coding_task_prompt', 'user_app_install'].map(name => ({ name, execute: async () => ++calls })), () => intent)
  await assert.rejects(tools[0].execute(), /intent/i)
  intent = 'task_query'
  assert.equal(await tools[0].execute(), 1)
  await assert.rejects(tools[1].execute(), /intent/i)
  await assert.rejects(tools[2].execute(), /intent/i)
  intent = 'session_continue'
  assert.equal(await tools[1].execute(), 2)
  assert.equal(calls, 2)
})

test('application queries can inspect inventory without granting lifecycle mutations', async () => {
  let calls = 0
  const tools = guardIntentTools(['user_apps_list', 'user_apps_desktop', 'user_app_install', 'user_app_place', 'user_app_remove', 'user_app_rollback']
    .map(name => ({ name, execute: async () => ++calls })), () => 'app_query')
  assert.equal(await tools[0].execute(), 1)
  assert.equal(await tools[1].execute(), 2)
  for (const tool of tools.slice(2)) await assert.rejects(tool.execute(), /Jev intent/)
  assert.equal(calls, 2)
})

test('cancellation during Jev blocks downstream prompt even if inference resolves late', async () => {
  let release, signal
  const adapter = sessionAdapter({ isStreaming: false, prompt: async () => assert.fail('cancelled handler'), subscribe: () => () => {}, abort: async () => {} }, {
    beginTurn() {}, prepareTurn: async (_text, inputSignal) => { signal = inputSignal; await new Promise(resolve => { release = resolve }); return { context: 'late route' } },
  })
  const pending = adapter.prompt('继续')
  await new Promise(resolve => setImmediate(resolve))
  await adapter.abort()
  assert.equal(signal.aborted, true)
  release()
  await assert.rejects(pending, /abort/i)
})

test('a displayed confirmation stays routing context after the host reserves its action', () => {
  const confirmation = '记住 watering：检查盆土后浇水'
  assert.deepEqual(proposalConfirmations({ list: () => [
    { id: 'reserved', status: 'executing', presented: true, confirmation },
    { id: 'unshown', status: 'pending', presented: false, confirmation },
    { id: 'old', status: 'completed', presented: true, confirmation },
  ] }), [{ id: 'reserved', confirmation }])
})

test('mutation reservations cover concurrent calls and canonical arguments without caching fresh reads', async () => {
  let turn = 1, changes = 0, reads = 0, release
  const tools = guardIntentTools([
    { name: 'reviewed_change', execute: async () => { changes++; await new Promise(resolve => { release = resolve }); return { ok: true } } },
    { name: 'reviewed_read', annotations: { readOnlyHint: true }, execute: async () => ++reads },
  ], () => 'extension', () => turn)
  const first = tools[0].execute('direct', { a: 1, nested: { x: 2, y: 3 } })
  await assert.rejects(tools[0].execute('nested', { nested: { y: 3, x: 2 }, a: 1 }), /already attempted/)
  assert.equal(changes, 1)
  release(); await first
  await assert.rejects(tools[0].execute('later', { a: 1, nested: { x: 2, y: 3 } }), /already attempted/)
  turn++
  const next = tools[0].execute('new-user-turn', { a: 1, nested: { x: 2, y: 3 } })
  release(); await next
  assert.equal(changes, 2)
  assert.equal(await tools[1].execute('read-1', {}), 1)
  assert.equal(await tools[1].execute('read-2', {}), 2)
})

test('ride status reconciliation remains a repeatable read after mutation reservation', async () => {
  const { createDidiTools } = await import('../src/didi/index.mjs')
  let count = 0
  const tools = guardIntentTools(createDidiTools({ snapshot: () => ({ sandbox: true }), status: async () => ({ sequence: ++count }) }), () => 'ride')
  const status = tools.find(tool => tool.name === 'didi_status')
  assert.equal((await status.execute('before', {})).structuredContent.result.sequence, 1)
  assert.equal((await status.execute('reconcile', {})).structuredContent.result.sequence, 2)
})

test('operator-added capabilities retain a Jev-routed extension handler without opening core mutations', async () => {
  let intent = 'conversation'
  const tools = guardIntentTools([{ name: 'reviewed_extension', execute: async () => 'extension result' },
    { name: 'coding_task_start', execute: async () => assert.fail('extension route cannot start core tasks') }], () => intent)
  await assert.rejects(tools[0].execute(), /Jev intent/)
  intent = 'extension'
  assert.equal(await tools[0].execute(), 'extension result')
  await assert.rejects(tools[1].execute(), /Jev intent/)
})
