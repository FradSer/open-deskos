import { nodeExecutable } from './helpers/node-executable.mjs'
import { endpoint, tokenEnvironment, requests } from './helpers/private-channel.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { createPersonalBotComposition, personalBotManifest, BOT_PORTS } from '../src/plugin-composition.mjs'
import { loadPersonalBotReplacements } from '../src/development-plugins.mjs'
import { HomeBriefing } from '../src/home-briefing.mjs'
import { PersonalBotService } from '../src/service.mjs'
import { loadCapabilities } from '../src/capabilities.mjs'
import { agentOptions, validateWorkspace, createPersonalBot, createResourceLoader, sessionAdapter } from '../src/agent.mjs'

test('a routed conversation stays concise when completion and learning are enabled', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'odk-conversation-verification-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  let listener, calls = 0
  const bot = await createPersonalBot({ stateDir: join(dir, 'state'), env: {},
    personal: { profile: 'personal', memoryFile: join(dir, 'memory.json'), skillPaths: [], agentPlugins: { enabled: ['completion', 'learning'], autoLearn: true } },
  }, {
    createIntentRouter: () => async () => ({ intent: 'conversation' }),
    createRuntime: async () => ({ getAvailable: async () => [{ provider: 'fixture', id: 'model' }] }),
    createSession: async options => {
      calls++
      assert.equal(options.ephemeral, undefined, 'A conversation must not create a verification conversation')
      return { session: { isStreaming: false, bindExtensions: async () => {}, setActiveToolsByName() {},
        subscribe(callback) { listener = callback; return () => { listener = undefined } },
        async prompt() { listener({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '你好。' }], stopReason: 'stop' } }) },
        abort: async () => {}, dispose() {},
      } }
    },
  })
  t.after(() => bot.close())
  assert.equal(await bot.prompt('你好'), '你好。')
  assert.equal(bot.lastTaskResult.verification.status, 'not_run')
  assert.equal(calls, 1)
})

test('pre-cancelled Agent initialization does not create its router or state directory', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-init-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  await assert.rejects(createPersonalBot({ stateDir: join(dir, 'state'), signal: controller.signal }, {
    createIntentRouter: () => { calls++; return async () => ({ intent: 'conversation' }) },
  }), { name: 'AbortError' })
  assert.equal(calls, 0)
  const { access } = await import('node:fs/promises')
  await assert.rejects(access(join(dir, 'state')), /ENOENT/)
})

for (const stage of ['runtime', 'models', 'session', 'binding', 'failed-binding']) {
  test(`Agent startup owns cancellation and cleanup during ${stage}`, async t => {
    const dir = await mkdtemp(join(tmpdir(), 'voice-init-'))
    t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
    const controller = new AbortController()
    let entered
    const ready = new Promise(resolve => { entered = resolve })
    let release
    const gate = new Promise(resolve => { release = resolve })
    let sessions = 0
    let binds = 0
    let disposed = 0
    let aborted = 0
    const session = {
      async bindExtensions() {
        binds++
        if (stage === 'failed-binding') throw Error('fixture binding failed')
        if (stage === 'binding') { entered(); await gate }
      },
      async abort() { aborted++; release() },
      dispose() { disposed++ },
      setActiveToolsByName() {},
    }
    const initializing = createPersonalBot({ stateDir: join(dir, 'state'), signal: controller.signal,
      personal: { profile: 'personal', memoryFile: join(dir, 'memory.json'), skillPaths: [] }, env: {},
    }, {
      createIntentRouter: () => async () => ({ intent: 'conversation' }),
      createRuntime: async options => {
        assert.equal(options.signal, controller.signal)
        if (stage === 'runtime') {
          options.signal.addEventListener('abort', release, { once: true })
          entered(); await gate
        }
        return { async getAvailable(_filter, options) {
        assert.equal(options.signal, controller.signal)
        if (stage === 'models') {
          options.signal.addEventListener('abort', release, { once: true })
          entered(); await gate
        }
        return [{ provider: 'fixture', id: 'model' }]
      } }
      },
      createSession: async () => {
        sessions++
        if (stage === 'session') { entered(); await gate }
        return { session }
      },
    })
    const rejected = assert.rejects(initializing, stage === 'failed-binding' ? /fixture binding failed/ : { name: 'AbortError' })
    if (stage !== 'failed-binding') {
      await ready
      controller.abort()
      if (stage === 'session') release()
    }
    await rejected
    assert.equal(sessions, ['runtime', 'models'].includes(stage) ? 0 : 1)
    assert.equal(binds, ['binding', 'failed-binding'].includes(stage) ? 1 : 0)
    assert.equal(disposed, ['runtime', 'models'].includes(stage) ? 0 : 1)
    assert.equal(aborted, ['runtime', 'models'].includes(stage) ? 0 : 1)
  })
}

test('real SDK resource loader loads the widget skill without undefined agentDir', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-loader-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
  const loader = await createResourceLoader(fileURLToPath(new URL('../../..', import.meta.url)), dir)
  assert.ok(loader.getSkills().skills.some(skill => skill.name === 'odk-widget'))
  assert.match(loader.getAppendSystemPrompt().join('\n'), /never edit active/i)
  assert.equal(loader.getExtensions().extensions.length, 1, 'only the installed SDK codemode factory loads')
  const instructions = loader.getAppendSystemPrompt().join('\n')
  assert.match(instructions, /默认使用简体中文/)
  assert.match(instructions, /尊重用户明确指定的其他语言/)
  assert.match(instructions, /coding_targets/)
  assert.match(instructions, /full exposed tool set/)
  assert.doesNotMatch(instructions, /edit\/test-only defaults|Never automatically commit, push, install or deploy/)
  assert.doesNotMatch(instructions, /live sessions/)
  assert.doesNotMatch(instructions, /without markdown/)
  assert.match(instructions, /Markdown/)
  assert.match(instructions, /retain the exact target\/project\/taskId in tool references and internal context/)
  assert.match(instructions, /raw identifiers only when explicitly requested/)
  assert.match(instructions, /accepted, queued, or running admission from completed execution/)
})

