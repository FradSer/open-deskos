import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createTaskService, goalPreviews, reserveTaskRecord } from '../src/task-service.mjs'

async function fixture(t, runTask = async () => ({ text: '完成', stopReason: 'stop' })) {
  const dir = await mkdtemp(join(tmpdir(), 'managed-task-'))
  const root = join(await realpath(dir), 'dev')
  await mkdir(root)
  const config = { roots: [root], stateDir: join(dir, 'state'), socketPath: join(dir, 'socket', 'task.sock') }
  const service = await createTaskService(config, { runTask })
  t.after(async () => {
    await service.close()
    for (let attempt = 0; attempt < 5; attempt++) {
      try { await rm(dir, { recursive: true, force: true }); break }
      catch (error) {
        if (error.code !== 'ENOTEMPTY' || attempt === 4) throw error
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
  })
  return { dir, root, config, service }
}
const request = (command, data = {}) => ({ version: 1, requestId: randomUUID(), command, ...data })
const start = (project, data = {}) => request('start', { taskId: randomUUID(), project, prompt: '修复测试，不提交', ...data })
async function settled(service, taskId) {
  for (let i = 0; i < 100; i++) {
    const result = await service.handle(request('status', { taskId }))
    if (result.task.state !== 'running') return result.task
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Task did not settle')
}

test('durable receipt precedes job, same ID is idempotent and conflicting payload fails', async t => {
  let calls = 0
  let config
  const f = await fixture(t, async ({ task }) => {
    calls++
    const record = JSON.parse(await readFile(join(config.stateDir, `${task.taskId}.json`), 'utf8'))
    assert.equal(record.state, 'running')
    return { text: '完成', stopReason: 'stop' }
  })
  config = f.config
  const req = start(f.root)
  assert.equal((await f.service.handle(req)).ok, true)
  const result = await settled(f.service, req.taskId)
  assert.equal(result.state, 'finished')
  assert.equal(result.verification, 'not_run')
  assert.equal((await f.service.handle(req)).task.taskId, req.taskId)
  assert.equal((await f.service.handle({ ...req, prompt: 'different' })).ok, false)
  assert.equal(calls, 1)
})

test('realpath admission and host/project active limits', async t => {
  const f = await fixture(t, ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ text: '', stopReason: 'aborted' }))))
  await symlink(f.dir, join(f.root, 'escape'))
  assert.equal((await f.service.handle(start(join(f.root, 'escape')))).ok, false)
  assert.equal((await f.service.handle(start('/opt/open-deskos'))).ok, false)
  const busy = join(f.root, 'busy')
  await mkdir(busy)
  assert.equal((await f.service.handle(start(busy))).ok, true)
  assert.equal((await f.service.handle(start(busy))).ok, false)
  for (let i = 0; i < 4; i++) {
    const project = join(f.root, `project${i}`)
    await mkdir(project)
    assert.equal((await f.service.handle(start(project))).ok, i < 3)
  }
})

test('canonical ancestor and descendant projects stay locked while unrelated siblings run', async t => {
  for (const childFirst of [false, true]) {
    const f = await fixture(t, ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ text: '', stopReason: 'aborted' }))))
    const parent = join(f.root, 'project')
    const child = join(parent, 'child')
    const sibling = join(f.root, 'project-other')
    const alias = join(f.root, 'alias')
    await mkdir(child, { recursive: true })
    await mkdir(sibling)
    await symlink(child, alias)
    assert.equal((await f.service.handle(start(childFirst ? alias : parent))).ok, true)
    assert.equal((await f.service.handle(start(childFirst ? parent : alias))).ok, false)
    assert.equal((await f.service.handle(start(childFirst ? parent : child))).ok, false)
    assert.equal((await f.service.handle(start(sibling))).ok, true)
  }
})

function receipt(project, changes = {}) {
  return { taskId: randomUUID(), project, requestedProject: project, prompt: '修复测试', response: '', state: 'running', verification: 'not_run', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...changes }
}

test('malformed persisted receipts fail closed without rewriting or replay', async t => {
  const invalid = [
    { state: 'success' }, { state: null }, { verification: 'passed' },
    { project: 'relative' }, { project: '/tmp/../dev' }, { project: '/dev\u0000bad' },
    { requestedProject: 'relative' }, { project: null },
    { prompt: '' }, { prompt: ' ' }, { prompt: 4 }, { prompt: '汉'.repeat(22000) },
    { response: null }, { response: '汉'.repeat(5500) }, { response: '\ud800' },
    { createdAt: 'yesterday' }, { updatedAt: '2026-02-30T00:00:00.000Z' },
    { updatedAt: '2025-01-01T00:00:00.000Z' }, { response: undefined },
    { extra: 'x'.repeat(80 * 1024) },
  ]
  for (const changes of invalid) {
    await t.test(JSON.stringify(changes).slice(0, 100), async t => {
      const f = await fixture(t)
      const record = receipt(f.root, changes)
      const file = join(f.config.stateDir, `${record.taskId}.json`)
      const original = JSON.stringify(record)
      await writeFile(file, original)
      await assert.rejects(createTaskService(f.config, { runTask: async () => { assert.fail('must not replay'); } }), /任务记录损坏/)
      assert.equal(await readFile(file, 'utf8'), original)
    })
  }
})

test('invalid UTF-8 and non-object records fail closed', async t => {
  for (const content of ['null', '[]', '{', Buffer.concat([Buffer.from('{"bad":"'), Buffer.from([0xff]), Buffer.from('"}')])]) {
    const f = await fixture(t)
    await writeFile(join(f.config.stateDir, `${randomUUID()}.json`), content)
    await assert.rejects(createTaskService(f.config, { runTask: async () => ({ text: '', stopReason: 'stop' }) }), /任务记录损坏/)
  }
})

