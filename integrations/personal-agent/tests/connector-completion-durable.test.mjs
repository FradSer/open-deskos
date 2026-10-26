import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Type } from 'typebox'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { createDurableAgentSession } from '../src/durable-agent-session.mjs'
import { sessionAdapter } from '../src/agent.mjs'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { openDurableRuntime, durableCapability } from '../src/durable-runtime.mjs'
import { createConnectorCompletionGuard, createConnectorCompletionExtension,
  runBufferedConnectorSubmission, connectorNoExecutionAnswer } from '../src/connector-completion-guard.mjs'
import { assistant, fixtureModel } from './helpers/pi-fixture.mjs'

async function fixture(t, reply, { ready = true, toolFailure = false } = {}) {
  let calls = 0, executions = 0, runtime
  const controller = new AbortController(), owner = {}
  let current = { owner, intent: 'extension', ownerAccess: true, requestReady: ready, mcpAdmitted: true,
    allowedCapabilities: ['agent_mcp_tools', 'agent_mcp_call'], catalogFingerprint: 'a'.repeat(64), signal: controller.signal }
  const guard = createConnectorCompletionGuard(current)
  const requestId = 'one-real-owner-input'
  const binding = () => ({ guard, admission: current, requestId })
  const extension = createConnectorCompletionExtension({ getBinding: async () => binding(),
    submissionStatus: async (id, context) => (await runtime.harness.submission(id))?.status(context),
    recordRepair: async (receipt, context) => {
      await (await runtime.conversation.submit({ type: 'write', entry: { kind: 'odk.connector-repair', data: receipt } }, context)).wait(context)
    } })
  const tool = durableCapability({ name: 'agent_mcp_tools', label: 'Inspect connector', description: 'Read installed connector metadata.',
    parameters: Type.Object({}), execute: async () => {
      executions++
      if (toolFailure) throw Error('Fixture source outcome is unknown; do not replay')
      return { content: [{ type: 'text', text: 'Actual fixture connector metadata.' }] }
    } }, { callers: ['model', 'tools'] })
  const models = { getAuth: async () => undefined, getModel: () => fixtureModel, getAvailable: async () => [fixtureModel],
    getAvailableSnapshot: () => [fixtureModel], streamSimple: (_model, context) => {
    const result = Promise.resolve().then(() => reply({ context, call: ++calls, setCurrent: value => { current = value }, current, controller }))
    return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
  } }
  runtime = await openDurableRuntime({ ephemeral: true, codeMode: false, models,
    model: { provider: fixtureModel.provider, modelId: fixtureModel.id }, tools: [tool], extensions: [extension] })
  t.after(() => runtime.close())
  const submissions = new Map(), taskHistory = []
  const unsubscribe = runtime.harness.subscribeCommits(publication => {
    for (const change of publication.changes) {
      if (change.type === 'submission') submissions.set(change.value.id, change.value)
      if (change.type === 'task') taskHistory.push(change.value)
    }
  })
  t.after(unsubscribe)
  const published = [], afterTurn = []
  return { runtime, guard, controller, owner, requestId, published, afterTurn, taskHistory,
    get calls() { return calls }, get executions() { return executions },
    async run(after = answer => answer) {
      return runBufferedConnectorSubmission({ runtime, guard, getAdmission: async () => current,
        text: 'Read the installed connector.', requestId, context: BACKGROUND_CONTEXT,
        afterTurn: async answer => { afterTurn.push(answer); return after(answer) }, publish: answer => published.push(answer) })
    },
    async inputs() { return [...submissions.values()].filter(item => item.type === 'input') },
  }
}

const toolCall = () => assistant([{ type: 'toolCall', id: 'one-call', name: 'agent_mcp_tools', arguments: {} }], 'toolUse')

test('real Durable continuation uses one owner input and publishes only the final tool-backed answer', async t => {
  const f = await fixture(t, ({ call }) => call === 1 ? assistant('The connector permission is unavailable.')
    : call === 2 ? toolCall() : assistant('Read the actual connector metadata.'))
  const result = await f.run()
  assert.equal(f.calls, 3)
  assert.equal(f.executions, 1)
  assert.equal((await f.inputs()).length, 1)
  assert.deepEqual(f.afterTurn, ['Read the actual connector metadata.'])
  assert.deepEqual(f.published, ['Read the actual connector metadata.'])
  assert.equal(result.origin, 'model')
  const view = await f.runtime.conversation.viewState(BACKGROUND_CONTEXT)
  try {
    const text = JSON.stringify(view.value.entries)
    assert.match(text, /connector permission is unavailable/, 'The first draft remains private history')
    assert.match(text, /Host-generated connector execution check/)
    const repairs = view.value.entries.filter(entry => entry.kind === 'odk.connector-repair')
    assert.equal(repairs.length, 1)
    assert.equal(repairs[0].data.origin, 'host')
    assert.equal(repairs[0].data.ownerRequestId, f.requestId)
    assert.equal(repairs[0].data.authorizesNewActions, false)
    assert(f.taskHistory.some(task => Object.values(task.memos ?? {}).some(memo => memo.ownerRequestId === f.requestId)))
  } finally { view.dispose() }
})

test('a second zero-call answer becomes a host fact without claiming missing permission or input', async t => {
  const f = await fixture(t, () => assistant('The connector permission is unavailable.'))
  const result = await f.run()
  assert.equal(f.calls, 2)
  assert.equal(f.executions, 0)
  assert.equal((await f.inputs()).length, 1)
  assert.equal(result.origin, 'host')
  assert.deepEqual(f.afterTurn, [connectorNoExecutionAnswer])
  assert.deepEqual(f.published, [connectorNoExecutionAnswer])
  assert.doesNotMatch(result.answer, /permission|请补充/)
})

