import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createTaskComposition, hostedPiManifest, TASK_PORTS } from '../src/task-composition.mjs'
import { createTaskService } from '../src/task-service.mjs'

for (const selected of [false, true]) {
  test(`${selected ? 'selected' : 'default'} task engine cancels and retains records across service disable and enable`, { timeout: 10000 }, async t => {
    const { mkdtemp, mkdir, readFile, realpath, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const directory = await mkdtemp(join(tmpdir(), 'task-plugin-records-'))
    const root = join(await realpath(directory), 'project')
    await mkdir(root)
    const config = { roots: [root], stateDir: join(directory, 'state'), socketPath: join(directory, 'tasks.sock') }
    let handle, entered, executions = 0
    const running = new Promise(resolve => { entered = resolve })
    const events = []
    // Both factories use the existing engine. This checks composition, not an independent task algorithm.
    const createService = () => createTaskService(config, { runTask: ({ signal }) => {
      executions++
      return new Promise(resolve => {
        const cancelled = () => resolve({ text: '', stopReason: 'aborted' })
        if (signal.aborted) cancelled()
        else signal.addEventListener('abort', cancelled, { once: true })
        entered()
      })
    } })
    const composition = createTaskComposition({
      openChannel: async handler => { handle = handler; return { disconnectClients() {}, close() { events.push('listener.close') } } },
      createService: () => { assert.equal(selected, false, 'selected service must not construct the default'); return createService() },
      replacementPlugins: selected ? [{ manifest: { ...hostedPiManifest('service'), version: '2.0.0' }, create: createService }] : [],
      endpointFile: () => join(directory, 'endpoint.json'),
      publishEndpoint: async () => { events.push('endpoint.publish') },
      removeEndpoint: async () => { events.push('endpoint.remove') },
    })
    t.after(async () => { await composition.close(); await rm(directory, { recursive: true, force: true }) })
    const request = (command, data = {}) => ({ version: 1, requestId: randomUUID(), command, ...data })
    await composition.start()
    const listener = composition.port(TASK_PORTS.listener)
    const taskId = randomUUID()
    assert.equal((await handle(request('start', { taskId, project: root, prompt: 'Controlled pending task' }))).ok, true)
    await running
    await composition.setEnabled('odk.hosted-pi.service', false)
    const saved = JSON.parse(await readFile(join(config.stateDir, `${taskId}.json`), 'utf8'))
    assert.equal(saved.state, 'cancelled')
    assert.equal(saved.verification, 'not_run')
    assert.equal(composition.port(TASK_PORTS.listener), listener)
    assert.equal((await handle(request('list'))).ok, false)
    assert.deepEqual(events, ['endpoint.publish', 'endpoint.remove'])
    await composition.setEnabled('odk.hosted-pi.service', true)
    const status = await handle(request('status', { taskId }))
    assert.equal(status.ok, true)
    assert.equal(status.task.state, saved.state)
    assert.equal(status.task.response, saved.response)
    assert.equal(executions, 1)
    assert.deepEqual(JSON.parse(await readFile(join(config.stateDir, `${taskId}.json`), 'utf8')), saved)
    assert.equal(composition.port(TASK_PORTS.listener), listener)
    assert.equal(composition.catalog().find(plugin => plugin.manifest.id === 'odk.hosted-pi.service').manifest.version, selected ? '2.0.0' : '1.0.0')
    await composition.close()
    assert.deepEqual(events, ['endpoint.publish', 'endpoint.remove', 'endpoint.publish', 'endpoint.remove', 'listener.close'])
  })
}

test('runtime diagnosis remains available during task initialization and rejects task fields', async () => {
  let handle
  let finish
  let enter
  let taskCalls = 0
  const entered = new Promise(resolve => { enter = resolve })
  const pending = new Promise(resolve => { finish = resolve })
  const composition = createTaskComposition({
    openChannel: async handler => { handle = handler; return { close() {} } },
    createService: () => { enter(); return pending },
    endpointFile: () => null, publishEndpoint() {}, removeEndpoint() {},
  })
  const starting = composition.start()
  await entered
  try {
    const request = { version: 1, command: 'runtime_diagnose', requestId: randomUUID() }
    const result = await handle(request)
    assert.equal(result.runtime.instance, 'hosted-pi')
    assert.equal(result.runtime.plugins.find(plugin => plugin.manifest.id === 'odk.hosted-pi.service').state, 'starting')
    assert.equal((await handle({ ...request, project: 'private', prompt: 'private' })).ok, false)
    assert.equal((await handle({ ...request, version: 2 })).ok, false)
    assert.equal((await handle({ ...request, requestId: 'invalid' })).ok, false)
    for (const requestId of ['-'.repeat(36), 'a'.repeat(36)]) {
      assert.equal((await handle({ ...request, requestId })).ok, false)
    }
  } finally {
    finish({ handle() { taskCalls++; return Promise.resolve({ ok: true }) }, close() {} })
    await starting
    await composition.close()
  }
  assert.equal(taskCalls, 0)
})

function fixture({ publishFailure = false, closeFailure = false, initialize } = {}) {
  const events = []
  const service = { handle: request => ({ request }), disconnect() {}, close() { events.push('service.close') } }
  const composition = createTaskComposition({
    openChannel: async (handle) => { events.push('listener.open'); assert.equal((await handle({ requestId: 'starting' })).ok, false); return { close() { events.push('listener.close'); if (closeFailure) throw Error('listener failure') } } },
    createService: initialize || (async () => { events.push('service.create'); return service }),
    endpointFile: () => '/fixture/endpoint.json',
    publishEndpoint: async () => { events.push('endpoint.publish'); if (publishFailure) throw Error('publication failure') },
    removeEndpoint: async () => { events.push('endpoint.remove') },
    reportPublicationFailure: () => events.push('endpoint.warning'),
  })
  return { composition, events, service, recoverClose() { closeFailure = false } }
}

test('partial service lifecycle retains its listener and restores endpoint publication', async () => {
  const events = []
  let handle
  let services = 0
  const composition = createTaskComposition({
    openChannel: async handler => { handle = handler; events.push('listener.open'); return { disconnectClients() {}, close() { events.push('listener.close') } } },
    createService: async () => { const generation = ++services; return { handle: () => ({ generation }), close() { events.push('service.close') } } },
    endpointFile: () => '/fixture/endpoint.json', publishEndpoint: async () => { events.push('endpoint.publish') },
    removeEndpoint: async () => { events.push('endpoint.remove') },
  })
  await composition.start()
  const listener = composition.port(TASK_PORTS.listener)
  await composition.setEnabled('odk.hosted-pi.service', false)
  assert.equal(composition.port(TASK_PORTS.listener), listener)
  assert.deepEqual(events, ['listener.open', 'endpoint.publish', 'endpoint.remove', 'service.close'])
  assert.equal((await handle({ requestId: 'fixture' })).error, '任务服务正在启动')
  await composition.setEnabled('odk.hosted-pi.service', true)
  assert.deepEqual(await handle({ requestId: 'fixture' }), { generation: 2 })
  assert.equal(composition.port(TASK_PORTS.listener), listener)
  await composition.close()
  assert.deepEqual(events.slice(-3), ['endpoint.remove', 'listener.close', 'service.close'])
})

test('failed endpoint withdrawal retains its service until cleanup can retry', async () => {
  let fail = true
  let serviceCloses = 0
  const composition = createTaskComposition({
    openChannel: async () => ({ disconnectClients() {}, close() {} }),
    createService: async () => ({ close() { serviceCloses++ } }),
    endpointFile: () => '/fixture/endpoint.json', publishEndpoint: async () => {},
    removeEndpoint: async () => { if (fail) throw Error('private withdrawal failure') },
  })
  await composition.start()
  await composition.setEnabled('odk.hosted-pi.service', false)
  assert.equal(composition.catalog().find(plugin => plugin.manifest.id === 'odk.hosted-pi.endpoint').state, 'cleanup-failed')
  assert.equal(serviceCloses, 0)
  fail = false
  await composition.setEnabled('odk.hosted-pi.service', false)
  assert.equal(serviceCloses, 1)
  await composition.close()
})

test('service disable disconnects attached Consoles while retaining its accepting listener', { skip: process.platform === 'win32' }, async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createConnection } = await import('node:net')
  const { once } = await import('node:events')
  const { serveTasks, requestTask } = await import('../src/task-protocol.mjs')
  const root = await mkdtemp(join(tmpdir(), 'task-attachment-'))
  const socket = join(root, 'task.sock')
  let enterDisconnect
  const disconnecting = new Promise(resolve => { enterDisconnect = resolve })
  let finishDisconnect
  const pendingDisconnect = new Promise(resolve => { finishDisconnect = resolve })
  let serviceCloses = 0
  const composition = createTaskComposition({
    openChannel: (handle, disconnect) => serveTasks(socket, handle, disconnect),
    createService: () => ({ handle: async request => ({ version: 1, requestId: request.requestId, ok: true }),
      async disconnect() { enterDisconnect(); await pendingDisconnect }, close() { serviceCloses++ } }),
    endpointFile: () => null, publishEndpoint() {}, removeEndpoint() {},
  })
  let peer
  t.after(async () => { finishDisconnect(); peer?.destroy(); await composition.close(); await rm(root, { recursive: true, force: true }) })
  await composition.start()
  peer = createConnection(socket)
  peer.on('error', () => {})
  await once(peer, 'connect')
  const attached = once(peer, 'data')
  peer.write(JSON.stringify({ version: 1, requestId: 'attach', command: 'attach' }) + '\n')
  await attached
  const disabling = composition.setEnabled('odk.hosted-pi.service', false)
  await disconnecting
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(serviceCloses, 0)
  finishDisconnect()
  await disabling
  // Read-side close delivery can follow server-side close completion.
  if (!peer.destroyed) await once(peer, 'close')
  assert.equal(peer.destroyed, true)
  assert.equal((await requestTask(socket, { version: 1, requestId: 'new', command: 'list' })).error, '任务服务正在启动')
  await composition.setEnabled('odk.hosted-pi.service', true)
  assert.equal((await requestTask(socket, { version: 1, requestId: 'restored', command: 'list' })).ok, true)
})

