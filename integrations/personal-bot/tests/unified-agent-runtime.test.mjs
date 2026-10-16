import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalBot, sessionAdapter } from '../src/agent.mjs'
import { assistant, fixtureModel } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

test('Given rejected external routing When prompted Then no recovery or turn authority starts', async () => {
  for (const rejected of ['clarify', 'failure']) {
    const events = []
    const adapter = sessionAdapter({ isStreaming: false, recover: async () => events.push('recover'),
      subscribe: () => () => {}, prompt: async () => events.push('prompt'), abort() {}, dispose() {} }, {
      prepareTurn: async () => { events.push('jev'); if (rejected === 'failure') throw Error('routing unavailable'); return { answer: 'Clarify the request.' } },
      beginTurn: text => events.push(text ? 'grant' : 'clear'), context: async () => { events.push('memory'); return '' },
    })
    if (rejected === 'failure') await assert.rejects(adapter.prompt('external request'), /routing unavailable/)
    else assert.equal(await adapter.prompt('external request'), 'Clarify the request.')
    assert.deepEqual(events, ['jev', 'clear'])
  }
})

test('Given accepted routing When prompted Then recovery follows judgment and cleanup clears authority', async () => {
  const events = []
  const adapter = sessionAdapter({ isStreaming: false, recover: async () => events.push('recover'),
    subscribe: () => () => {}, prompt: async () => events.push('prompt'), abort() {}, dispose() {} }, {
    prepareTurn: async () => { events.push('jev'); return { context: 'selected' } },
    beginTurn: text => events.push(text ? 'grant' : 'clear'), context: async () => { events.push('memory'); return '' },
  })
  await adapter.prompt('external request')
  assert.deepEqual(events, ['jev', 'recover', 'grant', 'memory', 'prompt', 'clear'])
})

test('Given canonical or legacy browser declaration When composed Then tools and bundled Skill activate together', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-unified-runtime-')))
  await isolateAgentDirectory(t, root)
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const source of ['absent', 'canonical', 'legacy']) {
    const browser = { executablePath: '/nonexistent/odk-test-browser' }
    let options
    const active = []
    const bot = await createPersonalBot({ stateDir: join(root, source), env: {}, personal: {
      profile: 'personal', memoryFile: join(root, `${source}.json`), skillPaths: [],
      ...(source === 'canonical' ? { capabilities: { browser } } : source === 'legacy' ? { browser } : {}),
    } }, {
      createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }),
      createIntentRouter: () => async () => ({ intent: 'browse' }),
      createSession: async value => { options = value; return { session: { model: fixtureModel, isStreaming: false,
        setActiveToolsByName: names => active.push(names), subscribe: () => () => {}, prompt: async () => {}, abort() {}, dispose() {} } } },
    })
    try {
      const expected = source === 'absent' ? 0 : 7
      assert.equal(options.customTools.filter(tool => tool.name.startsWith('browser_')).length, expected)
      assert.equal(options.resourceLoader.getSkills().skills.filter(skill => skill.name === 'browser').length, expected ? 1 : 0)
      await bot.prompt('Read a public page.')
      assert.equal(active.some(names => names.includes('browser_read')), expected > 0)
      assert.deepEqual(active.at(-1), ['codemode'])
    } finally { await bot.close() }
  }
})

test('Given host admission When children start Then no child Jev client is created and each gets a private capability runtime', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-unified-child-')))
  await isolateAgentDirectory(t, root)
  let bot
  t.after(async () => { try { await bot?.close() } finally { await rm(root, { recursive: true, force: true }) } })
  let routers = 0
  const sessions = []
  bot = await createPersonalBot({ stateDir: join(root, 'state'), env: {}, personal: {
    profile: 'personal', memoryFile: join(root, 'notes.json'), skillPaths: [],
    capabilities: { browser: { executablePath: '/nonexistent/odk-test-browser' } }, agentPlugins: { enabled: ['subagents'] },
  } }, {
    createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }),
    createIntentRouter: () => { routers++; return async () => assert.fail('host-admitted children do not classify owner input') },
    createSession: async options => {
      const prompts = []
      let listener
      sessions.push({ options, prompts })
      return { session: { model: fixtureModel, isStreaming: false, setActiveToolsByName() {}, subscribe: receive => { listener = receive; return () => { listener = undefined } },
        prompt: async text => { prompts.push(text); listener?.({ type: 'message_end', message: assistant('Inspected the supplied report.') }) }, abort() {}, dispose() {} } }
    },
  })
  const first = bot.agentTasks.start({ request: 'Inspect supplied report A.' })
  const second = bot.agentTasks.start({ request: 'Inspect supplied report B.' })
  assert.equal((await bot.agentTasks.wait(first.taskId)).state, 'finished')
  assert.equal((await bot.agentTasks.wait(second.taskId)).state, 'finished')
  assert.equal(routers, 1)
  assert.equal(sessions.length, 3)
  assert.equal(new Set(sessions.map(({ options }) => options.cwd)).size, 3)
  for (const { options, prompts } of sessions.slice(1)) {
    assert.equal(options.customTools.filter(tool => tool.name.startsWith('browser_')).length, 7)
    assert(!options.customTools.some(tool => tool.name.startsWith('didi_') || tool.name === 'agent_start'))
    assert.match(prompts[0], /Host-admitted workflow: agent_execute/)
  }
})
