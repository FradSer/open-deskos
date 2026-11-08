import { fixtureExperience } from './fixtures/mem0.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, writeFile, chmod, symlink, link } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentPluginRuntime, validateAgentPlugins } from '../src/agent-plugins/runtime.mjs'
import { experienceDigest, experienceRevision } from '../src/agent-plugins/experience.mjs'
import { validateCompletion, completionInstructions, completionNotice, AgentValidationError, pluginFormatCorrection } from '../src/agent-plugins/completion.mjs'
import { protectProactivePath } from '../src/proactive-private.mjs'

// Given a Windows Limited user, when a fixture creates private state, then apply the actual host ACL policy.
async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-agent-plugins-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  if (process.platform === 'win32') protectProactivePath(directory)
  return directory
}

const success = { content: [{ type: 'text', text: 'The report contains all three requested regions. Checks: 3 passed, 0 failed.' }], details: {} }

test('conversation skips execution verification and learning without claiming success', async t => {
  const directory = await fixture(t)
  let calls = 0
  const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'conversation.json')),
    config: { enabled: ['completion', 'learning'], autoLearn: true }, infer: async () => { calls++; throw Error('Conversation needs no execution verifier') } })
  runtime.beginTurn('你好', 'conversation')
  const result = await runtime.finishTurn('你好。')
  assert.equal(result.verification.status, 'not_run')
  assert.equal(result.learning.status, 'skipped')
  assert.equal(calls, 0)
  runtime.beginTurn('Create the requested report.', 'agent_execute')
  assert.equal((await runtime.finishTurn('Done.')).verification.status, 'needs_review')
})

test('source queries retain receipt verification and skip automatic procedural learning', async t => {
  const directory = await fixture(t)
  for (const intent of ['odk_data', 'task_query', 'app_query', 'package_query']) {
    const calls = []
    const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, `${intent}.json`)),
      config: { enabled: ['completion', 'learning'], autoLearn: true }, infer: async kind => {
        calls.push(kind)
        return { status: 'passed', summary: 'The source answered the query.', checks: [{ requirement: 'Read the current source', scope: 'completion', status: 'passed', evidence: [{ id: 'tool-1', quote: 'Actual source value: 7' }] }] }
      } })
    runtime.beginTurn('Read the source.', intent)
    await runtime.observeTools([{ name: 'odk_data', execute: async () => ({ content: [{ type: 'text', text: 'Actual source value: 7' }], details: {} }) }])[0].execute('query', {})
    const result = await runtime.finishTurn('The observed value is 7.')
    assert.equal(result.verification.status, 'passed')
    assert.equal(result.learning.status, 'skipped')
    assert.deepEqual(calls, ['completion'])
  }
})

test('tool metadata cannot promote receipts to automatic learning', async t => {
  const directory = await fixture(t)
  for (const intent of ['task_query', 'agent_execute']) {
    const calls = []
    const store = fixtureExperience(join(directory, `${intent}.json`))
    const runtime = createAgentPluginRuntime({ store, config: { enabled: ['completion', 'learning'], autoLearn: true },
      infer: async (kind, input) => {
        calls.push(kind)
        assert.equal(kind, 'completion')
        assert(!input.receipts.some(receipt => receipt.kind === 'host_check'))
        return { status: 'passed', summary: 'The requested check passed.', checks: [{ requirement: 'Check task evidence', scope: 'completion',
          status: 'passed', evidence: [{ id: 'tool-2', quote: 'Checked task' }] }] }
      } })
    runtime.beginTurn('Check task evidence.', intent)
    const tools = runtime.observeTools([
      { name: 'skill_read', execute: async () => ({ content: [{ type: 'text', text: 'Unrelated method' }], details: {} }) },
      { name: 'coding_task_verify', execute: async () => ({ content: [{ type: 'text', text: 'Checked task' }], details: { completionReceipts: [{ text: 'Assertions: 3 passed', status: 'succeeded', truncated: false }] } }) },
    ])
    await tools[0].execute('ordinary', {}); await tools[1].execute('host', {})
    const outcome = await runtime.finishTurn('The check passed.')
    assert.equal(outcome.verification.status, 'passed')
    assert.equal(outcome.learning.status, 'skipped')
    assert.deepEqual(calls, ['completion'])
    assert.deepEqual((await store.load()).entries, [])
  }
})

