import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createPersonalBot, sessionAdapter } from '../src/agent.mjs'
import { createIntentTurn, guardIntentTools } from '../src/intent-routing.mjs'
import { assistant, fixtureModel, visibleTools } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'
import { ProactiveWatch } from '../src/proactive.mjs'
import { proposalStateStore } from '../src/proactive-state.mjs'
import { openDurableRuntime, durableCapability, createPiExecutionTarget } from '../src/durable-runtime.mjs'
import { createDurableAgentSession } from '../src/durable-agent-session.mjs'
import { SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'

function runtime(reply) {
  const requests = []
  return { requests, getAvailable: async () => [fixtureModel], getModel: () => fixtureModel,
    getModels: () => [fixtureModel], getAvailableSnapshot: () => [fixtureModel],
    streamSimple: (_model, context, options) => {
      requests.push(context)
      const result = Promise.resolve(reply(context, requests.length, options))
      return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
    },
  }
}

async function fixture(t, profile = 'personal') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-durable-resident-')))
  await isolateAgentDirectory(t, dir)
  t.after(() => rm(dir, { recursive: true, force: true }))
  const workspace = join(dir, 'project')
  await mkdir(join(workspace, '.git'), { recursive: true })
  await mkdir(join(workspace, '.agents', 'skills', 'odk-widget'), { recursive: true })
  await writeFile(join(workspace, '.agents', 'skills', 'odk-widget', 'SKILL.md'), '# Isolated fixture skill\n')
  return { dir, config: { stateDir: join(dir, 'state'), workspace,
    personal: { profile, memoryFile: join(dir, 'memory.json'), skillPaths: [] }, env: {} } }
}

for (const profile of ['personal', 'coding']) {
  test(`default ${profile} resident imports legacy context once without restoring tool authority`, async t => {
    const { config } = await fixture(t, profile)
    const cwd = profile === 'personal' ? config.stateDir : config.workspace
    const saved = SessionManager.create(cwd, profile === 'personal' ? join(config.stateDir, 'personal', 'sessions') : join(config.stateDir, 'sessions'))
    saved.appendMessage({ role: 'system', content: 'obsolete system fixture', timestamp: 1 })
    const kept = saved.appendMessage({ role: 'user', content: 'legacy owner fixture', timestamp: 2 })
    saved.appendMessage(assistant([{ type: 'toolCall', id: 'legacy-write', name: 'write', arguments: { path: '/never-execute', content: 'fixture' } }], 'toolUse'))
    saved.appendCompaction('legacy summary fixture', kept, 100)
    const file = saved.getSessionFile()
    const before = await readFile(file, 'utf8')
    const modelRuntime = runtime(context => {
      assert.deepEqual(visibleTools(context).map(tool => tool.name), ['codemode'])
      assert.equal(context.messages.filter(message => message.role === 'user' && message.content === 'legacy owner fixture').length, 1)
      assert(!JSON.stringify(context.messages).includes('obsolete system fixture'))
      assert(JSON.stringify(context.messages).includes('legacy summary fixture'))
      const historical = context.messages.find(message => message.role === 'toolResult' && message.toolCallId === 'legacy-write')
      assert.equal(historical?.isError, true)
      assert(!JSON.stringify(context.messages).includes('later legacy fixture'))
      return assistant('保留原有上下文。')
    })
    const dependencies = { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'conversation' }) }
    let bot = await createPersonalBot(config, dependencies)
    t.after(() => bot.close())
    assert.equal(await bot.prompt('new owner fixture'), '保留原有上下文。')
    assert.equal(await readFile(file, 'utf8'), before)
    await bot.close()
    saved.appendMessage({ role: 'user', content: 'later legacy fixture', timestamp: Date.now() })
    bot = await createPersonalBot(config, dependencies)
    assert.equal(await bot.prompt('another owner fixture'), '保留原有上下文。')
  })

  test(`default ${profile} resident uses persisted Durable state and actual nested capability execution`, async t => {
    const { config } = await fixture(t, profile)
    const modelRuntime = runtime(context => {
      assert.deepEqual(visibleTools(context).map(tool => tool.name), ['codemode'])
      const result = context.messages.findLast(message => message.role === 'toolResult')
      if (!result) return assistant([{ type: 'toolCall', id: 'targets-1', name: 'codemode', arguments: {
        code: 'text(await tools.coding_targets({}));',
      } }], 'toolUse')
      assert.equal(result.isError, false)
      assert.match(JSON.stringify(result.content), /targets/)
      return assistant('当前没有配置目标。')
    })
    const dependencies = { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'task_query' }) }
    let bot = await createPersonalBot(config, dependencies)
    t.after(() => bot.close())
    const snapshots = []
    assert.equal(await bot.prompt('查询 Pi 目标', text => snapshots.push(text)), '当前没有配置目标。')
    assert.equal(snapshots.at(-1), '当前没有配置目标。')
    assert(snapshots.every(text => !/targets|Script completed/.test(text)))
    const directory = join(config.stateDir, 'durable', profile)
    const before = await readFile(join(directory, 'main.jsonl'), 'utf8')
    assert.match(before, /查询 Pi 目标/)
    await bot.close()
    bot = await createPersonalBot(config, dependencies)
    assert.equal(await bot.prompt('再次查询目标'), '当前没有配置目标。')
    assert(modelRuntime.requests.at(-1).messages.some(message => message.role === 'user' && message.content.includes('查询 Pi 目标')))
  })
}

