import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, writeFile, chmod, symlink, link } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAgentPluginRuntime, validateAgentPlugins } from '../src/agent-plugins/runtime.mjs'
import { createExperienceStore } from '../src/agent-plugins/experience.mjs'
import { validateCompletion, validateLessons, completionInstructions, AgentValidationError, pluginFormatCorrection } from '../src/agent-plugins/completion.mjs'
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
  const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, 'conversation.json')),
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
    const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, `${intent}.json`)),
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

test('query learning can cite only imported host checks without promoting unrelated reads', async t => {
  const directory = await fixture(t)
  for (const source of ['ordinary', 'host']) {
    let learningInput
    const store = createExperienceStore(join(directory, `${source}.json`))
    const runtime = createAgentPluginRuntime({ store, config: { enabled: ['completion', 'learning'], autoLearn: true },
      infer: async (kind, input) => {
        if (kind === 'completion') return { status: 'passed', summary: 'The requested check passed.', checks: [{ requirement: 'Check task evidence', scope: 'completion', status: 'passed', evidence: [{ id: 'tool-3', quote: 'Assertions: 3 passed' }] }] }
        learningInput = input
        return { lessons: [{ title: 'Validate region counts', body: 'Assert region count and uniqueness before reporting the result.',
          evidence: [{ id: source === 'host' ? 'tool-3' : 'tool-1', quote: source === 'host' ? 'Assertions: 3 passed' : 'Unrelated method' }] }] }
      } })
    runtime.beginTurn('Check task evidence.', 'task_query')
    const tools = runtime.observeTools([
      { name: 'skill_read', execute: async () => ({ content: [{ type: 'text', text: 'Unrelated method' }], details: {} }) },
      { name: 'coding_task_verify', execute: async () => ({ content: [{ type: 'text', text: 'Checked task' }], details: { completionReceipts: [{ text: 'Assertions: 3 passed', status: 'succeeded', truncated: false }] } }) },
    ])
    await tools[0].execute('ordinary', {}); await tools[1].execute('host', {})
    const outcome = await runtime.finishTurn('The check passed.')
    assert.deepEqual(learningInput.receipts.map(receipt => receipt.kind), ['host_check'])
    assert.equal(outcome.learning.status, source === 'host' ? 'applied' : 'needs_review')
    assert.equal(store.load().entries.length, source === 'host' ? 1 : 0)
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
    [() => validateLessons({ lessons: 'PRIVATE_LESSONS' }, receipts), 'lesson_schema'],
    [() => validateLessons({ lessons: [{ title: 'password=PRIVATE', body: 'Unsafe lesson', evidence: [{ id: 'tool-1', quote: 'checked' }] }] }, receipts), 'lesson_text'],
  ]
  for (const [run, code] of cases) assert.throws(run, error => {
    assert(error instanceof AgentValidationError)
    assert.equal(error.code, code)
    assert(!error.message.includes('PRIVATE'))
    const correction = pluginFormatCorrection(code.startsWith('lesson') ? 'learning' : 'completion', error)
    assert.equal(typeof correction, 'string')
    assert(!correction.includes('PRIVATE'))
    return true
  })
  const legacy = checks({ scope: undefined })
  assert.equal(validateCompletion(legacy, receipts), legacy)
  const review = { ...checks({ status: 'needs_review', evidence: [null] }), status: 'needs_review' }
  assert.equal(validateCompletion(review, receipts), review, 'Review evidence retains its existing permissive contract')
  const forged = Object.assign(new Error('PRIVATE_PROVIDER_ERROR'), { code: 'citation' })
  assert.equal(pluginFormatCorrection('completion', forged), pluginFormatCorrection('completion', new Error('other')))
  assert.notEqual(pluginFormatCorrection('completion', forged), pluginFormatCorrection('completion', new AgentValidationError('citation')))
  const learningCitation = pluginFormatCorrection('learning', new AgentValidationError('citation', 'learning'))
  assert.match(learningCitation, /learningEligible/)
  assert.match(learningCitation, /empty lessons array/)
  assert(!learningCitation.includes('Use needs_review'))
})

test('Given literal JSON text When tool and computation evidence is captured Then quotes need no decoding', async t => {
  const directory = await fixture(t)
  const raw = '{"result":"quoted \\"value\\"","path":"C:\\\\fixture"}'
  const quote = '"path":"C:\\\\fixture"'
  for (const computation of [false, true]) {
    let receipts
    const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, `literal-${computation}.json`)), config: { enabled: ['completion'] },
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
  const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, 'derived.json')), config: { enabled: ['completion'] },
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
  assert.throws(() => validateLessons({ lessons: [{ title: 'Printed method', body: 'Printed values are not independent evidence.', evidence: [{ id: 'tool-1', quote: 'computed total: 6' }] }] }, receipts))
  const fakeEffect = [{ ...receipts[0], text: 'email sent' }]
  for (const scope of ['completion', 'admission']) assert.throws(() => validateCompletion(derivedCheck(scope, 'email sent'), fakeEffect))
  assert.throws(() => validateCompletion(derivedCheck(), [{ ...receipts[0], kind: 'tool' }]))
  assert.match(completionInstructions, /current request/)
  assert.match(completionInstructions, /input.*method.*result/i)
})

