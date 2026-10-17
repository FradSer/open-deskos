import { parsePluginInput } from '../src/agent-plugins/prompt.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPersonalBot } from '../src/agent.mjs'
import { openAgentCatalog } from '../src/agent-catalog/catalog.mjs'
import { assistant, fixtureModel, visibleTools } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

function runtime(reply) {
  return { getAvailable: async () => [fixtureModel], getModel: () => fixtureModel,
    streamSimple: (_model, context) => {
      const result = Promise.resolve().then(() => reply(context))
      return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
    } }
}
const execute = (id, code) => assistant([{ type: 'toolCall', id, name: 'codemode', arguments: { code } }], 'toolUse')

test('the actual Durable resident admits a general child with no parent history or recursive child tools', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-task-resident-')))
  let bot
  t.after(async () => { try { if (bot) childFinish.resolve(); await bot?.close() } finally { await rm(root, { recursive: true, force: true }) } })
  await isolateAgentDirectory(t, root)
  const childReached = Promise.withResolvers(), childFinish = Promise.withResolvers()
  const updates = []
  let childTaskId, mode = 'parent', calls = 0, routed = 0
  const models = runtime(async context => {
    assert.deepEqual(visibleTools(context).map(tool => tool.name), ['codemode'])
    const text = JSON.stringify(context.messages.findLast(message => message.role === 'user').content)
    if (text.includes('Inspect child-only measurements')) {
      assert(!JSON.stringify(context).includes('parent-history-marker'))
      assert(!text.includes('"agent_start"'))
      assert(text.includes('Host-admitted workflow: agent_execute'))
      assert(!text.includes('Use agent_start'))
      childReached.resolve()
      await childFinish.promise
      return assistant('Child inspected the supplied measurements.')
    }
    if (context.messages.at(-1).role !== 'toolResult') {
      if (mode === 'parent') return execute(`start-${++calls}`, 'text(await tools.agent_start({request:"Inspect child-only measurements",role:"Report only measured differences."}));')
      if (mode === 'denied') return execute(`denied-${++calls}`, 'text(await tools.agent_start({request:"forbidden extra task"}));')
      return execute(`status-${++calls}`, `text(await tools.agent_status({taskId:${JSON.stringify(childTaskId)}}));`)
    }
    const result = context.messages.at(-1)
    if (mode === 'denied') { assert.equal(result.isError, true); return assistant('No task started.') }
    assert.equal(result.isError, false, JSON.stringify(result.content))
    return assistant(mode === 'parent' ? 'Task accepted; completion is pending.' : 'Read the actual child result.')
  })
  const config = { stateDir: join(root, 'state'), env: {}, onAgentUpdate: tasks => updates.push(tasks), personal: {
    profile: 'personal', skillPaths: [], memoryFile: join(root, 'notes.json'), agentPlugins: { enabled: ['subagents'] },
  } }
  bot = await createPersonalBot(config, { createRuntime: async () => models, createIntentRouter: () => async input => {
    routed++
    assert.notEqual(input.text, 'Inspect child-only measurements', 'an admitted child must not receive a second routing judgment')
    return { intent: mode === 'parent' ? 'agent_work' : mode === 'denied' ? 'conversation' : 'task_query' }
  } })
  await bot.prompt('Start a task; parent-history-marker stays in my conversation.')
  await childReached.promise
  const active = bot.agentTasks.activity()
  assert.equal(active.length, 1)
  childTaskId = active[0].taskId
  assert.equal(active[0].state, 'running')
  childFinish.resolve()
  const result = await bot.agentTasks.wait(childTaskId)
  assert.equal(result.state, 'finished')
  assert.equal(result.verification.status, 'not_run')
  assert.match(result.response, /Child inspected/)
  assert(updates.some(tasks => tasks.some(task => task.taskId === childTaskId && task.state === 'running')))
  mode = 'status'
  await bot.prompt('Read that child task result.')
  mode = 'denied'
  await bot.prompt('Only discuss the work.')
  assert.equal(bot.agentTasks.list().total, 1)
  assert.equal(routed, 3)
})