test('legacy listeners refuse partial service operations before graph mutation', async () => {
  const { composition, events } = fixture()
  await composition.start()
  const before = [...events]
  for (const id of ['odk.hosted-pi.service', 'odk.hosted-pi.listener']) {
    await assert.rejects(composition.setEnabled(id, false), /connection draining/)
    assert.deepEqual(events, before)
  }
  await composition.close()
})

for (const wholeShutdown of [false, true]) {
for (const selected of [false, true]) {
test(`${selected ? 'selected' : 'default'} service retries failed asynchronous disconnect before close during ${wholeShutdown ? 'shutdown' : 'partial disable'}`, { skip: process.platform === 'win32' }, async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { serveTasks, requestTask } = await import('../src/task-protocol.mjs')
  const root = await mkdtemp(join(tmpdir(), 'task-disconnect-'))
  const socket = join(root, 'task.sock')
  let fail = true
  let calls = 0
  let closed = 0
  const createService = () => ({ handle: async request => ({ version: 1, requestId: request.requestId, ok: true }),
    async disconnect() { calls++; if (closed) throw Error('disposed service cannot disconnect'); if (fail) throw Error('private disconnect failure') }, close() { closed++ } })
  const composition = createTaskComposition({
    openChannel: (handle, disconnect) => serveTasks(socket, handle, disconnect),
    replacementPlugins: selected ? [{ manifest: { ...hostedPiManifest('service'), version: '2.0.0' }, create: createService }] : [],
    createService: () => { assert.equal(selected, false, 'selected service must not construct the default'); return createService() },
    endpointFile: () => null, publishEndpoint() {}, removeEndpoint() {},
  })
  t.after(async () => { fail = false; await composition.close(); await rm(root, { recursive: true, force: true }) })
  await composition.start()
  assert.equal(composition.catalog().find(plugin => plugin.manifest.id === 'odk.hosted-pi.service').manifest.version, selected ? '2.0.0' : '1.0.0')
  await requestTask(socket, { version: 1, requestId: 'fixture', command: 'list' })
  if (wholeShutdown) await assert.rejects(composition.close(), /shutdown failed/)
  else await composition.setEnabled('odk.hosted-pi.service', false)
  assert.equal(composition.catalog().find(plugin => plugin.manifest.id === 'odk.hosted-pi.service').state, 'cleanup-failed')
  assert.equal(closed, 0)
  assert.ok(calls >= 1)
  fail = false
  if (wholeShutdown) await composition.close()
  else await composition.setEnabled('odk.hosted-pi.service', false)
  assert.equal(closed, 1)
  assert.ok(calls >= 2)
})
}
}

