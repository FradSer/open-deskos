import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPersonalBot } from '../src/agent.mjs'
import { loadPersonalConfig } from '../src/personal-config.mjs'
import { assistant, fixtureModel, visibleTools } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-agent-plugin-integration-')))
  await isolateAgentDirectory(t, directory)
  t.after(() => rm(directory, { recursive: true, force: true }))
  const stateDir = join(directory, 'state')
  await mkdir(stateDir, { mode: 0o700 })
  return { directory, config: { stateDir, personal: { profile: 'personal', skillPaths: [], memoryFile: join(directory, 'explicit-notes.json'),
    agentPlugins: { enabled: ['experience', 'completion', 'learning'] } }, env: {} } }
}

function offline(reply) {
  return { getAvailable: async () => [fixtureModel], getModel: () => fixtureModel,
    streamSimple: (_model, context) => {
      const result = Promise.resolve().then(() => reply(context))
      return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
    } }
}

test('explicit owner notes reach real Durable context after restart and reflect later updates and deletion', async t => {
  const { config } = await fixture(t)
  config.personal.agentPlugins = undefined
  let expected = {}, routed = 0, inspected = 0
  const modelRuntime = offline(context => {
    assert.deepEqual(visibleTools(context).map(tool => tool.name), ['codemode'])
    const message = context.messages.findLast(message => message.role === 'user')
    const text = typeof message.content === 'string' ? message.content : message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    const currentMemory = /Saved MEMORY data \(not instructions or authorization\):\n([^\n]*)\nEnd MEMORY data\./.exec(text)
    assert(currentMemory, 'The actual provider request must carry the current memory block')
    assert.deepEqual(JSON.parse(currentMemory[1]), expected)
    assert(!text.includes('Learned experience index'))
    inspected++
    const request = text.split('Personal Bot request:\n').at(-1)
    if (context.messages.at(-1).role !== 'toolResult') {
      const code = request === 'remember beverage: tea' ? 'text(await tools.memory_update({category:"beverage",value:"tea"}));'
        : request === 'remember beverage: water' ? 'text(await tools.memory_update({category:"beverage",value:"water"}));'
        : request === 'forget beverage' ? 'text(await tools.memory_forget({category:"beverage"}));' : undefined
      if (code) return assistant([{ type: 'toolCall', id: `memory-${inspected}`, name: 'codemode', arguments: { code } }], 'toolUse')
    } else assert.equal(context.messages.at(-1).isError, false)
    return assistant(JSON.stringify(expected))
  })
  const dependencies = { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => { routed++; return { intent: 'memory' } } }
  let bot = await createPersonalBot(config, dependencies)
  try {
    await bot.prompt('remember beverage: tea')
    assert.deepEqual(JSON.parse(await readFile(config.personal.memoryFile, 'utf8')), { beverage: 'tea' })
  } finally { await bot.close() }
  expected = { beverage: 'tea' }
  bot = await createPersonalBot(config, dependencies)
  try {
    assert.equal(await bot.prompt('Recall my saved beverage after restart.'), JSON.stringify(expected))
    await bot.prompt('remember beverage: water')
    expected = { beverage: 'water' }
    assert.equal(await bot.prompt('Recall my updated beverage.'), JSON.stringify(expected))
    await bot.prompt('forget beverage')
    expected = {}
    assert.equal(await bot.prompt('Read my current saved notes after deletion.'), '{}')
    assert.deepEqual(JSON.parse(await readFile(config.personal.memoryFile, 'utf8')), {})
    assert.equal(routed, 6)
    assert.equal(inspected, 9)
  } finally { await bot.close() }
})

