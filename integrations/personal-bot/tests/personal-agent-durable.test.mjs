import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile, stat, mkdir, symlink, link, readFile, utimes, appendFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Connection, localDaemon } from '@earendil-works/pi-env'
import { assistant, fixtureModel, visibleTools } from './helpers/pi-fixture.mjs'
import { openDurableRuntime, durableCapability, createPiExecutionTarget } from '../src/durable-runtime.mjs'
import { guardIntentTools } from '../src/intent-routing.mjs'
import { protectProactivePath } from '../src/proactive-private.mjs'

function models(reply) {
  const requests = []
  return {
    requests,
    getModel: () => fixtureModel,
    streamSimple: (_model, context) => {
      requests.push(context)
      const result = Promise.resolve(reply(context, requests.length))
      return { async *[Symbol.asyncIterator]() {
        const message = await result
        yield { type: 'done', reason: message.stopReason, message }
      }, result: () => result }
    },
  }
}

async function state(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-durable-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const model = { provider: fixtureModel.provider, modelId: fixtureModel.id }

for (const kind of ['symlink', 'hardlink']) {
  test(`Durable storage refuses a pre-existing ${kind} without writing outside private storage`, async t => {
    const dir = await state(t)
    const directory = join(dir, 'private')
    await mkdir(directory, { mode: 0o700 })
    const external = join(dir, 'public.txt')
    await writeFile(external, '')
    try {
      if (kind === 'symlink') await symlink(external, join(directory, 'main.jsonl'))
      else await link(external, join(directory, 'main.jsonl'))
    } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Windows fixture requires link creation permission'); return }
      throw error
    }
    let runtime
    t.after(() => runtime?.close())
    await assert.rejects(async () => {
      runtime = await openDurableRuntime({ directory, models: models(() => assistant('fixture')), model, codeMode: false })
      await runtime.prompt('private fixture request')
    }, /unsafe|private/i)
    assert.equal(await readFile(external, 'utf8'), '')
  })
}

test('a second writer is refused and normal close releases storage ownership', async t => {
  const config = { directory: join(await state(t), 'exclusive'), models: models(() => assistant('fixture')), model, codeMode: false }
  const first = await openDurableRuntime(config)
  t.after(() => first.close())
  let second
  t.after(() => second?.close())
  await assert.rejects(async () => { second = await openDurableRuntime(config) }, /lock|owner/i)
  await first.prompt('first')
  await first.close()
  second = await openDurableRuntime(config)
  await second.prompt('second')
})

test('storage recovery and registry setup failures release exclusive ownership', async t => {
  const directory = join(await state(t), 'failure')
  await mkdir(directory, { mode: 0o700 })
  const main = join(directory, 'main.jsonl')
  await writeFile(main, 'invalid fixture JSON\n', { mode: 0o600 })
  if (process.platform === 'win32') {
    protectProactivePath(directory)
    protectProactivePath(main)
  }
  const config = { directory, models: models(() => assistant('fixture')), model, codeMode: false }
  await assert.rejects(openDurableRuntime(config), /malformed/i)
  await writeFile(main, '')
  await assert.rejects(openDurableRuntime({ ...config, tools: [null] }))
  const runtime = await openDurableRuntime(config)
  t.after(() => runtime.close())
  assert.equal(await runtime.prompt('fixture'), 'fixture')
})