test('an attempted failed tool is never repeated by connector verification', async t => {
  const f = await fixture(t, ({ call }) => call === 1 ? toolCall() : assistant('The source outcome needs review.'), { toolFailure: true })
  assert.equal((await f.run()).answer, 'The source outcome needs review.')
  assert.equal(f.calls, 2)
  assert.equal(f.executions, 1)
  assert.equal(f.guard.evidence().attemptedRepairs, 0)
})

test('a host-declared missing input remains a legitimate clarification without another generation', async t => {
  const f = await fixture(t, () => assistant('Which source should I inspect?'), { ready: false })
  assert.equal((await f.run()).answer, 'Which source should I inspect?')
  assert.equal(f.calls, 1)
  assert.deepEqual(f.published, ['Which source should I inspect?'])
})

test('fresh admission changes at yield cancel without a corrective generation or publication', async t => {
  const f = await fixture(t, ({ current, setCurrent }) => {
    setCurrent({ ...current, catalogFingerprint: 'b'.repeat(64) })
    return assistant('The connector permission is unavailable.')
  })
  await assert.rejects(f.run(), /admission changed/)
  assert.equal(f.calls, 1)
  assert.equal(f.executions, 0)
  assert.deepEqual(f.published, [])
})

test('fresh admission is checked again after afterTurn and before final publication', async t => {
  const f = await fixture(t, ({ call, current, setCurrent }) => {
    if (call === 1) return toolCall()
    // Defer the change until the caller completion check runs.
    f.changeCatalog = () => setCurrent({ ...current, catalogFingerprint: 'b'.repeat(64) })
    return assistant('Read the actual connector metadata.')
  })
  await assert.rejects(f.run(answer => { f.changeCatalog(); return answer }), /admission changed/)
  assert.equal(f.executions, 1)
  assert.deepEqual(f.published, [])
})

for (const { executes, invalidate } of [{ executes: true, invalidate: false }, { executes: false, invalidate: false }, { executes: true, invalidate: true }]) {
  test(`resident subscriber publishes only final connector completion (executes: ${executes}, invalidate: ${invalidate})`, async t => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-connector-resident-')))
    t.after(() => rm(dir, { recursive: true, force: true }))
    let calls = 0, executions = 0
    const admission = { owner: {}, intent: 'extension', ownerAccess: true, requestReady: true, mcpAdmitted: true,
      allowedCapabilities: ['agent_mcp_tools', 'agent_mcp_call'], catalogFingerprint: 'a'.repeat(64), signal: new AbortController().signal }
    const models = { getAuth: async () => undefined, getModel: () => fixtureModel, getAvailable: async () => [fixtureModel],
      getAvailableSnapshot: () => [fixtureModel], streamSimple: () => {
        const call = ++calls
        const message = call === 1 ? assistant('The connector permission is unavailable.')
          : call === 2 && executes ? assistant([{ type: 'toolCall', id: 'inspect', name: 'codemode',
            arguments: { code: 'text(await tools.agent_mcp_tools({}));' } }], 'toolUse')
          : assistant(executes ? 'Read the actual fixture source.' : 'The connector permission is unavailable.')
        return { async *[Symbol.asyncIterator]() { yield { type: 'done', reason: message.stopReason, message } }, result: async () => message }
      } }
    const { session } = await createDurableAgentSession({ cwd: dir, durableDirectory: join(dir, 'durable'),
      excludeTools: ['read'], modelRuntime: models, model: fixtureModel, settingsManager: SettingsManager.inMemory({}),
      connectorAdmission: async () => admission, customTools: [{ name: 'agent_mcp_tools', label: 'Inspect source',
        description: 'Inspect fixture source metadata.', parameters: Type.Object({}), execute: async () => {
          executions++
          return { content: [{ type: 'text', text: 'Fixture metadata.' }] }
        } }] })
    t.after(() => session.dispose())
    const events = []
    session.subscribe(event => events.push(event))
    const snapshots = [], completions = []
    const adapter = sessionAdapter(session, { beginTurn: () => {}, afterTurn: async (_text, answer) => {
      completions.push(answer)
      assert.deepEqual(snapshots, [], 'No response may be published before the completion hook finishes')
      if (invalidate) admission.catalogFingerprint = 'b'.repeat(64)
      return `${answer} Final completion check.`
    } })
    const expected = executes ? 'Read the actual fixture source.' : connectorNoExecutionAnswer
    const result = adapter.prompt('Read the installed source.', text => snapshots.push(text))
    if (invalidate) await assert.rejects(result, /admission changed/)
    else assert.equal(await result, `${expected} Final completion check.`)
    assert.deepEqual(completions, [expected])
    assert.deepEqual(snapshots, invalidate ? [] : [`${expected} Final completion check.`])
    assert.equal(calls, executes ? 3 : 2)
    assert.equal(executions, executes ? 1 : 0)
    assert.equal(events.length, 1)
    assert.equal(events[0].type, 'message_end')
    assert.equal(events[0].message.content[0].text, executes ? 'Read the actual fixture source.' : connectorNoExecutionAnswer)
    assert.equal(session.hasBufferedConnectorCompletion(), true)
    if (invalidate) await assert.rejects(session.validateConnectorPublication(), /admission changed/)
    else await session.validateConnectorPublication()
    const view = await session.runtime.conversation.viewState(BACKGROUND_CONTEXT)
    try { assert.match(JSON.stringify(view.value.entries), /connector permission is unavailable/) } finally { view.dispose() }
  })
}