async function generationFixture(t, env, generatorPrompt = () => new Promise(() => {}), inspect = (_options) => {}, defaultRouting = false, runtimeOverride = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-generation-env-'))
  await mkdir(join(dir, 'private'), { mode: 0o700 })
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
  let sessionNumber = 0
  let listener
  const session = (generator = false) => ({
    model: { provider: 'fixture', id: 'model' }, isStreaming: false, messages: [],
    bindExtensions: async () => {}, setActiveToolsByName: () => {}, subscribe: callback => {
      listener = callback
      return () => { listener = undefined }
    },
    prompt: generator ? async text => generatorPrompt(listener, text) : async () => {listener?.({type: 'message_end', message: {role: 'assistant', content: [{type: 'text', text: 'fixture reply'}], stopReason: 'stop'}})},
    abort: async () => {}, dispose: () => {},
  })
  const bot = await createPersonalBot({
    stateDir: join(dir, 'state'),
    personal: { profile: 'personal', memoryFile: join(dir, 'private', 'memory.json'), skillPaths: [] },
    env,
  }, {
    createRuntime: async () => ({ getAvailable: async () => [{ provider: 'fixture', id: 'model' }], getModel: () => undefined, ...runtimeOverride }),
    ...(defaultRouting ? {} : {createIntentRouter: () => async () => ({ intent: 'conversation' })}),
    createSession: async options => {
      const generator = ++sessionNumber > 1
      if (generator) inspect(options)
      return { session: session(generator) }
    },
  })
  t.after(() => bot.close())
  return bot
}

test('an explicitly selected resident provider is configured before model availability is checked', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'resident-provider-'))
  t.after(() => rm(dir, {recursive: true, force: true}))
  const model = {provider: 'opencode', id: 'fixture', api: 'openai-completions', baseUrl: 'https://old.invalid'}
  const events = []
  const runtime = {
    getModels: () => [model],
    registerProvider(provider, options) {events.push('registry'); assert.equal(provider, 'opencode'); assert.equal(options.models[0].baseUrl, 'https://opencode.ai/inference/openai/v1')},
    async setRuntimeApiKey(provider, key) {events.push('credential'); assert.equal(provider, 'opencode'); assert.equal(key, 'synthetic-console')},
    async getAvailable() {assert.deepEqual(events, ['registry', 'credential']); return [model]},
    getModel: () => model,
  }
  const bot = await createPersonalBot({stateDir: join(dir, 'state'), model: 'opencode/fixture',
    personal: {profile: 'personal', memoryFile: join(dir, 'memory.json'), skillPaths: []},
    env: {ODK_JEV_PROVIDER: 'disabled', OPENCODE_API_KEY: 'synthetic-console'},
  }, {createRuntime: async () => runtime, createIntentRouter: () => async () => ({intent: 'conversation'}),
    createSession: async () => ({session: {model, bindExtensions: async () => {}, setActiveToolsByName() {}, abort: async () => {}, dispose() {}}}),
  })
  t.after(() => bot.close())
  assert.equal(bot.judgmentStatus.model, 'opencode/fixture')
})

test('selected Agent preserves Home binding, cached updates, and runtime restart', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'home-agent-selection-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
  const entry = join(dir, 'agent.cjs')
  const config = join(dir, 'selection.json')
  await writeFile(entry, `exports.create = () => {
    let calls = 0, enter, release, finish
    const ready = new Promise(resolve => { enter = resolve })
    const gate = new Promise(resolve => { release = resolve })
    const finished = new Promise(resolve => { finish = resolve })
    const runtime = { mode: 'normal', ready, release, finished, agent: {
    get calls() { return calls },
    async generateBriefing({ signal }) {
      calls++
      if (runtime.mode === 'fail') throw Error('private generation detail')
      if (runtime.mode === 'hold') {
        enter()
        let cancel
        try {
          await Promise.race([gate.then(() => finish()), new Promise((_resolve, reject) => {
            cancel = () => reject(Error('cancelled'))
            signal.addEventListener('abort', cancel, { once: true })
            if (signal.aborted) cancel()
          })])
        } finally { signal.removeEventListener('abort', cancel) }
      }
      return { items: [{ text: '{{pi|@label|text}} {{pi|count|integer}} sessions.',
        segments: [{ text: '{{pi|@label|text}} {{pi|count|integer}} sessions.', icon: 'sessions' }], readingIds: ['pi'] }] }
    }, abort() {}, close() {}
    } }
    return runtime
  }`)
  await writeFile(config, JSON.stringify({ schemaVersion: 1, replacements: [{
    manifest: { ...personalBotManifest('runtime'), version: '2.0.0' }, entry,
  }] }))
  const reports = []
  for (const external of [false, true]) {
    let count = 2, generations = 0, now = 2000
    const reading = () => ({ id: 'pi', label: 'Pi', state: 'live', updatedAt: 1000,
      value: { count }, home: { mode: 'required', priority: 100, icon: 'sessions', fields: ['count'] } })
    const service = new PersonalBotService({ record: async () => assert.fail('no recording'),
      transcribe: async () => assert.fail('no transcription'), prompt: async () => assert.fail('no voice request') })
    const resident = createPersonalBotComposition({
      replacementPlugins: external ? loadPersonalBotReplacements(config, { trusted: true }) : [],
      createService: () => service, openChannel: async () => ({ close() {} }),
      async initialize() {
        assert.equal(external, false, 'selected Agent must not construct the default adapter')
        let enter, release, finish
        const ready = new Promise(resolve => { enter = resolve })
        const gate = new Promise(resolve => { release = resolve })
        const finished = new Promise(resolve => { finish = resolve })
        const runtime = { mode: 'normal', ready, release, finished }
        const agent = await generationFixture(t, {}, async emit => {
          generations++
          if (runtime.mode === 'fail') throw Error('private generation detail')
          const held = runtime.mode === 'hold'
          if (held) { enter(); await gate }
          emit({ type: 'message_end', message: assistant(JSON.stringify({ items: [{ sources: [0] }] })) })
          if (held) finish()
        })
        return Object.assign(runtime, { agent })
      },
      createHome(runtime) {
        return new HomeBriefing({ requireBindings: true, list: async () => [reading()], read: async () => reading(),
          generate: runtime.agent.generateBriefing, publish: frame => service.publishBriefing(frame), now: () => now })
      },
      onHome(home, current, context) {
        current.attachHome(home)
        context.onCleanup(() => current.attachHome(undefined))
      },
    })
    try {
      await resident.start()
      const home = resident.port(BOT_PORTS.home)
      const agent = resident.port(BOT_PORTS.runtime).agent
      const channel = resident.port(BOT_PORTS.channel)
      await home.refresh()
      assert.equal(service.status.briefing.state, 'live')
      assert.equal(service.status.briefing.items[0].text, 'Pi 2 sessions.')
      const first = structuredClone(service.status.briefing)
      count = 5
      await home.refresh()
      assert.equal(service.status.briefing.items[0].text, 'Pi 5 sessions.')
      assert.equal(external ? agent.calls : generations, 1)
      const updated = structuredClone(service.status.briefing)
      const runtime = resident.port(BOT_PORTS.runtime)
      runtime.mode = 'fail'
      now += 15 * 60 * 1000
      await home.refresh()
      assert.equal(service.status.briefing.state, 'error')
      assert.deepEqual(service.status.briefing.items, updated.items)
      assert.doesNotMatch(JSON.stringify(service.status.briefing), /private generation detail/)
      const stale = structuredClone(service.status.briefing)
      runtime.mode = 'normal'
      await home.refresh()
      assert.equal(service.status.briefing.state, 'live')
      const recovered = structuredClone(service.status.briefing)
      runtime.mode = 'hold'
      now += 15 * 60 * 1000
      const pending = home.refresh()
      await runtime.ready
      await resident.setEnabled('odk.personal-bot.runtime', false)
      await pending
      assert.equal(home.closed, true)
      const disabled = structuredClone(service.status.briefing)
      count = 7
      await home.refresh()
      assert.deepEqual(service.status.briefing, disabled)
      await resident.setEnabled('odk.personal-bot.runtime', true)
      const fresh = resident.port(BOT_PORTS.home)
      assert.notEqual(fresh, home)
      assert.equal(resident.port(BOT_PORTS.service), service)
      assert.equal(resident.port(BOT_PORTS.channel), channel)
      await fresh.refresh()
      assert.equal(service.status.briefing.items[0].text, 'Pi 7 sessions.')
      const resumed = structuredClone(service.status.briefing)
      runtime.release()
      await runtime.finished
      assert.deepEqual(service.status.briefing, resumed)
      reports.push({ first, updated, stale, recovered, resumed })
    } finally { await resident.stop() }
  }
  assert.deepEqual(reports[1], reports[0])
})

