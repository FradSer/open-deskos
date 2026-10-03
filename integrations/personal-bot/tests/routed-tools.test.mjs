import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPersonalBot } from '../src/agent.mjs'
import { assistant, fixtureModel, offlineSession, visibleTools } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

const repository = fileURLToPath(new URL('../../..', import.meta.url))
for (const profile of ['personal', 'coding']) {
  test(`${profile} routes exact direct and Code Mode calls through one per-turn capability boundary`, async t => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-routed-tools-')))
    t.after(() => rm(dir, { recursive: true, force: true }))
    await isolateAgentDirectory(t, dir)
    const targets = process.env.ODESK_TASK_TARGETS_FILE
    delete process.env.ODESK_TASK_TARGETS_FILE
    t.after(() => { if (targets !== undefined) process.env.ODESK_TASK_TARGETS_FILE = targets })
    let intent = 'task_query', call, session, turn = 0
    const events = []
    const agent = await createPersonalBot({ stateDir: dir, workspace: repository, personal: { profile, skillPaths: [], memoryFile: join(dir, 'memory.json') } }, {
      createIntentRouter: () => async () => { events.push('jev'); turn++; return { intent } },
      createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }),
      createSession: async options => {
        const created = await offlineSession(options, context => {
          events.push('model')
          assert.deepEqual(visibleTools(context).map(tool => tool.name), ['codemode'])
          const result = context.messages.findLast(message => message.role === 'toolResult' && message.toolCallId === `call-${turn}`)
          if (!result) return assistant([{ type: 'toolCall', id: `call-${turn}`, ...call }], 'toolUse')
          const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
          if (call.name === 'coding_targets' || call.name === 'codemode') {
            assert.equal(result.isError, false)
            assert.match(text, /targets/)
            assert.doesNotMatch(text, /not found|Script failed/)
          } else assert.equal(result.isError, true)
          return assistant('当前工具调用已验证。')
        })
        session = created.session
        return created
      },
    })
    t.after(() => agent.close())
    for (call of [
      { name: 'coding_targets', arguments: {} },
      { name: 'codemode', arguments: { code: 'text(await tools.coding_targets({}));' } },
      { name: 'user_app_install', arguments: { path: '/not-authorized' } },
      { name: 'coding_target', arguments: {} },
    ]) {
      assert.equal(await agent.prompt('查询当前任务'), '当前工具调用已验证。')
      assert.deepEqual(session.getActiveToolNames(), profile === 'personal' ? ['codemode'] : ['read', 'grep', 'find', 'ls', 'codemode'])
    }
    const modelCalls = events.filter(event => event === 'model').length
    intent = 'clarify'
    await agent.prompt('继续')
    assert.equal(events.filter(event => event === 'model').length, modelCalls)
    assert(!session.getActiveToolNames().includes('coding_targets'))
    assert.equal(events[0], 'jev')
  })
}

