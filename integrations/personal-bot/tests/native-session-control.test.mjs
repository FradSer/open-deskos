import assert from 'node:assert/strict'
import { test } from 'node:test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadCapabilities } from '../src/capabilities.mjs'
import { createIntentTurn, guardIntentTools } from '../src/intent-routing.mjs'

const IDS = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003']
const REFUSALS = ['此端点是当前 Pi 会话，不是 Hosted Pi 任务服务', '指令未送达：该会话正在运行，且这条消息没有被排队']
async function configuredTools(t, root, executable) {
  const config = join(root, 'targets.json')
  await writeFile(config, JSON.stringify({ targets: [{ id: 'mac', name: 'Mac', roots: [root], executable }] }))
  const previous = process.env.ODESK_TASK_TARGETS_FILE
  process.env.ODESK_TASK_TARGETS_FILE = config
  t.after(() => { if (previous === undefined) delete process.env.ODESK_TASK_TARGETS_FILE; else process.env.ODESK_TASK_TARGETS_FILE = previous })
  const tools = await loadCapabilities()
  return { tools, call: async (name, params) => (await tools.find(tool => tool.name === name).execute('fixture', params)).structuredContent }
}
async function temporaryRoot(t) {
  const root = await mkdtemp('/tmp/odk-native-')
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
test('native endpoint fixed refusals retain meaning while arbitrary errors remain hidden', async t => {
  const root = await temporaryRoot(t)
  const executable = join(root, 'helper')
  await writeFile(executable, `#!/usr/bin/env node\nlet input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { const request = JSON.parse(input); console.log(JSON.stringify({ version: 1, requestId: request.requestId, ok: false, error: request.prompt })); });\n`, { mode: 0o700 })
  const { call } = await configuredTools(t, root, executable)
  for (const error of REFUSALS) await assert.rejects(call('coding_task_prompt', { target: 'mac', project: root, taskId: IDS[0], prompt: error }), { message: error })
  await assert.rejects(call('coding_task_prompt', { target: 'mac', project: root, taskId: IDS[0], prompt: 'private server traceback' }), { message: 'Managed task request rejected' })
})
test('continuation workflow preserves native delivery defaults and actual receipt meaning', async () => {
  const turn = createIntentTurn({ route: async () => ({ intent: 'session_continue' }), profile: 'personal', tools: ['coding_targets', 'coding_tasks_list', 'coding_task_status', 'coding_task_prompt', 'coding_task_start'] })
  const prepared = await turn.prepare('继续 Mac 上刚才的任务', new AbortController().signal)
  for (const expression of [/native.*normal Pi Enter behavior/i, /queued/, /ran/, /unknown/]) assert.match(prepared.context, expression)
  const tools = guardIntentTools([{ name: 'coding_task_start', execute: async () => assert.fail('replacement launch') }], turn.getIntent)
  await assert.rejects(tools[0].execute('fixture', {}), /unavailable/)
})
test('a lost prompt response retains the exact generated mutation identity without leaking its text', async t => {
  const root = await temporaryRoot(t)
  const executable = join(root, 'lost-response')
  const captured = join(root, 'request.json')
  await writeFile(executable, `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs'; let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { writeFileSync(${JSON.stringify(captured)}, input); process.exit(1); });\n`, { mode: 0o700 })
  const { call } = await configuredTools(t, root, executable)
  let failure
  try { await call('coding_task_prompt', { target: 'mac', project: root, taskId: IDS[0], prompt: 'PRIVATE_PROMPT_FIXTURE' }) } catch (error) { failure = error }
  const request = JSON.parse(await readFile(captured, 'utf8'))
  assert.match(request.mutationId, /^[0-9a-f-]{36}$/)
  assert.ok(failure.message.includes(`mutationId=${request.mutationId}`))
  assert.ok(!failure.message.includes('PRIVATE_PROMPT_FIXTURE'))
  assert.match(failure.message, /do not retry automatically/)
})
test('an incomplete native inventory retains unavailable endpoints and cannot prove a missing session', async t => {
  const root = await temporaryRoot(t)
  const executable = join(root, 'partial-inventory')
  await writeFile(executable, `#!/usr/bin/env node\nlet input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { const request = JSON.parse(input); console.log(JSON.stringify({version: 1, requestId: request.requestId, ok: true, tasks: [], incomplete: true, unavailable: 1, truncated: false})); });\n`, { mode: 0o700 })
  const { tools, call } = await configuredTools(t, root, executable)
  const response = await call('coding_tasks_list', { target: 'mac', project: root })
  assert.deepEqual(response.tasks, [])
  assert.equal(response.incomplete, true)
  assert.equal(response.unavailable, 1)
  assert.match(tools.find(tool => tool.name === 'coding_tasks_list').description, /incomplete.*missing session/i)
  for (const intent of ['session_continue', 'task_query']) {
    const turn = createIntentTurn({ route: async () => ({ intent }), profile: 'personal', tools: tools.map(tool => tool.name) })
    const prepared = await turn.prepare('Mac 上刚才的会话', new AbortController().signal)
    assert.match(prepared.context, /incomplete.*missing session/i)
  }
})
// Real published helper and SessionHost sockets; only the Pi message receiver is mocked.
test('coordinator discovers native sessions by root and continues the exact Chinese task identity', async t => {
  const packageRoot = process.env.ODESK_PI_PACKAGE_DIR ?? fileURLToPath(new URL('../../../../pi-packages/packages/open-deskos/', import.meta.url))
  try { await access(join(packageRoot, 'src/session-host.ts')) } catch (error) {
    if (process.env.ODESK_PI_PACKAGE_DIR || error.code !== 'ENOENT') throw error
    return t.skip('Set ODESK_PI_PACKAGE_DIR to exercise the native Pi package helper')
  }
  const { SessionHost } = await import(pathToFileURL(join(packageRoot, 'src/session-host.ts')).href)
  const root = await temporaryRoot(t)
  const runtime = join(root, 'run')
  const firstProject = join(root, 'one')
  const secondProject = join(root, 'two')
  await Promise.all([mkdir(firstProject), mkdir(secondProject)])
  const messages = [[], [], []]
  const hosts = []
  for (let index = 0; index < 3; index++) {
    const cwd = index === 1 ? secondProject : firstProject
    let pending = false
    const ctx = { cwd, isIdle: () => index !== 1, hasPendingMessages: () => pending, abort: async () => {}, sessionManager: { getSessionId: () => IDS[index], getSessionName: () => `native-${index}` } }
    const pi = { sendUserMessage: (text, options) => {
      messages[index].push({ text, options })
      pending = true
      if (index !== 1) host.observeMessage({ role: 'user', content: [{ type: 'text', text }] })
    } }
    const host = new SessionHost({ pi, env: { XDG_RUNTIME_DIR: runtime } })
    await host.start(ctx)
    hosts.push(host)
  }
  t.after(() => Promise.all(hosts.map(host => host.close())))
  const executable = join(root, 'helper')
  const helper = join(packageRoot, 'src/session-host-client.mjs')
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`
  const sessionDirectory = join(runtime, 'open-deskos', 'sessions')
  await writeFile(executable, `#!/bin/sh\nexport XDG_RUNTIME_DIR=${quote(runtime)}\nexport ODK_SESSION_HOST_SOCKET=${quote(sessionDirectory)}\nexec ${quote(process.execPath)} ${quote(helper)} --find\n`, { mode: 0o700 })
  const { tools: available } = await configuredTools(t, root, executable)
  const turn = createIntentTurn({ route: async () => ({ intent: 'session_continue' }), profile: 'personal', tools: available.map(tool => tool.name) })
  await turn.prepare('继续 Mac 上刚才的任务', new AbortController().signal)
  const tools = guardIntentTools(available, turn.getIntent, turn.getTurn)
  const call = async (name, params) => (await tools.find(tool => tool.name === name).execute('fixture', params)).structuredContent
  await assert.rejects(call('coding_task_start', { target: 'mac', project: root, prompt: '替代任务' }), /unavailable/)
  const listed = await call('coding_tasks_list', { target: 'mac', project: root })
  assert.deepEqual(listed.tasks.map(task => task.taskId).sort(), [...IDS].sort())
  assert.equal(listed.incomplete, false)
  assert.equal(listed.unavailable, 0)
  const prompt = '继续这个任务。\n先修复中文输入，然后运行剩余测试。'
  const idle = listed.tasks.find(task => task.taskId === IDS[2])
  const receipt = await call('coding_task_prompt', { target: 'mac', project: idle.project, taskId: idle.taskId, prompt })
  assert.equal(receipt.delivery, 'unknown')
  assert.equal(receipt.accepted, false)
  assert.equal(receipt.submitted, true)
  assert.equal(receipt.task.taskId, IDS[2])
  assert.equal(messages[2][0].text, prompt)
  assert.equal(messages[2][0].options.deliverAs, 'steer')
  assert.deepEqual(messages[0], [])
  const working = listed.tasks.find(task => task.taskId === IDS[1])
  const receipts = []
  for (const behavior of [undefined, 'steer', 'followUp']) {
    const params = { target: 'mac', project: working.project, taskId: working.taskId, prompt, ...(behavior ? { streamingBehavior: behavior } : {}) }
    const response = await call('coding_task_prompt', params)
    assert.equal(response.delivery, 'unknown')
    assert.equal(response.accepted, false)
    assert.equal(response.submitted, true)
    assert.equal(response.retry, 'never')
    assert.equal(response.task.lastDelivery.state, 'unknown')
    assert.match(response.mutationId, /^[0-9a-f-]{36}$/)
    assert.equal(response.task.deliveries.find(item => item.mutationId === response.mutationId).state, 'unknown')
    receipts.push(response)
  }
  assert.deepEqual(messages[1].map(message => message.text), [prompt, prompt, prompt])
  assert.deepEqual(messages[1].map(message => message.options.deliverAs), ['steer', 'steer', 'followUp'])
  hosts[1].observeMessage({ role: 'user', content: [{ type: 'text', text: prompt }] })
  const status = await call('coding_task_status', { target: 'mac', project: working.project, taskId: working.taskId })
  assert.equal(status.task.lastDelivery.state, 'unknown', 'observing one equal prompt must not certify all three submissions')
  assert.equal(status.task.deliveries.find(item => item.mutationId === receipts[0].mutationId).state, 'unknown')
  assert.equal(status.task.deliveries.find(item => item.mutationId === receipts[1].mutationId).state, 'unknown')
  assert.equal(status.task.deliveries.find(item => item.mutationId === receipts[2].mutationId).state, 'unknown')
  for (let index = 0; index < 2; index++) hosts[1].observeMessage({ role: 'user', content: [{ type: 'text', text: prompt }] })
  const reconciled = await call('coding_task_status', { target: 'mac', project: working.project, taskId: working.taskId })
  assert.equal(reconciled.task.lastDelivery.state, 'unknown')
  assert.ok(receipts.every(receipt => reconciled.task.deliveries.find(item => item.mutationId === receipt.mutationId).state === 'unknown'))
  assert.equal(reconciled.task.goal ?? reconciled.task.prompt, '继续这个任务。')
  assert.deepEqual(messages[1].map(message => message.text), [prompt, prompt, prompt], 'status reconciliation must not replay prompts')
  assert.match(tools.find(tool => tool.name === 'coding_task_prompt').description, /native.*normal Pi Enter behavior/i)
  const socketPath = join(root, 'drop.sock')
  const dropped = createServer(socket => socket.once('data', () => socket.end()))
  await new Promise((resolve, reject) => { dropped.once('error', reject); dropped.listen(socketPath, resolve) })
  t.after(() => new Promise(resolve => dropped.close(resolve)))
  await writeFile(join(runtime, 'open-deskos', 'sessions', 'dropped.json'), JSON.stringify({ version: 1, sessionId: '10000000-0000-4000-8000-000000000004', project: firstProject, socketPath }))
  const incomplete = await call('coding_tasks_list', { target: 'mac', project: root })
  assert.deepEqual(incomplete.tasks.map(task => task.taskId).sort(), [...IDS].sort())
  assert.equal(incomplete.incomplete, true, 'the actual package helper must expose the dropped endpoint')
  assert.equal(incomplete.unavailable, 1)
  assert.equal(incomplete.truncated, false)
})