test('all fact batches and their final selection use the isolated SDK generator', async t => {
  const seen = new Set()
  let calls = 0
  const bot = await generationFixture(t, {}, async (emit, text) => {
    calls++
    const request = JSON.parse(text.slice(text.indexOf('{')))
    assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 48000)
    for (const variable of request.variables) seen.add(variable.id)
    const selector = request.variables.findIndex(variable => variable.id === 'source-299')
    emit({ type: 'message_end', message: assistant(JSON.stringify({ items: [{ sources: [Math.max(0, selector)] }] })) })
  })
  const readings = Array.from({ length: 300 }, (_, i) => ({ id: `source-${i}`, label: `Source ${i}`, state: 'live', value: { subject: `Current fact ${i}` } }))
  const result = await bot.generateBriefing({ readings })
  assert.equal(seen.size, 300)
  assert.ok(calls >= 3)
  assert.deepEqual(result.items[0].readingIds, ['source-299'])
})

test('home generation uses an isolated zero-tool SDK session and its own schema', async t => {
  let inspected = false
  const bot = await generationFixture(t, { TYPESAFE_API_KEY: 'fixture-only' }, async emit => {
    emit?.({ type: 'message_end', message: assistant('{"items":[{"sources":[0]}]}') })
  }, options => {
    inspected = true
    assert.deepEqual(options.tools, [])
    assert.deepEqual(options.customTools, [])
    assert.equal(options.resourceLoader.getExtensions().extensions.length, 0)
    assert.equal(options.resourceLoader.getSkills().skills.length, 0)
    assert.match(options.resourceLoader.getSystemPrompt(), /No tools, actions, memory/)
  })
  const result = await bot.generateBriefing({ readings: [{ id: 'mail', label: 'Mail', kind: 'package', state: 'live', value: { subject: 'Untrusted content' } }] })
  assert.equal(inspected, true)
  assert.equal(result.items[0].readingIds[0], 'mail')
})

test('Home generation accepts finite source selections and returns the existing bound template',async t=>{
 const bot=await generationFixture(t,{ODK_JEV_PROVIDER:'disabled'},async(emit,text)=>{
  const request=JSON.parse(text.slice(text.indexOf('{')))
  assert.equal(request.variables[0].id,'weather')
  assert.equal(request.variables[0].factId, 'weather:@summary')
  assert.equal(request.variables[0].text, 'Local weather 25°C overcast in Taipei')
  assert.equal(request.variables[0].required, undefined)
  assert.equal(JSON.stringify(request.variables).includes('{{'),false)
  assert.deepEqual(request.previous,[])
  emit?.({type:'message_end',message:assistant(JSON.stringify({items:[{sources:[0]}]}))})
 })
 const readings=[{id:'weather',label:'Local weather',state:'live',value:{temperatureC:25,condition:'overcast',place:'Taipei'},home:{mode:'required',priority:100,icon:'weather',fields:['temperatureC','condition','place']}}]
 const result=await bot.generateBriefing({readings})
 assert.deepEqual(result.items[0].readingIds,['weather'])
 assert.match(result.items[0].text,/\{\{weather\|temperatureC\|celsius\}\}/)
 assert.equal(result.items[0].segments[0].icon,'weather')
})

test('invalid fact selections retry without restoring required source coverage', async t => {
  let attempts = 0
  const bot = await generationFixture(t, { TYPESAFE_API_KEY: 'fixture-only' }, async (emit, text) => {
    const request = JSON.parse(text.slice(text.indexOf('{')))
    if (++attempts === 2) {
      assert.match(request.formatCorrection, /integer selector/)
      assert.match(request.formatCorrection, /exactly one selector/)
      assert.equal(request.variables[0].required,undefined)
      assert.equal(request.variables[0].icon,'portfolio')
      assert.match(request.variables[0].text,/Futu holdings/)
    }
    const content = attempts === 1 ? '{"items":[{"sources":[999]}]}' : JSON.stringify({items:[{sources:[0]}]})
    emit?.({ type: 'message_end', message: assistant(content) })
  })
  await bot.generateBriefing({ readings: [{ id: 'futu', label: 'Futu holdings', state: 'live', value: { count: 11 }, home: { mode: 'required', priority: 100, icon: 'portfolio', fields: ['count'] } }] })
  assert.equal(attempts, 2)
})

