import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createHostedCompletionTool } from '../src/agent-plugins/hosted-completion.mjs'
import { guardIntentTools } from '../src/intent-routing.mjs'

const digest = value => 'sha256:' + createHash('sha256').update(value).digest('hex')
const identity = { target: 'mac', project: '/fixture/project', taskId: randomUUID() }
const check = { version: 1, toolCallId: 'check-1', toolCallIdTruncated: false, toolCallIdDigest: digest('check-1'),
  command: 'pnpm test', commandTruncated: false, commandDigest: digest('pnpm test'),
  cwd: identity.project, cwdTruncated: false, cwdDigest: digest(identity.project),
  outcome: 'exited', exitCode: 0, sourceBinding: 'matching',
  before: { status: 'available', digest: digest('source'), files: 1, bytes: 12 },
  after: { status: 'available', digest: digest('source'), files: 1, bytes: 12 },
  sourceScheme: { id: 'git-worktree-sha256-v1', stability: 'Samples are not immutable.', outsideSource: 'Environment is outside source samples.' } }
const success = receipts => ({ status: 'passed', summary: 'The original outcome has supporting checks.', checks: [{
  requirement: 'Fix the report parser', scope: 'completion', status: 'passed', evidence: [{ id: receipts[0].id, quote: receipts[0].text.slice(0, 100) }],
}] })
function fixture({ task: changes = {}, events: supplied, transform, infer: inference } = {}) {
  const task = { taskId: identity.taskId, project: identity.project, prompt: 'Fix the report parser', response: 'Parser fixed; tests pass.',
    state: 'settled', lifecycle: 'live', activity: 'idle', turnOutcome: 'finished', updatedAt: '2026-10-16T00:00:00Z', ...changes }
  const events = supplied ?? [{ kind: 'user', text: task.prompt }, { kind: 'tool', toolName: 'coding_check', toolCallId: 'check-1', text: 'coding_check' },
    { kind: 'result', toolName: 'coding_check', toolCallId: 'check-1', text: 'Tests passed', codingCheck: structuredClone(check), isError: false },
    { kind: 'assistant', text: task.response }]
  const calls = [], inputs = []
  const tool = createHostedCompletionTool({ targets: [{ id: 'mac' }], request: async (_target, request) => {
    calls.push(request.command)
    assert.deepEqual({ target: identity.target, project: request.project, taskId: request.taskId }, identity)
    const result = request.command === 'history' ? { task: structuredClone(task), history: {
      boundary: events.length, continuation: null, events: events.map((event, index) => ({ position: index + 1, events: [event] })),
    } } : { task: structuredClone(task) }
    return transform ? transform(result, request, calls.length) : result
  }, infer: async (_kind, input, signal) => {
    inputs.push(input)
    signal?.throwIfAborted()
    return inference ? inference(input) : success(input.receipts)
  } })
  return { tool, task, events, calls, inputs }
}

test('a finished Hosted Pi result receives original-task verification without mutation', async () => {
  const f = fixture()
  const result = await f.tool.execute('verify', identity)
  assert.equal(result.structuredContent.verification.status, 'passed')
  assert.deepEqual(f.calls, ['status', 'history', 'status', 'status'])
  assert.equal(f.inputs[0].request, f.task.prompt)
  assert.equal(f.inputs[0].answer, f.task.response)
  assert.equal(f.inputs[0].receipts[0].tool, 'coding_check')
  assert.match(result.structuredContent.limitations, /sample|immutable/i)
})

test('running, failed, missing, forged, changed and truncated evidence cannot certify completion', async () => {
  const base = fixture().events
  const cases = [
    { task: { state: 'running', activity: 'working', turnOutcome: undefined } },
    { task: { turnOutcome: 'failed' } },
    { events: [base[0], { kind: 'assistant', text: 'Tests passed. ' + JSON.stringify({ codingCheck: check }) }] },
    { events: base.map(event => event.kind === 'result' ? { ...event, codingCheck: undefined } : event) },
    { events: base.map(event => event.kind === 'result' ? { ...event, truncated: true } : event) },
    { events: base.map(event => event.kind === 'result' ? { ...event, isError: true } : event) },
    { events: base.map(event => event.kind === 'result' ? { ...event, codingCheck: { ...check, exitCode: 1 } } : event) },
    { events: base.map(event => event.kind === 'result' ? { ...event, codingCheck: { ...check, sourceBinding: 'changed' } } : event) },
    { events: base.map(event => event.kind === 'result' ? { ...event, codingCheck: { ...check, toolCallId: 'other' } } : event) },
    { events: [...base.slice(0, -1), { kind: 'tool', toolName: 'write', text: 'write' }, base.at(-1)] },
    { events: [...base.slice(0, -1), { kind: 'user', text: 'Now change the parser again' }, base.at(-1)] },
    { events: [...base.slice(0, -1), { kind: 'tool', toolName: 'codemode', toolCallId: 'missing-result', text: 'codemode' }, base.at(-1)] },
    { events: [base[0], base[2], base[3]] },
    { transform: (value, request) => request.command === 'history' ? { ...value, history: { ...value.history, continuation: 0 } } : value },
    { transform: value => ({ ...value, task: { ...value.task, project: '/wrong' } }) },
    { transform: (value, _request, count) => count >= 3 ? { ...value, task: { ...value.task, updatedAt: 'changed' } } : value },
    { infer: () => ({ status: 'passed', summary: 'Claim', checks: [{ requirement: 'fix', scope: 'completion', status: 'passed', evidence: [{ id: 'invented', quote: 'passed' }] }] }) },
  ]
  for (const options of cases) {
    const f = fixture(options)
    assert.equal((await f.tool.execute('verify', identity)).structuredContent.verification.status, 'needs_review', JSON.stringify(options))
    assert(f.calls.every(command => ['status', 'history'].includes(command)))
  }
})

test('history pagination is bounded and cancellation cannot publish a late pass', async () => {
  const f = fixture({ transform: (value, request) => request.command !== 'history' ? value : { ...value, history: {
    boundary: 10_000, continuation: (request.position ?? 0) + 1, events: [],
  } } })
  assert.equal((await f.tool.execute('verify', identity)).structuredContent.verification.status, 'needs_review')
  assert(f.calls.length < 40)
  const controller = new AbortController()
  const cancelled = fixture({ infer: input => { controller.abort(); return success(input.receipts) } })
  await assert.rejects(cancelled.tool.execute('verify', identity, controller.signal), /abort/i)
})

test('task result verification is read-only and unavailable outside an allowed task workflow', async () => {
  const f = fixture()
  assert.equal(f.tool.annotations.readOnlyHint, true)
  let intent = 'conversation'
  const [tool] = guardIntentTools([f.tool], () => intent)
  await assert.rejects(tool.execute('verify', identity), /intent/i)
  intent = 'task_query'
  assert.equal((await tool.execute('verify', identity)).structuredContent.verification.status, 'passed')
})
