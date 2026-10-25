import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ProactiveWatch, validateOwnerConfig } from '../src/proactive.mjs'

const time = Date.parse('2026-10-23T10:00:00Z')
const action = { id: 'inspect', label: 'Inspect the current task history.', tool: 'coding_task_history', params: { target: 'cm5', project: '/workspace/example', taskId: 'e311a280-c0b9-4411-96cd-4e1e92385349' } }
const config = () => ({ version: 2, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000, maxCandidates: 8, maxPush: 3, generationIntervalMs: 0, attentionCooldownMs: 0, rules: [{ id: 'work', goal: 'Inspect a completed task.', delivery: 'immediate', urgent: false, observations: [{ readingId: 'work', fields: ['count'] }], actions: [structuredClone(action)] }], suppressed: [], snoozed: {} })
function fixture(overrides = {}) {
  let checkpoint = { version: 1, proposals: [] }, count = 1, available = true, now = time
  const requests = [], executions = [], frames = []
  const options = { config: config(), now: () => now, read: async id => ({ id, state: 'live', value: { count, measured_at: new Date(now).toISOString() } }),
    canExecute: () => available,
    generate: async input => { requests.push(input); return { suggestions: [{ topicId: 'work', key: 'inspect', advice: 'Review the completed task.', actionId: 'inspect', evidenceIds: ['e0'] }] } },
    judge: async ({ candidates }) => ({ model: 'jev-fixture', answers: Object.fromEntries(candidates.map(c => [c.id, { probability: .99, groundingProbability: .99, threshold: .8 }])) }),
    execute: async (...args) => { executions.push(args); return { outcome: 'completed', text: 'History inspected.' } },
    publish: frame => frames.push(frame), save: async () => {}, saveState: state => { checkpoint = structuredClone(state) }, loadState: () => structuredClone(checkpoint), ...overrides }
  const watch = new ProactiveWatch(options)
  return { watch, options, frames, requests, executions, available: v => { available = v }, count: v => { count = v; now += 60001 }, checkpoint: () => checkpoint }
}

test('host binds an approved currently executable action without exposing parameters to generation', async () => {
  const f = fixture(); await f.watch.tick(); const p = f.watch.list()[0]
  assert.deepEqual(f.requests[0].topics[0].actions, [{ id: action.id, label: action.label }])
  assert.equal(JSON.stringify(f.requests).includes('/workspace/example'), false)
  assert.equal(p.nextStep, action.label); assert.equal(p.actionId, action.id)
  assert.deepEqual(p.action, { tool: action.tool, params: action.params })
  assert.equal(p.confirmation, `确认执行 ${p.id}`)
  await assert.rejects(f.watch.respond(p.id, 'accept', p.confirmation), /presented/)
  await f.watch.presented([p.id]); await f.watch.respond(p.id, 'accept', p.confirmation)
  assert.equal(f.executions.length, 1); assert.equal(f.watch.list()[0].status, 'completed')
})

test('a missing or withdrawn current capability cannot offer or execute an action', async () => {
  for (const canExecute of [undefined, () => false, () => { throw Error('withdrawn') }]) {
    const f = fixture({ canExecute }); await f.watch.tick(); assert.equal(f.requests.length, 0); assert.equal(f.watch.list().length, 0)
  }
  const f = fixture(); await f.watch.tick(); const p = f.watch.list()[0]; await f.watch.presented([p.id]); f.available(false)
  await assert.rejects(f.watch.respond(p.id, 'accept', p.confirmation), /authorized|available/); assert.equal(f.executions.length, 0)
})

test('accepted unknown failed and restarted execution never report completed or replay', async () => {
  for (const outcome of ['accepted', 'unknown', 'failed']) {
    let executions = 0
    const f = fixture({ execute: async () => { executions++; return { outcome, text: `Observed ${outcome}.`, receipt: { requestId: 'fixture' } } } })
    await f.watch.tick(); const p = f.watch.list()[0]; await f.watch.presented([p.id]); await f.watch.respond(p.id, 'accept', p.confirmation)
    assert.equal(f.watch.list()[0].status, 'unknown'); assert.match(f.watch.list()[0].result, new RegExp(outcome))
    const restored = new ProactiveWatch(f.options); await restored.tick(); await assert.rejects(restored.respond(p.id, 'accept', p.confirmation)); assert.equal(executions, 1)
  }
})