test('an existing Durable conversation takes precedence over legacy context without an import checkpoint', async t => {
  const { config } = await fixture(t)
  const models = runtime(() => assistant('existing Durable answer'))
  const seed = await openDurableRuntime({ directory: join(config.stateDir, 'durable', 'personal'), models,
    model: { provider: fixtureModel.provider, modelId: fixtureModel.id } })
  await seed.prompt('existing Durable request')
  await seed.close()
  const saved = SessionManager.create(config.stateDir, join(config.stateDir, 'personal', 'sessions'))
  saved.appendMessage({ role: 'user', content: 'excluded legacy fixture', timestamp: 1 })
  const modelRuntime = runtime(context => {
    assert(JSON.stringify(context.messages).includes('existing Durable request'))
    assert(!JSON.stringify(context.messages).includes('excluded legacy fixture'))
    return assistant('继续已有 Durable 会话。')
  })
  const bot = await createPersonalBot(config, { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'conversation' }) })
  t.after(() => bot.close())
  assert.equal(await bot.prompt('current request'), '继续已有 Durable 会话。')
})

test('production proactive advice and briefing use isolated zero-tool Durable conversations', async t => {
  const { config } = await fixture(t)
  const requests = []
  const modelRuntime = runtime(context => {
    requests.push(context)
    assert.deepEqual(visibleTools(context), [])
    assert(!context.messages.some(message => message.role === 'user' && message.content.includes('resident private fixture')))
    if (JSON.stringify(context.messages).includes('Organize the owner-approved')) return assistant('[0,1]')
    if (JSON.stringify(context.messages).includes('Generate useful, concise proactive')) return assistant('{"suggestions":[]}')
    return assistant('{"items":[{"sources":[0]}]}')
  })
  const bot = await createPersonalBot(config, { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'conversation' }) })
  t.after(() => bot.close())
  const proposals = await bot.generateProposals({ topics: [], maxCandidates: 1 })
  assert.deepEqual(proposals, { suggestions: [] })
  const briefing = await bot.generateBriefing({ readings: [{ id: 'mail', label: 'Mail', kind: 'package', state: 'live', value: { subject: 'fixture' } }] })
  assert.deepEqual(briefing.items[0].readingIds, ['mail'])
  assert.equal(await bot.phraseProposal({ advice: '观察读数。检查来源。' }), '观察读数。检查来源。')
  assert.equal(requests.length, 3)
})

test('default Durable resident keeps exact-turn private memory authorization', async t => {
  const { dir, config } = await fixture(t)
  await mkdir(join(dir, 'private'), { mode: 0o700 })
  config.personal.memoryFile = join(dir, 'private', 'memory.json')
  let count = 0
  const modelRuntime = runtime(context => {
    const turn = ++count
    if (turn % 2 === 1) return assistant([{ type: 'toolCall', id: `memory-${turn}`, name: 'codemode', arguments: {
      code: 'text(await tools.memory_update({category:"偏好",value:"测试偏好"}));',
    } }], 'toolUse')
    const result = context.messages.findLast(message => message.role === 'toolResult')
    assert.equal(result.isError, true)
    return assistant('未获得记忆变更授权。')
  })
  const bot = await createPersonalBot(config, { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'memory' }) })
  t.after(() => bot.close())
  assert.equal(await bot.prompt('我之前说过什么偏好？'), '未获得记忆变更授权。')
  await assert.rejects(readFile(config.personal.memoryFile), /ENOENT/)
})

