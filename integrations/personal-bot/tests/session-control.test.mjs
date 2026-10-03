import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { fileURLToPath } from 'node:url'
import { loadCapabilities } from '../src/capabilities.mjs'

const TASK_ID = '12345678-1234-1234-1234-123456789abc'
const PROJECT = '/work'
const integration = fileURLToPath(new URL('..', import.meta.url))

// The helper is the target's own control entry point: it echoes the correlated
// request it received, so the assertion is about what actually left the
// coordinator rather than about the coordinator's own bookkeeping.
async function coordinator(t) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-session-control-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const executable = join(dir, 'helper')
  await writeFile(executable, `#!/usr/bin/env node
let input = ''
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  const request = JSON.parse(input)
  console.log(JSON.stringify({ version: 1, requestId: request.requestId, ok: true, task: {
    command: request.command, taskId: request.taskId, project: request.project,
    prompt: request.prompt, streamingBehavior: request.streamingBehavior, position: request.position,
  } }))
})
`, { mode: 0o700 })
  const targets = join(dir, 'targets.json')
  await writeFile(targets, `${JSON.stringify({ targets: [{ id: 'cm5', name: 'CM5', executable, roots: [PROJECT] }] })}\n`)
  const previous = process.env.ODESK_TASK_TARGETS_FILE
  process.env.ODESK_TASK_TARGETS_FILE = targets
  t.after(() => {
    if (previous === undefined) delete process.env.ODESK_TASK_TARGETS_FILE
    else process.env.ODESK_TASK_TARGETS_FILE = previous
  })
  const tools = await loadCapabilities()
  const call = async (name, params) => JSON.parse((await tools.find(tool => tool.name === name).execute('call', params)).content[0].text)
  return { tools, call }
}

test('the coordinator controls a session that already exists instead of replacing it', async t => {
  const { tools, call } = await coordinator(t)
  const names = tools.map(tool => tool.name)
  for (const name of ['coding_task_history', 'coding_task_prompt', 'coding_task_end']) assert.ok(names.includes(name), `${name} is missing`)

  const prompted = await call('coding_task_prompt', { target: 'cm5', project: PROJECT, taskId: TASK_ID, prompt: '继续完成剩余的测试', streamingBehavior: 'steer' })
  assert.equal(prompted.task.command, 'prompt')
  assert.equal(prompted.task.taskId, TASK_ID)
  assert.equal(prompted.task.project, PROJECT)
  assert.equal(prompted.task.prompt, '继续完成剩余的测试')
  assert.equal(prompted.task.streamingBehavior, 'steer')

  const read = await call('coding_task_history', { target: 'cm5', project: PROJECT, taskId: TASK_ID, position: 12 })
  assert.equal(read.task.command, 'history')
  assert.equal(read.task.taskId, TASK_ID)
  assert.equal(read.task.position, 12)

  const ended = await call('coding_task_end', { target: 'cm5', project: PROJECT, taskId: TASK_ID })
  assert.equal(ended.task.command, 'end')
  assert.equal(ended.task.taskId, TASK_ID)
  assert.equal(ended.task.project, PROJECT)
})

test('a further instruction requires an existing identity and a delivery behavior parameter', async t => {
  const { tools } = await coordinator(t)
  const prompt = tools.find(tool => tool.name === 'coding_task_prompt').parameters
  assert.deepEqual([...prompt.required].sort(), ['project', 'prompt', 'target', 'taskId'])
  assert.deepEqual(prompt.properties.streamingBehavior.anyOf.map(member => member.const), ['steer', 'followUp'])
  const history = tools.find(tool => tool.name === 'coding_task_history').parameters
  assert.deepEqual([...history.required].sort(), ['project', 'target', 'taskId'])
  assert.equal(history.properties.position.minimum, 0)
  assert.deepEqual([...tools.find(tool => tool.name === 'coding_task_end').parameters.required].sort(), ['project', 'target', 'taskId'])
})

test('the coordinator refuses a bad delivery behavior, an unconfigured target and a malformed task ID before any request leaves', async t => {
  const { tools, call } = await coordinator(t)
  const execute = params => tools.find(tool => tool.name === 'coding_task_prompt').execute('call', params)
  await assert.rejects(execute({ target: 'cm5', project: PROJECT, taskId: TASK_ID, prompt: '继续', streamingBehavior: 'now' }), /Invalid streaming behavior/)
  await assert.rejects(execute({ target: 'mac', project: PROJECT, taskId: TASK_ID, prompt: '继续' }), /not configured/)
  await assert.rejects(execute({ target: 'cm5', project: PROJECT, taskId: 'not-a-task-id', prompt: '继续' }), /Invalid task ID/)
  await assert.rejects(execute({ target: 'cm5', project: '/work/../else', taskId: TASK_ID, prompt: '继续' }), /Invalid project/)
  // A project outside the advertised roots is the host's answer to give, not the coordinator's: the
  // request leaves carrying the project the operator named.
  assert.equal((await call('coding_task_prompt', { target: 'cm5', project: '/elsewhere', taskId: TASK_ID, prompt: '继续' })).task.project, '/elsewhere')
})

test('an empty target list is reported instead of a guessed host', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-session-control-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const targets = join(dir, 'targets.json')
  await writeFile(targets, '{"targets":[]}\n')
  const previous = process.env.ODESK_TASK_TARGETS_FILE
  process.env.ODESK_TASK_TARGETS_FILE = targets
  t.after(() => {
    if (previous === undefined) delete process.env.ODESK_TASK_TARGETS_FILE
    else process.env.ODESK_TASK_TARGETS_FILE = previous
  })
  const tools = await loadCapabilities()
  const listed = JSON.parse((await tools.find(tool => tool.name === 'coding_targets').execute('call', {}, undefined)).content[0].text)
  assert.deepEqual(listed, { targets: [] })
  await assert.rejects(tools.find(tool => tool.name === 'coding_task_end').execute('call', { target: 'cm5', project: PROJECT, taskId: TASK_ID }), /not configured/)
})