test('Given invalid plugin judgments When validation fails Then only fixed host codes describe the failure', () => {
  const receipts = [{ id: 'tool-1', status: 'succeeded', text: 'checked', truncated: false }]
  const valid = { status: 'passed', summary: 'Checked', checks: [{ requirement: 'Read', scope: 'completion', status: 'passed', evidence: [{ id: 'tool-1', quote: 'checked' }] }] }
  const checks = (patch) => ({ ...valid, checks: [{ ...valid.checks[0], ...patch }] })
  const cases = [
    [() => validateCompletion({ ...valid, status: 'PRIVATE_INVALID' }, receipts), 'schema'],
    [() => validateCompletion(checks({ status: 'PRIVATE_INVALID' }), receipts), 'check_schema'],
    [() => validateCompletion(checks({ scope: 'PRIVATE_SCOPE' }), receipts), 'scope'],
    [() => validateCompletion(checks({ evidence: [{ id: 'tool-1', quote: 'PRIVATE_QUOTE' }] }), receipts), 'citation'],
    [() => validateCompletion(checks({ scope: 'derivation' }), receipts), 'computation_required'],
    [() => validateCompletion(checks({ status: 'needs_review', evidence: [] }), receipts), 'unresolved'],
  ]
  for (const [run, code] of cases) assert.throws(run, error => {
    assert(error instanceof AgentValidationError)
    assert.equal(error.code, code)
    assert(!error.message.includes('PRIVATE'))
    const correction = pluginFormatCorrection(error)
    assert.equal(typeof correction, 'string')
    assert(!correction.includes('PRIVATE'))
    return true
  })
  const legacy = checks({ scope: undefined })
  assert.equal(validateCompletion(legacy, receipts), legacy)
  const review = { ...checks({ status: 'needs_review', evidence: [null] }), status: 'needs_review' }
  assert.equal(validateCompletion(review, receipts), review, 'Review evidence retains its existing permissive contract')
  const forged = Object.assign(new Error('PRIVATE_PROVIDER_ERROR'), { code: 'citation' })
  assert.equal(pluginFormatCorrection(forged), pluginFormatCorrection(new Error('other')))
  assert.notEqual(pluginFormatCorrection(forged), pluginFormatCorrection(new AgentValidationError('citation')))

})

test('Given literal JSON text When tool and computation evidence is captured Then quotes need no decoding', async t => {
  const directory = await fixture(t)
  const raw = '{"result":"quoted \\"value\\"","path":"C:\\\\fixture"}'
  const quote = '"path":"C:\\\\fixture"'
  for (const computation of [false, true]) {
    let receipts
    const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, `literal-${computation}.json`)), config: { enabled: ['completion'] },
      infer: async (_kind, input) => {
        receipts = input.receipts
        return { status: 'passed', summary: 'The literal evidence was checked.', checks: [{ requirement: 'Return the observed value', scope: computation ? 'derivation' : 'completion', status: 'passed', evidence: [{ id: 'tool-1', quote }] }] }
      } })
    runtime.beginTurn('Read the supplied value.')
    if (computation) {
      runtime.beginComputation({ source: 'const path="C:\\\\fixture";text(path)' })({ status: 'succeeded', output: raw, diagnostics: [] })
    } else await runtime.observeTools([{ name: 'read_fixture', execute: async () => ({ content: [{ type: 'text', text: raw }], structuredContent: { id: 'fixture', count: 2 }, details: {} }) }])[0].execute('read', {})
    assert.equal((await runtime.finishTurn('Read complete.')).verification.status, 'passed')
    assert(receipts[0].text.includes(raw))
    assert(receipts[0].text.includes(quote))
    assert.match(receipts[0].text, computation ? /^Executed source:\n/ : /^Tool output:\n/)
    if (!computation) assert(receipts[0].text.includes('Structured output (JSON):\n{"id":"fixture","count":2}'))
    const changed = quote.replace('fixture', 'invented')
    assert.throws(() => validateCompletion({ status: 'passed', summary: 'Invalid quote', checks: [{ requirement: 'Read', scope: computation ? 'derivation' : 'completion', status: 'passed', evidence: [{ id: 'tool-1', quote: changed }] }] }, receipts))
  }
})