test('valid persisted states and UTF-8 boundaries survive restart', async t => {
  const f = await fixture(t)
  const records = ['pending', 'running', 'finished', 'failed', 'cancelled', 'interrupted'].map(state => receipt(f.root, { state }))
  records[2].prompt = '汉'.repeat(21845) + 'a'
  records[3].response = '汉'.repeat(5461) + 'a'
  for (const record of records) await writeFile(join(f.config.stateDir, `${record.taskId}.json`), JSON.stringify(record))
  const restarted = await createTaskService(f.config, { runTask: async () => { assert.fail('must not replay') } })
  t.after(() => restarted.close())
  for (const record of records) {
    const { task } = await restarted.handle(request('status', { taskId: record.taskId }))
    assert.equal(task.state, ['pending', 'running'].includes(record.state) ? 'interrupted' : record.state)
    assert.equal(task.prompt, record.prompt)
    assert.equal(task.response, record.response)
  }
})

test('all receipts validate before recovery mutates any of them', async t => {
  const f = await fixture(t)
  const record = receipt(f.root, { taskId: '00000000-0000-0000-0000-000000000000' })
  const file = join(f.config.stateDir, `${record.taskId}.json`)
  const original = JSON.stringify(record)
  await writeFile(file, original)
  await writeFile(join(f.config.stateDir, 'ffffffff-ffff-ffff-ffff-ffffffffffff.json'), '{}')
  await assert.rejects(createTaskService(f.config, { runTask: async () => { assert.fail('must not replay') } }), /任务记录损坏/)
  assert.equal(await readFile(file, 'utf8'), original)
})

test('restart interrupts an idle live Hosted Pi that cannot keep its SDK session', async t => {
  const f = await fixture(t)
  const req = receipt(f.root, { state: 'settled', lifecycle: 'live', activity: 'idle', turnOutcome: 'finished' })
  await writeFile(join(f.config.stateDir, `${req.taskId}.json`), JSON.stringify(req))
  const restarted = await createTaskService(f.config, { runTask: async () => { assert.fail('must not replay') } })
  t.after(() => restarted.close())
  const task = (await restarted.handle(request('status', { taskId: req.taskId }))).task
  assert.equal(task.lifecycle, 'interrupted')
  assert.equal(task.state, 'interrupted')
  assert.equal(task.turnOutcome, 'finished', 'an idle session keeps the outcome of the turn that already finished')
})

test('restart marks a turn that was in flight as interrupted', async t => {
  const f = await fixture(t)
  const req = receipt(f.root, { state: 'running', lifecycle: 'live', activity: 'working' })
  await writeFile(join(f.config.stateDir, `${req.taskId}.json`), JSON.stringify(req))
  const restarted = await createTaskService(f.config, { runTask: async () => { assert.fail('must not replay') } })
  t.after(() => restarted.close())
  const task = (await restarted.handle(request('status', { taskId: req.taskId }))).task
  assert.equal(task.lifecycle, 'interrupted')
  assert.equal(task.turnOutcome, 'interrupted', 'a turn interrupted mid-flight is recorded as such')
})

test('restart interrupts receipts without replay', async t => {
  const f = await fixture(t)
  const req = receipt(f.root)
  await writeFile(join(f.config.stateDir, `${req.taskId}.json`), JSON.stringify(req))
  let replayed = false
  const restarted = await createTaskService(f.config, { runTask: async () => { replayed = true; return { text: '', stopReason: 'stop' }; } })
  assert.equal((await restarted.handle(request('status', { taskId: req.taskId }))).task.state, 'interrupted')
  assert.equal(replayed, false)
  await restarted.close()
})

test('non-stop results never succeed and UTF8 response stays bounded', async t => {
  for (const reason of ['stop', 'length', 'error', 'aborted', undefined]) {
    const f = await fixture(t, async () => ({ text: '汉'.repeat(20000), stopReason: reason }))
    const req = start(f.root)
    await f.service.handle(req)
    const task = await settled(f.service, req.taskId)
    assert.equal(task.state, reason === 'stop' ? 'finished' : reason === 'aborted' ? 'cancelled' : 'failed')
    assert.ok(Buffer.byteLength(task.response) <= 16384)
    assert.equal(task.verification, 'not_run')
  }
})

test('escaped terminal responses fit complete receipts and survive restart without disabling tasks', async t => {
  for (const text of ['\n'.repeat(16000), ('汉\u{1f600}\u0000"\\\n').repeat(4000)]) {
    const f = await fixture(t, async () => ({ text, stopReason: 'stop' }))
    const req = start(f.root, { prompt: 'a'.repeat(64000) })
    assert.equal((await f.service.handle(req)).ok, true)
    await settled(f.service, req.taskId)
    assert.equal((await f.service.handle(request('list'))).ok, true)
    await f.service.close()
    const bytes = await readFile(join(f.config.stateDir, `${req.taskId}.json`))
    assert.ok(bytes.length <= 80 * 1024)
    const record = JSON.parse(bytes.toString('utf8'))
    assert.equal(record.state, 'finished')
    assert.equal(record.prompt, req.prompt)
    assert.ok(record.response.length > 0)
    assert.ok(text.startsWith(record.response))
    assert.equal(Buffer.from(record.response).toString('utf8'), record.response)
    assert.ok(Buffer.byteLength(record.response) <= 16 * 1024)
    const restarted = await createTaskService(f.config, { runTask: async () => ({ text: 'next', stopReason: 'stop' }) })
    try {
      assert.deepEqual((await restarted.handle(request('status', { taskId: req.taskId }))).task, record)
      assert.equal((await restarted.handle(start(f.root))).ok, true)
    } finally {
      await restarted.close()
    }
  }
})

test('admission reserves terminal metadata and failure explanation before saving', () => {
  const record = receipt('/dev/' + 'a'.repeat(18000), { requestedProject: '/dev/alias', prompt: '' })
  record.prompt = 'a'.repeat(80 * 1024 - Buffer.byteLength(JSON.stringify(record)))
  assert.equal(Buffer.byteLength(JSON.stringify(record)), 80 * 1024)
  assert.throws(() => reserveTaskRecord(record), /任务记录过大/)
  record.prompt = record.prompt.slice(0, -128)
  assert.doesNotThrow(() => reserveTaskRecord(record))
})