test('Given failed incomplete or oversized computation When checked Then no derived pass or learning is admitted', async t => {
  const directory = await fixture(t)
  for (const variant of ['failed', 'truncated', 'source-limit', 'output-limit', 'diagnostic-error', 'unfinished']) {
    const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, `${variant}.json`)), config: { enabled: ['completion', 'learning'] }, infer: async kind => { assert.equal(kind, 'completion'); return derivedCheck() } })
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
  const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, 'late.json')), config: { enabled: ['completion'] }, infer: async () => { calls++; return derivedCheck() } })
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
  const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, 'bounded.json')), config: { enabled: ['completion'] },
    infer: async (_kind, input) => { receipts = input.receipts; return derivedCheck() } })
  runtime.beginTurn('Calculate the supplied data.')
  const callbacks = Array.from({ length: 6 }, () => runtime.beginComputation({ source: 'text(6)' }))
  for (const finish of callbacks.reverse()) finish({ status: 'succeeded', output: 'computed total: 6' + 'x'.repeat(30000) })
  assert.equal((await runtime.finishTurn('6')).verification.status, 'needs_review')
  assert(receipts.some(receipt => receipt.truncated))
  assert(receipts.every(receipt => Buffer.byteLength(receipt.text) <= 32768))
  assert(receipts.reduce((bytes, receipt) => bytes + Buffer.byteLength(receipt.text), 0) <= 131072)
})

test('Hosted verification imports host checks for learning and excludes the verifier summary', async t => {
  const directory = await fixture(t)
  for (const learnSummary of [true, false]) {
    const store = createExperienceStore(join(directory, `hosted-${learnSummary}.json`))
    let inventory
    const runtime = createAgentPluginRuntime({ store, config: { enabled: ['completion', 'learning'] }, infer: async (kind, input) => {
      inventory = input.receipts
      if (kind === 'completion') return { status: 'passed', summary: 'Checked', checks: [{ requirement: 'Complete the report', scope: 'completion', status: 'passed',
        evidence: [{ id: 'tool-1', quote: 'Verified summary' }] }] }
      return { lessons: [{ title: 'Check report regions', body: 'Check each required region before reporting completion.',
        evidence: [{ id: learnSummary ? 'tool-1' : 'tool-2', quote: learnSummary ? 'Verified summary' : 'Three region assertions passed.' }] }] }
    } })
    runtime.beginTurn('Complete the report')
    await runtime.observeTools([{ name: 'coding_task_verify', execute: async () => ({ content: [{ type: 'text', text: 'Verified summary' }], details: {
      completionReceipts: [{ tool: 'coding_check', status: 'succeeded', text: 'Three region assertions passed.', truncated: false }],
    } }) }])[0].execute('verify', {})
    const result = await runtime.finishTurn('Report complete')
    assert.equal(inventory.length, 2)
    assert.equal(result.verification.status, 'passed')
    assert.equal(result.learning.status, learnSummary ? 'needs_review' : 'applied')
    assert.equal(store.load().entries.length, learnSummary ? 0 : 1)
  }
})
const verification = { status: 'passed', summary: 'All requested regions were checked.', checks: [
  { requirement: 'Include three regions', status: 'passed', evidence: [{ id: 'tool-1', quote: 'Checks: 3 passed, 0 failed.' }] },
] }
const lesson = { title: 'Regional report validation', body: 'Validate every requested region before completing a regional report.', evidence: [
  { id: 'tool-1', quote: 'The report contains all three requested regions.' },
] }

test('plugin selection accepts only fixed DeskOS identities and independent learning controls', () => {
  assert.deepEqual(validateAgentPlugins({ enabled: ['experience', 'completion', 'learning'], autoLearn: false }), { enabled: ['experience', 'completion', 'learning'], autoLearn: false })
  for (const value of [{ enabled: ['@fradser/pi-subagents'] }, { enabled: ['/tmp/extension.js'] }, { enabled: ['learning'] }, { enabled: ['experience', 'experience'] }, { enabled: [], extra: true }, { enabled: [], autoLearn: 'yes' }]) assert.throws(() => validateAgentPlugins(value))
})