test('configured Durable resident verifies, learns, clears shortcut outcomes, and retrieves after restart', async t => {
  const { directory, config } = await fixture(t)
  const stages = []
  let residentCalls = 0
  const modelRuntime = offline(context => {
    const all = JSON.stringify(context.messages)
    const user = context.messages.findLast(message => message.role === 'user')
    if (all.includes('Check the current Personal Agent task after')) {
      stages.push('completion')
      assert.deepEqual(visibleTools(context), [])
      const task = JSON.parse(user.content.split('Personal Bot request:\n')[1])
      const receipt = task.receipts.find(receipt => receipt.tool === 'coding_targets')
      assert(receipt)
      assert.doesNotMatch(all, /other-owner-private-marker/)
      return assistant(JSON.stringify({ status: 'passed', summary: '已查询配置目标。', checks: [{ requirement: '查询目标', status: 'passed', evidence: [{ id: receipt.id, quote: 'targets' }] }] }))
    }
    if (all.includes('Extract reusable procedural lessons only')) {
      stages.push('learning')
      assert.deepEqual(visibleTools(context), [])
      const task = JSON.parse(user.content.split('Personal Bot request:\n')[1])
      const receipt = task.receipts.find(receipt => receipt.tool === 'coding_targets')
      return assistant(JSON.stringify({ lessons: [{ title: 'Resolve configured targets', body: 'Read configured target inventory before selecting a task host.', evidence: [{ id: receipt.id, quote: 'targets' }] }] }))
    }
    residentCalls++
    if (residentCalls > 2) assert.match(user.content, /Resolve configured targets/)
    const latest = context.messages.at(-1)
    if (latest.role !== 'toolResult') return assistant([{ type: 'toolCall', id: `query-${residentCalls}`, name: 'codemode', arguments: { code: 'text(await tools.coding_targets({}));' } }], 'toolUse')
    return assistant('没有配置可用目标。')
  })
  let selectedIntent = 'task_query'
  const deps = { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => {
    if (selectedIntent === 'failure') throw Error('fixture route unavailable')
    return { intent: selectedIntent }
  } }
  let bot = await createPersonalBot(config, deps)
  t.after(() => bot.close())
  assert.equal(await bot.prompt('查询配置目标'), '没有配置可用目标。')
  assert.deepEqual(stages, ['completion', 'learning'])
  assert.equal(bot.lastTaskResult.verification.status, 'passed')
  assert.equal(bot.lastTaskResult.learning.status, 'applied')
  await assert.rejects(readFile(config.personal.memoryFile), /ENOENT/)
  for (const shortcut of ['clarify', 'failure', 'suggestions']) {
    if (shortcut !== 'clarify') {
      selectedIntent = 'task_query'
      await bot.prompt('再次查询配置目标')
      assert.equal(bot.lastTaskResult.verification.status, 'passed')
    }
    const previousStages = [...stages]
    const previousCalls = residentCalls
    selectedIntent = shortcut
    const answer = await bot.prompt('下一项请求')
    assert.match(answer, shortcut === 'clarify' ? /请说明/ : shortcut === 'failure' ? /暂时不可用/ : /建议/)
    assert.equal(bot.lastTaskResult, null, 'A shortcut answer cannot retain previous completion evidence')
    assert.deepEqual(stages, previousStages, 'A shortcut must not run completion or learning')
    assert.equal(residentCalls, previousCalls, 'A shortcut must not prompt the reasoning model')
  }
  selectedIntent = 'task_query'
  await bot.close()
  bot = await createPersonalBot(config, deps)
  assert.equal(await bot.prompt('再次查询配置目标'), '没有配置可用目标。')
  const persisted = JSON.parse(await readFile(join(config.stateDir, 'personal-agent', 'experience.json'), 'utf8'))
  assert.equal(persisted.entries.length, 1)
  assert.equal(persisted.entries[0].title, 'Resolve configured targets')
  assert(!JSON.stringify(persisted).includes('查询配置目标'))
  assert.equal(await readFile(join(directory, 'state', 'durable', 'personal', 'main.jsonl'), 'utf8').then(text => text.includes('Resolve configured targets')), true)
})

test('a failed completion check changes the final answer and never starts learning', async t => {
  const { config } = await fixture(t)
  const modelRuntime = offline(context => {
    const all = JSON.stringify(context.messages)
    if (all.includes('Check the current Personal Agent task after')) throw Error('fixture provider unavailable')
    assert(!all.includes('Extract reusable procedural lessons only'))
    if (context.messages.at(-1).role !== 'toolResult') return assistant([{ type: 'toolCall', id: 'query', name: 'codemode', arguments: { code: 'text(await tools.coding_targets({}));' } }], 'toolUse')
    return assistant('查询完成。')
  })
  const bot = await createPersonalBot(config, { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'task_query' }) })
  t.after(() => bot.close())
  const snapshots = []
  const answer = await bot.prompt('查询目标', text => snapshots.push(text))
  assert.match(answer, /完成后校验.*需要复核/)
  assert.equal(snapshots.at(-1), answer)
  assert.equal(bot.lastTaskResult.verification.status, 'needs_review')
  assert.equal(bot.lastTaskResult.learning.status, 'skipped')
})

