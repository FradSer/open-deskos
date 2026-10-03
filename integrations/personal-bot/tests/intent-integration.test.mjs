import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPersonalBot } from '../src/agent.mjs'
import { createJevIntentRouter } from '../src/intent-routing.mjs'
import { assistant, fixtureModel, offlineSession } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

const repository = fileURLToPath(new URL('../../..', import.meta.url))

for (const profile of ['coding', 'personal']) {
  test(profile + ' production entry dispatches Jev workflows and enforces tool gates in the real SDK', async t => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-intent-sdk-')))
    t.after(() => rm(dir, { recursive: true, force: true }))
    await isolateAgentDirectory(t, dir)
    const requests = []
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\odk-plant-${process.pid}-${profile}` : join(dir, 'desk.sock')
    const tokenFile = join(dir, 'channel.token')
    await writeFile(tokenFile, 'fixture-channel-token')
    const server = net.createServer(client => {
      let buffer = ''
      client.on('error', () => {})
      client.on('data', chunk => {
        buffer += chunk
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n')
          const request = JSON.parse(buffer.slice(0, end))
          buffer = buffer.slice(end + 1)
          if (!request.command) continue // Windows channel authentication frame.
          requests.push(request)
          const value = request.command === 'list'
            ? { readings: [{ id: 'odk.tile.hydra', label: 'Hydra plants', kind: 'tile' }] }
            : { reading: { id: request.readingId, state: 'live', value: { plants: [{ soilPercent: requests.length }] } } }
          client.write(JSON.stringify({ v: 1, id: request.id, ok: true, ...value }) + '\n')
        }
      })
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve) })
    t.after(() => new Promise(resolve => server.close(resolve)))
    const savedChannel = { ODESK_DESK_DATA_SOCKET: process.env.ODESK_DESK_DATA_SOCKET, ODK_CHANNEL_TOKEN_FILE: process.env.ODK_CHANNEL_TOKEN_FILE }
    process.env.ODESK_DESK_DATA_SOCKET = endpoint
    process.env.ODK_CHANNEL_TOKEN_FILE = tokenFile
    t.after(() => { for (const [key, value] of Object.entries(savedChannel)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
    const savedTargets = process.env.ODESK_TASK_TARGETS_FILE
    delete process.env.ODESK_TASK_TARGETS_FILE
    t.after(() => { if (savedTargets !== undefined) process.env.ODESK_TASK_TARGETS_FILE = savedTargets })
    let selected = 'task_query', guardedTools
    const events = [], states = []
    const agent = await createPersonalBot({ stateDir: dir, workspace: repository, personal: { profile, skillPaths: [], memoryFile: join(dir, 'memory.json') } }, {
      createIntentRouter: () => createJevIntentRouter({ env: { TYPESAFE_API_KEY: 'fixture-only' }, fetchImpl: async (_url, options) => {
        events.push('jev')
        const { state, questions } = JSON.parse(options.body)
        states.push(state)
        return Response.json({ model: 'jev-fixture', answers: { intent: { type: 'choice', choice: selected, confidence: 1,
          probabilities: Object.fromEntries(Object.keys(questions.intent.criteria).map(key => [key, key === selected ? 1 : 0])) } } })
      } }),
      createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }),
      createSession: async options => {
        guardedTools = options.customTools
        assert.equal(new Set(guardedTools.map(tool => tool.name)).size, guardedTools.length, 'each capability must be registered once')
        options.sessionManager.appendMessage({ role: 'user', content: [{ type: 'text', text: '花今天活得怎么样了？' }], timestamp: Date.now() })
        options.sessionManager.appendMessage(assistant([{ type: 'toolCall', id: 'historical-direct', name: 'desk_data', arguments: { id: 'odk.tile.hydra' } }], 'toolUse'))
        options.sessionManager.appendMessage({ role: 'toolResult', toolCallId: 'historical-direct', toolName: 'desk_data',
          content: [{ type: 'text', text: 'Tool desk_data not found' }], isError: true, timestamp: Date.now() })
        options.sessionManager.appendMessage(assistant('之前没有读到花卉数据。'))
        return { session: (await offlineSession(options, async context => {
          events.push('pi')
          assert.match(JSON.stringify(context.messages), new RegExp(`Jev-selected workflow: ${selected}`))
          if (selected === 'task_query') {
            const targets = guardedTools.find(tool => tool.name === 'coding_targets')
            assert.deepEqual((await targets.execute('test', {})).structuredContent, { targets: [] })
            for (const name of ['coding_task_start', 'coding_task_prompt', 'coding_task_cancel', 'user_app_install']) {
              await assert.rejects(guardedTools.find(tool => tool.name === name).execute('test', {}), /Jev intent/)
            }
          }
          if (selected === 'session_continue') await assert.rejects(guardedTools.find(tool => tool.name === 'coding_task_start').execute('test', {}), /Jev intent/)
          if (selected === 'desk_data') {
            assert.match(JSON.stringify(context.messages), /await tools\.<exact name>\(args\)/, 'all routes teach the actual Pi v1 call entry')
            const result = context.messages.findLast(message => message.role === 'toolResult' && message.toolCallId === 'desk-read-' + states.length)
            if (result) {
              assert.equal(result.isError, false)
              assert.match(JSON.stringify(result.content), /soilPercent/)
              assert.match(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n'), new RegExp(`"soilPercent":${requests.length}`))
              await assert.rejects(guardedTools.find(tool => tool.name === 'coding_task_start').execute('test', {}), /Jev intent/)
              return assistant('offline routed response')
            }
            return assistant([{ type: 'toolCall', id: 'desk-read-' + states.length, name: 'codemode', arguments: {
              code: 'const listed = await tools.desk_data({}); text(listed); text(await tools.desk_data({id:"odk.tile.hydra"}));',
            } }], 'toolUse')
          }
          return assistant('offline routed response')
        })).session }
      },
    })
    t.after(() => agent.close())
    for (const [intent, text] of [['task_query', '现在任务怎样了'], ['session_continue', '继续那个 Pi 会话'], ['widget_create', '创建天气 widget'], ['app_create', '创建 App'], ['desk_data', '今天花怎么样'], ['desk_data', '现在花怎么样']]) {
      selected = intent
      assert.equal(await agent.prompt(text), 'offline routed response')
      assert.equal(states.at(-1).text, text)
      assert(states.at(-1).availableTools.includes('coding_task_start'))
      assert(states.at(-1).capabilities.some(tool => tool.name === 'desk_data' && tool.description.includes('runtime data')))
    }
    assert.equal(events.filter(event => event === 'jev').length, 6)
    assert.deepEqual(requests.map(request => request.command), ['list', 'read', 'list', 'read'])
    assert.equal(states[1].previous.text, '现在任务怎样了')
    await assert.rejects(guardedTools.find(tool => tool.name === 'coding_targets').execute('late', {}), /Jev intent/)
  })
}

test('mandatory routing startup and provider failures never reach the conversation model or private memory', async t => {
  let modelCalls = 0
  await assert.rejects(createPersonalBot({ env: {}, stateDir: '/unused' }, { createRuntime: async () => { modelCalls++; throw Error() } }), /Jev credential/)
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-intent-failure-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  const agent = await createPersonalBot({ stateDir: dir, personal: { profile: 'personal', skillPaths: [], memoryFile: join(dir, 'memory.json') } }, {
    createIntentRouter: () => createJevIntentRouter({ env: { TYPESAFE_API_KEY: 'fixture-only' }, fetchImpl: async () => { throw Error('PRIVATE_PROVIDER_DETAIL') } }),
    createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }),
    createSession: async options => ({ session: (await offlineSession(options, () => { modelCalls++; return assistant('unexpected') })).session }),
  })
  t.after(() => agent.close())
  const answer = await agent.prompt('记住 note：不能绕过 Jev')
  assert.match(answer, /Jev.*不可用/)
  assert.doesNotMatch(answer, /PRIVATE_PROVIDER_DETAIL/)
  assert.equal(modelCalls, 0)
  await assert.rejects(readFile(join(dir, 'memory.json')), { code: 'ENOENT' })
})

test('closing the agent cancels touch-confirmation inference before its action tool runs', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-intent-touch-close-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  let release, signal
  const confirmation = '记住 note：closed action'
  const agent = await createPersonalBot({ stateDir: dir, personal: { profile: 'personal', skillPaths: [], memoryFile: join(dir, 'memory.json') },
    getWatch: () => ({ list: () => [{ id: 'reserved', status: 'executing', presented: true, confirmation }] }),
  }, {
    createIntentRouter: () => async input => { signal = input.signal; await new Promise(resolve => { release = resolve }); return { intent: 'proposal_response' } },
    createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }),
    createSession: async options => ({ session: (await offlineSession(options, () => assert.fail('no conversation call'))).session }),
  })
  const action = agent.executeProposal('memory_update', { category: 'note', value: 'closed action' }, confirmation)
  await new Promise(resolve => setImmediate(resolve))
  await agent.close()
  assert.equal(signal.aborted, true)
  release()
  await assert.rejects(action, /abort/i)
  await assert.rejects(readFile(join(dir, 'memory.json')), { code: 'ENOENT' })
})

test('a hand-written capability can omit description and its pending action receives lifetime cancellation', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-intent-extension-close-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  const { writeFile } = await import('node:fs/promises')
  const { pathToFileURL } = await import('node:url')
  const modulePath = join(dir, 'capability.mjs')
  await writeFile(modulePath, `export let signal;
export default async () => [{ name: 'reviewed_pending', label: 'Reviewed pending',
parameters: { type: 'object', properties: {}, additionalProperties: false },
execute: async (_id, _params, inputSignal) => {
  signal = inputSignal;
  return new Promise((_resolve, reject) => {
    inputSignal.addEventListener('abort', () => reject(Error('Action aborted')), { once: true });
  });
} }];`)
  const agent = await createPersonalBot({ workspace: repository, stateDir: dir, capabilityPaths: [modulePath] }, {
    createIntentRouter: () => async () => ({ intent: 'proposal_response' }),
    createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }),
    createSession: async () => ({ session: { bindExtensions: async () => {}, setActiveToolsByName() {}, dispose() {}, abort: async () => {} } }),
  })
  t.after(() => agent.close())
  const action = agent.executeProposal('reviewed_pending', {}, '确认执行 fixture')
  const capability = await import(pathToFileURL(modulePath).href)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(capability.signal.aborted, false)
  await agent.close()
  assert.equal(capability.signal.aborted, true)
  await assert.rejects(action, /Action aborted/)
})