test('Given different service and process environments When generating suggestions Then the service timeout controls the injected SDK session', { timeout: 5000 }, async t => {
  const previous = process.env.ODK_PROACTIVE_GENERATION_TIMEOUT_MS
  process.env.ODK_PROACTIVE_GENERATION_TIMEOUT_MS = 'invalid'
  t.after(() => {
    if (previous === undefined) delete process.env.ODK_PROACTIVE_GENERATION_TIMEOUT_MS
    else process.env.ODK_PROACTIVE_GENERATION_TIMEOUT_MS = previous
  })
  const bot = await generationFixture(t, { TYPESAFE_API_KEY: 'fixture-only', ODK_PROACTIVE_GENERATION_TIMEOUT_MS: '1000' })
  await assert.rejects(bot.generateProposals({ topics: [], maxCandidates: 1 }), /timed out/)
})

test('Given an isolated service environment When the process environment is invalid Then suggestion generation ignores the global value', async t => {
  const previous = process.env.ODK_PROACTIVE_GENERATION_TIMEOUT_MS
  process.env.ODK_PROACTIVE_GENERATION_TIMEOUT_MS = 'invalid'
  t.after(() => {
    if (previous === undefined) delete process.env.ODK_PROACTIVE_GENERATION_TIMEOUT_MS
    else process.env.ODK_PROACTIVE_GENERATION_TIMEOUT_MS = previous
  })
  const bot = await generationFixture(t, { TYPESAFE_API_KEY: 'fixture-only' }, async emit => {
    emit?.({ type: 'message_end', message: assistant('{"suggestions":[]}') })
  })
  assert.deepEqual(await bot.generateProposals({ topics: [], maxCandidates: 1 }), { suggestions: [] })
})

test('Pi adapter preserves full Markdown for the service to bound once', async () => {
  const reply = '# Result\n' + '中文结果\n'.repeat(4000)
  const calls = []
  const { adapter } = streamingSession(async (emit, ...args) => {
    calls.push(args)
    emit({ type: 'message_end', message: assistant(reply) })
  })
  assert.equal(await adapter.prompt('request'), reply)
  assert.equal(calls.length, 1)
})

function assistant(text, stopReason = 'stop') {
  return { role: 'assistant', stopReason, content: [
    { type: 'thinking', thinking: 'private reasoning' },
    { type: 'text', text },
    { type: 'toolCall', id: 'tool', name: 'read', arguments: { path: 'private argument' } },
  ] }
}

function streamingSession(run, hooks) {
  let listener
  let subscribed = false
  let unsubscribed = 0
  const session = {
    messages: [assistant('old history must not leak')],
    subscribe: callback => {
      subscribed = true
      listener = callback
      return () => { subscribed = false; unsubscribed++ }
    },
    prompt: async (...args) => {
      assert.equal(subscribed, true)
      await run(event => listener(event), ...args)
    },
    abort: async () => {}, dispose: () => {},
  }
  return { adapter: sessionAdapter(session,hooks), emitLate: event => listener(event), unsubscribed: () => unsubscribed }
}

test('session continuation can suppress model drafts before binding without muting ordinary answers',async()=>{
 for(const stream of [false,true]) {
  const snapshots=[];let prepared=false
  const {adapter}=streamingSession(async emit=>{
   update(emit,'已发送并完成');emit({type:'message_end',message:assistant('Model final')})
  },{beginTurn:()=>{},prepareTurn:async()=>{prepared=true;return{}},streamResponse:()=>{assert.equal(prepared,true);return stream},afterTurn:async()=> 'Host final'})
  assert.equal(await adapter.prompt('request',value=>snapshots.push(value)),'Host final')
  assert.deepEqual(snapshots,stream?['已发送并完成','Model final','Host final']:[])
 }
})

function update(emit, text, type = 'text_delta') {
  const message = assistant(text)
  emit({ type: 'message_update', message, assistantMessageEvent: { type, contentIndex: 1, delta: text, partial: message } })
}

test('SDK snapshots stream current-request visible text across tool turns with final authority', async () => {
  const snapshots = []
  const fixture = streamingSession(async (emit, text, options) => {
    assert.equal(text, 'Personal Bot request:\nrequest')
    assert.equal(options.expandPromptTemplates, false)
    emit({ type: 'message_start', message: assistant('') })
    update(emit, '', 'thinking_delta')
    update(emit, 'First')
    assert.deepEqual(snapshots, ['First'])
    update(emit, 'First', 'toolcall_delta')
    emit({ type: 'message_end', message: assistant('First turn', 'toolUse') })
    emit({ type: 'message_end', message: { role: 'toolResult', content: [{ type: 'text', text: 'raw secret' }] } })
    emit({ type: 'tool_execution_update', partialResult: { content: [{ type: 'text', text: 'raw secret' }] } })
    emit({ type: 'message_start', message: assistant('') })
    update(emit, 'Second')
    assert.equal(snapshots.at(-1), 'First turn\n\nSecond')
    emit({ type: 'message_end', message: assistant('Second final') })
  })
  assert.equal(await fixture.adapter.prompt('request', text => snapshots.push(text)), 'First turn\n\nSecond final')
  assert.equal(fixture.unsubscribed(), 1)
  assert.equal(snapshots.at(-1), 'First turn\n\nSecond final')
  const count = snapshots.length
  update(fixture.emitLate, 'late')
  assert.equal(snapshots.length, count)
  assert.ok(snapshots.every(text => !/private|raw secret|old history/.test(text)))
})