test('reviewed extensions keep schema checks, original failures and exactly-once effects across both call entries', async t => {
  const { writeFile } = await import('node:fs/promises')
  const { pathToFileURL } = await import('node:url')
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-routed-extension-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  const modulePath = join(dir, 'reviewed.mjs')
  await writeFile(modulePath, `export const calls = [];
let start; export const started = new Promise(resolve => { start = resolve });
export default async () => ['reviewed_read', 'reviewed_change'].map(name => ({
  name, label: name, description: name === 'reviewed_read' ? 'Read one reviewed measurement.' : 'Perform one explicitly requested reviewed change.',
  annotations: { readOnlyHint: name === 'reviewed_read' },
  parameters: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false },
  outputSchema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] },
  execute: async (_id, params, signal) => {
    calls.push({name, value:params.value});
    if (params.value === 99) { start(signal); await new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('Fixture call aborted')), {once:true})); }
    if (name === 'reviewed_change') throw Error('Fixture outcome unknown after side effect');
    return { content: [{type:'text', text:JSON.stringify(params)}], details:{}, structuredContent:params };
  }
}));`)
  const capability = await import(pathToFileURL(modulePath).href)
  let intent = 'extension', call, session, turn = 0, expectedError = false
  let inferenceFailure = false
  const agent = await createPersonalBot({ stateDir: dir, workspace: repository, capabilityPaths: [modulePath] }, {
    createIntentRouter: () => async () => { turn++; if (inferenceFailure) throw Error('Fixture Jev failure'); return { intent } },
    createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }),
    createSession: async options => {
      const created = await offlineSession(options, context => {
        assert.deepEqual(visibleTools(context).map(tool => tool.name), ['codemode'])
        const result = context.messages.findLast(message => message.role === 'toolResult' && message.toolCallId === `extension-${turn}`)
        if (!result) return assistant([{ type: 'toolCall', id: `extension-${turn}`, ...call }], 'toolUse')
        const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
        if (intent === 'extension' && call.name === 'reviewed_change') {
          const replay = context.messages.findLast(message => message.role === 'toolResult' && message.toolCallId === `replay-${turn}`)
          if (!replay) return assistant([{ type: 'toolCall', id: `replay-${turn}`, name: 'codemode', arguments: {
            code: `text(await tools.reviewed_change(${JSON.stringify(call.arguments)}));`,
          } }], 'toolUse')
          assert.match(replay.content.filter(part => part.type === 'text').map(part => part.text).join('\n'), /already attempted|replay refused/i)
        }
        if (expectedError) assert.match(text, /validation|Invalid|not found|Script failed|outcome unknown/i)
        else { assert.equal(result.isError, false); assert.match(text, /value/); assert.doesNotMatch(text, /Script failed/) }
        return assistant('调用结果已核对。')
      })
      session = created.session
      return created
    },
  })
  t.after(() => agent.close())
  const cases = [
    [{ name: 'reviewed_read', arguments: { value: 1 } }, false, 1],
    [{ name: 'codemode', arguments: { code: 'text(await tools.reviewed_read({value:2}));' } }, false, 1],
    [{ name: 'reviewed_read', arguments: { value: 'invalid' } }, true, 0],
    [{ name: 'codemode', arguments: { code: 'text(await tools.reviewed_read({value:"invalid"}));' } }, true, 0],
    [{ name: 'reviewed_chnge', arguments: { value: 3 } }, true, 0],
    [{ name: 'reviewed_change', arguments: { value: 4 } }, true, 1],
    [{ name: 'codemode', arguments: { code: 'text(await tools.reviewed_change({value:5}));' } }, true, 1],
  ]
  for (const [next, error, effects] of cases) {
    call = next; expectedError = error
    const before = capability.calls.length
    assert.equal(await agent.prompt('通过已审核的能力处理当前请求'), '调用结果已核对。')
    assert.equal(capability.calls.length - before, effects, 'no correction or replay changes side-effect count')
    assert(!session.getCallableToolNames().includes('reviewed_change'), 'turn completion deactivates the extension')
  }
  assert.deepEqual(capability.calls, [
    { name: 'reviewed_read', value: 1 }, { name: 'reviewed_read', value: 2 },
    { name: 'reviewed_change', value: 4 }, { name: 'reviewed_change', value: 5 },
  ])
  intent = 'conversation'; call = { name: 'reviewed_change', arguments: { value: 6 } }
  assert.equal(await agent.prompt('你好'), '调用结果已核对。')
  assert.equal(capability.calls.length, 4, 'another intent cannot reuse an extension entry')
  inferenceFailure = true
  assert.match(await agent.prompt('通过已审核的能力处理当前请求'), /Jev.*不可用/)
  assert.equal(capability.calls.length, 4)
  inferenceFailure = false; intent = 'extension'; call = { name: 'reviewed_read', arguments: { value: 99 } }
  const pending = agent.prompt('读取一个可能需要取消的结果')
  const signal = await capability.started
  assert(session.getCallableToolNames().includes('reviewed_read'))
  assert(!session.getCallableToolNames().includes('coding_task_start'))
  await agent.abort()
  await assert.rejects(pending, /aborted|Agent request failed/)
  assert.equal(signal.aborted, true)
  assert.equal(capability.calls.length, 5, 'cancellation does not replay a started call')
  assert(!session.getCallableToolNames().includes('reviewed_read'))
})