test('owner action catalogs reject duplicate identifiers, forged permissions and malformed labels', () => {
  for (const changes of [{ actions: [] }, { actions: [action, action] }, { actions: [{ ...action, label: 'x\nnext' }] }, { actions: [{ ...action, tool: 'bash' }] }]) {
    const c = config(); Object.assign(c.rules[0], changes); assert.throws(() => validateOwnerConfig(c))
  }
})

test('completed generated action occurrences release capacity without replaying after restart', async () => {
  const f = fixture()
  for (let n = 1; n <= 65; n++) {
    f.count(n); await f.watch.tick(); const p = f.watch.list().find(p => p.status === 'pending')
    assert.ok(p, `need ${n} must fit`); await f.watch.presented([p.id]); await f.watch.respond(p.id, 'accept', p.confirmation)
  }
  assert.equal(f.executions.length, 65); assert.ok(Object.keys(f.checkpoint().handledOccurrences).length >= 65)
  const restored = new ProactiveWatch(f.options); await restored.tick(); assert.equal(restored.list().some(p => p.status === 'pending'), false)
})


test('a candidate cannot choose an unknown action or manufacture its own action text', async () => {
  for (const fields of [{ actionId: 'invented' }, { actionId: 'inspect', nextStep: 'Execute something else.' }, { actionId: 'inspect', params: { secret: true } }]) {
    const f = fixture({ generate: async () => ({ suggestions: [{ topicId: 'work', key: 'inspect', advice: 'Review the task.', evidenceIds: ['e0'], ...fields }] }) })
    await f.watch.tick(); assert.equal(f.watch.list().length, 0); assert.equal(f.executions.length, 0)
  }
})

test('changed observations and withdrawn publication capability cannot execute an earlier binding', async () => {
  const f = fixture(); await f.watch.tick(); const p = f.watch.list()[0]; await f.watch.presented([p.id]); f.count(2)
  await assert.rejects(f.watch.respond(p.id, 'accept', p.confirmation), /observations changed/); assert.equal(f.executions.length, 0)
  const withdrawn = fixture(); await withdrawn.watch.tick(); withdrawn.available(false); withdrawn.watch.emit()
  assert.equal(withdrawn.frames.at(-1).popup, false); assert.equal(withdrawn.watch.list()[0].status, 'expired')
})

test('an ordinary topic without owner actions never calls generation', async () => {
  const c = config(); delete c.rules[0].actions
  const f = fixture({ config: c }); await f.watch.tick(); assert.equal(f.requests.length, 0); assert.equal(f.frames.at(-1).popup, false)
})

test('historical read-only records never receive a new action from matching generated text', async () => {
  const f = fixture(); await f.watch.tick(); const original = f.watch.proposals[0]
  original.action = null; original.confirmation = ''; delete original.actionId
  await f.watch.tick(); const p = f.watch.list()[0]
  assert.equal(p.id, original.id); assert.equal(p.action, null); assert.equal(p.confirmation, '')
  await f.watch.respond(p.id, 'done'); assert.equal(f.executions.length, 0)
})

test('an executable generated card supports snooze but completion feedback cannot execute it', async () => {
  const f = fixture(); await f.watch.tick(); const p = f.watch.list()[0]
  await assert.rejects(f.watch.respond(p.id, 'done'), /read-only/)
  await f.watch.respond(p.id, 'snooze'); const saved = f.watch.list()[0]
  assert.equal(saved.snoozedUntil, time + 60000); assert.equal(saved.presented, false); assert.equal(saved.actionId, action.id)
  assert.equal(f.executions.length, 0)
})


test('capability withdrawal while the confirmation source read waits prevents execution', async () => {
  const f = fixture(); await f.watch.tick(); const p = f.watch.list()[0]; await f.watch.presented([p.id])
  const prior = f.watch.read
  f.watch.read = async (...args) => { f.available(false); return prior(...args) }
  await assert.rejects(f.watch.respond(p.id, 'accept', p.confirmation), /authorized/); assert.equal(f.executions.length, 0)
})