test('SDK retries remove failed partial text and retain successful preceding turns', async () => {
  const snapshots = []
  const fixture = streamingSession(async emit => {
    emit({ type: 'message_end', message: assistant('Plan', 'toolUse') })
    emit({ type: 'message_start', message: assistant('') })
    update(emit, 'failed attempt')
    emit({ type: 'message_end', message: assistant('failed attempt', 'error') })
    emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: 'private provider error' })
    assert.equal(snapshots.at(-1), 'Plan')
    emit({ type: 'message_start', message: assistant('') })
    update(emit, 'Success')
    emit({ type: 'message_end', message: assistant('Success') })
    emit({ type: 'auto_retry_end', success: true, attempt: 1 })
  })
  assert.equal(await fixture.adapter.prompt('request', text => snapshots.push(text)), 'Plan\n\nSuccess')
  assert.equal(fixture.unsubscribed(), 1)
})

test('SDK overflow recovery removes only the discarded attempt', async () => {
  for (const stopReason of ['error', 'length']) {
    const fixture = streamingSession(async emit => {
      emit({ type: 'message_end', message: assistant('Plan', 'toolUse') })
      emit({ type: 'message_end', message: assistant('discarded', stopReason) })
      emit({ type: 'compaction_end', reason: 'overflow', result: undefined, aborted: false, willRetry: true })
      emit({ type: 'message_end', message: assistant('Recovered') })
    })
    assert.equal(await fixture.adapter.prompt('request'), 'Plan\n\nRecovered')
  }
})

test('SDK terminal overflow failures reject normally resolved prompts and discard truncated attempts', async t => {
  for (const outcome of [
    { aborted: false, errorMessage: 'private compaction error' },
    { aborted: true },
    { aborted: false, errorMessage: 'recovery exhausted', retried: true },
  ]) {
    await t.test(outcome.errorMessage || 'aborted compaction', async () => {
      const snapshots = []
      const fixture = streamingSession(async emit => {
        emit({ type: 'message_end', message: assistant('Plan', 'toolUse') })
        emit({ type: 'message_end', message: assistant('truncated', 'length') })
        if (outcome.retried) {
          emit({ type: 'compaction_end', reason: 'overflow', result: {}, aborted: false, willRetry: true })
          emit({ type: 'message_end', message: assistant('still truncated', 'length') })
        }
        emit({ type: 'compaction_end', reason: 'overflow', result: undefined, willRetry: false, ...outcome })
      })
      await assert.rejects(fixture.adapter.prompt('request', text => snapshots.push(text)), /^Error: Agent request failed$/)
      assert.equal(snapshots.at(-1), 'Plan')
      assert.equal(fixture.unsubscribed(), 1)
      const count = snapshots.length
      update(fixture.emitLate, 'late')
      assert.equal(snapshots.length, count)
    })
  }
})

test('SDK length termination without recovery events rejects an incomplete reply', async () => {
  const fixture = streamingSession(async emit => {
    emit({ type: 'message_end', message: assistant('Plan', 'toolUse') })
    emit({ type: 'message_end', message: assistant('truncated', 'length') })
  })
  await assert.rejects(fixture.adapter.prompt('request'), /^Error: Agent request failed$/)
  assert.equal(fixture.unsubscribed(), 1)
})

test('SDK successful overflow maintenance without retry keeps the completed reply', async () => {
  const fixture = streamingSession(async emit => {
    emit({ type: 'message_end', message: assistant('Completed') })
    emit({ type: 'compaction_end', reason: 'overflow', result: {}, aborted: false, willRetry: false })
  })
  assert.equal(await fixture.adapter.prompt('request'), 'Completed')
})

test('SDK no-assistant, rejected, aborted and cancelled retry requests never reuse history and always unsubscribe', async () => {
  const empty = streamingSession(async () => {})
  assert.equal(await empty.adapter.prompt('request'), '')
  assert.equal(empty.unsubscribed(), 1)
  for (const run of [
    async () => { throw Error('prompt rejected') },
    async emit => emit({ type: 'message_end', message: assistant('partial', 'aborted') }),
    async emit => emit({ type: 'message_end', message: assistant('partial', 'error') }),
    async emit => {
      emit({ type: 'message_end', message: assistant('partial', 'error') })
      emit({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: 'private error' })
      emit({ type: 'auto_retry_end', success: false, attempt: 1, finalError: 'private error' })
    },
  ]) {
    const fixture = streamingSession(run)
    await assert.rejects(fixture.adapter.prompt('request'))
    assert.equal(fixture.unsubscribed(), 1)
  }
})

test('SDK adapter rejects concurrent prompts without sharing subscriptions', async () => {
  let finish, entered
  const ready = new Promise(resolve => { entered = resolve })
  const fixture = streamingSession(() => new Promise(resolve => { finish = resolve; entered() }))
  const pending = fixture.adapter.prompt('first')
  await assert.rejects(fixture.adapter.prompt('second'), /progress/)
  await ready
  finish()
  await pending
  assert.equal(fixture.unsubscribed(), 1)
})

test('user application lifecycle tools use the bounded shell control protocol', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-apps-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
  await tokenEnvironment(t, dir)
  const socketPath = endpoint(dir, 'control.sock')
  process.env.ODK_APPS_CONTROL_SOCKET = socketPath
  t.after(() => delete process.env.ODK_APPS_CONTROL_SOCKET)
  const server = createServer(connection => {
    requests(connection, request => {
      connection.end(JSON.stringify({ v: 1, id: request.id, ok: true, apps: [] }) + '\n')
    })
  })
  await new Promise(resolve => server.listen(socketPath, resolve))
  t.after(() => server.close())
  const tools = await loadCapabilities()
  const list = tools.find(tool => tool.name === 'user_apps_list')
  const install = tools.find(tool => tool.name === 'user_app_install')
  assert.ok(list && install)
  const listed = await list.execute('call', {}, undefined)
  assert.deepEqual(JSON.parse(listed.content[0].text).apps, [])
  const installed = await install.execute('call', { id: 'hello-widget' }, undefined)
  assert.equal(JSON.parse(installed.content[0].text).ok, true)
})