test('a proactive heartbeat uses production Durable generation and preserves deduplication after restart', async t => {
  const { dir, config } = await fixture(t)
  const now = Date.parse('2026-10-15T10:00:00.000Z')
  const frames = []
  let generations = 0
  const modelRuntime = runtime(context => {
    assert.deepEqual(visibleTools(context), [])
    const request = JSON.parse(context.messages.findLast(message => message.role === 'user').content.split('Personal Bot request:\n')[1])
    generations++
    const evidenceIds = request.topics[0].evidence.map(item => item.id)
    return assistant(JSON.stringify({ suggestions: [{ topicId: 'deliveries', key: 'collect', advice: '有待领取的物品，可以安排领取。', nextStep: 'Open the referenced source and inspect the pending item.', evidenceIds }] }))
  })
  const owner = { version: 2, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000, maxCandidates: 4, maxPush: 2,
    suppressed: [], snoozed: {}, rules: [{ id: 'deliveries', goal: '及时领取待取物品。',
      observations: [{ readingId: 'thirdparty.parcels', fields: ['ready', 'count'] }], delivery: 'immediate', urgent: false }] }
  const state = proposalStateStore(join(dir, 'private', 'proposals.json'))
  let watch
  let bot = await createPersonalBot({ ...config, getWatch: () => watch }, { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'conversation' }) })
  t.after(async () => { await watch?.close(); await bot.close() })
  const createWatch = () => new ProactiveWatch({ config: owner, now: () => now, loadState: state.load, saveState: state.save,
    generate: bot.generateProposals,
    read: async id => ({ id, label: '物品服务', state: 'live', value: { ready: true, count: 2, measured_at: new Date(now).toISOString() } }),
    judge: async ({ candidates }) => ({ model: 'jev-fixture', answers: Object.fromEntries(candidates.map(candidate => [candidate.id,
      { probability: 0.95, groundingProbability: 0.95, threshold: 0.8 }])) }),
    publish: frame => frames.push(frame), save: async () => {}, execute: async () => assert.fail('a proactive heartbeat must not execute an action'),
  })
  watch = createWatch()
  await watch.tick()
  assert.equal(generations, 1)
  const proposal = watch.list().find(proposal => proposal.status === 'pending')
  assert(proposal)
  assert.equal(frames.at(-1).popup, true)
  await watch.presented([proposal.id])
  await watch.close()
  await bot.close()
  bot = await createPersonalBot({ ...config, getWatch: () => watch }, { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'conversation' }) })
  watch = createWatch()
  await watch.tick()
  assert.equal(watch.list()[0].id, proposal.id)
  assert.equal(frames.at(-1).popup, false)
  assert.equal(generations, 1, 'unchanged observations reuse the persisted generation checkpoint')
})

test('production recovery blocks old tool authority while a fresh persisted request can execute', async t => {
  const { dir } = await fixture(t)
  const directory = join(dir, 'conversation')
  let effects = 0, entered
  const ready = new Promise(resolve => { entered = resolve })
  const capability = { name: 'reviewed_change', label: 'Fixture change', description: 'One fixture effect.',
    parameters: { type: 'object', properties: {} }, execute: async () => { effects++; return { content: [{ type: 'text', text: 'effect' }] } } }
  const blockedModel = runtime((_context, _count, options) => {
    entered()
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('fixture interrupted')), { once: true }))
  })
  const seed = await openDurableRuntime({ directory, models: blockedModel, model: { provider: fixtureModel.provider, modelId: fixtureModel.id }, tools: [durableCapability(capability)] })
  await seed.submit('old fixture request', { requestId: 'old-fixture-turn' })
  await ready
  await seed.close()
  let oldRejected = false
  const modelRuntime = runtime(context => {
    const request = context.messages.findLast(message => message.role === 'user').content
    const last = context.messages.at(-1)
    if (last.role === 'toolResult') {
      if (request === 'old fixture request') {
        assert.equal(last.isError, true)
        assert.match(JSON.stringify(last.content), /active owner request|authorization/)
        oldRejected = true
      } else assert.equal(last.isError, false)
      return assistant(request === 'old fixture request' ? '旧请求没有当前授权。' : '新的请求已执行。')
    }
    return assistant([{ type: 'toolCall', id: `fixture-${request}`, name: 'codemode', arguments: { code: 'text(await tools.reviewed_change({}));' } }], 'toolUse')
  })
  const events = []
  const turn = createIntentTurn({ route: async () => { events.push('jev'); return { intent: 'extension' } }, profile: 'personal', tools: [capability.name] })
  const guarded = guardIntentTools([capability], turn.getIntent)
  const { session } = await createDurableAgentSession({ cwd: dir, durableDirectory: directory, customTools: guarded,
    excludeTools: ['read'], modelRuntime, model: fixtureModel, settingsManager: SettingsManager.inMemory({}) })
  t.after(() => session.dispose())
  const adapter = sessionAdapter(session, {
    prepareTurn: turn.prepare,
    beginTurn: text => {
      if (text) {
        events.push('begin')
        assert.equal(oldRejected, true, 'Pending work must settle before the new owner turn begins')
        assert.equal(effects, 0, 'A recovered submission cannot borrow the newly selected extension intent')
        assert.equal(turn.getIntent(), 'extension')
      } else turn.clear()
    },
  })
  assert.equal(await adapter.prompt('new fixture request'), '新的请求已执行。')
  assert.deepEqual(events, ['jev', 'begin'])
  assert.equal(effects, 1)
  const view = await session.runtime.conversation.viewState(BACKGROUND_CONTEXT)
  assert(view.value.entries.some(entry => entry.model?.some(message => message.role === 'assistant' && message.content.some(part => part.type === 'text' && part.text === '新的请求已执行。'))))
  view.dispose()
})