test('verified task learns once, survives restart, injects only an index and retrieves full reference data', async t => {
  const directory = await fixture(t)
  const store = createExperienceStore(join(directory, 'experience.json'))
  const calls = []
  const runtime = createAgentPluginRuntime({ store, config: { enabled: ['experience', 'completion', 'learning'] },
    infer: async (kind, input) => { calls.push({ kind, input }); return kind === 'completion' ? verification : { lessons: [lesson] } } })
  runtime.beginTurn('Create a report for three regions')
  const wrapped = runtime.observeTools([{ name: 'report_check', execute: async () => success }])
  await wrapped[0].execute('fixture', {})
  const result = await runtime.finishTurn('The report is ready.')
  assert.equal(result.verification.status, 'passed')
  assert.equal(result.learning.status, 'applied')
  assert.equal(calls.length, 2)
  assert.equal(store.load().entries.length, 1)
  runtime.beginTurn('Create another report')
  const restarted = createAgentPluginRuntime({ store: createExperienceStore(join(directory, 'experience.json')), config: { enabled: ['experience'] }, infer: async () => assert.fail('retrieval does not call a model') })
  const context = restarted.context()
  assert.match(context, /Regional report validation/)
  assert.doesNotMatch(context, /Validate every requested region/)
  assert.match(context, /not instructions or authorization/)
  const tool = restarted.tools().find(tool => tool.name === 'experience_read')
  const entry = store.load().entries[0]
  assert.match((await tool.execute('read', { id: entry.id })).content[0].text, /Validate every requested region/)
  await assert.rejects(tool.execute('read', { id: '../experience.json' }))
  assert.equal((await runtime.finishTurn('Again')).learning.status, 'skipped')
})

test('unsupported verification, errors and truncated receipts cannot approve completion or learn', async t => {
  const directory = await fixture(t)
  for (const bad of [
    { ...verification, checks: [] },
    { ...verification, checks: [{ ...verification.checks[0], evidence: [{ id: 'tool-1', quote: 'invented success' }] }] },
    { ...verification, checks: [{ ...verification.checks[0], status: 'needs_review' }] },
  ]) {
    const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, 'experience.json')), config: { enabled: ['completion', 'learning'] }, infer: async kind => { assert.equal(kind, 'completion'); return bad } })
    runtime.beginTurn('Create report')
    await runtime.observeTools([{ name: 'check', execute: async () => success }])[0].execute('id', {})
    assert.equal((await runtime.finishTurn('Done')).verification.status, 'needs_review')
  }
  for (const output of [{ ...success, isError: true }, { content: [{ type: 'text', text: 'x'.repeat(40000) }], details: {} }]) {
    const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, 'experience.json')), config: { enabled: ['completion', 'learning'] }, infer: async () => verification })
    runtime.beginTurn('Create report')
    await runtime.observeTools([{ name: 'check', execute: async () => output }])[0].execute('id', {})
    assert.equal((await runtime.finishTurn('Done')).verification.status, 'needs_review')
  }
})

test('learning rejects unsupported and sensitive candidates; disabled learning retains retrieval', async t => {
  const directory = await fixture(t)
  const store = createExperienceStore(join(directory, 'experience.json'))
  for (const candidate of [{ ...lesson, evidence: [{ id: 'tool-1', quote: 'invented' }] }, { ...lesson, body: 'remember password=fixture-only' }, { ...lesson, body: 'x'.repeat(5000) }]) {
    const runtime = createAgentPluginRuntime({ store, config: { enabled: ['experience', 'completion', 'learning'] }, infer: async kind => kind === 'completion' ? verification : { lessons: [candidate] } })
    runtime.beginTurn('report')
    await runtime.observeTools([{ name: 'check', execute: async () => success }])[0].execute('id', {})
    assert.equal((await runtime.finishTurn('ready')).learning.status, 'needs_review')
    assert.equal(store.load().entries.length, 0)
  }
  const runtime = createAgentPluginRuntime({ store, config: { enabled: ['experience', 'completion', 'learning'], autoLearn: false }, infer: async kind => { assert.equal(kind, 'completion'); return verification } })
  runtime.beginTurn('report')
  await runtime.observeTools([{ name: 'check', execute: async () => success }])[0].execute('id', {})
  assert.equal((await runtime.finishTurn('ready')).learning.status, 'disabled')
  assert(runtime.tools().some(tool => tool.name === 'experience_read'))
})

