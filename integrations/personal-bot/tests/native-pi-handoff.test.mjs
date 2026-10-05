import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { createPersonalBot } from '../src/agent.mjs'
import { createJevIntentRouter } from '../src/intent-routing.mjs'
import { taskRequest } from '../src/task-client.mjs'
import { assistant, fixtureModel, offlineSession } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

// This uses the installed Pi SDK agent loop, public extension API and persisted
// messages. Model replies and intent judgments are scripted offline; this is not
// natural model routing, TUI, device SSH or microphone acceptance.
const repository = fileURLToPath(new URL('../../..', import.meta.url))
const packageDir = process.env.PI_OPEN_DESKOS_PACKAGE || join(dirname(repository), 'pi-packages/packages/open-deskos')

async function until(predicate, message) {
  const deadline = Date.now() + 10_000
  while (!await predicate()) {
    if (Date.now() > deadline) throw Error(message)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test('Personal Agent idle, followUp and normal Enter instructions execute in the original native Pi session', { timeout: 60_000, skip: process.platform === 'win32' ? 'Native Pi private endpoint requires a Unix target' : false }, async t => {
  await access(join(packageDir, 'index.ts'))
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'odk-native-handoff-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  // macOS limits Unix socket names to 104 bytes. Keep this owned runtime
  // directory independent of TMPDIR, which can already exceed that limit.
  const socketDir = await mkdtemp('/tmp/odk-npi-')
  t.after(() => rm(socketDir, { recursive: true, force: true }))
  assert.ok(Buffer.byteLength(join(socketDir, `${'0'.repeat(36)}.sock`)) < 100)
  const agentDir = await isolateAgentDirectory(t, dir)
  const project = join(dir, 'project')
  await mkdir(project)
  const desks = join(dir, 'desks.json')
  await writeFile(desks, JSON.stringify({ desks: [] }))
  const envChanges = {
    ODK_SESSION_HOST_SOCKET: socketDir,
    ODK_DESK_LINK_DESKS_FILE: desks,
    PI_DIRECTORY_SESSIONS_DIR: join(dir, 'registry'),
    ODESK_TASK_TARGETS_FILE: join(dir, 'targets.json'),
    ODK_NODE: process.execPath,
    ODK_DESK_LINK_ADDRESS: '',
    ODK_DESK_LINK_TOKEN: '',
    ODK_DESK_LINK_CONTROL_TOKEN: '',
  }
  const saved = Object.fromEntries(Object.keys(envChanges).map(key => [key, process.env[key]]))
  for (const [key, value] of Object.entries(envChanges)) process.env[key] = value
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
  const target = { id: 'mac', name: 'Isolated native Pi', executable: join(packageDir, 'session-control'), roots: [project] }
  await writeFile(envChanges.ODESK_TASK_TARGETS_FILE, JSON.stringify({ targets: [target] }))
  const { default: extension } = await import(pathToFileURL(join(packageDir, 'index.ts')).href)
  const loader = new DefaultResourceLoader({ cwd: project, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true,
    settingsManager: SettingsManager.inMemory({ packages: [] }), extensionFactories: [extension],
    agentsFilesOverride: () => ({ agentsFiles: [] }), systemPromptOverride: () => 'Offline isolated handoff fixture.' })
  await loader.reload()
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const streaming = new Promise(resolve => { entered = resolve })
  let releaseSteer, enteredSteer
  const steerGate = new Promise(resolve => { releaseSteer = resolve })
  const steering = new Promise(resolve => { enteredSteer = resolve })
  const idlePrompt = '继续原来的任务，把 idle-marker.txt 写成 idle-delivered。'
  const queuedPrompt = '继续原来的任务，把 queued-marker.txt 写成 queued-delivered，作为下一轮执行。'
  const steerPrompt = '继续原来的任务，把 steer-marker.txt 写成 steer-delivered。'
  const worker = await offlineSession({ cwd: project, agentDir, resourceLoader: loader,
    tools: ['write'], sessionManager: SessionManager.create(project, join(dir, 'native-sessions')) }, async context => {
    const user = context.messages.filter(message => message.role === 'user').at(-1)
    const text = typeof user?.content === 'string' ? user.content : user?.content?.map(part => part.text || '').join('')
    const last = context.messages.at(-1)
    if (text === '保持当前轮次运行。') { entered(); await gate; return assistant('当前轮次结束。') }
    if (text === '再次保持当前轮次运行。') { enteredSteer(); await steerGate; return assistant('第二个当前轮次结束。') }
    if (last?.role === 'toolResult') return assistant('原会话已写入验收标记。')
    const path = text === idlePrompt ? 'idle-marker.txt' : text === queuedPrompt ? 'queued-marker.txt' : text === steerPrompt ? 'steer-marker.txt' : undefined
    return path ? assistant([{ type: 'toolCall', id: path, name: 'write', arguments: { path, content: path.replace('-marker.txt', '-delivered') } }], 'toolUse') : assistant('原会话等待后续指令。')
  })
  t.after(async () => { release(); releaseSteer(); await worker.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); worker.session.dispose() })
  worker.session.setActiveToolsByName(['write'])
  await worker.session.prompt('开始原来的验收任务。')
  const sessionId = worker.session.sessionManager.getSessionId()
  const sessionFile = worker.session.sessionManager.getSessionFile()
  assert.ok(sessionFile)
  await access(join(envChanges.ODK_SESSION_HOST_SOCKET, `${sessionId}.json`))

  let coordinator, activePrompt, behavior
  const bot = await createPersonalBot({ stateDir: join(dir, 'bot'), personal: { profile: 'personal', skillPaths: [], memoryFile: join(dir, 'memory.json') } }, {
    createIntentRouter: () => createJevIntentRouter({ env: { TYPESAFE_API_KEY: 'fixture-only' }, fetchImpl: async (_url, options) => {
      const { questions } = JSON.parse(options.body)
      return Response.json({ model: 'jev-fixture', answers: { intent: { type: 'choice', choice: 'session_continue', confidence: 1,
        probabilities: Object.fromEntries(Object.keys(questions.intent.criteria).map(key => [key, key === 'session_continue' ? 1 : 0])) } } })
    } }),
    createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }),
    createSession: async options => {
      coordinator = await offlineSession(options, context => {
        if (context.messages.at(-1)?.role === 'toolResult') return assistant('原会话收到续接请求；执行结果需要另行核实。')
        const code = `const targets=await tools.coding_targets({}); const list=await tools.coding_tasks_list({target:"mac",project:${JSON.stringify(project)}}); const task=list.tasks.find(t=>t.taskId===${JSON.stringify(sessionId)}); if(!task) throw Error("Original session missing"); text(await tools.coding_task_prompt({target:"mac",project:task.project,taskId:task.taskId,prompt:${JSON.stringify(activePrompt)}${behavior ? ',streamingBehavior:"followUp"' : ''}}));`
        return assistant([{ type: 'toolCall', id: `handoff-${behavior || 'idle'}`, name: 'codemode', arguments: { code } }], 'toolUse')
      })
      return { session: coordinator.session }
    },
  })
  t.after(() => bot.close())
  activePrompt = idlePrompt
  await bot.prompt('在 Mac 的原 Pi 会话中继续原来的任务。')
  const idleResult = coordinator.session.messages.find(message => message.role === 'toolResult' && message.toolName === 'codemode')
  assert.ok(idleResult, 'Coordinator must run its actual codemode pipeline')
  assert.equal(idleResult.isError, false, JSON.stringify(idleResult.content))
  await until(async () => { try { return await readFile(join(project, 'idle-marker.txt'), 'utf8') === 'idle-delivered' } catch { return false } }, 'Idle prompt did not execute')
  await until(() => !worker.session.isStreaming, 'Idle turn did not settle')
  const pending = worker.session.prompt('保持当前轮次运行。')
  await streaming
  activePrompt = queuedPrompt; behavior = 'followUp'
  await bot.prompt('继续同一个 Mac 会话，下一轮写入验收标记。')
  const results = coordinator.session.messages.filter(message => message.role === 'toolResult' && message.toolName === 'codemode')
  assert.equal(results.length, 2)
  for (const result of results) assert.equal(result.isError, false, JSON.stringify(result.content))
  const receipts = results.map(result => JSON.parse(result.content.find(part => part.type === 'text' && part.text.startsWith('{')).text))
  for (const receipt of receipts) {
    assert.equal(receipt.delivery, 'unknown')
    assert.equal(receipt.accepted, false)
    assert.equal(receipt.retry, 'never')
    assert.equal(receipt.submitted, true)
    assert.equal(receipt.reconciliation, 'session_execution_only')
  }
  await assert.rejects(access(join(project, 'queued-marker.txt')), { code: 'ENOENT' })
  release(); await pending
  await until(async () => { try { return await readFile(join(project, 'queued-marker.txt'), 'utf8') === 'queued-delivered' } catch { return false } }, 'Queued prompt did not execute')
  await until(() => !worker.session.isStreaming, 'Queued turn did not settle')
  const pendingSteer = worker.session.prompt('再次保持当前轮次运行。')
  await steering
  activePrompt = steerPrompt; behavior = undefined
  await bot.prompt('继续同一个 Mac 会话，直接输入新的验收指令。')
  const steerResult = coordinator.session.messages.filter(message => message.role === 'toolResult' && message.toolName === 'codemode').at(-1)
  assert.equal(steerResult.isError, false, JSON.stringify(steerResult.content))
  const steerReceipt = JSON.parse(steerResult.content.find(part => part.type === 'text' && part.text.startsWith('{')).text)
  assert.equal(steerReceipt.delivery, 'unknown')
  assert.equal(steerReceipt.accepted, false)
  assert.equal(steerReceipt.retry, 'never')
  assert.equal(steerReceipt.submitted, true)
  assert.equal(steerReceipt.reconciliation, 'session_execution_only')
  releaseSteer(); await pendingSteer
  await until(async () => { try { return await readFile(join(project, 'steer-marker.txt'), 'utf8') === 'steer-delivered' } catch { return false } }, 'Normal Enter instruction did not execute')
  await until(() => !worker.session.isStreaming, 'Normal Enter turn did not settle')
  assert.equal(worker.session.sessionManager.getSessionId(), sessionId)
  assert.equal(worker.session.sessionManager.getSessionFile(), sessionFile)
  const status = await taskRequest(target, { command: 'status', project, taskId: sessionId })
  const mutationIds = [...receipts, steerReceipt].map(receipt => receipt.mutationId)
  assert.equal(new Set(mutationIds).size, 3)
  for (const mutationId of mutationIds) {
    assert.match(mutationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    assert.ok(status.task.deliveries.some(delivery => delivery.mutationId === mutationId && delivery.state === 'unknown' && delivery.submitted === true))
  }
  assert.ok(status.task.deliveries.every(delivery => delivery.state === 'unknown'), 'Session observation cannot certify exact mutation admission')
  assert.equal(status.task.lastDelivery.mutationId, steerReceipt.mutationId)
  assert.equal(status.task.lastDelivery.state, 'unknown')
  assert.equal(status.task.lastDelivery.submitted, true)
  assert.equal(status.task.prompt, steerPrompt)
  assert.equal(status.task.response, '原会话已写入验收标记。')
  assert.equal(status.task.activity, 'idle')
  const persisted = (await readFile(sessionFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  for (const prompt of [idlePrompt, queuedPrompt, steerPrompt]) assert.ok(persisted.some(entry => entry.type === 'message' && entry.message.role === 'user' && JSON.stringify(entry.message.content).includes(prompt)))
  const calls = [...results, steerResult].flatMap(result => result.nestedCalls.calls.map(call => call.name))
  assert.deepEqual(calls, Array.from({ length: 3 }, () => ['coding_targets', 'coding_tasks_list', 'coding_task_prompt']).flat())
  t.diagnostic(JSON.stringify({ evidence: 'native-sdk-handoff', model: 'offline-scripted', realProvider: false, device: false, originalSessionId: sessionId, identityPreserved: true, persistedPrompts: 3, markerWrites: 3, deliveryReceipts: 'unknown', mutationIds, sessionObservation: 'prompt-response-idle', replacementStarts: 0, socketPathBytes: Buffer.byteLength(join(socketDir, `${sessionId}.sock`)) }))
})