const derivedCheck = (scope = 'derivation', quote = 'computed total: 6') => ({ status: 'passed', summary: 'The supplied calculation was checked.', checks: [
  { requirement: 'Calculate the supplied values with the requested method', scope, status: 'passed', evidence: [{ id: 'tool-1', quote }] },
] })

test('Given actual computation When derivation is checked Then it cannot certify external effects or lessons', async t => {
  const directory = await fixture(t)
  let receipts
  const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'derived.json')), config: { enabled: ['completion'] },
    infer: async (_kind, input) => { receipts = input.receipts; return derivedCheck() } })
  runtime.beginTurn('Sum the supplied values [1, 2, 3].')
  const finish = runtime.beginComputation({ source: 'text([1,2,3].reduce((a,b)=>a+b,0))' })
  finish({ status: 'succeeded', output: 'computed total: 6', diagnostics: [], truncated: false })
  finish({ status: 'failed', output: 'A duplicate callback must not replace the receipt.', diagnostics: [], truncated: false })
  assert.equal((await runtime.finishTurn('6')).verification.status, 'passed')
  assert.equal(receipts[0].kind, 'computation')
  assert.equal(receipts[0].learningEligible, false)
  assert.match(receipts[0].text, /reduce/)
  for (const scope of ['completion', 'admission']) assert.throws(() => validateCompletion(derivedCheck(scope), receipts))
  const legacy = derivedCheck(); delete legacy.checks[0].scope
  assert.throws(() => validateCompletion(legacy, receipts))
  const fakeEffect = [{ ...receipts[0], text: 'email sent' }]
  for (const scope of ['completion', 'admission']) assert.throws(() => validateCompletion(derivedCheck(scope, 'email sent'), fakeEffect))
  assert.throws(() => validateCompletion(derivedCheck(), [{ ...receipts[0], kind: 'tool' }]))
  assert.match(completionInstructions, /current request/)
  assert.match(completionInstructions, /input.*method.*result/i)
})

test('Given failed incomplete or oversized computation When checked Then no derived pass or learning is admitted', async t => {
  const directory = await fixture(t)
  for (const variant of ['failed', 'truncated', 'source-limit', 'output-limit', 'diagnostic-error', 'unfinished']) {
    const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, `${variant}.json`)), config: { enabled: ['completion', 'learning'] }, infer: async kind => { assert.equal(kind, 'completion'); return derivedCheck() } })
    runtime.beginTurn('Calculate the supplied data.')
    const finish = runtime.beginComputation({ source: variant === 'source-limit' ? 'x'.repeat(40000) : 'text(6)' })
    if (variant !== 'unfinished') finish({ status: variant === 'failed' ? 'failed' : 'succeeded', output: variant === 'output-limit' ? 'computed total: 6' + 'x'.repeat(40000) : 'computed total: 6',
      truncated: variant === 'truncated', diagnostics: variant === 'diagnostic-error' ? [{ severity: 'error', message: 'execution failed' }] : [] })
    const result = await runtime.finishTurn('6')
    assert.equal(result.verification.status, 'needs_review', variant)
    assert.equal(result.learning.status, 'skipped', variant)
  }
})

test('Given a superseded computation When its callback arrives Then another turn cannot borrow its result', async t => {
  const directory = await fixture(t)
  let calls = 0
  const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'late.json')), config: { enabled: ['completion'] }, infer: async () => { calls++; return derivedCheck() } })
  runtime.beginTurn('Old request')
  const finish = runtime.beginComputation({ source: 'text(6)' })
  runtime.beginTurn('New request')
  finish({ status: 'succeeded', output: 'computed total: 6', diagnostics: [], truncated: false })
  assert.equal((await runtime.finishTurn('6')).verification.status, 'needs_review')
  assert.equal(calls, 0)
})

test('Given concurrent computations When their output exceeds the turn budget Then receipts stay bounded and cannot pass', async t => {
  const directory = await fixture(t)
  let receipts
  const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'bounded.json')), config: { enabled: ['completion'] },
    infer: async (_kind, input) => { receipts = input.receipts; return derivedCheck() } })
  runtime.beginTurn('Calculate the supplied data.')
  const callbacks = Array.from({ length: 6 }, () => runtime.beginComputation({ source: 'text(6)' }))
  for (const finish of callbacks.reverse()) finish({ status: 'succeeded', output: 'computed total: 6' + 'x'.repeat(30000) })
  assert.equal((await runtime.finishTurn('6')).verification.status, 'needs_review')
  assert(receipts.some(receipt => receipt.truncated))
  assert(receipts.every(receipt => Buffer.byteLength(receipt.text) <= 32768))
  assert(receipts.reduce((bytes, receipt) => bytes + Buffer.byteLength(receipt.text), 0) <= 131072)
})