// A real host, reached the way a released one is: a stable symlink to the active release and the
// documented control helper on the target. The daemon runs for real; starting a turn needs model
// credentials, so these tests drive the commands that do not begin one.
async function hostCoordinator(t, seed) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-host-control-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  // The daemon compares real paths, so the root is created from its own real path rather than
  // through the symlinked temporary directory macOS hands out.
  const root = join(await realpath(dir), 'development')
  const stateDir = join(dir, 'state')
  const runDir = join(dir, 'run')
  for (const path of [root, stateDir, runDir]) await mkdir(path, { recursive: true, mode: 0o700 })
  if (seed) await seed(root, stateDir)
  const hostConfig = join(dir, 'pi-tasks.json')
  await writeFile(hostConfig, `${JSON.stringify({ roots: [root], stateDir, socketPath: join(runDir, 'control.sock') })}\n`, { mode: 0o600 })
  await symlink(integration, join(dir, 'current'), 'dir')
  const helper = join(dir, 'pi-task-control')
  await writeFile(helper, `#!/bin/sh\nexport ODESK_TASK_CONFIG='${hostConfig}'\nexec '${process.execPath}' '${join(dir, 'current/src/task-cli.mjs')}'\n`, { mode: 0o700 })
  const targets = join(dir, 'targets.json')
  await writeFile(targets, `${JSON.stringify({ targets: [{ id: 'cm5', name: 'CM5', executable: helper, roots: [root] }] })}\n`)
  const daemon = spawn(process.execPath, [join(dir, 'current/src/task-daemon.mjs')], {
    env: { PATH: process.env.PATH, HOME: dir, XDG_RUNTIME_DIR: dir, ODESK_TASK_CONFIG: hostConfig },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => daemon.kill())
  let live = false
  const socketPath = join(runDir, 'control.sock')
  for (let attempt = 0; attempt < 400 && !live && daemon.exitCode === null; attempt++) {
    live = await new Promise(resolve => {
      const probe = connect(socketPath)
      probe.once('connect', () => { probe.destroy(); resolve(true) })
      probe.once('error', () => { probe.destroy(); resolve(false) })
    })
    if (!live) await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(live, 'the host daemon never served its control socket')
  const previous = process.env.ODESK_TASK_TARGETS_FILE
  process.env.ODESK_TASK_TARGETS_FILE = targets
  t.after(() => {
    if (previous === undefined) delete process.env.ODESK_TASK_TARGETS_FILE
    else process.env.ODESK_TASK_TARGETS_FILE = previous
  })
  return { root, tools: await loadCapabilities() }
}

test('the coordinator reaches a real host daemon through the documented control helper', async t => {
  const { root, tools } = await hostCoordinator(t)
  const call = async (name, params) => JSON.parse((await tools.find(tool => tool.name === name).execute('call', params)).content[0].text)
  const listed = await call('coding_tasks_list', { target: 'cm5', project: root })
  assert.deepEqual(listed.tasks, [])
  assert.equal(listed.truncated, false)
  for (const name of ['coding_task_status', 'coding_task_history', 'coding_task_prompt', 'coding_task_end']) {
    await assert.rejects(tools.find(tool => tool.name === name).execute('call', { target: 'cm5', project: root, taskId: TASK_ID, prompt: '继续' }), /未找到任务/, `${name} did not report the missing session`)
  }
})

test('the coordinator reads and refuses a real recorded session through the same helper', async t => {
  // A session that has already ended: a valid durable receipt with no live SDK session, which is
  // what a spoken "continue that session" hits after the desk has ended it.
  const { root, tools } = await hostCoordinator(t, async (hostRoot, stateDir) => {
    await mkdir(join(hostRoot, 'sub'), { recursive: true })
    const at = '2026-01-01T00:00:00.000Z'
    await writeFile(join(stateDir, `${TASK_ID}.json`), `${JSON.stringify({
      taskId: TASK_ID, project: join(hostRoot, 'sub'), requestedProject: join(hostRoot, 'sub'), prompt: '修复天气应用',
      response: '完成', state: 'finished', lifecycle: 'ended', turnOutcome: 'finished', endedReason: 'explicit',
      verification: 'not_run', createdAt: at, updatedAt: at,
    })}\n`)
  })
  const call = async (name, params) => JSON.parse((await tools.find(tool => tool.name === name).execute('call', params)).content[0].text)
  const listed = await call('coding_tasks_list', { target: 'cm5', project: root })
  assert.deepEqual(listed.tasks.map(task => task.taskId), [TASK_ID])
  assert.equal(listed.tasks[0].lifecycle, 'ended')
  assert.equal(listed.tasks[0].goal, '修复天气应用')
  const subproject = join(root, 'sub')
  assert.deepEqual((await call('coding_tasks_list', { target: 'cm5', project: subproject })).tasks.map(task => task.taskId), [TASK_ID])
  const status = await call('coding_task_status', { target: 'cm5', project: subproject, taskId: TASK_ID })
  assert.equal(status.task.lifecycle, 'ended')
  assert.equal(status.task.verification, 'not_run')
  const history = await call('coding_task_history', { target: 'cm5', project: subproject, taskId: TASK_ID })
  assert.equal(history.history.boundary, 0)
  await assert.rejects(tools.find(tool => tool.name === 'coding_task_prompt').execute('call', { target: 'cm5', project: subproject, taskId: TASK_ID, prompt: '继续完成测试' }), /Hosted Pi 已结束/)
})