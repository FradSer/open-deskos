import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPersonalAgent } from '../src/agent.mjs'
import { fixtureMem0 } from './fixtures/mem0.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'
import { assistant, fixtureModel } from './helpers/pi-fixture.mjs'

async function fixture(t, selection, answer, config = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-feedback-agent-')))
  await isolateAgentDirectory(t, directory)
  t.after(() => rm(directory, { recursive: true, force: true }))
  const memoryFile = join(directory, 'notes.json')
  const original = JSON.stringify({ company: 'Saved public company', gym: 'Saved public gym' })
  await writeFile(memoryFile, original, { mode: 0o600 })
  const requests = []
  const runtime = { getAvailable: async () => [fixtureModel], getAvailableSnapshot: () => [fixtureModel], getModel: () => fixtureModel, getModels: () => [fixtureModel], getError: () => undefined,
    hasConfiguredAuth: () => true, isUsingOAuth: () => false, checkAuth: async () => ({}),
    getAuth: async () => ({ auth: { apiKey: 'offline-fixture' }, env: {} }),
    streamSimple: (_model, context) => {
      requests.push(context)
      const result = Promise.resolve().then(() => answer(context))
      return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
    } }
  const stateDir = join(directory, 'state'), mem0 = fixtureMem0()
  const bot = await createPersonalAgent({ stateDir, mem0, env: {}, ...config, personal: { profile: 'personal', skillPaths: [], memoryFile, agentPlugins: selection } }, {
    createRuntime: async () => runtime, createIntentRouter: () => async () => ({ intent: 'conversation' }),
  })
  t.after(() => bot.close())
  return { bot, requests, mem0, stateDir, original, memory: () => readFile(memoryFile, 'utf8') }
}

test('feedback uses the resident Mem0 scope without another Pi inference', async t => {
  const f = await fixture(t, { enabled: ['completion', 'learning'] }, () => assistant('Unused'))
  assert.equal(f.bot.feedbackMemoryEnabled, true)
  await f.bot.feedbackStore.put('fixture', 'useful: Review pending work.')
  assert.equal((await f.mem0.scope(f.stateDir, 'feedback').list())[0].memory, 'useful: Review pending work.')
  assert.deepEqual(await f.mem0.scope(f.stateDir, 'notes').list(), [])
  assert.equal(f.requests.length, 0)
  assert.equal(await f.memory(), f.original)
})

test('disabling learning keeps the configured Mem0 feedback scope available for recall', async t => {
  const f = await fixture(t, { enabled: ['completion', 'learning'], autoLearn: false }, () => assistant('Unused'))
  assert.equal(f.bot.feedbackMemoryEnabled, false)
  assert(f.bot.feedbackStore)
  assert.equal(f.requests.length, 0)
})