test('changed observations cannot reoffer the same need while its prior action outcome is unknown', async () => {
  let executions = 0
  const f = fixture({ execute: async () => { executions++; return { outcome: 'unknown', text: 'Delivery unknown.' } } })
  await f.watch.tick(); const p = f.watch.list()[0]; await f.watch.presented([p.id]); await f.watch.respond(p.id, 'accept', p.confirmation)
  f.count(2); await f.watch.tick(); assert.equal(f.watch.list().some(p => p.status === 'pending'), false)
  assert.equal(f.watch.list().filter(p => p.status === 'unknown').length, 1); assert.equal(executions, 1)
})

test('closing the Watch during its confirmation source read prevents late execution and publication', async () => {
  const f = fixture(); await f.watch.tick(); const p = f.watch.list()[0]; await f.watch.presented([p.id])
  let release, entered
  const reading = new Promise(resolve => { entered = resolve })
  const hold = new Promise(resolve => { release = resolve })
  const prior = f.watch.read
  f.watch.read = async (...args) => { entered(); await hold; return prior(...args) }
  const response = f.watch.respond(p.id, 'accept', p.confirmation)
  await reading; await f.watch.close()
  const published = f.frames.length
  release()
  await assert.rejects(response, /closed|stopped|aborted|unavailable/)
  assert.equal(f.executions.length, 0)
  assert.equal(f.frames.length, published)
  assert.notEqual(f.watch.proposals[0].status, 'executing')
})

test('a source push after one confirmation read invalidates the pending multi-source action', async () => {
  const c = config(); c.rules[0].observations.push({ readingId: 'other', fields: ['count'] })
  const f = fixture({ config: c }); await f.watch.tick(); const p = f.watch.list()[0]; await f.watch.presented([p.id])
  let release, entered
  const waiting = new Promise(resolve => { entered = resolve })
  const hold = new Promise(resolve => { release = resolve })
  const prior = f.watch.read
  f.watch.read = async (...args) => {
    const observed = await prior(...args)
    if (args[0] === 'other') { entered(); await hold }
    return observed
  }
  const response = f.watch.respond(p.id, 'accept', p.confirmation)
  await waiting; assert.equal(f.watch.push(['work']), true); release()
  await assert.rejects(response, /source|observation|changed/)
  assert.equal(f.executions.length, 0); assert.notEqual(f.watch.proposals[0].status, 'executing')
  await f.watch.close()
})

test('the actual dispatch guard refuses a stopped or superseded Watch after executor routing waits', async () => {
  for (const change of ['close', 'capability', 'source', 'owner']) {
    let release, entered, mutations = 0, seen
    const waiting = new Promise(resolve => { entered = resolve })
    const hold = new Promise(resolve => { release = resolve })
    const f = fixture({ execute: async (_tool, _params, _confirmation, context) => {
      seen = context; entered(); await hold
      if (!context?.isCurrent() || context.signal.aborted) throw Error('Dispatch no longer current')
      mutations++; return { outcome: 'completed', text: 'Actual operation completed.' }
    } })
    await f.watch.tick(); const p = f.watch.list()[0]; await f.watch.presented([p.id])
    const response = f.watch.respond(p.id, 'accept', p.confirmation)
    await waiting
    if (change === 'close') await f.watch.close()
    else if (change === 'capability') f.available(false)
    else if (change === 'source') f.watch.push(['work'])
    else f.watch.config.rules[0].actions[0].params.project = '/different-owner-target'
    release(); await response
    assert.equal(typeof seen?.isCurrent, 'function', 'The executor must receive the current-dispatch guard')
    assert.equal(mutations, 0, change); assert.equal(f.watch.proposals[0].status, 'unknown', change)
    await f.watch.close()
  }
})

