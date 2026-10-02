import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createTaskService } from '../src/task-service.mjs'
import { serveTasks, requestTask } from '../src/task-protocol.mjs'
import { loadCapabilities } from '../src/capabilities.mjs'
import { VoiceService } from '../src/service.mjs'

// The coordinator is a fixture, not a model. Real capability/helper/host boundaries
// pin the handoff lifecycle; this is not provider routing or microphone acceptance.
test('a coding handoff frees the next Spoken Turn while the Hosted Pi remains working', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'voice-handoff-')))
  const project = join(dir, 'project')
  await mkdir(project)
  const config = { roots: [project], stateDir: join(dir, 'state'), socketPath: join(dir, 'run', 'host.sock') }
  let started
  const working = new Promise(resolve => { started = resolve })
  let stopped = false
  const host = await createTaskService(config, { runTask: ({ signal }) => new Promise(resolve => {
    started()
    signal.addEventListener('abort', () => { stopped = true; resolve({ text: '', stopReason: 'aborted' }) }, { once: true })
  }) })
  const server = await serveTasks(config.socketPath, (request, context) => host.handle(request, context))
  const helper = join(dir, 'helper')
  await writeFile(helper, '#!' + process.execPath + '\n' +
    'import(' + JSON.stringify(new URL('../src/task-protocol.mjs', import.meta.url).href) + ').then(async ({requestTask})=>{' +
    'let text="";for await (const chunk of process.stdin) text+=chunk;' +
    'console.log(JSON.stringify(await requestTask(' + JSON.stringify(config.socketPath) + ',JSON.parse(text))));})', { mode: 0o700 })
  const targets = join(dir, 'targets.json')
  await writeFile(targets, JSON.stringify({ targets: [{ id: 'cm5', name: 'Fixture host', roots: [project], executable: helper }] }))
  const previous = process.env.ODESK_TASK_TARGETS_FILE
  process.env.ODESK_TASK_TARGETS_FILE = targets
  t.after(async () => {
    if (previous === undefined) delete process.env.ODESK_TASK_TARGETS_FILE
    else process.env.ODESK_TASK_TARGETS_FILE = previous
    await server.close()
    await host.close()
    await rm(dir, { recursive: true, force: true })
  })
  const tools = await loadCapabilities()
  const launch = tools.find(tool => tool.name === 'coding_task_start')
  let receipt
  const voice = new VoiceService({
    record: async () => ({ stop: async () => 'fixture.wav', cleanup: async () => {}, done: new Promise(() => {}) }),
    transcribe: async () => '请修改这个项目',
    prompt: async () => {
      receipt = JSON.parse((await launch.execute('fixture', { target: 'cm5', project, prompt: '请修改这个项目' })).content[0].text)
      return '已接受；尚未完成。taskId=' + receipt.task.taskId
    },
  })
  t.after(() => voice.close())
  await voice.toggle()
  await voice.toggle()
  await working
  assert.equal(receipt.ok, true)
  assert.equal(voice.status.state, 'idle')
  assert.match(voice.status.message, /尚未完成/)
  const request = { version: 1, requestId: randomUUID(), command: 'status', taskId: receipt.task.taskId, project }
  assert.equal((await requestTask(config.socketPath, request)).task.state, 'running')
  await voice.toggle()
  assert.equal(voice.status.state, 'recording')
  assert.equal(stopped, false)
  assert.equal((await requestTask(config.socketPath, request)).task.state, 'running')
})