test('task resources use ordered plugins and close once', async () => {
  const { composition, events } = fixture()
  await composition.start()
  await composition.start()
  assert.ok(composition.catalog().every(entry => entry.state === 'running'))
  assert.equal(composition.port(TASK_PORTS.endpoint).published, true)
  await composition.close()
  await composition.close()
  assert.deepEqual(events, ['listener.open', 'service.create', 'endpoint.publish', 'endpoint.remove', 'listener.close', 'service.close'])
})

test('publication failure retains service and reports existing warning', async () => {
  const { composition, events } = fixture({ publishFailure: true })
  await composition.start()
  assert.ok(composition.port(TASK_PORTS.service))
  assert.equal(composition.port(TASK_PORTS.endpoint).published, false)
  assert.deepEqual(events, ['listener.open', 'service.create', 'endpoint.publish', 'endpoint.warning'])
  await composition.close()
  assert.ok(!events.includes('endpoint.remove'))
})

test('listener close failure still closes service and reports failed shutdown', async () => {
  const { composition, events, recoverClose } = fixture({ closeFailure: true })
  await composition.start()
  await assert.rejects(composition.close(), /shutdown failed/)
  assert.deepEqual(events.slice(-3), ['endpoint.remove', 'listener.close', 'service.close'])
  recoverClose()
  await composition.close()
  assert.equal(events.filter(event => event === 'listener.close').length, 2)
  assert.equal(events.filter(event => event === 'service.close').length, 1)
  assert.ok(composition.catalog().every(entry => entry.state === 'stopped'))
})