const verification = { status: 'passed', summary: 'All requested regions were checked.', checks: [
  { requirement: 'Include three regions', status: 'passed', evidence: [{ id: 'tool-1', quote: 'Checks: 3 passed, 0 failed.' }] },
] }
const lesson = { title: 'Regional report validation', body: 'Validate every requested region before completing a regional report.', evidence: [
  { id: 'tool-1', quote: 'The report contains all three requested regions.' },
] }

test('private connector receipts cannot start separate completion or learning inference', async t => {
  const directory = await fixture(t)
  const store = fixtureExperience(join(directory, 'experience.json'))
  const runtime = createAgentPluginRuntime({ store, config: { enabled: ['completion', 'learning'] }, infer: async () => assert.fail('no inference') })
  runtime.beginTurn('Read the requested private document', 'agent_execute', 'personal')
  await runtime.observeTools([{ name: 'agent_mcp_call', execute: async () => ({ ...success, details: { privateData: true } }) }])[0].execute('private-document', {})
  const result = await runtime.finishTurn('The requested private document is summarized.')
  assert.equal(result.verification.status, 'not_run')
  assert.equal(result.learning.status, 'skipped')
  assert.deepEqual((await store.load()).entries, [])
})

test('plugin selection accepts only fixed DeskOS identities and independent learning controls', () => {
  assert.deepEqual(validateAgentPlugins({ enabled: ['experience', 'completion', 'learning'], autoLearn: false }), { enabled: ['experience', 'completion', 'learning'], autoLearn: false })
  for (const value of [{ enabled: ['@fradser/pi-subagents'] }, { enabled: ['/tmp/extension.js'] }, { enabled: ['learning'] }, { enabled: ['experience', 'experience'] }, { enabled: [], extra: true }, { enabled: [], autoLearn: 'yes' }]) assert.throws(() => validateAgentPlugins(value))
})

test('stored experience survives restart, injects only an index and retrieves full reference data', async t => {
  const directory = await fixture(t)
  const store = fixtureExperience(join(directory, 'experience.json'))
  await store.append([{ title: lesson.title, body: lesson.body, sources: [{ tool: 'fixture', digest: 'a'.repeat(64) }] }])
  const restarted = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'experience.json')),
    config: { enabled: ['experience', 'completion', 'learning'], autoLearn: false }, infer: async () => assert.fail('retrieval does not call a model') })
  const context = (await restarted.context())
  assert.match(context, /Regional report validation/)
  assert.doesNotMatch(context, /Validate every requested region/)
  assert.match(context, /not instructions or authorization/)
  const tool = restarted.tools().find(tool => tool.name === 'experience_read')
  const entry = (await store.load()).entries[0]
  assert.match((await tool.execute('read', { id: entry.id })).content[0].text, /Validate every requested region/)
  await assert.rejects(tool.execute('read', { id: '../experience.json' }))
})

