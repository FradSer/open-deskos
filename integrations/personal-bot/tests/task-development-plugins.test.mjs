import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTaskComposition, hostedPiManifest, TASK_PORTS } from '../src/task-composition.mjs'
import { loadHostedPiReplacements } from '../src/development-plugins.mjs'

async function selection(t, name, source) {
  const dir = await mkdtemp(join(tmpdir(), 'task-plugins-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const entry = join(dir, 'entry.cjs')
  const config = join(dir, 'selection.json')
  await writeFile(entry, source)
  await writeFile(config, JSON.stringify({ schemaVersion: 1, replacements: [{ manifest: { ...hostedPiManifest(name), version: '2.0.0' }, entry }] }))
  return { dir, entry, config }
}

for (const name of Object.keys(TASK_PORTS)) {
  test(`external Hosted Pi ${name} retains task routing, diagnosis and cleanup`, async t => {
    const source = name === 'listener'
      ? "exports.create = (ctx, bindings) => { globalThis.__taskReplacementBindings = bindings; return { close() {} } }"
      : name === 'service'
        ? "exports.create = ctx => ({ handle: request => ({ version: 1, requestId: request.requestId, ok: true, tasks: ['external'] }), disconnect() {}, close() {} })"
        : "exports.create = async (ctx, bindings) => { await bindings.publish(); return { file: bindings.file, published: true, close: bindings.remove } }"
    const selected = await selection(t, name, source)
    t.after(() => { delete globalThis.__taskReplacementBindings })
    let handle
    const events = []
    const resident = createTaskComposition({ replacementPlugins: loadHostedPiReplacements(selected.config, { trusted: true }),
      openChannel: async handler => { assert.notEqual(name, 'listener'); handle = handler; return { close() { events.push('listener.close') } } },
      createService: async () => { assert.notEqual(name, 'service'); return { handle: request => ({ version: 1, requestId: request.requestId, ok: true, tasks: ['default'] }), disconnect() {}, close() { events.push('service.close') } } },
      endpointFile: () => '/fixture/endpoint.json', publishEndpoint: async () => events.push('endpoint.publish'), removeEndpoint: async () => events.push('endpoint.remove'),
    })
    await resident.start()
    if (name === 'listener') handle = globalThis.__taskReplacementBindings.handleRequest
    assert.equal((await handle({ command: 'list', requestId: randomUUID() })).tasks[0], name === 'service' ? 'external' : 'default')
    const report = await handle({ version: 1, command: 'runtime_diagnose', requestId: randomUUID() })
    assert.equal(report.runtime.plugins.find(plugin => plugin.manifest.id === `odk.hosted-pi.${name}`).manifest.version, '2.0.0')
    assert.equal(resident.port(TASK_PORTS.endpoint).published, true)
    await resident.close()
    assert.equal(events.filter(event => event === 'endpoint.remove').length, 1)
  })
}

test('Hosted Pi external inspection is lazy and incompatible declarations fail before execution', async t => {
  const selected = await selection(t, 'service', "throw Error('entry executed')")
  assert.throws(() => loadHostedPiReplacements(selected.config), /trust/)
  assert.equal(loadHostedPiReplacements(selected.config, { trusted: true }).length, 1)
  assert.throws(() => createTaskComposition({ replacementPlugins: [{ manifest: { ...hostedPiManifest('service'), requires: [] }, create() { throw Error('entry executed') } }] }), /contract/)
})

test('actual Hosted Pi inspection needs no task configuration and executes no entry', async t => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { fileURLToPath } = await import('node:url')
  const selected = await selection(t, 'service', "throw Error('private entry executed')")
  const result = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../src/task-daemon.mjs', import.meta.url)), '--plugin-selection', selected.config, '--trust-plugins', '--plugins', 'validate'], {
    timeout: 10000, env: { PATH: process.env.PATH, ODK_CONFIG_DIR: selected.dir },
  })
  const report = JSON.parse(result.stdout)
  assert.equal(report.instance, 'hosted-pi')
  assert.equal(report.plugins.find(item => item.manifest.id === 'odk.hosted-pi.service').manifest.version, '2.0.0')
  assert.equal(result.stderr, '')
})