test('the production coding coordinator reads through Durable tools and finds files through Pi env', async t => {
  const { dir } = await fixture(t)
  let inventoryCalls = 0
  await mkdir(join(dir, 'nested'))
  await mkdir(join(dir, 'node_modules'))
  await mkdir(join(dir, '.agents'))
  await writeFile(join(dir, 'nested', 'measurement.txt'), 'actual environment fact')
  await writeFile(join(dir, 'node_modules', 'excluded.txt'), 'dependency fixture')
  await writeFile(join(dir, '.config.json'), '{}')
  await writeFile(join(dir, '.agents', 'SKILL.md'), 'hidden fixture')
  const modelRuntime = runtime(context => {
    const last = context.messages.at(-1)
    if (last.role === 'toolResult') {
      assert.equal(last.isError, false)
      const text = JSON.stringify(last.content)
      assert.match(text, /actual environment fact/)
      assert.match(text, /nested\/measurement.txt/)
      assert.doesNotMatch(text, /node_modules|excluded.txt/)
      assert.match(text, /\.config.json/)
      assert.match(text, /\.agents\/SKILL.md/)
      return assistant('已读取实际文件并确认搜索结果。')
    }
    return assistant([{ type: 'toolCall', id: 'inspection', name: 'codemode', arguments: {
      code: 'text(await tools.read({path:"nested/measurement.txt"})); text(await tools.find({pattern:"*.txt"})); text(await tools.find({pattern:"nested/*.txt"})); text(await tools.find({pattern:"*.json"})); text(await tools.find({pattern:"**/*.md"}));',
    } }], 'toolUse')
  })
  const { session } = await createDurableAgentSession({ cwd: dir, durableDirectory: join(dir, 'durable'), modelRuntime, model: fixtureModel,
    excludeTools: ['write', 'edit', 'bash', 'powershell'], settingsManager: SettingsManager.inMemory({}) }, {
    createTarget: options => {
      const target = createPiExecutionTarget(options)
      const list = target.env.listFiles.bind(target.env)
      target.env.listFiles = (...args) => { inventoryCalls++; return list(...args) }
      return target
    },
  })
  t.after(() => session.dispose())
  await session.setActiveToolsByName(['read', 'find', 'grep', 'ls', 'codemode'])
  await session.prompt('读取并搜索实际文件')
  assert.equal(inventoryCalls, 4, 'every actual search uses the Pi environment daemon')
})

test('committed Durable partials preserve identical text across tool turns and exclude thinking', async t => {
  const { config } = await fixture(t)
  let releaseFirst, releaseSecond, calls = 0
  const first = new Promise(resolve => { releaseFirst = resolve })
  const second = new Promise(resolve => { releaseSecond = resolve })
  t.after(() => { releaseFirst(); releaseSecond() })
  const modelRuntime = { getAvailable: async () => [fixtureModel], getModel: () => fixtureModel,
    streamSimple: () => {
      const turn = ++calls
      const message = assistant(turn === 1 ? [{ type: 'text', text: '相同的内容。' }, { type: 'toolCall', id: 'partial-tool', name: 'codemode', arguments: { code: 'text(await tools.coding_targets({}));' } }] : '相同的内容。', turn === 1 ? 'toolUse' : 'stop')
      const partial = assistant([{ type: 'thinking', thinking: 'private reasoning fixture' }, { type: 'text', text: '相同的内容。' }])
      return { async *[Symbol.asyncIterator]() {
        yield { type: 'text_delta', contentIndex: 1, delta: '相同的内容。', partial }
        await (turn === 1 ? first : second)
        yield { type: 'done', reason: message.stopReason, message }
      }, result: async () => message }
    },
  }
  const bot = await createPersonalBot(config, { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'task_query' }) })
  t.after(() => bot.close())
  const snapshots = []
  const text = await bot.prompt('查询任务并保持回复内容', snapshot => {
    snapshots.push(snapshot)
    if (snapshot === '相同的内容。') releaseFirst()
    if (snapshot === '相同的内容。\n\n相同的内容。') releaseSecond()
  })
  assert.equal(text, '相同的内容。\n\n相同的内容。')
  assert.equal(snapshots.at(-1), text)
  assert(snapshots.every(snapshot => !/private reasoning|targets|Script/.test(snapshot)))
  assert.equal(calls, 2)
})