test('late service creation is cleaned without endpoint publication', async () => {
  let finish
  let enter
  const entered = new Promise(resolve => { enter = resolve })
  const pending = new Promise(resolve => { finish = resolve })
  const { composition, events, service } = fixture({ initialize: async () => { enter(); return pending } })
  const starting = composition.start()
  await entered
  const closing = composition.close()
  finish(service)
  await Promise.all([starting, closing])
  assert.deepEqual(events, ['listener.open', 'listener.close', 'service.close'])
})

test('service initialization failure closes listener and retains the original error', async () => {
  const failure = Error('service initialization failure')
  const { composition, events } = fixture({ initialize: async () => { throw failure } })
  await assert.rejects(composition.start(), error => error === failure)
  assert.deepEqual(events, ['listener.open', 'listener.close'])
})

test('a late endpoint publication is withdrawn during cancellation', async () => {
  const events = []
  let finish
  let enter
  const entered = new Promise(resolve => { enter = resolve })
  const pending = new Promise(resolve => { finish = resolve })
  const composition = createTaskComposition({
    openChannel: async () => ({ close() { events.push('listener.close') } }),
    createService: async () => ({ close() { events.push('service.close') } }),
    endpointFile: () => '/fixture/endpoint.json',
    publishEndpoint: async () => { enter(); await pending; events.push('endpoint.publish') },
    removeEndpoint: async () => { events.push('endpoint.remove') },
  })
  const starting = composition.start()
  await entered
  const closing = composition.close()
  finish()
  await Promise.all([starting, closing])
  assert.deepEqual(events, ['endpoint.publish', 'endpoint.remove', 'listener.close', 'service.close'])
})