test('trusted capability modules augment readonly coordination tools and resume dedicated sessions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-cap-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
  await writeFile(join(dir, 'custom.mjs'), 'export default async () => [{name:"custom",execute:async()=>({content:[],details:{}})}]')
  const tools = await loadCapabilities([join(dir, 'custom.mjs')])
  assert.ok(tools.some(tool => tool.name === 'coding_targets'))
  for (const name of ['coding_task_start', 'coding_task_status', 'coding_task_history', 'coding_task_prompt', 'coding_task_cancel', 'coding_task_end', 'coding_tasks_list']) assert.ok(tools.some(tool => tool.name === name))
  assert.ok(!tools.some(tool => ['live_sessions', 'send_to_session'].includes(tool.name)))
  assert.ok(tools.some(tool => tool.name === 'custom'))
  const options = agentOptions('/work/checkout', dir, tools)
  assert.equal(options.tools, undefined, 'activation must not declare codemode-only customs')
  assert.deepEqual(options.settingsManager.getDefaultTools(), ['read', 'grep', 'find', 'ls', 'codemode'])
  for (const name of ['bash', 'powershell', 'edit', 'write']) assert.ok(options.excludeTools.includes(name))
  assert.ok(options.customTools.every(tool => tool.exposure === 'codemode'))
  assert.equal(options.cwd, '/work/checkout')
  await assert.rejects(validateWorkspace('/opt/odk/current'), /Workspace/)
})

test('capability modules cannot replace builtin inspection or shell names', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-reserved-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
  for (const name of ['grep', 'find', 'ls', 'powershell', 'codemode', 'tool_search']) {
    const file = join(dir, name + '.mjs')
    await writeFile(file, 'export default async () => [{name:' + JSON.stringify(name) + ',execute:async()=>({content:[],details:{}})}]')
    await assert.rejects(loadCapabilities([file]), /Invalid or duplicate capability/)
  }
})

test('coding tools list configuration only and route explicit project requests', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-targets-'))
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }))
  const file = join(dir, 'targets.json')
  let executable = join(dir, 'helper')
  await writeFile(executable, '#!/usr/bin/env node\nlet s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const r=JSON.parse(s);console.log(JSON.stringify({...r,ok:true}))})', { mode: 0o700 })
  executable = await nodeExecutable(t, executable)
  const projectRoot = process.platform === 'win32' ? join(dir, 'work') : '/work'
  await writeFile(file, JSON.stringify({ targets: [{ id: 'cm5', name: '开发板', roots: [projectRoot], executable }] }))
  const previous = process.env.ODK_TASK_TARGETS_FILE
  process.env.ODK_TASK_TARGETS_FILE = file
  t.after(() => { if (previous === undefined) delete process.env.ODK_TASK_TARGETS_FILE; else process.env.ODK_TASK_TARGETS_FILE = previous })
  const tools = await loadCapabilities()
  const targets = await tools.find(tool => tool.name === 'coding_targets').execute('call', {}, undefined)
  assert.deepEqual(JSON.parse(targets.content[0].text), { targets: [{ id: 'cm5', name: '开发板', roots: [projectRoot] }] })
  const targetTool = tools.find(tool => tool.name === 'coding_targets')
  assert.ok(targetTool.outputSchema)
  assert.deepEqual(targets.structuredContent, JSON.parse(targets.content[0].text))
  assert.equal(targetTool.exposure, 'codemode')
  assert.equal(targetTool.annotations.readOnlyHint, true)
  assert.equal(tools.find(tool => tool.name === 'coding_task_start').annotations.readOnlyHint, false)
  for (const command of ['start', 'status', 'history', 'prompt', 'cancel', 'end', 'list']) {
    const tool = tools.find(tool => tool.name === (command === 'list' ? 'coding_tasks_list' : `coding_task_${command}`))
    const params = { target: 'cm5', project: join(projectRoot, '天气'), prompt: '修改已有应用', taskId: '12345678-1234-1234-1234-123456789abc' }
    const response = JSON.parse((await tool.execute('call', params, undefined)).content[0].text)
    assert.equal(response.command, command)
    assert.equal(response.project, params.project)
    await assert.rejects(tool.execute('call', { ...params, target: 'mac' }, undefined), /not configured/)
    await assert.rejects(tool.execute('call', { ...params, project: undefined }, undefined), /project/)
    assert.equal(tool.parameters.additionalProperties, false)
  }
})

test('a failed Jev reply route never enters the model or becomes a delivered reply',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'odk-reply-jev-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 let modelTurns=0;const states=[]
 const bot=await createPersonalBot({stateDir:join(dir,'state'),personal:{profile:'personal',memoryFile:join(dir,'memory.json'),skillPaths:[]},env:{}},{
  createIntentRouter:()=>async()=>{throw Error('synthetic Jev HTTP402')},
  createRuntime:async()=>({getAvailable:async()=>[{provider:'fixture',id:'model'}]}),
  createSession:async()=>({session:{isStreaming:false,bindExtensions:async()=>{},setActiveToolsByName:async()=>{},prompt:async()=>{modelTurns++},subscribe:()=>()=>{},abort:async()=>{},dispose:async()=>{}}}),
 });t.after(()=>bot.close())
 const replyTo={messageId:'a'.repeat(64),sourceKey:'source',sourceRevision:'b'.repeat(64)},reply={id:'00000000-0000-0000-0000-000000000001',replyTo,text:'用 adb 输入安卓',threadId:'c'.repeat(64),source:{key:'source',revision:'b'.repeat(64),machine:'host',project:'/synthetic',sessionId:'session',control:'report_only'}}
 const service=new PersonalBotService({record:async()=>{throw Error('unused')},transcribe:async()=>'',prompt:(...args)=>bot.prompt(...args)})
 service.attachRemoteUpdates({snapshot:()=>({state:'live',messages:[]}),poll:async()=>{},beginReply:()=>reply,completeReply:(_id,patch)=>states.push(patch.status)})
 assert.equal(service.sendText(reply.text,replyTo),true);await service.pending
 assert.equal(modelTurns,0);assert.equal(service.status.state,'error');assert.deepEqual(states,['failed'])
 await service.close()
})