for (const action of ['abort', 'close']) {
  test(`production resident ${action} cancels an active Durable request and releases its lifecycle`, async t => {
    const { config } = await fixture(t)
    let entered, calls = 0
    const ready = new Promise(resolve => { entered = resolve })
    const modelRuntime = runtime((_context, _count, options) => {
      if (++calls > 1) return assistant('后续请求正常完成。')
      entered()
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Error('fixture model aborted')), { once: true }))
    })
    const dependencies = { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'conversation' }) }
    let bot = await createPersonalBot(config, dependencies)
    t.after(() => bot.close())
    const work = bot.prompt('保持请求运行')
    const rejected = assert.rejects(work)
    await ready
    if (action === 'abort') await bot.abort()
    else await bot.close()
    await rejected
    if (action === 'close') {
      await bot.close()
      bot = await createPersonalBot(config, dependencies)
    }
    assert.equal(await bot.prompt('开始后续请求'), '后续请求正常完成。')
  })
}

test('historical direct capability calls retain the same Durable guard while only Code Mode is offered', async t => {
  const { config } = await fixture(t)
  const modelRuntime = runtime(context => {
    assert.deepEqual(visibleTools(context).map(tool => tool.name), ['codemode'])
    const last = context.messages.at(-1)
    if (last.role === 'toolResult') {
      assert.equal(last.isError, false, JSON.stringify(last.content))
      assert.match(JSON.stringify(last.content), /targets/)
      return assistant('直接调用已通过当前意图检查。')
    }
    return assistant([{ type: 'toolCall', id: 'historical-direct', name: 'coding_targets', arguments: {} }], 'toolUse')
  })
  const bot = await createPersonalBot(config, { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'task_query' }) })
  t.after(() => bot.close())
  assert.equal(await bot.prompt('查询任务目标'), '直接调用已通过当前意图检查。')
})

test('direct and nested Durable entries share one mutation reservation after an unknown effect', async t => {
  const { dir, config } = await fixture(t, 'coding')
  const capability = join(dir, 'reviewed.mjs')
  await writeFile(capability, `export const calls=[];
    export default async()=>[{name:'reviewed_change',label:'Fixture change',description:'Fixture mutation.',
      parameters:{type:'object',properties:{value:{type:'integer'}},required:['value']},
      execute:async(_id,args)=>{calls.push(args.value);throw Error('fixture effect outcome unknown')}}];`)
  config.capabilityPaths = [capability]
  let calls = 0
  const modelRuntime = runtime(context => {
    assert.deepEqual(visibleTools(context).map(tool => tool.name), ['codemode'])
    const last = context.messages.at(-1)
    if (++calls === 1) return assistant([{ type: 'toolCall', id: 'first-change', name: 'reviewed_change', arguments: { value: 7 } }], 'toolUse')
    assert.equal(last.isError, true)
    if (calls === 2) {
      assert.match(JSON.stringify(last.content), /outcome unknown/)
      return assistant([{ type: 'toolCall', id: 'repeat-change', name: 'codemode', arguments: { code: 'text(await tools.reviewed_change({value:7}));' } }], 'toolUse')
    }
    assert.match(JSON.stringify(last.content), /already attempted|replay refused/)
    return assistant('变更结果未知，未重试。')
  })
  const bot = await createPersonalBot(config, { createRuntime: async () => modelRuntime, createIntentRouter: () => async () => ({ intent: 'extension' }) })
  t.after(() => bot.close())
  assert.equal(await bot.prompt('执行一次已审核的测试变更'), '变更结果未知，未重试。')
  assert.deepEqual((await import(pathToFileURL(capability).href)).calls, [7])
})