test('retired experience stays inspectable but cannot be retrieved by the model', async t => {
  const directory = await fixture(t), store = fixtureExperience(join(directory, 'experience.json'))
  const receipt = { target: 'mac', project: directory, taskId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', toolCallId: 'test-call' }
  const sources = [{ tool: 'coding_check', digest: 'a'.repeat(64), receipt }]
  const scope = { kind: 'hosted_check', version: 1, profile: 'personal' }
  const original = { title: 'Old checks', body: 'Check the old report format.', sources, scope }
  const [oldId, newId, otherProfileId] = await store.append([
    original,
    { title: 'New checks', body: 'Check the revised report format.', sources, scope },
    { ...original, title: 'Coding-only checks', scope: { ...scope, profile: 'coding' } },
  ])
  const entry = async () => (await store.load()).entries.find(item => item.id === oldId)
  const revision = async () => experienceRevision(await entry())
  const initial = await revision()
  const runtime = createAgentPluginRuntime({ store, config: { enabled: ['experience'] }, infer: async () => assert.fail('no inference') })
  const read = runtime.tools().find(tool => tool.name === 'experience_read')
  assert.match((await runtime.context()), /Old checks/)
  assert.doesNotMatch((await runtime.context()), /Coding-only checks/)
  await assert.rejects(read.execute('read', { id: otherProfileId }), /unavailable/)
  await assert.rejects(store.maintain({ action: 'replace', id: oldId, replacementId: otherProfileId, expectedRevision: initial }), /scope/)
  await store.maintain({ action: 'replace', id: oldId, replacementId: newId, expectedRevision: initial })
  assert.equal((await entry()).retired.replacedBy, newId)
  assert.deepEqual((await entry()).sources[0].receipt, receipt)
  assert.doesNotMatch((await runtime.context()), /Old checks/)
  await assert.rejects(read.execute('read', { id: oldId }), /unavailable/)
  assert.deepEqual(await store.append([original]), [], 'Learning cannot recreate a retired entry')
  await assert.rejects(store.maintain({ action: 'restore', id: oldId, expectedRevision: initial }), /changed/)
  await store.maintain({ action: 'restore', id: oldId, expectedRevision: await revision() })
  assert.match((await runtime.context()), /Old checks/)
  const data = (await read.execute('read', { id: oldId })).structuredContent.referenceData
  assert.match(data.body, /old report format/)
  assert.equal(data.sources[0].receipt, undefined)
  assert.match(data.sources[0].receiptId, /^[a-f0-9]{64}$/)
  await assert.rejects(store.maintain({ action: 'withdraw', id: oldId, expectedRevision: initial }), /changed/)
  await store.maintain({ action: 'withdraw', id: oldId, expectedRevision: await revision() })
  assert.doesNotMatch((await runtime.context()), /Old checks/)
})

test('unsupported verification, errors and truncated receipts cannot approve completion or learn', async t => {
  const directory = await fixture(t)
  for (const bad of [
    { ...verification, checks: [] },
    { ...verification, checks: [{ ...verification.checks[0], evidence: [{ id: 'tool-1', quote: 'invented success' }] }] },
    { ...verification, checks: [{ ...verification.checks[0], status: 'needs_review' }] },
  ]) {
    const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'experience.json')), config: { enabled: ['completion', 'learning'] }, infer: async kind => { assert.equal(kind, 'completion'); return bad } })
    runtime.beginTurn('Create report')
    await runtime.observeTools([{ name: 'check', execute: async () => success }])[0].execute('id', {})
    assert.equal((await runtime.finishTurn('Done')).verification.status, 'needs_review')
  }
  for (const output of [{ ...success, isError: true }, { content: [{ type: 'text', text: 'x'.repeat(40000) }], details: {} }]) {
    const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'experience.json')), config: { enabled: ['completion', 'learning'] }, infer: async () => verification })
    runtime.beginTurn('Create report')
    await runtime.observeTools([{ name: 'check', execute: async () => output }])[0].execute('id', {})
    assert.equal((await runtime.finishTurn('Done')).verification.status, 'needs_review')
  }
})

test('Given complete installation receipts When an unrelated computation summary is truncated Then requested effects retain exact evidence', async t => {
  const directory = await fixture(t)
  let captured
  const check = (requirement, id, quote) => ({ requirement, scope: 'completion', status: 'passed', evidence: [{ id, quote }] })
  const checks = [check('Install the requested revision', 'tool-2', 'installed revision r1'), check('Read the installed catalog', 'tool-3', 'catalog revision r1')]
  const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'installation.json')), config: { enabled: ['completion'] },
    infer: async (_kind, input) => { captured = input.receipts; return { status: 'passed', summary: 'Both requested effects have exact receipts.', checks } } })
  runtime.beginTurn('Install revision r1 and read its catalog.', 'app_manage')
  runtime.beginComputation({ source: 'text(await odk.coding_task_history({taskId:"original"}))' })({ status: 'succeeded', output: 'unrelated bounded history summary', truncated: true })
  for (const [name, text] of [['user_app_install', 'installed revision r1'], ['user_apps_list', 'catalog revision r1']]) {
    await runtime.observeTools([{ name, execute: async () => ({ content: [{ type: 'text', text }], details: {} }) }])[0].execute(name, {})
  }
  assert.equal((await runtime.finishTurn('Revision r1 is installed and listed.')).verification.status, 'passed')
  assert.equal(captured[0].truncated, true)
  assert.throws(() => validateCompletion({ status: 'passed', summary: 'Invalid source', checks: [check('Read history', 'tool-1', 'unrelated bounded history summary')] }, captured), error => error.code === 'scope' || error.code === 'citation')
  const missing = { status: 'needs_review', summary: 'Requested history has no complete receipt.', checks: [...checks, { requirement: 'Read all required history', scope: 'completion', status: 'needs_review', evidence: [] }] }
  assert.equal(validateCompletion(missing, captured).status, 'needs_review')
  assert.throws(() => validateCompletion({ ...missing, status: 'passed' }, captured), error => error.code === 'unresolved')
})