test('malformed prompt Unicode is rejected before receipt or adapter execution', async t => {
  let calls = 0
  const f = await fixture(t, async () => { calls++; return { text: 'ok', stopReason: 'stop' }; })
  const req = start(f.root, { prompt: JSON.parse('"bad\\ud800"') })
  assert.equal((await f.service.handle(req)).ok, false)
  await assert.rejects(readFile(join(f.config.stateDir, `${req.taskId}.json`)), { code: 'ENOENT' })
  assert.equal(calls, 0)
  const valid = start(f.root)
  assert.equal((await f.service.handle(valid)).ok, true)
  await settled(f.service, valid.taskId)
  await f.service.close()
  const restarted = await createTaskService(f.config, { runTask: async () => { assert.fail('must not replay'); } })
  t.after(() => restarted.close())
  assert.equal((await restarted.handle(request('status', { taskId: valid.taskId }))).task.state, 'finished')
})

test('malformed adapter Unicode is normalized before persistence and restart', async t => {
  const f = await fixture(t, async () => ({ text: 'bad\ud800汉\udfff\u{1f600}', stopReason: 'stop' }))
  const req = start(f.root)
  assert.equal((await f.service.handle(req)).ok, true)
  const task = await settled(f.service, req.taskId)
  assert.equal(task.response, 'bad\ufffd汉\ufffd\u{1f600}')
  await f.service.close()
  const restarted = await createTaskService(f.config, { runTask: async () => { assert.fail('must not replay'); } })
  t.after(() => restarted.close())
  assert.deepEqual((await restarted.handle(request('status', { taskId: req.taskId }))).task, JSON.parse(JSON.stringify(task)))
})

test('status and cancel use recorded identities after a project is removed', async t => {
  const f = await fixture(t, ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ text: '', stopReason: 'aborted' }))))
  const project = join(f.root, 'project')
  const alias = join(f.root, 'alias')
  await mkdir(project)
  await symlink(project, alias)
  const req = start(alias)
  await f.service.handle(req)
  await new Promise(resolve => setImmediate(resolve))
  await rm(project, { recursive: true })
  for (const identity of [alias, project]) {
    assert.equal((await f.service.handle(request('status', { taskId: req.taskId, project: identity }))).ok, true)
  }
  assert.equal((await f.service.handle(request('cancel', { taskId: req.taskId, project: f.root }))).ok, false)
  assert.equal((await f.service.handle(request('cancel', { taskId: req.taskId, project: alias }))).ok, true)
  assert.equal((await settled(f.service, req.taskId)).state, 'cancelled')
})

test('empty non-stop outcomes carry safe generic explanations', async t => {
  for (const stopReason of ['error', 'length', 'aborted', undefined]) {
    const f = await fixture(t, async () => ({ text: '', stopReason, errorMessage: 'provider-private-detail' }))
    const req = start(f.root)
    await f.service.handle(req)
    const task = await settled(f.service, req.taskId)
    assert.ok(task.response.trim())
    assert.doesNotMatch(task.response, /provider-private-detail/)
  }
})

test('cancel aborts adapter and holds project until it exits', async t => {
  let release
  let signal
  const f = await fixture(t, input => { signal = input.signal; return new Promise(resolve => { release = resolve; }); })
  const req = start(f.root)
  await f.service.handle(req)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await f.service.handle(request('cancel', { taskId: req.taskId }))).ok, true)
  assert.equal(signal.aborted, true)
  assert.equal((await f.service.handle(start(f.root))).ok, false)
  release({ text: 'cancel', stopReason: 'stop' })
  assert.equal((await settled(f.service, req.taskId)).state, 'cancelled')
  const list = await f.service.handle(request('list'))
  assert.equal('prompt' in list.tasks[0], false)
  assert.equal('response' in list.tasks[0], false)
})

test('list carries a bounded goal without carrying the full prompt', async t => {
  const f = await fixture(t, async () => ({ text: '完成', stopReason: 'stop' }))
  const prompt = '整理'.repeat(600)
  const req = start(f.root, { prompt })
  assert.equal((await f.service.handle(req)).ok, true)
  const [listed] = (await f.service.handle(request('list'))).tasks
  assert.equal(listed.taskId, req.taskId)
  assert.equal(typeof listed.goal, 'string')
  assert.equal(prompt.startsWith(listed.goal), true)
  assert.equal(Buffer.byteLength(listed.goal) <= 1024, true)
  assert.equal(Buffer.from(listed.goal).toString('utf8'), listed.goal)
})


test('private socket preserves jobs across helper exit and rejects oversized frames', async t => {
  const { serveTasks, requestTask, readFrame } = await import('../src/task-protocol.mjs')
  const { stat, writeFile } = await import('node:fs/promises')
  const { spawn } = await import('node:child_process')
  const { PassThrough } = await import('node:stream')
  let release
  const f = await fixture(t, () => new Promise(resolve => { release = resolve; }))
  const server = await serveTasks(f.config.socketPath, req => f.service.handle(req))
  t.after(() => server.close())
  assert.equal((await stat(f.config.socketPath)).mode & 0o777, 0o600)
  await assert.rejects(serveTasks(f.config.socketPath, req => f.service.handle(req)), /已运行/)
  const file = join(f.dir, 'config.json')
  await writeFile(file, JSON.stringify(f.config), { mode: 0o600 })
  const req = start(f.root)
  const child = spawn(process.execPath, ['src/task-cli.mjs'], { env: { ...process.env, ODESK_TASK_CONFIG: file }, stdio: ['pipe', 'pipe', 'pipe'] })
  const reply = readFrame(child.stdout, 256 * 1024)
  child.stdin.end(JSON.stringify(req) + '\n')
  assert.equal((await reply).task.state, 'running')
  assert.equal(await new Promise(resolve => child.on('close', resolve)), 0)
  assert.equal((await requestTask(f.config.socketPath, request('status', { taskId: req.taskId }))).task.state, 'running')
  release({ text: '完成', stopReason: 'stop' })
  assert.equal((await settled(f.service, req.taskId)).state, 'finished')
  const oversized = new PassThrough()
  const rejected = assert.rejects(readFrame(oversized, 10), /过大/)
  oversized.end('x'.repeat(11))
  await rejected
  const silent = new PassThrough()
  await assert.rejects(readFrame(silent, 10, 10), /超时/)
})