test('actual daemon uses all external components for list, diagnosis, publication and shutdown', { skip: process.platform === 'win32' && 'This fixture uses a Unix socket; native Windows acceptance is separate.', timeout: 15000 }, async t => {
  const { spawn } = await import('node:child_process')
  const { readFile, mkdir, access } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { requestTask } = await import('../src/task-protocol.mjs')
  const selected = await selection(t, 'service', `
const { createTaskService } = require(${JSON.stringify(fileURLToPath(new URL('../src/task-service.mjs', import.meta.url)))});
const { loadTaskConfig } = require(${JSON.stringify(fileURLToPath(new URL('../src/task-store.mjs', import.meta.url)))});
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
exports.create = async () => {
  const config = await loadTaskConfig();
  const service = await createTaskService(config, { async runTask({ task, signal }) {
    const saved = JSON.parse(await readFile(join(config.stateDir, task.taskId + '.json'), 'utf8'));
    if (saved.taskId !== task.taskId || saved.state !== 'running') throw Error('receipt must precede execution');
    console.log('selected.task.running');
    if (task.prompt === 'Controlled successful task') return { text: 'Selected task completed', stopReason: 'stop' };
    if (task.prompt === 'Controlled failed task') throw Error('Controlled execution failure');
    return new Promise(resolve => {
      const abort = () => { console.log('selected.task.aborted'); resolve({ text: '', stopReason: 'aborted' }); };
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    });
  } });
  return { ...service, async close() { await service.close(); console.log('selected.service.closed'); } };
};
`)
  const socket = join(selected.dir, 'control.sock')
  const descriptor = join(selected.dir, 'odk', 'hosted-pi', 'endpoint.json')
  const project = join(selected.dir, 'project')
  await mkdir(project)
  const taskConfig = join(selected.dir, 'tasks.json')
  await writeFile(taskConfig, JSON.stringify({ roots: [project], stateDir: join(selected.dir, 'state'), socketPath: socket }), { mode: 0o600 })
  const listener = join(selected.dir, 'listener.cjs')
  const endpoint = join(selected.dir, 'endpoint.cjs')
  const protocol = fileURLToPath(new URL('../src/task-protocol.mjs', import.meta.url))
  await writeFile(listener, `const { serveTasks } = require(${JSON.stringify(protocol)}); exports.create = async (ctx, bindings) => { const channel = await serveTasks(process.env.ODK_TEST_SOCKET, bindings.handleRequest, bindings.disconnect); return { disconnectClients: () => channel.disconnectClients(), close() { console.log('selected.listener.closed'); return channel.close() } } }`)
  await writeFile(endpoint, "exports.create = async (ctx, bindings) => { await bindings.publish(); console.log('selected.endpoint.ready'); return { file: bindings.file, published: true, async close() { await bindings.remove(); console.log('selected.endpoint.closed') } } }")
  await writeFile(selected.config, JSON.stringify({ schemaVersion: 1, replacements: [
    { manifest: { ...hostedPiManifest('listener'), version: '2.0.0' }, entry: listener },
    { manifest: { ...hostedPiManifest('service'), version: '2.0.0' }, entry: selected.entry },
    { manifest: { ...hostedPiManifest('endpoint'), version: '2.0.0' }, entry: endpoint },
  ] }))
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/task-daemon.mjs', import.meta.url)), '--plugin-selection', selected.config, '--trust-plugins'], {
    env: { PATH: process.env.PATH, HOME: selected.dir, XDG_RUNTIME_DIR: selected.dir, ODK_TASK_CONFIG: taskConfig, ODK_TEST_SOCKET: socket },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  let output = ''
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error(`startup timed out: ${errors}`)), 10000)
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('selected.endpoint.ready')) { clearTimeout(timeout); resolve() } })
    child.once('close', code => { clearTimeout(timeout); reject(Error(`startup exited ${code}: ${errors}`)) })
    child.once('error', error => { clearTimeout(timeout); reject(error) })
  })
  assert.equal(JSON.parse(await readFile(descriptor, 'utf8')).socketPath, socket)
  const list = await requestTask(socket, { version: 1, requestId: randomUUID(), command: 'list' })
  assert.equal(list.ok, true)
  assert.deepEqual(list.tasks, [])
  const diagnosis = await requestTask(socket, { version: 1, requestId: randomUUID(), command: 'runtime_diagnose' })
  assert.ok(diagnosis.runtime.plugins.every(plugin => plugin.state === 'running'))
  assert.ok(diagnosis.runtime.plugins.filter(plugin => plugin.manifest.id !== 'odk.hosted-pi.control').every(plugin => plugin.manifest.version === '2.0.0'))
  assert.equal(diagnosis.runtime.plugins.find(plugin => plugin.manifest.id === 'odk.hosted-pi.control').manifest.version, '1.0.0')
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const cli = fileURLToPath(new URL('../../../runtime/shell/scripts/odk-plugin-cli.js', import.meta.url))
  const manage = action => promisify(execFile)(process.execPath, [cli, action, 'odk.hosted-pi.service', '--runtime'], {
    env: { PATH: process.env.PATH, HOME: selected.dir, XDG_RUNTIME_DIR: selected.dir, ODK_CONFIG_DIR: join(selected.dir, 'preferences') },
  })
  const taskId = randomUUID()
  const startRequest = { version: 1, requestId: randomUUID(), command: 'start', taskId, project, prompt: 'Controlled pending task' }
  const started = await requestTask(socket, startRequest)
  assert.equal(started.task?.taskId, taskId)
  if (!output.includes('selected.task.running')) await new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); child.stdout.off('data', observe); error ? reject(error) : resolve() }
    const observe = () => { if (output.includes('selected.task.running')) finish() }
    const timer = setTimeout(() => finish(Error('selected task did not begin')), 3000)
    child.stdout.on('data', observe)
  })
  assert.equal(JSON.parse((await manage('disable')).stdout).state, 'disabled')
  const savedFile = join(selected.dir, 'state', `${taskId}.json`)
  const savedBytes = await readFile(savedFile, 'utf8')
  const saved = JSON.parse(savedBytes)
  assert.equal(saved.state, 'cancelled')
  assert.equal(saved.verification, 'not_run')
  assert.equal(output.match(/selected\.task\.aborted/g)?.length, 1)
  await assert.rejects(access(descriptor), { code: 'ENOENT' })
  assert.equal((await requestTask(socket, { version: 1, requestId: randomUUID(), command: 'list' })).error, '任务服务正在启动')
  assert.equal(JSON.parse((await manage('enable')).stdout).state, 'running')
  assert.deepEqual((await requestTask(socket, { version: 1, requestId: randomUUID(), command: 'list' })).tasks.map(task => task.taskId), [taskId])
  const retry = await requestTask(socket, { ...startRequest, requestId: randomUUID() })
  assert.equal(retry.task.taskId, taskId)
  assert.equal(retry.task.state, 'cancelled')
  assert.equal(await readFile(savedFile, 'utf8'), savedBytes)
  assert.equal(output.match(/selected\.task\.running/g)?.length, 1)
  assert.equal(output.match(/selected\.task\.aborted/g)?.length, 1)
  const terminalRecords = []
  for (const [prompt, state, response] of [
    ['Controlled successful task', 'finished', 'Selected task completed'],
    ['Controlled failed task', 'failed', '任务执行未正常完成，请检查本机会话记录'],
  ]) {
    const terminalId = randomUUID()
    const request = { version: 1, requestId: randomUUID(), command: 'start', taskId: terminalId, project, prompt }
    assert.equal((await requestTask(socket, request)).task?.taskId, terminalId)
    const deadline = performance.now() + 3000
    let status
    do {
      assert.equal(child.exitCode, null, 'Selected daemon must remain available during task completion')
      status = await requestTask(socket, { version: 1, requestId: randomUUID(), command: 'status', taskId: terminalId })
      if (status.task?.state === state) break
      assert.ok(performance.now() < deadline, `Selected task did not reach ${state}`)
      await new Promise(resolve => setImmediate(resolve))
    } while (true)
    assert.equal(status.ok, true)
    assert.equal(status.task.lifecycle, 'ended')
    assert.equal(status.task.turnOutcome, state)
    assert.equal(status.task.response, response)
    assert.equal(status.task.verification, 'not_run')
    const file = join(selected.dir, 'state', `${terminalId}.json`)
    const bytes = await readFile(file, 'utf8')
    const record = JSON.parse(bytes)
    assert.equal(record.taskId, terminalId)
    assert.equal(record.prompt, prompt)
    assert.equal(record.state, state)
    assert.equal(record.response, response)
    assert.equal(record.verification, 'not_run')
    const replay = await requestTask(socket, { ...request, requestId: randomUUID() })
    assert.equal(replay.task.taskId, terminalId)
    assert.equal(replay.task.state, state)
    assert.equal(replay.task.response, response)
    assert.equal(await readFile(file, 'utf8'), bytes)
    terminalRecords.push({ file, bytes })
  }
  assert.equal(output.match(/selected\.task\.running/g)?.length, 3)
  assert.equal(output.match(/selected\.task\.aborted/g)?.length, 1)
  child.kill('SIGTERM')
  assert.deepEqual(await closed, { code: 0, signal: null })
  for (const { file, bytes } of terminalRecords) assert.equal(await readFile(file, 'utf8'), bytes)
  assert.equal(output.match(/selected\.task\.running/g)?.length, 3)
  assert.equal(output.match(/selected\.task\.aborted/g)?.length, 1)
  for (const name of Object.keys(TASK_PORTS)) assert.equal(output.match(new RegExp(`selected\\.${name}\\.closed`, 'g'))?.length, name === 'listener' ? 1 : 2)
  await assert.rejects(access(descriptor), { code: 'ENOENT' })
  assert.equal(errors, '')
})

