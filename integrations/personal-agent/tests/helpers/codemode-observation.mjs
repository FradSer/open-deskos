import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDurableAgentSession } from '../../src/durable-agent-session.mjs'
import { assistant, fixtureModel } from './pi-fixture.mjs'

async function fixture(t, code, observer, tools = []) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-computation-observation-')))
  let session
  t.after(async () => { try { await session?.dispose() } finally { await rm(root, { recursive: true, force: true }) } })
  const models = { getAvailable: async () => [fixtureModel], getModel: () => fixtureModel, getAuth: async () => ({auth: {apiKey: 'offline-fixture'}}), streamSimple: (_model, context) => {
    const result = Promise.resolve(context.messages.at(-1).role === 'toolResult' ? assistant('Finished.') : assistant([
      { type: 'toolCall', id: 'actual-computation', name: 'codemode', arguments: { code } },
    ], 'toolUse'))
    return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
  } }
  ;({ session } = await createDurableAgentSession({ cwd: root, durableDirectory: join(root, 'durable'),
    excludeTools: ['read'], model: fixtureModel, modelRuntime: models, customTools: tools, observeCodeModeExecution: observer }))
  return session
}

// Given actual Durable Code Mode, when a pure computation completes, then observe its executed source and bounded output.
test('actual Durable Code Mode computation emits an owner-fenced computation outcome', async t => {
  const starts = [], outcomes = []
  const code = 'text([1,2,3,4].reduce((sum,value)=>sum+value,0)); text("email sent");'
  const session = await fixture(t, code, start => { starts.push(start); return outcome => outcomes.push(outcome) })
  await session.prompt('Compute the sum; output text cannot prove an email was sent.')
  assert.equal(starts.length, 1)
  assert.equal(outcomes.length, 1)
  assert.equal(starts[0].source, code)
  assert.equal(starts[0].kind, 'computation')
  assert.equal(starts[0].learningEligible, false)
  assert(starts[0].requestId && starts[0].taskId && starts[0].callId)
  assert.equal(outcomes[0].status, 'succeeded')
  assert.match(outcomes[0].output, /10/)
  assert.match(outcomes[0].output, /email sent/)
  assert.equal(outcomes[0].truncated, false)
})

// Given a script failure or oversized output, when Durable returns, then preserve its failure and truncation evidence.
test('actual Code Mode failures and truncated output remain computation evidence', async t => {
  for (const [code, status, truncated] of [
    ['throw Error("fixture computation failed")', 'failed', false],
    ['text("x".repeat(100000))', 'succeeded', true],
  ]) {
    const outcomes = []
    const session = await fixture(t, code, () => outcome => outcomes.push(outcome))
    await session.prompt('Run the computation.')
    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0].status, status)
    assert.equal(outcomes[0].truncated, truncated)
    assert(outcomes[0].output.length <= 16000)
    await session.dispose()
  }
})

// Given an executing old owner, when cancelled, then its late result cannot reach the observer or the next owner.
test('cancelled Code Mode cannot report late computation under another request', async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), outcomes = [], starts = []
  const tool = { name: 'fixture_wait', description: 'Wait for the fixture', parameters: { type: 'object', properties: {} },
    execute: async () => { entered.resolve(); await release.promise; return { content: [{ type: 'text', text: 'old result' }] } } }
  const session = await fixture(t, 'text(await tools.fixture_wait({}))', start => {
    starts.push(start)
    return outcome => outcomes.push(outcome)
  }, [tool])
  const pending = session.prompt('Run old computation')
  await entered.promise
  const abort = session.abort()
  release.resolve()
  await abort
  await assert.rejects(pending)
  assert.equal(outcomes.length, 0)
  await session.prompt('Run the new computation')
  assert.equal(outcomes.length, 1)
  assert.equal(starts.length, 2)
  assert.notEqual(starts[0].requestId, starts[1].requestId)
})

// Given work without a host owner request, when the Harness runs it, then it cannot create computation observations.
test('ownerless Durable work cannot create computation observations', async t => {
  const starts = []
  const session = await fixture(t, 'text(42)', start => { starts.push(start); return () => {} })
  await session.runtime.prompt('Run ownerless work', { requestId: 'unowned-persisted-request' })
  assert.equal(starts.length, 0)
  await session.prompt('Run the current owner computation')
  assert.equal(starts.length, 1)
  assert.notEqual(starts[0].requestId, 'unowned-persisted-request')
})