test('another process cannot write live storage and abrupt process death never replays a mutation', async t => {
  const dir = await state(t)
  const directory = join(dir, 'crash')
  const marker = join(dir, 'effect.txt')
  await writeFile(marker, '', { mode: 0o600 })
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { openDurableRuntime, durableCapability } from ${JSON.stringify(new URL('../src/durable-runtime.mjs', import.meta.url).href)};
    import { assistant, fixtureModel } from ${JSON.stringify(new URL('./helpers/pi-fixture.mjs', import.meta.url).href)};
    import { appendFile } from 'node:fs/promises';
    process.on('message', () => {});
    const tool = durableCapability({name:'crash_change', description:'Fixture mutation.', parameters:{type:'object',properties:{}},
      execute: async (_id,_args,signal) => {
        await appendFile(${JSON.stringify(marker)}, 'effect\\n'); process.send({type:'effect'});
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('interrupted')), {once:true}));
        return {content:[]};
      }}, {callers:['model']});
    const models = { getModel:()=>fixtureModel, streamSimple:()=> {
      const message=assistant([{type:'toolCall',id:'crash-call',name:tool.name,arguments:{}}], 'toolUse');
      return {async *[Symbol.asyncIterator](){yield {type:'done',reason:'toolUse',message}}, result:async()=>message};
    }};
    const runtime=await openDurableRuntime({directory:${JSON.stringify(directory)},models,model:${JSON.stringify(model)},tools:[tool],codeMode:false});
    await runtime.submit('one authorized fixture mutation', {requestId:'crash-request'});
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  const failed = once(child, 'exit').then(([code]) => { throw Error(`fixture process ended: ${code}; ${stderr}`) })
  const [ready] = await Promise.race([once(child, 'message'), failed])
  assert.equal(ready.type, 'effect')
  await assert.rejects(openDurableRuntime({ directory, models: models(() => assistant('fixture')), model, codeMode: false }), /lock/i)
  const stopped = once(child, 'exit')
  child.kill('SIGKILL')
  await stopped
  // Advance only this dead fixture's lease. This tests recovery, not elapsed lease timing.
  const expired = new Date(Date.now() - 180000)
  await utimes(join(directory, '.writer.lock'), expired, expired)
  const tool = durableCapability({ name: 'crash_change', description: 'Fixture mutation.', parameters: { type: 'object', properties: {} },
    execute: async () => { await appendFile(marker, 'effect\n'); return { content: [] } },
  }, { callers: ['model'] })
  const runtime = await openDurableRuntime({ directory, models: models(() => assistant('中断结果待核对。')), model, tools: [tool], codeMode: false })
  t.after(() => runtime.close())
  const submission = await runtime.submit('one authorized fixture mutation', { requestId: 'crash-request' })
  assert.equal((await submission.wait(BACKGROUND_CONTEXT)).status, 'done')
  assert.equal(await readFile(marker, 'utf8'), 'effect\n')
  const view = await runtime.conversation.viewState(BACKGROUND_CONTEXT)
  assert.match(JSON.stringify(view.value.entries), /interrupted/)
  view.dispose()
})

test('Durable 1.2 retains conversation and deduplicates admission after reopening actual JSONL storage', async t => {
  const directory = join(await state(t), 'conversation')
  const runtimeModels = models(() => assistant('已记录。'))
  const config = { directory, models: runtimeModels, model, codeMode: false }
  const first = await openDurableRuntime(config)
  const id = first.conversation.id
  const receipt = await first.submit('第一条请求', { requestId: 'owner-turn-1' })
  assert.equal((await receipt.wait(BACKGROUND_CONTEXT)).status, 'done')
  await first.close()
  const second = await openDurableRuntime(config)
  t.after(() => second.close())
  assert.equal(second.conversation.id, id)
  const repeated = await second.submit('第一条请求', { requestId: 'owner-turn-1' })
  assert.equal(repeated.id, receipt.id)
  assert.equal((await repeated.wait(BACKGROUND_CONTEXT)).status, 'done')
  assert.equal(runtimeModels.requests.length, 1)
  const view = await second.conversation.viewState(BACKGROUND_CONTEXT)
  assert(view.value.entries.some(entry => entry.model?.some(message => message.role === 'user' && message.content === '第一条请求')))
  view.dispose()
  if (process.platform !== 'win32') assert.equal((await stat(directory)).mode & 0o777, 0o700)
})

test('actual Durable Code Mode validates and returns structured capability results with models disabled', async t => {
  const calls = []
  const tool = durableCapability({ name: 'reviewed_read', description: 'Read a fixture measurement.',
    parameters: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false },
    outputSchema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'] },
    execute: async (_id, args, signal) => {
      assert(signal instanceof AbortSignal)
      calls.push(args.value)
      return { content: [{ type: 'text', text: 'fixture' }], structuredContent: { value: args.value } }
    },
  })
  assert.equal(tool.replay, 'unsafe', 'read hints cannot establish recovery safety')
  const runtimeModels = models(context => {
    assert.deepEqual(visibleTools(context).map(tool => tool.name), ['codemode'])
    const result = context.messages.findLast(message => message.role === 'toolResult')
    if (!result) return assistant([{ type: 'toolCall', id: 'script-1', name: 'codemode', arguments: {
      code: 'text(await tools.reviewed_read({value:7}));',
    } }], 'toolUse')
    assert.equal(result.isError, false)
    assert.match(JSON.stringify(result.content), /value.*7/)
    return assistant('读数为 7。')
  })
  const runtime = await openDurableRuntime({ directory: join(await state(t), 'code'), models: runtimeModels, model, tools: [tool] })
  t.after(() => runtime.close())
  assert.equal(await runtime.prompt('读取测试值'), '读数为 7。')
  assert.deepEqual(calls, [7])
  const agent = await runtime.conversation.agent(BACKGROUND_CONTEXT)
  assert(!agent.callable.some(tool => tool.name.startsWith('models.')))
})