test('SDK adapter uses persistent isolated resources and waits for final stop reason', async t => {
  const { runTask } = await import('../src/task-agent.mjs')
  const { writeFile } = await import('node:fs/promises')
  const f = await fixture(t)
  await writeFile(join(f.root, 'AGENTS.md'), 'Managed test context')
  const controller = new AbortController()
  let options
  let disposed = false
  let aborted = false
  let finish
  const session = {
    messages: [],
    prompt: async (_text, opts) => {
      assert.equal(opts.expandPromptTemplates, false)
      await new Promise(resolve => { finish = resolve; })
      session.messages.push({ role: 'assistant', content: [{ type: 'text', text: '最终结果' }], stopReason: 'length' })
    },
    abort: async () => { aborted = true; finish(); },
    subscribe: () => () => {},
    dispose: () => { disposed = true; },
  }
  const job = runTask({ task: { project: f.root, prompt: '任务' }, signal: controller.signal, sessionDir: join(f.config.stateDir, 'sdk') }, {
    createRuntime: async () => ({}),
    createSession: async opts => { options = opts; return { session }; },
  })
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(options.sessionManager.isPersisted(), true)
  assert.equal(options.resourceLoader.getExtensions().extensions.length, 0)
  assert.equal(options.resourceLoader.getPrompts().prompts.length, 0)
  assert.ok(options.resourceLoader.getAgentsFiles().agentsFiles.some(file => file.content.includes('Managed test context')))
  assert.equal(options.resourceLoader.getSkills().skills.length, 0)
  controller.abort()
  assert.equal((await job).stopReason, 'aborted')
  assert.equal(aborted, true)
  assert.equal(disposed, true)
})

test('malformed submitted project Unicode is rejected before persistence', async t => {
  const f = await fixture(t)
  await mkdir(join(f.root, 'project\ufffd'))
  const response = await f.service.handle(start(join(f.root, 'project\ud800')))
  assert.equal(response.ok, false)
  await f.service.close()
  const restarted = await createTaskService(f.config, { runTask: async () => ({ text: 'ok', stopReason: 'stop' }) })
  await restarted.close()
})

function persistentAdapter() {
  const sessions = []
  return {
    sessions,
    async createSession({ onEvent }) {
      let streaming = false
      let disposed = false
      let aborted = false
      let abortCalls = 0
      let disposeCalls = 0
      let release
      const prompts = []
      const session = {
        get isStreaming() { return streaming },
        get disposed() { return disposed },
        get prompts() { return prompts },
        get aborted() { return aborted },
        get abortCalls() { return abortCalls },
        get disposeCalls() { return disposeCalls },
        sessionFile: undefined,
        async prompt(text, options = {}) {
          const wasStreaming = streaming
          prompts.push({ text, options })
          if (wasStreaming) return { text: '', stopReason: undefined }
          streaming = true
          if (prompts.length === 1) await new Promise(resolve => { release = resolve })
          streaming = false
          onEvent?.({ position: prompts.length, entry: { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: `reply ${prompts.length}` }], stopReason: aborted ? 'aborted' : 'stop' } } })
          return { text: `reply ${prompts.length}`, stopReason: aborted ? 'aborted' : 'stop' }
        },
        release() { release?.() },
        async abort() { abortCalls++; aborted = true; release?.() },
        dispose() { disposeCalls++; disposed = true },
        history(position = 0) {
          return { entries: prompts.slice(position).map((prompt, index) => ({ position: position + index + 1, entry: prompt })), boundary: prompts.length, continuation: null }
        },
      }
      sessions.push(session)
      return session
    },
  }
}

async function waitState(service, taskId, expected) {
  for (let index = 0; index < 100; index++) {
    const response = await service.handle(request('status', { taskId }))
    if (response.task.state === expected) return response.task
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(`Task did not reach ${expected}`)
}

test('persistent host retains one Pi session across turns and steers while streaming', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  assert.equal((await service.handle(launched)).task.lifecycle, 'launching')
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  assert.equal((await service.handle(request('prompt', { taskId: launched.taskId, prompt: 'redirect' }))).ok, false)
  assert.equal((await service.handle(request('prompt', { taskId: launched.taskId, prompt: 'redirect', streamingBehavior: 'steer' }))).ok, true)
  assert.equal(adapter.sessions[0].prompts[1].options.streamingBehavior, 'steer')
  adapter.sessions[0].release()
  const task = await waitState(service, launched.taskId, 'settled')
  assert.equal(task.turnOutcome, 'finished')
  assert.equal(adapter.sessions.length, 1)
  assert.equal(adapter.sessions[0].disposed, false)
  assert.equal((await service.handle(request('prompt', { taskId: launched.taskId, prompt: 'next turn' }))).ok, true)
  await waitState(service, launched.taskId, 'settled')
  assert.equal(adapter.sessions.length, 1)
})

test('cancel retains identity, end disposes, and idle unattached sessions release locks', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 30 }, adapter)
  t.after(() => service.close())
  const first = start(f.root)
  await service.handle(first)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  await service.handle(request('cancel', { taskId: first.taskId }))
  const cancelled = await waitState(service, first.taskId, 'settled')
  assert.equal(cancelled.turnOutcome, 'cancelled')
  assert.equal(adapter.sessions[0].disposed, false)
  const second = start(f.root)
  assert.equal((await service.handle(second)).ok, true)
  while (!adapter.sessions[1]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  adapter.sessions[1].release()
  await waitState(service, second.taskId, 'settled')
  assert.equal((await service.handle(request('end', { taskId: first.taskId }))).ok, true)
  assert.equal(adapter.sessions[0].disposed, true)
  assert.equal((await service.handle(request('status', { taskId: first.taskId }))).task.lifecycle, 'ended')
})