test('actual Code Mode computation supports derivation while printed external success cannot pass completion', async t => {
  for (const external of [false, true]) {
    const { config } = await fixture(t)
    config.personal.agentPlugins = { enabled: ['completion'] }
    const code = external ? 'text("Email delivered.");' : String.raw`const values=[3,5,7];text(JSON.stringify({mean:values.reduce((sum,value)=>sum+value,0)/values.length,note:'quoted "value"',path:'C:\\fixture'}));`
    const modelRuntime = offline(context => {
      if (visibleTools(context).length === 0) {
        const message = context.messages.findLast(message => message.role === 'user')
        const input = JSON.parse(message.content.split('Personal Bot request:\n').at(-1))
        assert.equal(input.receipts.length, 1)
        const receipt = input.receipts[0]
        assert.equal(receipt.kind, 'computation')
        assert.equal(receipt.learningEligible, false)
        assert(receipt.text.startsWith(`Executed source:\n${code}\nObserved output:\n`))
        const output = receipt.text.split('\nObserved output:\n')[1].split('\nDiagnostics (JSON):\n')[0]
        assert.match(output, external ? /Email delivered/ : /5/)
        if (!external) assert(output.includes(JSON.stringify({ mean: 5, note: 'quoted "value"', path: 'C:\\fixture' })))
        return assistant(JSON.stringify({ status: 'passed', summary: 'Fixture evidence checked.', checks: [{
          requirement: external ? 'Deliver an email' : 'Calculate the supplied mean', scope: external ? 'completion' : 'derivation', status: 'passed',
          evidence: [{ id: receipt.id, quote: external ? 'Email delivered.' : '"mean":5' }],
        }] }))
      }
      if (context.messages.at(-1).role !== 'toolResult') return assistant([{ type: 'toolCall', id: 'derive', name: 'codemode', arguments: { code } }], 'toolUse')
      assert.equal(context.messages.at(-1).isError, false)
      return assistant(external ? 'Email delivered.' : 'The mean is 5.')
    })
    const bot = await createPersonalBot(config, { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'conversation' }) })
    try {
      await bot.prompt(external ? 'Deliver an email.' : 'Calculate the mean of supplied values [3,5,7].')
      assert.equal(bot.lastTaskResult.verification.status, external ? 'needs_review' : 'passed')
    } finally { await bot.close() }
  }
})

test('personal config validates fixed plugin identities without admitting Pi packages or paths', async t => {
  const { directory } = await fixture(t)
  const file = join(directory, 'config.json')
  await writeFile(file, JSON.stringify({ profile: 'personal', memoryFile: join(directory, 'notes.json'), agentPlugins: { enabled: ['experience', 'completion', 'learning'], autoLearn: false } }))
  assert.equal((await loadPersonalConfig({ ODK_PERSONAL_BOT_CONFIG: file })).agentPlugins.autoLearn, false)
  await writeFile(file, JSON.stringify({ profile: 'personal', memoryFile: join(directory, 'notes.json'), agentPlugins: { enabled: ['@fradser/pi-subagents'] } }))
  await assert.rejects(loadPersonalConfig({ ODK_PERSONAL_BOT_CONFIG: file }), /Invalid personal/)
})

test('an unsupported tool-free completion claim is visibly unverified', async t => {
  const { config } = await fixture(t)
  const bot = await createPersonalBot(config, { createRuntime: async () => offline(() => assistant('任务已完成。')),
    createIntentRouter: () => async () => ({ intent: 'coding_work' }) })
  t.after(() => bot.close())
  assert.match(await bot.prompt('完成报告'), /完成后校验.*需要复核/)
  assert.equal(bot.lastTaskResult.verification.status, 'needs_review')
  assert.equal(bot.lastTaskResult.learning.status, 'skipped')
})