test('Given complete effect evidence When its inventory is running or overflowed Then completion cannot approve it', async t => {
  const directory = await fixture(t)
  for (const variant of ['running', 'overflow']) {
    let calls = 0
    const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, `inventory-${variant}.json`)), config: { enabled: ['completion'] },
      infer: async () => { calls++; return { status: 'passed', summary: 'Installed.', checks: [{ requirement: 'Install r1', scope: 'completion', status: 'passed', evidence: [{ id: 'tool-1', quote: 'installed r1' }] }] } } })
    runtime.beginTurn('Install r1.', 'app_manage')
    await runtime.observeTools([{ name: 'user_app_install', execute: async () => ({ content: [{ type: 'text', text: 'installed r1' }], details: {} }) }])[0].execute('install', {})
    const count = variant === 'running' ? 1 : 64
    for (let i = 0; i < count; i++) {
      const done = runtime.beginComputation({ source: 'text("unrelated")' })
      if (variant === 'overflow') done({ status: 'succeeded', output: 'unrelated' })
    }
    assert.equal((await runtime.finishTurn('Installed.')).verification.status, 'needs_review', variant)
    assert.equal(calls, 0, 'An incomplete inventory must fail before model judgment')
  }
})

test('Given identical literal and structured JSON When captured Then one complete copy stays within the receipt budget', async t => {
  const directory = await fixture(t)
  for (const durable of [false, true]) {
    const payload = { taskId: 'original', history: 'observed source '.repeat(1200) }, literal = JSON.stringify(payload)
    let receipt
    const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, `deduplicate-${durable}.json`)), config: { enabled: ['completion'] },
      infer: async (_kind, input) => { receipt = input.receipts[0]; return { status: 'passed', summary: 'Actual history was read.', checks: [{ requirement: 'Read the original history', scope: 'completion', status: 'passed', evidence: [{ id: receipt.id, quote: '"taskId":"original"' }] }] } } })
    runtime.beginTurn('Read the original history.', 'task_query')
    if (durable) await runtime.observeDurableTools([{ name: 'coding_task_history', execute: async () => ({ output: [{ type: 'text', text: literal }], structuredOutput: payload }) }])[0].execute({}, {}, {})
    else await runtime.observeTools([{ name: 'coding_task_history', execute: async () => ({ content: [{ type: 'text', text: literal }], structuredContent: payload, details: {} }) }])[0].execute('read', {})
    assert.equal((await runtime.finishTurn('History read.')).verification.status, 'passed')
    assert.equal(receipt.truncated, false)
    assert.equal(receipt.text, `Tool output:\n${literal}`)
  }
})

test('learning can be disabled while completion and retrieval stay available', async t => {
  const directory = await fixture(t)
  const store = fixtureExperience(join(directory, 'experience.json'))
  const runtime = createAgentPluginRuntime({ store, config: { enabled: ['experience', 'completion', 'learning'], autoLearn: false }, infer: async kind => { assert.equal(kind, 'completion'); return verification } })
  runtime.beginTurn('report')
  await runtime.observeTools([{ name: 'check', execute: async () => success }])[0].execute('id', {})
  assert.equal((await runtime.finishTurn('ready')).learning.status, 'disabled')
  assert(runtime.tools().some(tool => tool.name === 'experience_read'))
})