test('Given no Jev, the ordinary runtime still boots and serves typed judgments and Overview generation', async t => {
  let requests = 0
  const bot = await generationFixture(t, {ODK_JEV_PROVIDER: 'disabled'}, async (listener, text) => {
    requests++
    assert.ok(text.startsWith('Personal Bot request:\n'))
    const input = JSON.parse(text.slice('Personal Bot request:\n'.length))
    let result = {items: []}
    if (input.questions?.startup) result = {answers: {startup: {type: 'noul', noul: 0.99}}}
    if (input.questions?.intent) {
      result = {answers: {intent: {type: 'choice', choice: 'conversation', confidence: 0.99}}}
    }
    listener({type: 'message_end', message: {role: 'assistant', content: [{type: 'text', text: JSON.stringify(result)}], stopReason: 'stop'}})
  }, options => {
    assert.deepEqual(options.tools, [])
    assert.deepEqual(options.customTools, [])
    assert.equal(options.ephemeral, true)
  }, true)
  assert.deepEqual(bot.judgmentStatus, {status: 'ready', provider: 'model', model: 'fixture/model'})
  const result = await bot.judge({state: {sample: 'The desk is ready'}, questions: {startup: {type: 'noul', instructions: 'Is the desk ready?'}}})
  assert.equal(result.model, 'fixture/model')
  assert.equal(result.answers.startup.noul, 0.99)
  assert.deepEqual(await bot.generateBriefing({readings: []}), {items: []})
  assert.equal(await bot.prompt('你好'), 'fixture reply')
  assert.equal(requests, 2)
})


test('actual owner turns share one internal follow-up identity and supply displayed task context before model execution',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'odk-owner-context-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 let tools,listener;const owners=[],routes=[];const context='Displayed roundtrip task: Windows and CM5.'
 const bot=await createPersonalBot({stateDir:join(dir,'state'),personal:{profile:'personal',memoryFile:join(dir,'memory.json'),skillPaths:[],agentPlugins:{enabled:['completion','remote_conversation'],autoLearn:false}},env:{}},{
  createIntentRouter:()=>async input=>{routes.push(input);return {intent:'session_continue'}},
  createRuntime:async()=>({getAvailable:async()=>[{provider:'fixture',id:'model'}]}),
  createSession:async options=>{if(options.ephemeral)throw Error('Verifier is outside the owner wiring fixture');tools=options.customTools;return {session:{isStreaming:false,bindExtensions:async()=>{},setActiveToolsByName:async()=>{},subscribe:callback=>{listener=callback;return()=>{listener=undefined}},prompt:async()=>{
   const tool=tools.find(tool=>tool.name==='remote_pi_followup');for(const prompt of ['first model prompt','different model prompt'])await tool.execute('call',{sourceKey:'displayed-source',sourceRevision:'a'.repeat(64),prompt},undefined)
   listener({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Task instruction processed.'}],stopReason:'stop'}})
  },abort:async()=>{},dispose:async()=>{}}}},
 });t.after(()=>bot.close())
 bot.attachRemoteContext(()=>context,undefined,async (_params,_signal,reply,owner)=>{assert.equal(reply,undefined);owners.push(owner);return {accepted:false,delivery:'unknown'}})
 await bot.prompt('Continue the displayed roundtrip task.');await bot.prompt('Now inspect its required rounds.')
 assert.equal(routes.length,2);assert(routes.every(route=>route.remoteTaskContext===context));assert.equal(owners.length,4)
 assert.equal(owners[0],owners[1]);assert.equal(owners[2],owners[3]);assert.notEqual(owners[0],owners[2]);assert(Object.isFrozen(owners[0]))
 assert.equal(owners[0].text,'Continue the displayed roundtrip task.');assert.equal(owners[2].text,'Now inspect its required rounds.')
 const count=owners.length;await assert.rejects(tools.find(tool=>tool.name==='remote_pi_followup').execute('outside',{sourceKey:'displayed-source',sourceRevision:'a'.repeat(64),prompt:'outside'},undefined),/unavailable/);assert.equal(owners.length,count)
})

test('Overview disables Model Studio thinking at the SDK request boundary without changing the resident model', async t => {
  const { streamSimple } = await import('@earendil-works/pi-ai/api/openai-completions')
  const { fixtureModel } = await import('./helpers/pi-fixture.mjs')
  const model = { ...fixtureModel, provider: 'bailian', id: 'deepseek-v4.1-flash', api: 'openai-completions', reasoning: true,
    baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }
  let generatedRuntime, payload
  const runtime = { streamSimple: (value, context, options) => streamSimple(value, context, {
    ...options, apiKey: 'synthetic-only', onPayload: value => { payload = value; throw Error('Stop fixture before transport') },
  }) }
  const bot = await generationFixture(t, {}, async emit => {
    emit({ type: 'message_end', message: assistant('{"items":[]}') })
  }, options => { generatedRuntime = options.modelRuntime }, false, runtime)
  await bot.generateBriefing({ readings: [{ id: 'one', label: 'One', state: 'live', value: { count: 1 } }] })
  const context = { messages: [{ role: 'user', content: 'Select facts', timestamp: Date.now() }] }
  await generatedRuntime.streamSimple(model, context, { maxTokens: 16000 }).result()
  assert.equal(payload.enable_thinking, false)
  assert.ok((payload.max_tokens ?? payload.max_completion_tokens) <= 2048)
  assert.equal(model.compat, undefined, 'Owner model metadata stays unchanged')
  await generatedRuntime.streamSimple({ ...model, maxTokens: 0 }, context, {}).result()
  assert.ok((payload.max_tokens ?? payload.max_completion_tokens) > 0, 'A virtual model sentinel cannot remove the output bound')
  assert.ok((payload.max_tokens ?? payload.max_completion_tokens) <= 2048)
  await runtime.streamSimple(model, context, { maxTokens: 16000 }).result()
  assert.equal(payload.enable_thinking, undefined, 'Owner requests keep their existing provider policy')
})

test('oversized selections receive exact character costs and a specific retry correction', async t => {
  let attempts = 0
  const bot = await generationFixture(t, {}, async (emit, text) => {
    const request = JSON.parse(text.slice(text.indexOf('{')))
    if (++attempts === 2) {
      assert.match(request.formatCorrection, /Select fewer/)
      assert.equal(request.maxCharacters, 240)
      for (const fact of request.variables) assert.equal(fact.characters, fact.text.length + 2)
    }
    emit({ type: 'message_end', message: assistant(JSON.stringify({ items: [{ sources: attempts === 1 ? [0, 1] : [0] }] })) })
  })
  const readings = [0, 1].map(index => ({ id: `s${index}`, label: `Source ${index}`, state: 'live', value: { note: 'x'.repeat(120) } }))
  await bot.generateBriefing({ readings })
  assert.equal(attempts, 2)
})

test('a handler clarification retains owner scope until a named follow-up attempts delivery once',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'odk-owner-clarification-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 let tools,listener,turns=0;const routes=[],owners=[]
 const bot=await createPersonalBot({stateDir:join(dir,'state'),personal:{profile:'personal',memoryFile:join(dir,'memory.json'),skillPaths:[],agentPlugins:{enabled:['completion','remote_conversation'],autoLearn:false}},env:{}},{
  createIntentRouter:()=>async input=>{routes.push(structuredClone(input.unresolvedRequests));return {intent:'session_continue',...(input.unresolvedRequests.length?{requestId:input.unresolvedRequests[0].id}:{})}},
  createRuntime:async()=>({getAvailable:async()=>[{provider:'fixture',id:'model'}]}),
  createSession:async options=>{tools=options.customTools;return {session:{isStreaming:false,bindExtensions:async()=>{},setActiveToolsByName:async()=>{},subscribe:callback=>{listener=callback;return()=>{listener=undefined}},prompt:async()=>{
   if(++turns===2)await tools.find(tool=>tool.name==='remote_pi_followup').execute('call',{sourceKey:'displayed',sourceRevision:'a'.repeat(64),prompt:'Model text is not owner scope'},undefined)
   listener({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'The instruction was sent.'}],stopReason:'stop'}})
  },abort:async()=>{},dispose:async()=>{}}}},
 });t.after(()=>bot.close())
 bot.attachRemoteContext(()=>'',undefined,async(_params,_signal,_reply,owner)=>{owners.push(owner.text);throw Error('Delivery attempt failed')})
 assert.match(await bot.prompt('只读项目 README.md，告诉我项目名称。'),/告诉我任务名称/)
 await assert.rejects(bot.prompt('SDLC 插件优化'),/Delivery attempt failed/)
 assert.equal(owners.length,1);assert(owners[0].includes('只读项目 README.md，告诉我项目名称。'));assert.match(owners[0],/Current owner clarification \(verbatim\):\nSDLC 插件优化/)
 await bot.prompt('另一条新的需求')
 assert.deepEqual(routes.at(-1),[],'an attempted delivery cannot become a deferred request after failure')
})