test('an abandoned idle Hosted Pi expires after the bounded period without replay', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 20 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  adapter.sessions[0].release()
  await waitState(service, launched.taskId, 'settled')

  // Left idle and unattached, the bounded idle period must end it and free its slot.
  const expired = await waitState(service, launched.taskId, 'finished')
  assert.equal(expired.endedReason, 'idle_expired')
  assert.equal(expired.lifecycle, 'ended')
  assert.equal(adapter.sessions[0].disposed, true)
  assert.equal(adapter.sessions.length, 1, 'expiry must not start another turn')
  assert.equal(adapter.sessions[0].prompts.length, 1, 'expiry must not replay the prompt')

  // The released slot lets the same project launch again, and the receipt stays readable.
  assert.equal((await service.handle(start(f.root))).ok, true)
  assert.equal((await service.handle(request('status', { taskId: launched.taskId }))).task.endedReason, 'idle_expired')
})

test('goal previews stay inside their escaped-cost ceiling', () => {
  // Control characters escape to six bytes each, so the source bound alone is not a wire bound.
  const hostile = Array.from({ length: 100 }, (_, index) => ({ taskId: `task-${index}`, prompt: '\u0001'.repeat(1024) }))
  const previews = goalPreviews(hostile)
  const escaped = previews.reduce((total, task) => total + Buffer.byteLength(JSON.stringify(task.goal)) - 2, 0)
  assert.equal(escaped <= 128 * 1024, true, 'the preview set never crosses its escaped-cost ceiling')
  assert.equal(previews.length, 100, 'every record survives; only previews are dropped')
  assert.equal(previews.some((task) => task.goal === ''), true, 'shedding starts once the ceiling is reached')
  assert.equal(previews.every((task) => typeof task.taskId === 'string'), true, 'records keep their identity')

  const typical = Array.from({ length: 100 }, (_, index) => ({ taskId: `t${index}`, prompt: '\u6574\u7406'.repeat(300) }))
  assert.equal(goalPreviews(typical).every((task) => task.goal.length > 0), true, 'typical previews are not shed')
})

test('ending a running turn leaves a terminal state, never running', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  assert.equal((await service.handle(request('end', { taskId: launched.taskId }))).ok, true)
  const ended = (await service.handle(request('status', { taskId: launched.taskId }))).task
  assert.equal(ended.lifecycle, 'ended')
  assert.equal(ended.state, 'cancelled', 'the receipt must not stay running after the turn was aborted')
  assert.equal(ended.turnOutcome, 'cancelled')
  assert.equal(ended.endedReason, 'explicit')
})

test('accepted launch receipt without a task record reconciles as pending after restart', async t => {
  const f = await fixture(t)
  await f.service.close()
  const mutationId = 'crash-window-launch'
  const taskId = randomUUID()
  const requestValue = start(f.root, { taskId, mutationId })
  const payload = JSON.stringify({ command: 'launch', taskId, project: requestValue.project, prompt: requestValue.prompt })
  const receipt = { taskId, command: 'launch', mutationId, payloadDigest: createHash('sha256').update(payload).digest('hex'), status: 'accepted' }
  const mutationDir = join(f.config.stateDir, 'mutations', 'launch')
  await mkdir(mutationDir, { recursive: true })
  const name = createHash('sha256').update(`launch\0${mutationId}`).digest('hex')
  await writeFile(join(mutationDir, `${name}.json`), JSON.stringify(receipt))
  const restarted = await createTaskService(f.config, { runTask: async () => { assert.fail('must not replay') } })
  t.after(() => restarted.close())
  const result = await restarted.handle(requestValue)
  assert.equal(result.ok, true)
  assert.equal(result.pending, true)
  assert.equal(result.task.taskId, taskId)
  assert.equal(result.task.lifecycle, 'launching')
})

test('launch mutation identity reconciles independently from Hosted Pi identity', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const first = start(f.root, { mutationId: 'launch-once' })
  const accepted = await service.handle(first)
  assert.equal(accepted.ok, true)
  const duplicate = await service.handle({ ...first, requestId: randomUUID() })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.task.taskId, first.taskId)
  const conflicting = await service.handle({ ...first, requestId: randomUUID(), taskId: randomUUID() })
  assert.equal(conflicting.ok, false)
  assert.match(conflicting.error, /different|不同/)
})

test('mutation receipt is durable before a Hosted Pi side effect begins', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  let sawReceipt = false
  const originalPrompt = adapter.sessions[0].prompt.bind(adapter.sessions[0])
  adapter.sessions[0].prompt = async (text, options) => {
    const mutationDir = join(f.config.stateDir, 'mutations', launched.taskId)
    const receipts = await readdir(mutationDir)
    sawReceipt = receipts.length === 1 && JSON.parse(await readFile(join(mutationDir, receipts[0]), 'utf8')).mutationId === 'durable-steer'
    return originalPrompt(text, options)
  }
  const response = await service.handle(request('prompt', { taskId: launched.taskId, mutationId: 'durable-steer', prompt: 'redirect', streamingBehavior: 'steer' }))
  assert.equal(response.ok, true)
  assert.equal(sawReceipt, true, 'the mutation receipt must be on disk before prompt delivery')
})

test('a failed mutation retry reports the recorded failure instead of accepted', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  adapter.sessions[0].deliver = async () => { throw new Error('delivery failed') }
  const failed = request('prompt', { taskId: launched.taskId, mutationId: 'failed-steer', prompt: 'redirect', streamingBehavior: 'steer' })
  assert.equal((await service.handle(failed)).ok, false)
  const duplicate = await service.handle({ ...failed, requestId: randomUUID() })
  assert.equal(duplicate.ok, false)
  assert.match(duplicate.error, /delivery failed/)
})

test('mutation identities make prompt, cancel and end exact-retry safe', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  const steer = request('prompt', { taskId: launched.taskId, mutationId: 'steer-1', prompt: 'redirect', streamingBehavior: 'steer' })
  assert.equal((await service.handle(steer)).ok, true)
  assert.equal((await service.handle({ ...steer, requestId: randomUUID() })).ok, true)
  assert.equal(adapter.sessions[0].prompts.filter(item => item.text === 'redirect').length, 1)
  assert.equal((await service.handle({ ...steer, requestId: randomUUID(), prompt: 'different' })).ok, false)
  const cancel = request('cancel', { taskId: launched.taskId, mutationId: 'cancel-1' })
  assert.equal((await service.handle(cancel)).ok, true)
  assert.equal((await service.handle({ ...cancel, requestId: randomUUID() })).ok, true)
  assert.equal(adapter.sessions[0].abortCalls, 1)
  await waitState(service, launched.taskId, 'settled')
  const end = request('end', { taskId: launched.taskId, mutationId: 'end-1' })
  assert.equal((await service.handle(end)).ok, true)
  assert.equal((await service.handle({ ...end, requestId: randomUUID() })).ok, true)
  assert.equal(adapter.sessions[0].disposeCalls, 1)
})