for (const [component,missing] of [['listener','close'], ['service','handle'], ['service','disconnect'], ['service','close'], ['endpoint','close']]) {
  test(`selected ${component} missing ${missing} fails startup and cleans registered allocations`, async t => {
    const resource = component === 'endpoint' ? "{ file: bindings.file, published: true }" : component === 'listener' ? "{}" : `{ handle() {}, disconnect() {}, close() {}, ${missing}: undefined }`
    const selected = await selection(t, component, `exports.create = (ctx, bindings) => { ctx.onCleanup(() => { globalThis.__taskInvalidReleased = true }); return ${resource} }`)
    t.after(() => { delete globalThis.__taskInvalidReleased })
    const resident = createTaskComposition({ replacementPlugins: loadHostedPiReplacements(selected.config, { trusted: true }),
      openChannel: async () => ({ close() {} }), createService: async () => ({ handle() {}, disconnect() {}, close() {} }),
      endpointFile: () => '/fixture/endpoint.json', publishEndpoint: async () => {}, removeEndpoint: async () => {},
    })
    await assert.rejects(resident.start(), /requires callable|invalid Hosted Pi endpoint/)
    assert.equal(globalThis.__taskInvalidReleased, true)
    await resident.close()
  })
}

test('independent Hosted Pi service preserves existing terminal records without replay', { timeout: 15000 }, async t => {
  const { mkdir, readFile, realpath } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { createTaskService } = await import('../src/task-service.mjs')
  const selected = await selection(t, 'service', '')
  const root = join(await realpath(selected.dir), 'project')
  const stateDir = join(selected.dir, 'state')
  await mkdir(root)
  await mkdir(stateDir, { mode: 0o700 })
  const config = { roots: [root], stateDir, socketPath: join(selected.dir, 'tasks.sock') }
  const records = ['finished', 'failed', 'cancelled', 'interrupted'].map((state, index) => ({
    taskId: randomUUID(), project: root, prompt: `Controlled saved goal ${index}: "reading"`,
    state, lifecycle: state === 'interrupted' ? 'interrupted' : 'ended', turnOutcome: state, verification: 'not_run',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: `2026-01-0${index + 1}T01:00:00.000Z`,
    response: index === 3 ? '界'.repeat(5461) + 'x' : `Controlled private result ${index}`, sessionFile: join(stateDir, `session-${index}.jsonl`),
    controlAudit: [{ machineName: 'controlled-console', sessionId: 'fixture', at: '2026-01-01T00:00:00.000Z' }],
  }))
  const saved = new Map()
  for (const record of records) {
    const file = join(stateDir, `${record.taskId}.json`)
    const bytes = JSON.stringify(record)
    await writeFile(file, bytes, { mode: 0o600 })
    saved.set(file, bytes)
  }
  // The alternative owns read-only dispatch; only the existing store and pure projection are shared.
  await writeFile(selected.entry, `
const { loadRecords } = require(${JSON.stringify(fileURLToPath(new URL('../src/task-store.mjs', import.meta.url)))});
const { goalPreviews } = require(${JSON.stringify(fileURLToPath(new URL('../src/task-service.mjs', import.meta.url)))});
exports.create = async () => {
  let tasks = [...(await loadRecords(${JSON.stringify(stateDir)})).values()];
  let closed = false;
  return {
    handle(request) {
      const base = { version: 1, requestId: request.requestId };
      if (closed) return { ...base, ok: false, error: '任务服务不可用' };
      if (request.command === 'list') {
        const ordered = tasks.toSorted((left, right) => left.updatedAt !== right.updatedAt
          ? (left.updatedAt < right.updatedAt ? 1 : -1) : (left.taskId < right.taskId ? -1 : 1));
        return { ...base, ok: true, tasks: goalPreviews(ordered.slice(0, 100)), truncated: ordered.length > 100 };
      }
      const task = request.command === 'status' && tasks.find(task => task.taskId === request.taskId);
      return task ? { ...base, ok: true, task: structuredClone(task) }
        : { ...base, ok: false, error: '未知任务命令' };
    },
    disconnect() {},
    close() { closed = true; tasks = []; },
  };
};
`)
  const requests = [{ version: 1, requestId: randomUUID(), command: 'list' },
    ...records.map(record => ({ version: 1, requestId: randomUUID(), command: 'status', taskId: record.taskId }))]
  let baseline
  for (const independent of [false, true]) {
    let handle
    const events = []
    const composition = createTaskComposition({
      replacementPlugins: independent ? loadHostedPiReplacements(selected.config, { trusted: true }) : [],
      createService: () => {
        assert.equal(independent, false, 'independent service cannot construct the default task engine')
        return createTaskService(config, { runTask() { assert.fail('saved terminal records cannot execute') } })
      },
      openChannel: async handler => { handle = handler; return { disconnectClients() {}, close() { events.push('listener.close') } } },
      endpointFile: () => join(selected.dir, 'endpoint.json'),
      publishEndpoint: async () => events.push('endpoint.publish'),
      removeEndpoint: async () => events.push('endpoint.remove'),
    })
    try {
      await composition.start()
      const listener = composition.port(TASK_PORTS.listener)
      const service = composition.port(TASK_PORTS.service)
      const results = await Promise.all(requests.map(request => handle(request)))
      if (!independent) {
        baseline = results
        assert.deepEqual(results[0].tasks.map(task => task.taskId), [...records].reverse().map(record => record.taskId))
        for (const task of results[0].tasks) {
          assert.equal(typeof task.goal, 'string')
          for (const key of ['prompt', 'response', 'sessionFile', 'controlAudit']) assert.equal(Object.hasOwn(task, key), false)
        }
        for (let index = 0; index < records.length; index++) assert.deepEqual(results[index + 1].task, records[index])
      } else assert.deepEqual(results, baseline)
      await composition.setEnabled('odk.hosted-pi.service', false)
      assert.equal(composition.port(TASK_PORTS.listener), listener)
      assert.equal((await handle(requests[0])).error, '任务服务正在启动')
      await composition.setEnabled('odk.hosted-pi.service', true)
      assert.equal(composition.port(TASK_PORTS.listener), listener)
      assert.notEqual(composition.port(TASK_PORTS.service), service)
      assert.deepEqual(await Promise.all(requests.map(request => handle(request))), baseline)
      assert.deepEqual(events, ['endpoint.publish', 'endpoint.remove', 'endpoint.publish'])
      for (const [file, bytes] of saved) assert.equal(await readFile(file, 'utf8'), bytes)
    } finally { await composition.close() }
    assert.deepEqual(events, ['endpoint.publish', 'endpoint.remove', 'endpoint.publish', 'endpoint.remove', 'listener.close'])
    for (const [file, bytes] of saved) assert.equal(await readFile(file, 'utf8'), bytes)
  }
})
