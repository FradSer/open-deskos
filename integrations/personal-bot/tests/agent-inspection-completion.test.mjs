import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalBot } from '../src/agent.mjs'
import { createAgentPluginRuntime } from '../src/agent-plugins/runtime.mjs'
import { createExperienceStore } from '../src/agent-plugins/experience.mjs'
import { assistant, fixtureModel } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

const passed = receipts => ({ status: 'passed', summary: 'The requested inspection ran.', checks: receipts.filter(receipt => receipt.kind !== 'computation').map(receipt => ({
  requirement: `Inspect with ${receipt.tool}`, scope: 'completion', status: 'passed', evidence: [{ id: receipt.id, quote: receipt.text.slice(0, 100) }],
})) })

test('actual coding-profile Durable read, grep, find and ls results reach completion verification', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-inspection-completion-')))
  let bot
  t.after(async () => { try { await bot?.close() } finally { await rm(root, { recursive: true, force: true }) } })
  await isolateAgentDirectory(t, root)
  const workspace = join(root, 'project')
  await mkdir(join(workspace, '.git'), { recursive: true })
  await mkdir(join(workspace, '.agents', 'skills', 'odk-widget'), { recursive: true })
  await writeFile(join(workspace, '.agents', 'skills', 'odk-widget', 'SKILL.md'), '# Fixture skill\n')
  await writeFile(join(workspace, 'report.txt'), 'region: measured report\n')
  let observed = []
  const models = { getAvailable: async () => [fixtureModel], getModel: () => fixtureModel, streamSimple: (_model, context) => {
    const result = Promise.resolve().then(() => {
      if (JSON.stringify(context.messages).includes('Check the current Personal Agent task after')) {
        const input = JSON.parse(context.messages.findLast(message => message.role === 'user').content.split('Personal Bot request:\n')[1])
        observed = input.receipts
        return assistant(JSON.stringify(passed(input.receipts)))
      }
      if (context.messages.at(-1).role !== 'toolResult') return assistant([{ type: 'toolCall', id: 'inspect', name: 'codemode', arguments: {
        code: 'const values=await Promise.allSettled([tools.read({path:"report.txt"}),tools.grep({pattern:"region",path:"report.txt"}),tools.find({pattern:"*.txt"}),tools.ls({path:"."})]); for(const value of values) { if(value.status!=="fulfilled") throw value.reason; text(value.value); }',
      } }], 'toolUse')
      assert.equal(context.messages.at(-1).isError, false, JSON.stringify(context.messages.at(-1).content))
      return assistant('The report was inspected.')
    })
    return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
  } }
  bot = await createPersonalBot({ stateDir: join(root, 'state'), workspace, env: {}, personal: {
    profile: 'coding', skillPaths: [], agentPlugins: { enabled: ['completion'] },
  } }, { createRuntime: async () => models, createIntentRouter: () => async () => ({ intent: 'coding_work' }) })
  await bot.prompt('Inspect the region report with read, grep, find and ls.')
  assert.equal(bot.lastTaskResult.verification.status, 'passed')
  assert.deepEqual(observed.filter(receipt => receipt.kind !== 'computation').map(receipt => receipt.tool).sort(), ['find', 'grep', 'ls', 'read'])
  const computation = observed.find(receipt => receipt.kind === 'computation')
  assert.equal(computation.tool, 'codemode')
  assert.equal(computation.learningEligible, false)
  assert.match(computation.text, /measured report/)
  assert(observed.every(receipt => receipt.status === 'succeeded' && !receipt.truncated))
  assert(observed.find(receipt => receipt.tool === 'read').text.includes('measured report'))
})

test('Durable diagnostics and omitted binary output prevent unsupported completion without changing tool results', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-inspection-output-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const result of [
    { output: [{ type: 'text', text: 'Only the first lines.' }], diagnostics: [{ severity: 'warn', code: 'truncated', message: 'More output exists.' }] },
    { output: [{ type: 'image', mimeType: 'image/png', data: 'binary-fixture-private-marker' }] },
    ...['matchLimitReached', 'entryLimitReached', 'resultLimitReached'].map(key => ({ output: [{ type: 'text', text: 'Only part of the result.' }], details: { [key]: 1 } })),
    { output: [{ type: 'text', text: 'A cut match line.' }], details: { linesTruncated: true } },
    {},
  ]) {
    const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(root, 'experience.json')), config: { enabled: ['completion'] }, infer: async (_kind, input) => {
      assert(!JSON.stringify(input.receipts).includes('binary-fixture-private-marker'))
      return passed(input.receipts)
    } })
    runtime.beginTurn('Inspect the complete report')
    const [tool] = runtime.observeDurableTools([{ name: 'read', execute: async () => result }])
    assert.equal(await tool.execute({}, {}, {}), result)
    assert.equal((await runtime.finishTurn('Complete report inspected')).verification.status, 'needs_review')
  }
})

test('Durable inspection failure and late completion cannot supply another task receipts', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-inspection-cancel-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  let observed
  const runtime = createAgentPluginRuntime({ store: createExperienceStore(join(root, 'experience.json')), config: { enabled: ['completion'] }, infer: async (_kind, input) => { observed = input.receipts; return passed(input.receipts) } })
  runtime.beginTurn('Read a missing report')
  const [failed] = runtime.observeDurableTools([{ name: 'read', execute: async () => { throw Error('private-provider-error-marker') } }])
  await assert.rejects(failed.execute({}, {}, {}))
  assert.equal((await runtime.finishTurn('Done')).verification.status, 'needs_review')
  assert.equal(observed[0].status, 'failed')
  assert(!JSON.stringify(observed).includes('private-provider-error-marker'))
  const finish = Promise.withResolvers()
  runtime.beginTurn('Old request')
  const [late] = runtime.observeDurableTools([{ name: 'read', execute: () => finish.promise }])
  const pending = late.execute({}, {}, {})
  runtime.beginTurn('New request')
  finish.resolve({ output: [{ type: 'text', text: 'old result' }] })
  await pending
  assert.equal((await runtime.finishTurn('New answer')).verification.status, 'needs_review')
})

// Real Durable computation observation scenarios run without a provider call.
import "./helpers/codemode-observation.mjs"