test('the Durable capability bridge retains the actual host intent guard after authorization is absent', async t => {
  let effects = 0
  const [guarded] = guardIntentTools([{ name: 'reviewed_change', description: 'Fixture mutation.',
    parameters: { type: 'object', properties: {} },
    execute: async () => { effects++; return { content: [{ type: 'text', text: 'changed' }] } },
  }], () => null)
  const runtimeModels = models(context => {
    const result = context.messages.findLast(message => message.role === 'toolResult')
    if (!result) return assistant([{ type: 'toolCall', id: 'guard-script', name: 'codemode', arguments: {
      code: 'await tools.reviewed_change({});',
    } }], 'toolUse')
    assert.equal(result.isError, true)
    assert.match(JSON.stringify(result.content), /selected intent/)
    return assistant('本次请求未执行。')
  })
  const runtime = await openDurableRuntime({ directory: join(await state(t), 'guard'), models: runtimeModels, model, tools: [durableCapability(guarded)] })
  t.after(() => runtime.close())
  assert.equal(await runtime.prompt('fixture'), '本次请求未执行。')
  assert.equal(effects, 0)
})

test('closing during a mutation and reopening does not repeat its external effect', async t => {
  let effects = 0, started
  const running = new Promise(resolve => { started = resolve })
  const tool = durableCapability({ name: 'reviewed_change', description: 'Fixture mutation.',
    parameters: { type: 'object', properties: {} },
    execute: async (_id, _args, signal) => {
      effects++
      started()
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('fixture interrupted')), { once: true }))
      return { content: [] }
    },
  }, { callers: ['model'] })
  const runtimeModels = models(context => context.messages.some(message => message.role === 'toolResult')
    ? assistant('结果中断，需核对原回执。')
    : assistant([{ type: 'toolCall', id: 'mutation-1', name: tool.name, arguments: {} }], 'toolUse'))
  const config = { directory: join(await state(t), 'mutation'), models: runtimeModels, model, tools: [tool], codeMode: false }
  const first = await openDurableRuntime(config)
  const submission = await first.submit('执行一次测试变更', { requestId: 'mutation-owner-turn' })
  const wait = submission.wait(BACKGROUND_CONTEXT).catch(() => undefined)
  await running
  await first.close()
  await wait
  const second = await openDurableRuntime(config)
  t.after(() => second.close())
  const recovered = await second.harness.submission(submission.id)
  const outcome = await recovered.wait(BACKGROUND_CONTEXT)
  assert.equal(outcome.status, 'done')
  assert.equal(effects, 1)
  const view = await second.conversation.viewState(BACKGROUND_CONTEXT)
  const results = view.value.entries.filter(entry => entry.kind === 'pi.tool-result')
  assert.match(JSON.stringify(results), /interrupted/)
  view.dispose()
})

test('Pi env reads a real local project and rejects implicit remote connection setup', async t => {
  const cwd = await state(t)
  await writeFile(join(cwd, 'measurement.txt'), 'local measurement')
  const target = createPiExecutionTarget({ cwd })
  t.after(() => target.close())
  const opened = await target.env.openBinaryReader('measurement.txt', undefined, BACKGROUND_CONTEXT)
  assert.equal(opened.ok, true)
  const read = await opened.value.read(0, 1024, BACKGROUND_CONTEXT)
  assert.equal(read.ok, true)
  assert.equal(new TextDecoder().decode(read.value), 'local measurement')
  await opened.value.close(BACKGROUND_CONTEXT)
  const listing = await target.env.listFiles('.', undefined, BACKGROUND_CONTEXT)
  assert.equal(listing.ok, true)
  assert(listing.value.entries.some(entry => entry.path === 'measurement.txt'))
  assert.throws(() => createPiExecutionTarget({ cwd: '/remote/project', remote: true }), /explicit.*connection/i)
  const remote = createPiExecutionTarget({ cwd: '/remote/project', remote: true, connection: { close() { throw Error('borrowed connection must not close') } }, id: 'remote-fixture' })
  assert.equal(remote.env.cwd, '/remote/project')
  await remote.close()
})

test('RemoteExecutionEnv performs actual file and argv operations through the Pi daemon protocol', async t => {
  const cwd = await state(t)
  const connection = new Connection({ command: [localDaemon()] })
  t.after(() => connection.close())
  const target = createPiExecutionTarget({ cwd, connection, remote: true, id: 'pi-env:protocol-fixture' })
  t.after(() => target.close())
  const written = await target.env.writeFile('remote-fact.txt', 'protocol fact', BACKGROUND_CONTEXT)
  assert.equal(written.ok, true)
  assert.equal(await readFile(join(cwd, 'remote-fact.txt'), 'utf8'), 'protocol fact')
  let output = ''
  const executed = await target.env.exec([process.execPath, '-e', 'process.stdout.write(process.cwd())'], {
    onOutput: text => { output += text },
  }, BACKGROUND_CONTEXT)
  assert.equal(executed.ok, true)
  assert.equal(executed.value.exitCode, 0)
  assert.equal(output, cwd)
})