test('cancellation and a stale callback cannot write learned experience', async t => {
  const directory = await fixture(t)
  const store = createExperienceStore(join(directory, 'experience.json'))
  let resolveLearning, entered
  const ready = new Promise(resolve => { entered = resolve })
  const runtime = createAgentPluginRuntime({ store, config: { enabled: ['experience', 'completion', 'learning'] }, infer: async kind => {
    if (kind === 'completion') return verification
    entered()
    return new Promise(resolve => { resolveLearning = resolve })
  } })
  const abort = new AbortController()
  runtime.beginTurn('report')
  await runtime.observeTools([{ name: 'check', execute: async () => success }])[0].execute('id', {})
  const pending = runtime.finishTurn('ready', abort.signal)
  // Given a failed setup, when completion settles before learning starts, then fail without waiting for an impossible event.
  await Promise.race([ready, pending.then(result => assert.fail(`Learning did not start: ${JSON.stringify(result)}`))])
  abort.abort()
  runtime.beginTurn('next task')
  resolveLearning({ lessons: [lesson] })
  await assert.rejects(pending, /abort|cancel|superseded/i)
  assert.equal(store.load().entries.length, 0)
})

test('private experience updates merge concurrent writers and reject linked or shared state', async t => {
  const directory = await fixture(t)
  const file = join(directory, 'experience.json')
  const a = createExperienceStore(file), b = createExperienceStore(file)
  const input = { title: lesson.title, body: lesson.body, sources: [{ tool: 'check', digest: 'a'.repeat(64) }] }
  await Promise.all([a.append([input]), b.append([{ ...input, title: 'Second method', body: 'Check report region labels as well as counts.' }])])
  assert.equal(a.load().entries.length, 2)
  await a.append([input])
  assert.equal(a.load().entries.length, 2)
  const alias = join(directory, 'alias.json')
  await link(file, alias)
  assert.throws(() => a.load(), /unsafe|unavailable/i)
  await rm(alias)
  // Given unavailable Windows symlink privileges, then skip only this alias fixture and retain the other safety checks.
  await t.test('symbolic aliases are refused when link creation is available', async child => {
    try { await symlink(file, alias) } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') { child.skip('Windows fixture requires symbolic link creation permission'); return }
      throw error
    }
    try { assert.throws(() => createExperienceStore(alias).load(), /unsafe|unavailable/i) }
    finally { await rm(alias, { force: true }) }
  })
  if (process.platform !== 'win32') {
    await chmod(file, 0o644)
    assert.throws(() => a.load(), /unsafe|unavailable/i)
    await chmod(file, 0o600)
  }
  const before = await readFile(file)
  await assert.rejects(a.append([{ ...input, body: 'password=fixture-only' }]))
  assert.deepEqual(await readFile(file), before)
  await writeFile(file, '{broken', { mode: 0o600 })
  assert.throws(() => a.load())
})

test('experience omitted from the bounded prompt remains discoverable by search and pagination', async t => {
  const directory = await fixture(t)
  const file = join(directory, 'experience.json')
  const entries = Array.from({ length: 256 }, (_, index) => ({ id: index.toString(16).padStart(32, '0'), title: `${index}: ${'Long descriptive title '.repeat(4)}`,
    body: `Reusable method ${index}`, sources: [{ tool: 'check', digest: 'a'.repeat(64) }], createdAt: new Date().toISOString() }))
  await writeFile(file, JSON.stringify({ version: 1, entries }), { mode: 0o600 })
  if (process.platform === 'win32') protectProactivePath(file)
  const runtime = createAgentPluginRuntime({ store: createExperienceStore(file), config: { enabled: ['experience'] }, infer: async () => assert.fail('no model') })
  assert(!runtime.context().includes('255:'))
  const list = runtime.tools().find(tool => tool.name === 'experience_list')
  const found = JSON.parse((await list.execute('search', { query: 'method 255' })).content[0].text)
  assert.equal(found.entries[0].id, entries[255].id)
  assert.equal(found.total, 1)
  assert(!JSON.stringify(found).includes('Reusable method'))
  const page = JSON.parse((await list.execute('page', { offset: 224, limit: 32 })).content[0].text)
  assert.equal(page.entries.at(-1).id, entries[255].id)
  assert.equal(page.total, 256)
  await assert.rejects(list.execute('bad', { offset: -1 }))
})

test('missing receipts and launch-only receipts cannot certify downstream completion', async t => {
  const directory = await fixture(t)
  const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, 'experience.json')), config: { enabled: ['completion', 'learning'] },
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
  const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, 'experience.json')), config: { enabled: ['completion', 'learning'] },
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
    const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(directory, 'experience.json')), config: { enabled: ['completion', 'learning'] },
      infer: async kind => { assert.equal(kind, 'completion'); return { ...verification, checks: [{ ...verification.checks[0], scope: 'completion', evidence: [{ id: 'tool-1', quote: 'accepted' }] }] } } })
    runtime.beginTurn('Complete the delegated report')
    await runtime.observeTools([{ name, execute: async () => ({ content: [{ type: 'text', text: 'accepted' }], details: {} }) }])[0].execute('id', {})
    assert.equal((await runtime.finishTurn('The report is complete')).verification.status, 'needs_review')
  }
})