test('mutation receipts remain durable beyond thirty-two operations', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  for (let index = 0; index < 40; index++) {
    assert.equal((await service.handle(request('prompt', { taskId: launched.taskId, mutationId: `steer-${index}`, prompt: `redirect ${index}`, streamingBehavior: 'steer' }))).ok, true)
  }
  await service.close()
  const restarted = await createTaskService(f.config, { runTask: async () => { assert.fail('must not replay') } })
  t.after(() => restarted.close())
  const duplicate = await restarted.handle(request('prompt', { taskId: launched.taskId, mutationId: 'steer-0', prompt: 'redirect 0', streamingBehavior: 'steer' }))
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.duplicate, true)
})

test('mutation receipts survive host restart for terminal end reconciliation', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  adapter.sessions[0].release()
  await waitState(service, launched.taskId, 'settled')
  const end = request('end', { taskId: launched.taskId, mutationId: 'durable-end' })
  assert.equal((await service.handle(end)).ok, true)
  await service.close()
  const restarted = await createTaskService(f.config, { runTask: async () => { assert.fail('must not replay') } })
  t.after(() => restarted.close())
  const duplicate = await restarted.handle({ ...end, requestId: randomUUID() })
  assert.equal(duplicate.ok, true)
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.task.lifecycle, 'ended')
  assert.equal((await restarted.handle({ ...end, requestId: randomUUID(), expectedTurnId: 'different' })).ok, false)
})

test('four abandoned sessions never block all further work', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const abandoned = []
  for (const name of ['a', 'b', 'c', 'd']) {
    const project = join(f.root, name)
    await mkdir(project, { recursive: true })
    const launched = start(project)
    assert.equal((await service.handle(launched)).ok, true)
    while (!adapter.sessions.at(-1)?.isStreaming) await new Promise(resolve => setImmediate(resolve))
    adapter.sessions.at(-1).release()
    await waitState(service, launched.taskId, 'settled')
    abandoned.push(launched.taskId)
  }
  const fresh = join(f.root, 'e')
  await mkdir(fresh, { recursive: true })
  assert.equal((await service.handle(start(fresh))).ok, true, 'an abandoned session is reclaimed instead of blocking every launch')
  const reclaimed = (await service.handle(request('status', { taskId: abandoned[0] }))).task
  assert.equal(reclaimed.lifecycle, 'ended')
  assert.equal(reclaimed.endedReason, 'evicted')
})

test('attach catch-up pages to its boundary before reporting caught up', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  adapter.sessions[0].history = position => position === 0
    ? { events: [{ position: 1, events: [{ kind: 'assistant', text: 'one' }] }], boundary: 2, continuation: 1 }
    : { events: [{ position: 2, events: [{ kind: 'assistant', text: 'two' }] }], boundary: 2, continuation: null }
  adapter.sessions[0].boundary = () => 2
  const sent = []
  const response = await service.handle(request('attach', { taskId: launched.taskId, after: 0, attachmentId: 'paged', console: { machineName: 'Mac', sessionId: 'console' } }), { connectionId: 'paged', send: event => sent.push(event) })
  assert.equal(response.ok, true)
  assert.deepEqual(sent.map(event => event.position), [1, 2])
})

test('an unbounded attach catch-up is refused instead of overflowing the Console buffer', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  const total = 30_000
  adapter.sessions[0].boundary = () => total
  adapter.sessions[0].history = (position = 0, limit = 100) => {
    const end = Math.min(total, position + Math.min(limit, 100))
    const events = []
    for (let point = position + 1; point <= end; point += 1) events.push({ position: point, events: [{ kind: 'assistant', text: `event ${point}` }] })
    return { events, boundary: total, continuation: end < total ? end : null }
  }
  const sent = []
  const response = await service.handle(
    request('attach', { taskId: launched.taskId, after: 0, attachmentId: 'huge', console: { machineName: 'Mac', sessionId: 'console-1' } }),
    { connectionId: 'c1', send: (event) => sent.push(event) },
  )
  assert.equal(response.ok, false)
  assert.match(response.error, /有界预算/)
  assert.equal(sent.length <= 1024, true, 'the host never streams past its bounded catch-up budget')
})

test('attach catch-up advances across a page containing only non-message entries', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  adapter.sessions[0].history = () => ({ events: [], boundary: 3, continuation: null })
  adapter.sessions[0].boundary = () => 3
  const response = await service.handle(request('attach', { taskId: launched.taskId, after: 0, attachmentId: 'empty-page', console: { machineName: 'Mac', sessionId: 'console' } }), { connectionId: 'empty-page', send() {} })
  assert.equal(response.ok, true)
  assert.equal(response.boundary, 3)
})

test('attach replacement, disconnect, positioned history and audit identity are explicit', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  const firstEvents = []
  const secondEvents = []
  const firstContext = { connectionId: 'one', send: value => firstEvents.push(value) }
  const secondContext = { connectionId: 'two', send: value => secondEvents.push(value) }
  assert.equal((await service.handle(request('attach', { taskId: launched.taskId, position: 0, console: { machineName: 'Mac', sessionId: 'console-1' } }), firstContext)).ok, true)
  assert.equal((await service.handle(request('attach', { taskId: launched.taskId, position: 0, console: { machineName: 'Mac', sessionId: 'console-2' } }), secondContext)).ok, true)
  assert.equal(firstEvents.at(-1).type, 'replaced')
  adapter.sessions[0].release()
  await waitState(service, launched.taskId, 'settled')
  assert.equal(secondEvents.some(event => event.type === 'event' && event.position <= 0), false)
  const history = await service.handle(request('history', { taskId: launched.taskId, position: 0, limit: 1 }))
  assert.equal(history.history.boundary, 1)
  assert.equal(history.history.entries[0].position, 1)
  const record = (await service.handle(request('status', { taskId: launched.taskId }))).task
  assert.deepEqual(record.controlledBy, { machineName: 'Mac', sessionId: 'console-2' })
  await service.disconnect('two')
  assert.equal((await service.handle(request('status', { taskId: launched.taskId }))).task.controlledBy, undefined)
})

