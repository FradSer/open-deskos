import { parsePluginInput } from '../src/agent-plugins/prompt.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createPersonalAgent } from '../src/agent.mjs'
import { fixtureMem0 } from './fixtures/mem0.mjs'
import { createExperienceStore } from '../src/agent-plugins/experience.mjs'
import { createTaskService } from '../src/task-service.mjs'
import { createHostedSession, readHostedHistory } from '../src/task-agent.mjs'
import { serveTasks } from '../src/task-protocol.mjs'
import { assistant, fixtureModel, offlineSession, visibleTools } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'
import { nodeExecutable } from './helpers/node-executable.mjs'

test('actual Hosted SDK checks cross the control transport into Durable completion and grounded learning', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-hosted-check-')))
  const previous = { ...process.env }
  let bot, service, listener
  t.after(async () => {
    try { await bot?.close(); await listener?.close(); await service?.close() }
    finally {
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, previous)
      await rm(root, { recursive: true, force: true })
    }
  })
  // The real command runs only a scratch assertion script, with no user startup files or credentials.
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, { PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${previous.PATH ?? ''}`,
    HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: root, TMPDIR: root, TEMP: root, TMP: root,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    ...(process.platform === 'win32' ? { SystemRoot: previous.SystemRoot, WINDIR: previous.WINDIR } : {}) })
  await isolateAgentDirectory(t, root)
  const project = join(root, 'project')
  await mkdir(project)
  await promisify(execFile)('git', ['init', '--quiet', project])
  await writeFile(join(project, 'report.json'), JSON.stringify({ regions: ['north', 'south', 'west'] }))
  await writeFile(join(project, 'check.cjs'), 'const assert=require("node:assert/strict");const report=require("./report.json");assert.equal(report.regions.length,3);assert.equal(new Set(report.regions).size,3);assert(report.regions.every(x=>typeof x==="string"));console.log("Assertions: 3 passed");\n')
  const taskId = randomUUID(), prompt = 'Check the report has exactly three distinct string regions.'
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\odk-check-${randomUUID()}` : join(root, 'run', 'task.sock')
  let workerCalls = 0
  service = await createTaskService({ roots: [project], stateDir: join(root, 'tasks'), socketPath }, {
    createSession: input => createHostedSession(input, { createRuntime: async () => ({}), createSession: options => offlineSession(options, context => {
      workerCalls++
      if (context.messages.at(-1).role !== 'toolResult') return assistant([{ type: 'toolCall', id: 'host-check', name: 'codemode', arguments: {
        code: `text(await tools.coding_check({command:${JSON.stringify('"' + process.execPath + '" check.cjs')}}));`,
      } }], 'toolUse')
      assert.equal(context.messages.at(-1).isError, false)
      return assistant('The report has three distinct string regions. Assertions: 3 passed.')
    }) }), readHistory: readHostedHistory,
  })
  listener = await serveTasks(socketPath, (request, context) => service.handle(request, context), id => service.disconnect(id))
  const request = command => ({ version: 1, requestId: randomUUID(), command, taskId, project })
  const started = await service.handle({ ...request('start'), prompt })
  assert.equal(started.ok, true, JSON.stringify(started))
  const deadline = AbortSignal.timeout(15_000)
  let task
  do {
    deadline.throwIfAborted()
    await new Promise(resolve => setImmediate(resolve))
    task = (await service.handle(request('status'))).task
  } while (task.activity === 'working' || task.lifecycle === 'launching')
  assert.equal(task.turnOutcome, 'finished')
  assert.equal(task.verification, 'not_run', 'the host receipt remains execution evidence')
  const history = await service.handle(request('history'))
  const hostCheck = history.history.events.flatMap(batch => batch.events).find(event => event.toolName === 'coding_check')
  assert.match(hostCheck.text, /Assertions: 3 passed/)
  assert.equal(hostCheck.truncated, undefined)
  const helper = join(root, 'control')
  await writeFile(helper, `#!/usr/bin/env node\nlet input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',async()=>{const {requestTask}=await import(${JSON.stringify(new URL('../src/task-protocol.mjs', import.meta.url).href)});console.log(JSON.stringify(await requestTask(${JSON.stringify(socketPath)},JSON.parse(input))));});\n`, { mode: 0o700 })
  const targets = join(root, 'targets.json')
  await writeFile(targets, JSON.stringify({ targets: [{ id: 'mac', name: 'Fixture', executable: await nodeExecutable(t, helper), roots: [project] }] }))
  process.env.ODK_TASK_TARGETS_FILE = targets
  const memoryFile = join(root, 'notes.json')
  const privateNote = 'Fixture private violet cedar'
  await writeFile(memoryFile, JSON.stringify({ fixture: privateNote }), { mode: 0o600 })
  const entered = Promise.withResolvers(), release = Promise.withResolvers()
  t.after(() => release.resolve())
  let verifiedOriginal = false, learnedCheck = false, modelFailure, toolCalls = 0
  let stage = 'cancel'
  const runtime = { getAvailable: async () => [fixtureModel], getAvailableSnapshot: () => [fixtureModel], hasConfiguredAuth: () => true, getError: () => undefined, getModel: () => fixtureModel, getAuth: async () => ({auth: {apiKey: 'offline-fixture'}}), streamSimple: (_model, context) => {
    const result = Promise.resolve().then(async () => {
      const text = JSON.stringify(context.messages)
      if (text.includes('Check the current Personal Agent task after')) {
        assert.deepEqual(visibleTools(context), [])
        const input = parsePluginInput(context.messages.findLast(message => message.role === 'user').content.slice('Personal Agent request:\n'.length))
        assert(input.hostedTask, 'The private resident turn must skip its separate completion check')
        assert.equal(input.request, prompt)
        assert.equal(input.answer, task.response)
        verifiedOriginal = true
        const receipt = input.receipts.find(receipt => receipt.tool === 'coding_check')
        assert(receipt)
        return assistant(JSON.stringify({ status: 'passed', summary: 'The report assertions support the requested outcome.', checks: [{
          requirement: prompt, scope: 'completion', status: 'passed', evidence: [{ id: receipt.id, quote: 'Assertions: 3 passed' }],
        }] }))
      }
      if (context.messages.at(-1).role !== 'toolResult') return assistant([{ type: 'toolCall', id: `verify-hosted-${++toolCalls}`, name: 'codemode', arguments: {
        code: `text(await tools.coding_task_verify(${JSON.stringify({ target: 'mac', project, taskId })}));`,
      } }], 'toolUse')
      assert.equal(context.messages.at(-1).isError, false, JSON.stringify(context.messages.at(-1).content))
      assert.match(JSON.stringify(context.messages.at(-1).content), /passed/)
      return assistant('后台任务的历史检查证据通过核验。')
    })
    void result.catch(error => { modelFailure = error })
    return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
  } }
  const stateDir = join(root, 'resident'), experienceFile = join(stateDir, 'personal-agent', 'experience.json')
  const mem0 = fixtureMem0({ extract: async (messages, { signal }) => {
    const text = JSON.stringify(messages)
    for (const privateValue of [privateNote, project, taskId, 'Assertions: 3 passed', 'verify-hosted']) assert(!text.includes(privateValue))
    assert.match(text, /matching source samples/)
    learnedCheck = true
    if (stage === 'cancel') {
      entered.resolve()
      await Promise.race([release.promise, new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))])
    }
    if (stage === 'invalid') throw Error('Mem0 ingestion unavailable')
    return ['Compare source samples before and after a successful check.']
  } })
  const store = createExperienceStore({ scope: mem0.scope(stateDir, 'experience'), stateDir, legacyFile: experienceFile })
  bot = await createPersonalAgent({ stateDir, mem0, env: {}, personal: { profile: 'personal', skillPaths: [],
    memoryFile, pinnedMemoryCategories: ['fixture'], agentPlugins: { enabled: ['completion', 'learning', 'experience'] } } }, {
    createRuntime: async () => runtime, createIntentRouter: () => async () => ({ intent: 'task_query' }),
  })
  const pending = bot.prompt('检查指定后台任务的最终结果')
  const rejected = assert.rejects(pending, /abort|cancel/i)
  try {
    await Promise.race([entered.promise, pending.then(() => assert.fail('Learning did not start'))])
    await bot.abort()
    await rejected
  } finally { release.resolve() }
  assert.deepEqual((await store.load()).entries, [], 'A cancelled learning answer cannot write experience')
  stage = 'invalid'
  await bot.prompt('再检查指定后台任务的最终结果')
  assert.equal(bot.lastTaskResult.learning.status, 'needs_review')
  assert.deepEqual((await store.load()).entries, [], 'A failed native extraction cannot write experience')
  stage = 'valid'
  try { await bot.prompt('检查指定后台任务的最终结果') } catch (error) { throw modelFailure ?? error }
  assert.equal(verifiedOriginal, true)
  assert.equal(learnedCheck, true)
  assert.equal(bot.lastTaskResult.verification.status, 'not_run')
  assert.equal(bot.lastTaskResult.learning.status, 'applied')
  assert.equal(workerCalls, 2, 'verification must not replay the worker')
  const experience = await store.load()
  assert.equal(experience.entries.length, 1)
  assert.equal(experience.entries[0].sources[0].tool, 'coding_check')
  assert.deepEqual(experience.entries[0].sources[0].receipt, { target: 'mac', project, taskId, toolCallId: hostCheck.toolCallId })
  assert.deepEqual(experience.entries[0].scope, { kind: 'hosted_check', version: 1, profile: 'personal' })
})