test('Mem0 experience writes keep distinct and duplicate entries consistent', async t => {
  const directory = await fixture(t)
  const file = join(directory, 'experience.json')
  const a = fixtureExperience(file), b = fixtureExperience(file)
  const input = { title: lesson.title, body: lesson.body, sources: [{ tool: 'check', digest: 'a'.repeat(64) }] }
  await Promise.all([a.append([input]), b.append([{ ...input, title: 'Second method', body: 'Check report region labels as well as counts.' }])])
  assert.equal((await a.load()).entries.length, 2)
  await a.append([input])
  assert.equal((await a.load()).entries.length, 2)
  await assert.rejects(a.append([{ ...input, body: 'password=fixture-only' }]))
  await assert.rejects(readFile(file), /ENOENT/)
})

test('experience omitted from the bounded prompt remains discoverable by search and pagination', async t => {
  const directory = await fixture(t)
  const file = join(directory, 'experience.json')
  const entries = Array.from({ length: 256 }, (_, index) => ({ id: index.toString(16).padStart(32, '0'), title: `${index}: ${'Long descriptive title '.repeat(4)}`,
    body: `Reusable method ${index}`, sources: [{ tool: 'check', digest: 'a'.repeat(64) }], createdAt: new Date().toISOString() }))
  await writeFile(file, JSON.stringify({ version: 1, entries }), { mode: 0o600 })
  if (process.platform === 'win32') protectProactivePath(file)
  const runtime = createAgentPluginRuntime({ store: fixtureExperience(file), config: { enabled: ['experience'] }, infer: async () => assert.fail('no model') })
  assert(!(await runtime.context()).includes('255:'))
  const list = runtime.tools().find(tool => tool.name === 'experience_list')
  const found = JSON.parse((await list.execute('search', { query: '255' })).content[0].text)
  assert.equal(found.entries[0].id, entries[255].id)
  assert.equal(found.total, 1)
  assert(!JSON.stringify(found).includes('Reusable method'))
  const page = JSON.parse((await list.execute('page', { offset: 224, limit: 32 })).content[0].text)
  assert.equal(page.entries.at(-1).id, entries[255].id)
  assert.equal(page.total, 256)
  await assert.rejects(list.execute('bad', { offset: -1 }))
})

test('Given a later relevant method When searching reordered terms Then retrieval and current context rank that method first', async t => {
  const directory = await fixture(t), store = fixtureExperience(join(directory, 'ranked.json'));
  await store.append([
    { title: 'Plant care', body: 'Check soil moisture before watering.', sources: [{ tool: 'check', digest: 'a'.repeat(64) }] },
    { title: 'Validate region report', body: 'Check region labels and assert report totals before delivery.', sources: [{ tool: 'check', digest: 'b'.repeat(64) }] },
    { title: '中文报表检查', body: '先检查报表的地区标签，再验证总数。', sources: [{ tool: 'check', digest: 'c'.repeat(64) }] },
  ]);
  const runtime = createAgentPluginRuntime({ store, config: { enabled: ['experience'] }, infer: async () => assert.fail('no inference') });
  const list = runtime.tools().find(tool => tool.name === 'experience_list');
  const found = (await list.execute('search', { query: 'report region totals' })).structuredContent;
  assert.equal(found.entries[0]?.title, 'Validate region report');
  const chinese = (await list.execute('zh', { query: '地区报表总数' })).structuredContent;
  assert.equal(chinese.entries[0]?.title, '中文报表检查');
  runtime.beginTurn('report region totals');
  const context = (await runtime.context());
  assert(context.includes('Validate region report'));
  assert(!context.includes('Plant care'));
  assert(!context.includes('Check region labels'));
});

test('missing receipts and launch-only receipts cannot certify downstream completion', async t => {
  const directory = await fixture(t)
  const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'experience.json')), config: { enabled: ['completion', 'learning'] },
    infer: async kind => { assert.equal(kind, 'completion'); return { ...verification, checks: [{ ...verification.checks[0], evidence: [{ id: 'tool-1', quote: 'accepted' }] }] } } })
  runtime.beginTurn('Complete a report')
  assert.equal((await runtime.finishTurn('Done')).verification.status, 'needs_review')
  for (const delivery of ['accepted', 'queued', 'running']) {
    runtime.beginTurn('Complete a report')
    await runtime.observeTools([{ name: 'coding_task_start', execute: async () => ({ content: [{ type: 'text', text: JSON.stringify({ delivery, task: { lifecycle: 'live', activity: 'working' } }) }], details: {} }) }])[0].execute('id', {})
    assert.equal((await runtime.finishTurn('The report is complete')).verification.status, 'needs_review')
  }
})