test('confirmed Hosted continuation is admission while unknown or mismatched receipts stay unknown', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'odk-hosted-ack-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const taskId = '11111111-1111-4111-8111-111111111111'
  const project = join(dir, 'project')
  const helper = join(dir, 'helper.mjs')
  const outcome = join(dir, 'outcome.json')
  await writeFile(helper, `#!/usr/bin/env node\nimport fs from 'node:fs';let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s),o=JSON.parse(fs.readFileSync(${JSON.stringify(outcome)}));console.log(JSON.stringify({version:1,requestId:r.requestId,ok:true,task:{taskId:r.taskId,project:r.project,...o.task},...o}))})`, { mode: 0o700 })
  const executable = await nodeExecutable(t, helper)
  const file = join(dir, 'targets.json')
  await writeFile(file, JSON.stringify({ targets: [{ id: 'cm5', name: 'Fixture', roots: [dir], executable }] }))
  const previous = process.env.ODK_TASK_TARGETS_FILE
  process.env.ODK_TASK_TARGETS_FILE = file
  t.after(() => { if (previous === undefined) delete process.env.ODK_TASK_TARGETS_FILE; else process.env.ODK_TASK_TARGETS_FILE = previous })
  for (const [receipt, expected] of [
    [{ accepted: true }, /原任务已受理/],
    [{ accepted: true, delivery: 'queued' }, /已排入原任务/],
    [{ accepted: true, delivery: 'unknown' }, /暂不能确认/],
    [{ accepted: false }, /暂不能确认/],
    [{ accepted: true, task: { taskId: '22222222-2222-4222-8222-222222222222', project } }, /暂不能确认/],
  ]) {
    await writeFile(outcome, JSON.stringify(receipt))
    let listener
    const bot = await createPersonalBot({ stateDir: join(dir, 'state'), env: {}, personal: { profile: 'personal', memoryFile: join(dir, 'notes.json'), skillPaths: [] } }, {
      createIntentRouter: () => async () => ({ intent: 'session_continue' }),
      createRuntime: async () => ({ getAvailable: async () => [{ provider: 'fixture', id: 'model' }] }),
      createSession: async options => ({ session: { isStreaming: false, bindExtensions: async () => {}, setActiveToolsByName() {},
        subscribe(callback) { listener = callback; return () => {} },
        async prompt() {
          await options.customTools.find(tool => tool.name === 'coding_task_prompt').execute('continue', { target: 'cm5', project, taskId, prompt: 'Continue the original task.' })
          listener({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '已完成所有工作。' }], stopReason: 'stop' } })
        }, abort: async () => {}, dispose() {},
      } }),
    })
    try { assert.match(await bot.prompt('Continue the original task.'), expected) }
    finally { await bot.close() }
  }
})


test('analysis-only selections retry inside the bounded provider validation', async t => {
  let attempts = 0
  const bot = await generationFixture(t, {}, async (emit, text) => {
    const request = JSON.parse(text.slice(text.indexOf('{')))
    if (++attempts === 1) assert.equal(request.variables[0].displayable, false)
    else {
      assert.match(request.formatCorrection, /displayable/)
      assert.deepEqual(request.variables.map(fact => fact.selector), [1], 'Correction cannot renumber or repeat ineligible choices')
      assert.ok(request.variables.every(fact => fact.displayable))
    }
    emit({ type: 'message_end', message: assistant(JSON.stringify({ items: [{ sources: [attempts === 1 ? 0 : 1] }] })) })
  })
  const result = await bot.generateBriefing({ readings: [
    { id: 's', label: 'S', state: 'live', value: { note: 'x'.repeat(231) } },
    { id: 'other', label: 'Other', state: 'live', value: { state: 'waiting' } },
  ] })
  assert.equal(attempts, 2)
  assert.deepEqual(result.items[0].readingIds, ['other'])
})