test('an unknown owner action cannot replay through changed generated keys advice or owner revisions', async () => {
  let key = 'first', advice = 'Inspect the completed task.', executions = 0
  const generate = async () => ({ suggestions: [{ topicId: 'work', key, advice, actionId: 'inspect', evidenceIds: ['e0'] }] })
  const f = fixture({ generate, execute: async () => { executions++; return { outcome: 'unknown', text: 'Transport outcome unknown.', receipt: { taskId: action.params.taskId, mutationId: '11111111-1111-4111-8111-111111111111' } } } })
  await f.watch.tick(); const p = f.watch.list()[0]; await f.watch.presented([p.id]); await f.watch.respond(p.id, 'accept', p.confirmation)
  key = 'different-semantic-key'; advice = 'Read another description of this task.'; f.count(2); await f.watch.tick()
  assert.equal(f.watch.list().some(p => p.status === 'pending'), false, 'Changed model text cannot authorize a retry')
  const c = config(); c.rules[0].goal = 'The owner revised the task goal.'; c.rules[0].actions[0].label = 'Read the saved task history.'
  const restarted = new ProactiveWatch({ ...f.options, config: c })
  key = 'another-key-after-restart'; advice = 'Inspect the newly described current task.'
  await restarted.tick()
  assert.equal(restarted.list().some(p => p.status === 'pending'), false, 'Owner text changes cannot retry identical unknown effects')
  assert.equal(restarted.list().find(entry => entry.id === p.id)?.execution.receipt.mutationId, '11111111-1111-4111-8111-111111111111')
  assert.equal(executions, 1)
})

test('a distinct approved action can still be generated while another action is unknown', async () => {
  let selected = 'inspect', key = 'first'
  const c = config(); c.rules[0].actions.push({ ...structuredClone(action), id: 'other', params: { ...action.params, taskId: '11111111-1111-4111-8111-111111111111' } })
  const f = fixture({ config: c, generate: async () => ({ suggestions: [{ topicId: 'work', key, advice: `Review the ${selected} task.`, actionId: selected, evidenceIds: ['e0'] }] }), execute: async () => ({ outcome: 'unknown', text: 'Unconfirmed task read.' }) })
  await f.watch.tick(); const p = f.watch.list()[0]; await f.watch.presented([p.id]); await f.watch.respond(p.id, 'accept', p.confirmation)
  selected = 'other'; key = 'independent-task'; f.count(2); await f.watch.tick()
  const pending = f.watch.list().filter(p => p.status === 'pending')
  assert.equal(pending.length, 1); assert.equal(pending[0].actionId, 'other')
})

test('owner and generated action identifiers must be explicit strings', async () => {
  for (const id of [undefined, null, 7, {}, ['inspect']]) {
    const c = config(); c.rules[0].actions[0].id = id
    assert.throws(() => validateOwnerConfig(c), /Invalid proactive owner configuration/)
  }
  const c = config(); delete c.rules[0].actions[0].id
  assert.throws(() => validateOwnerConfig(c), /Invalid proactive owner configuration/)
  const { validateGeneratedBatch } = await import('../src/proactive-generation.mjs')
  for (const actionId of [undefined, null, 7, {}, ['inspect']]) {
    const topic = { id: 'work', actions: [{ id: actionId, label: 'Inspect task.' }], evidence: [{ id: 'e0' }] }
    assert.throws(() => validateGeneratedBatch({ suggestions: [{ topicId: 'work', key: 'work', advice: 'Inspect task.', actionId, evidenceIds: ['e0'] }] }, [topic], 1), /Invalid generated suggestion/)
  }
})


test('two pending cards cannot replay the same action after the first outcome becomes unknown', async () => {
  let executions = 0
  const f = fixture({ generate: async () => ({ suggestions: ['one', 'two'].map(key => ({ topicId: 'work', key, advice: `Inspect ${key} task description.`, actionId: 'inspect', evidenceIds: ['e0'] })) }), execute: async () => { executions++; return { outcome: 'unknown', text: 'Outcome unknown.' } } })
  await f.watch.tick(); const [first, second] = f.watch.list(); assert.ok(first && second)
  await f.watch.presented([first.id, second.id]); await f.watch.respond(first.id, 'accept', first.confirmation)
  await assert.rejects(f.watch.respond(second.id, 'accept', second.confirmation), /pending|authorized/)
  assert.equal(executions, 1)
})