test('a project scope lists its own subtree', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const first = join(f.root, 'one')
  const second = join(f.root, 'one', 'nested')
  const unrelated = join(f.root, 'unrelated')
  for (const path of [first, second, unrelated]) await mkdir(path, { recursive: true })
  const older = start(first)
  assert.equal((await service.handle(older)).ok, true)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  adapter.sessions[0].release()
  await waitState(service, older.taskId, 'settled')
  const newer = start(second)
  assert.equal((await service.handle(newer)).ok, true)
  while (!adapter.sessions[1]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  adapter.sessions[1].release()
  await waitState(service, newer.taskId, 'settled')
  const ids = tasks => tasks.map(task => task.taskId).sort()
  assert.deepEqual(ids((await service.handle(request('list', { project: f.root }))).tasks), [older.taskId, newer.taskId].sort())
  assert.deepEqual(ids((await service.handle(request('list', { project: first }))).tasks), [older.taskId, newer.taskId].sort())
  assert.deepEqual(ids((await service.handle(request('list', { project: second }))).tasks), [newer.taskId])
  assert.deepEqual((await service.handle(request('list', { project: unrelated }))).tasks, [])
  // The session's own project is an identity; the root it was found under is not.
  assert.equal((await service.handle(request('status', { taskId: newer.taskId, project: second }))).ok, true)
  assert.equal((await service.handle(request('status', { taskId: newer.taskId, project: first }))).ok, false)
})

test('list orders by most recent update rather than by the order the store enumerates', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'hosted-order-'))
  const root = join(await realpath(dir), 'dev')
  const stateDir = join(dir, 'state')
  await mkdir(root)
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
  const receiptFor = (taskId, updatedAt) => ({
    taskId, project: root, requestedProject: root, prompt: '整理项目', response: '完成',
    state: 'finished', lifecycle: 'ended', turnOutcome: 'finished', endedReason: 'explicit',
    verification: 'not_run', createdAt: '2026-01-01T00:00:00.000Z', updatedAt,
  })
  for (const id of ids) await writeFile(join(stateDir, `${id}.json`), `${JSON.stringify(receiptFor(id, '2026-01-01T00:00:00.000Z'))}\n`)
  // The store inserts records in directory order. Timestamp them newest-first along that same
  // order, so the answer the contract asks for is directory order itself and differs by
  // construction from the reverse of enumeration order, whichever order this file system chose.
  const enumeration = (await readdir(stateDir)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5))
  for (const [index, id] of enumeration.entries()) {
    const seconds = String(enumeration.length - index).padStart(2, '0')
    await writeFile(join(stateDir, `${id}.json`), `${JSON.stringify(receiptFor(id, `2026-01-01T00:00:${seconds}.000Z`))}\n`)
  }
  const service = await createTaskService({ roots: [root], stateDir, socketPath: join(dir, 'socket', 'task.sock') }, { runTask: async () => ({ text: '', stopReason: 'stop' }) })
  t.after(async () => { await service.close(); await rm(dir, { recursive: true, force: true }) })
  assert.deepEqual((await service.handle(request('list', { project: root }))).tasks.map(task => task.taskId), enumeration)
})

test('repeating an end never rewrites a terminal receipt', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  adapter.sessions[0].release()
  await waitState(service, launched.taskId, 'settled')
  const first = await service.handle(request('end', { taskId: launched.taskId }))
  assert.equal(first.task.state, 'finished')
  assert.equal(first.task.turnOutcome, 'finished')
  const second = await service.handle(request('end', { taskId: launched.taskId }))
  assert.equal(second.ok, true)
  assert.equal(second.task.state, 'finished')
  assert.equal(second.task.turnOutcome, 'finished')
  assert.equal(second.task.endedReason, 'explicit')
})

test('prompting an ended session is refused as ended rather than as a malformed prompt', async t => {
  const f = await fixture(t)
  const launched = start(f.root)
  assert.equal((await f.service.handle(launched)).ok, true)
  await settled(f.service, launched.taskId)
  assert.equal((await f.service.handle(request('end', { taskId: launched.taskId }))).ok, true)
  // The voice client always carries a mutation identity, so the mutation pre-check is the path a
  // spoken request actually takes and the one this assertion has to cover.
  const refused = await f.service.handle(request('prompt', { taskId: launched.taskId, prompt: '继续完成测试', mutationId: randomUUID() }))
  assert.equal(refused.ok, false)
  assert.equal(refused.error, 'Hosted Pi 已结束')
  assert.equal((await f.service.handle(request('status', { taskId: launched.taskId }))).task.lifecycle, 'ended')
})

test('a launch in flight is refused as starting, not as ended', async t => {
  let reject
  const adapter = { async createSession() { await new Promise((_resolve, fail) => { reject = fail }) } }
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  assert.equal((await service.handle(launched)).task.lifecycle, 'launching')
  // createHosted runs on setImmediate, so wait for the adapter call before refusing it.
  await new Promise(resolve => setImmediate(resolve))
  for (const command of ['prompt', 'attach', 'history']) {
    const refused = await service.handle(request(command, { taskId: launched.taskId, prompt: '继续', mutationId: randomUUID(), console: { machineName: 'Mac', sessionId: 'console-1' } }), { connectionId: 'one', send: () => {} })
    assert.equal(refused.ok, false, `${command} must not be accepted while the session is starting`)
    assert.equal(refused.error, 'Hosted Pi 正在启动', `${command} leaked an unusable refusal`)
  }
  reject(new Error('no session for you'))
  const failed = await waitState(service, launched.taskId, 'failed')
  assert.equal(failed.turnOutcome, 'failed')
})

