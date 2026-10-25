import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createPersonalBot } from '../src/agent.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'
import { assistant, fixtureModel, visibleTools } from './helpers/pi-fixture.mjs'

async function fixture(t, selection, answer) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-feedback-agent-')))
  await isolateAgentDirectory(t, directory)
  t.after(() => rm(directory, { recursive: true, force: true }))
  const memoryFile = join(directory, 'notes.json')
  const original = JSON.stringify({ company: 'Saved public company', gym: 'Saved public gym' })
  await writeFile(memoryFile, original, { mode: 0o600 })
  const requests = []
  const runtime = { getAvailable: async () => [fixtureModel], getModel: () => fixtureModel,
    streamSimple: (_model, context) => {
      requests.push(context)
      const result = Promise.resolve().then(() => answer(context))
      return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
    } }
  const bot = await createPersonalBot({ stateDir: join(directory, 'state'), env: {}, personal: { profile: 'personal', skillPaths: [], memoryFile, agentPlugins: selection } }, {
    createRuntime: async () => runtime, createIntentRouter: () => async () => ({ intent: 'conversation' }),
  })
  t.after(() => bot.close())
  return { bot, requests, original, memory: () => readFile(memoryFile, 'utf8') }
}

test('configured Pi refines feedback in a separate tool-free Durable session without changing saved facts', async t => {
  const f = await fixture(t, { enabled: ['completion', 'learning'] }, context => {
    assert.deepEqual(visibleTools(context), [])
    const content = JSON.stringify(context.messages)
    assert(content.includes('Refine only the recommendation preference memory'))
    assert(!content.includes('Saved public company')); assert(!content.includes('Saved public gym'))
    const user = context.messages.findLast(message => message.role === 'user')
    const text = typeof user.content === 'string' ? user.content : user.content.map(part => part.text ?? '').join('')
    assert(text.includes('Review pending work'))
    return assistant('{"subject":"pending work","dimension":"utility"}')
  })
  assert.equal(typeof f.bot.refineFeedbackMemory, 'function')
  const result = await f.bot.refineFeedbackMemory({ feedback: { decision: 'useful', advice: 'Review pending work.', nextStep: 'Inspect the work' } })
  assert.deepEqual(result, { subject: 'pending work', dimension: 'utility' })
  assert.equal(f.requests.length, 1); assert.equal(await f.memory(), f.original)
  await f.bot.close()
  await assert.rejects(f.bot.refineFeedbackMemory({ feedback: { decision: 'useful', advice: 'Review pending work.', nextStep: '' } }), /cancel/)
  assert.equal(f.requests.length, 1)
})

for (const selection of [{ enabled: [] }, { enabled: ['completion', 'learning'], autoLearn: false }]) {
  test(`disabled feedback learning exposes no model capability ${JSON.stringify(selection)}`, async t => {
    const f = await fixture(t, selection, () => { throw Error('No inference allowed') })
    assert.equal(f.bot.refineFeedbackMemory, undefined)
    assert.equal(f.requests.length, 0); assert.equal(await f.memory(), f.original)
  })
}