test('a saved Durable child uses an installed MCP and retains its own verified lessons after restart', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-saved-child-')))
  let bot
  t.after(async () => { try { await bot?.close() } finally { await rm(root, { recursive: true, force: true }) } })
  await isolateAgentDirectory(t, root)
  const config = { stateDir: join(root, 'state'), env: {}, personal: { profile: 'personal', skillPaths: [], memoryFile: join(root, 'notes.json'),
    agentPlugins: { enabled: ['subagents', 'catalog', 'mcp', 'experience', 'completion', 'learning'] } } }
  const catalog = await openAgentCatalog(join(config.stateDir, 'personal-agent', 'packages'))
  await catalog.installMcp({ schemaVersion: 1, kind: 'mcp', id: 'reports', name: 'Offline report connector', transport: { type: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/agent-mcp-server.mjs', import.meta.url))] } })
  let sequence = 0, restarted = false, retrieved = false
  const models = runtime(context => {
    const content = context.messages.findLast(message => message.role === 'user').content
    const raw = typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    if (visibleTools(context).length === 0) {
      const input = parsePluginInput(raw.slice('Personal Bot request:\n'.length))
      const receipt = input.receipts.at(-1)
      if ('existingExperience' in input) return assistant(JSON.stringify({ lessons: input.request === 'Child report fixture' ? [{
        title: 'Report region checks', body: 'Check the reported region count before presenting a regional report.', evidence: [{ id: receipt.id, quote: 'Checks: 3 passed' }],
      }] : [] }))
      const admission = receipt.admissionOnly
      return assistant(JSON.stringify({ status: 'passed', summary: admission ? 'The child task was admitted.' : 'The requested report was checked.', checks: [{
        requirement: admission ? 'Start the requested child' : 'Inspect the report', scope: admission ? 'admission' : 'completion', status: 'passed',
        evidence: [{ id: receipt.id, quote: admission ? 'taskId' : 'Checks: 3 passed' }],
      }] }))
    }
    const child = raw.includes('Personal Bot request:\nChild report fixture')
    if (child && restarted) {
      assert(raw.includes('Report region checks'))
      assert(!raw.includes('Check the reported region count'))
    }
    if (context.messages.at(-1).role !== 'toolResult') {
      if (!child) return execute(`parent-${++sequence}`, 'text(await tools.agent_start({request:"Child report fixture",identityId:"reporter"}));')
      assert(raw.includes('Host-admitted workflow: agent_execute'))
      assert(JSON.stringify(context.messages).includes('Read each requested region.'))
      return execute(`child-${++sequence}`, `${restarted ? 'const entries=await tools.experience_list({query:"Report region checks"}); text(await tools.experience_read({id:entries.entries[0].id}));' : ''} const d=await tools.agent_mcp_tools({id:"reports"}); text(await tools.agent_mcp_call({id:"reports",revision:d.value.revision,tool:"echo",arguments:{text:"Checks: 3 passed"}}));`)
    }
    const result = context.messages.at(-1)
    assert.equal(result.isError, false, JSON.stringify(result.content))
    if (child && restarted) { assert(JSON.stringify(result.content).includes('Check the reported region count')); retrieved = true }
    return assistant(child ? 'Checks: 3 passed.' : 'Child task admitted.')
  })
  const dependencies = { createRuntime: async () => models, createIntentRouter: () => async () => ({ intent: 'agent_work' }) }
  bot = await createPersonalBot(config, dependencies)
  bot.agentTasks.saveIdentity({ id: 'reporter', name: 'Reporter', role: 'Read each requested region.', avatar: 'book' })
  await bot.prompt('Start the saved reporter task.')
  let task = bot.agentTasks.list().tasks[0]
  let result = await bot.agentTasks.wait(task.taskId)
  assert.equal(result.state, 'finished')
  assert.equal(result.verification.status, 'passed')
  assert.equal(result.learning, 'applied')
  assert.equal(result.identity.avatar, 'book')
  await bot.close()
  restarted = true
  bot = await createPersonalBot(config, dependencies)
  await bot.prompt('Run the saved reporter again.')
  task = bot.agentTasks.list().tasks[0]
  result = await bot.agentTasks.wait(task.taskId)
  assert.equal(result.state, 'finished')
  assert.equal(result.verification.status, 'passed')
  assert.equal(result.learning, 'skipped')
  assert.equal(retrieved, true)
})