test('ending a session during its launch keeps the terminal receipt when the build fails', async t => {
  let reject
  const adapter = { async createSession() { await new Promise((_resolve, fail) => { reject = fail }) } }
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  assert.equal((await service.handle(launched)).task.lifecycle, 'launching')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await service.handle(request('end', { taskId: launched.taskId, mutationId: randomUUID() }))).ok, true)
  reject(new Error('no session for you'))
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  const record = (await service.handle(request('status', { taskId: launched.taskId }))).task
  assert.equal(record.lifecycle, 'ended')
  assert.equal(record.state, 'cancelled')
  assert.equal(record.turnOutcome, 'cancelled')
  assert.equal(record.endedReason, 'explicit')
})

test('ending a Console-attached session clears attribution and tells that Console', async t => {
  const adapter = persistentAdapter()
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  await service.handle(launched)
  while (!adapter.sessions[0]?.isStreaming) await new Promise(resolve => setImmediate(resolve))
  const events = []
  assert.equal((await service.handle(request('attach', { taskId: launched.taskId, position: 0, console: { machineName: 'Mac', sessionId: 'console-1' } }), { connectionId: 'one', send: value => events.push(value) })).ok, true)
  adapter.sessions[0].release()
  await waitState(service, launched.taskId, 'settled')
  const ended = await service.handle(request('end', { taskId: launched.taskId }), { connectionId: 'one', send: () => {} })
  assert.equal(ended.ok, true)
  assert.equal(ended.task.lifecycle, 'ended')
  assert.equal(ended.task.controlledBy, undefined)
  assert.equal(events.at(-1).type, 'state')
  assert.equal(events.at(-1).lifecycle, 'ended')
  assert.equal((await service.handle(request('status', { taskId: launched.taskId }))).task.controlledBy, undefined)
})

test('ending a session whose launch is still in flight settles instead of failing', async t => {
  let release
  let disposed = false
  const adapter = {
    async createSession() {
      await new Promise(resolve => { release = resolve })
      return { isStreaming: false, async prompt() { return { text: '', stopReason: undefined } }, async abort() {}, dispose() { disposed = true }, history() { return { entries: [], boundary: 0, continuation: null } } }
    },
  }
  const f = await fixture(t)
  await f.service.close()
  const service = await createTaskService({ ...f.config, idleMs: 60_000 }, adapter)
  t.after(() => service.close())
  const launched = start(f.root)
  assert.equal((await service.handle(launched)).task.lifecycle, 'launching')
  const ended = await service.handle(request('end', { taskId: launched.taskId }))
  assert.equal(ended.ok, true)
  assert.equal(ended.task.lifecycle, 'ended')
  assert.equal(ended.task.state, 'cancelled')
  release()
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(disposed, true)
  assert.equal((await service.handle(request('status', { taskId: launched.taskId }))).task.activity, undefined)
})

test('held attach socket accepts further correlated commands and streams events until disconnect', async t => {
  const { serveTasks } = await import('../src/task-protocol.mjs')
  const { connect } = await import('node:net')
  const dir = await mkdtemp(join(tmpdir(), 'hosted-socket-'))
  const socketPath = join(dir, 'run', 'host.sock')
  let context
  const server = await serveTasks(socketPath, async (record, nextContext) => {
    context = nextContext
    return { version: 1, requestId: record.requestId, ok: true, command: record.command }
  })
  t.after(async () => { await server.close(); await rm(dir, { recursive: true, force: true }) })
  const socket = connect(socketPath)
  t.after(() => socket.destroy())
  let pending = ''
  const records = []
  socket.setEncoding('utf8')
  socket.on('data', chunk => { pending += chunk; const lines = pending.split('\n'); pending = lines.pop() ?? ''; records.push(...lines.filter(Boolean).map(JSON.parse)) })
  await new Promise(resolve => socket.once('connect', resolve))
  socket.write(JSON.stringify(request('attach', { taskId: randomUUID(), console: { machineName: 'Mac', sessionId: 'console' } })) + '\n')
  while (!records.some(record => record.command === 'attach')) await new Promise(resolve => setImmediate(resolve))
  assert.equal(socket.destroyed, false)
  const status = request('status', { taskId: randomUUID() })
  socket.write(JSON.stringify(status) + '\n')
  while (!records.some(record => record.requestId === status.requestId)) await new Promise(resolve => setImmediate(resolve))
  context.send({ version: 1, type: 'event', position: 3, entry: { kind: 'assistant', text: 'live' } })
  while (!records.some(record => record.type === 'event')) await new Promise(resolve => setImmediate(resolve))
  assert.equal(records.at(-1).position, 3)
})

test('real persisted history uses physical log positions, skips non-message entries and pages explicitly', async t => {
  const { readHostedHistory } = await import('../src/task-agent.mjs')
  const dir = await mkdtemp(join(tmpdir(), 'hosted-history-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'session.jsonl')
  const header = { type: 'session', version: 3, id: randomUUID(), timestamp: '2026-01-01T00:00:00.000Z', cwd: dir }
  const user = { type: 'message', id: 'u', parentId: null, timestamp: '2026-01-01T00:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: 'hello' }], timestamp: 1 } }
  const model = { type: 'model_change', id: 'm', parentId: 'u', timestamp: '2026-01-01T00:00:02.000Z', provider: 'p', modelId: 'm' }
  const assistant = { type: 'message', id: 'a', parentId: 'm', timestamp: '2026-01-01T00:00:03.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'reason' }, { type: 'text', text: 'answer' }], stopReason: 'stop', timestamp: 2 } }
  await writeFile(file, [header, user, model, assistant].map(JSON.stringify).join('\n') + '\n{"type":"message"')
  const first = readHostedHistory(file, 0, 1)
  assert.equal(first.boundary, 3)
  assert.equal(first.events[0].position, 1)
  assert.equal(first.events[0].events[0].kind, 'user')
  assert.equal(first.continuation, 1)
  const second = readHostedHistory(file, first.continuation, 10)
  assert.deepEqual(second.events.map(item => item.position), [3])
  assert.deepEqual(second.events[0].events.map(event => event.kind), ['thinking', 'assistant'])
  assert.equal(second.continuation, null)
})