test('a requested launch can pass admission verification without claiming downstream completion or learning', async t => {
  const directory = await fixture(t)
  const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'experience.json')), config: { enabled: ['completion', 'learning'] },
    infer: async kind => { assert.equal(kind, 'completion'); return { status: 'passed', summary: 'The task was started.', checks: [{ requirement: 'Start the task and return its ID', scope: 'admission', status: 'passed', evidence: [{ id: 'tool-1', quote: 'taskId=fixture' }] }] } } })
  runtime.beginTurn('Start a task and return its ID')
  await runtime.observeTools([{ name: 'coding_task_start', execute: async () => ({ content: [{ type: 'text', text: 'accepted taskId=fixture' }], details: {} }) }])[0].execute('id', {})
  const result = await runtime.finishTurn('Started task fixture')
  assert.equal(result.verification.status, 'passed')
  assert.equal(result.verification.checks[0].scope, 'admission')
  assert.equal(result.learning.status, 'skipped')
})

test('child admission receipts cannot certify completed downstream work', async t => {
  const directory = await fixture(t)
  for (const name of ['agent_start', 'agent_input']) {
    const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'experience.json')), config: { enabled: ['completion', 'learning'] },
      infer: async kind => { assert.equal(kind, 'completion'); return { ...verification, checks: [{ ...verification.checks[0], scope: 'completion', evidence: [{ id: 'tool-1', quote: 'accepted' }] }] } } })
    runtime.beginTurn('Complete the delegated report')
    await runtime.observeTools([{ name, execute: async () => ({ content: [{ type: 'text', text: 'accepted' }], details: {} }) }])[0].execute('id', {})
    assert.equal((await runtime.finishTurn('The report is complete')).verification.status, 'needs_review')
  }
})

test('completion failures retain a host-owned diagnostic without exposing provider errors', async t => {
  const directory = await fixture(t)
  for (const [bad, reason] of [[new Error('private provider diagnostic'), 'unavailable'],
    [new AgentValidationError('citation'), 'invalid_evidence']]) {
    const runtime = createAgentPluginRuntime({ store: fixtureExperience(join(directory, 'diagnostic.json')),
      config: { enabled: ['completion'] }, infer: async () => { throw bad } })
    runtime.beginTurn('Install the ready App')
    await runtime.observeTools([{ name: 'user_app_install', execute: async () => success }])[0].execute('id', {})
    const result = await runtime.finishTurn('Operation returned')
    assert.equal(result.verification.status, 'needs_review')
    assert.equal(result.verification.reason, reason)
    assert(!JSON.stringify(result).includes('private provider diagnostic'))
  }
})

test('completion notices preserve passed results and identify the unmet outcome', () => {
  assert.equal(completionNotice({ status: 'passed' }), '')
  assert.match(completionNotice({ status: 'needs_review', reason: 'unavailable' }), /检查暂不可用/)
  assert.match(completionNotice({ status: 'needs_review', reason: 'invalid_evidence' }), /证据校验/)
  assert.equal(completionNotice({ status: 'needs_review', checks: [{ status: 'needs_review', requirement: '读回已安装版本' }] }), '仍需确认：读回已安装版本。')
})

test('private host admission suppresses learning when the connector later fails', async t => {
  const directory = await fixture(t)
  const store = fixtureExperience(join(directory, 'experience.json'))
  const runtime = createAgentPluginRuntime({ store, config: { enabled: ['completion', 'learning'] }, infer: async () => assert.fail('no inference') })
  runtime.beginTurn('Check a private document and a public report', 'agent_execute', 'personal')
  const observed = runtime.observeTools([
    { name: 'public_report', execute: async () => success },
    { name: 'agent_mcp_call', execute: async () => { runtime.markPrivateData(); throw Error('Connector unavailable') } },
  ])
  await observed[0].execute('public', {})
  await assert.rejects(observed[1].execute('private', {}))
  const result = await runtime.finishTurn('The public report passed; the private document is unavailable.')
  assert.equal(result.verification.status, 'not_run')
  assert.equal(result.learning.status, 'skipped')
  assert.deepEqual((await store.load()).entries, [])
})
