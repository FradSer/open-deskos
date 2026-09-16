import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTaskService, reserveTaskRecord } from '../src/task-service.mjs'

async function fixture(t, runTask = async () => ({ text: '完成', stopReason: 'stop' })) {
  const dir = await mkdtemp(join(tmpdir(), 'managed-task-'))
  const root = join(await realpath(dir), 'dev')
  await mkdir(root)
  const config = { roots: [root], stateDir: join(dir, 'state'), socketPath: join(dir, 'socket', 'task.sock') }
  const service = await createTaskService(config, { runTask })
  t.after(async () => { await service.close(); await rm(dir, { recursive: true, force: true }); })
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
  assert.deepEqual((await restarted.handle(request('status', { taskId: req.taskId }))).task, task)
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
  const { runTask, TASK_POLICY } = await import('../src/task-agent.mjs')
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
  assert.match(TASK_POLICY, /禁止自动提交/)
  assert.match(TASK_POLICY, /安装/)
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
