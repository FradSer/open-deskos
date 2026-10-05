import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DefaultResourceLoader, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { assistant, offlineSession } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'
import { observeAcceptanceFrame } from './helpers/acceptance-frame.mjs'

// Explicit opt-in only. Installed Windows tools and OpenSSH carry requests to a
// new isolated native Mac Pi. No provider, microphone, service or config writes.
const enabled = process.env.ODESK_NATIVE_WINDOWS_ACCEPTANCE === '1'
const repository = fileURLToPath(new URL('../../..', import.meta.url))
const packageDir = join(dirname(repository), 'pi-packages/packages/open-deskos')
const root = '/private/tmp/odk-session-demo'
const runtimeDir = '/Users/FradSer/.local/run/open-deskos/sessions'
const existingDemoId = '01a0f0ba-8e8b-750f-aaae-c29d6fd8e743'
const helper = join(packageDir, 'session-control')
const windowsSource = 'open-deskos/personal-bot-releases/20261003-v6/integrations/personal-bot/src'
const sshArgs = ['-i', '/Users/FradSer/.ssh/id_ed25519', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=8', '-o', 'LogLevel=ERROR', 'frads@100.82.50.70', 'node', '-']

async function windowsRequest(request) {
  const acceptanceId = randomUUID()
  const script = `const {join}=require('node:path'); const {pathToFileURL}=require('node:url');
(async()=>{const base=join(process.env.LOCALAPPDATA,${JSON.stringify(windowsSource)});
process.env.ODESK_TASK_TARGETS_FILE=join(process.env.LOCALAPPDATA,'open-deskos','pi-tasks.json');
const {loadTargets}=await import(pathToFileURL(join(base,'task-client.mjs')).href);
const targets=await loadTargets(); const target=targets.find(t=>t.id==='mac');
if(!target||target.host!=='FradSer@100.89.103.122'||target.executable!==${JSON.stringify(helper)}||!target.roots.includes(${JSON.stringify(root)}))throw Error('Unexpected installed Mac target');
const {loadCapabilities}=await import(pathToFileURL(join(base,'capabilities.mjs')).href);
const tools=await loadCapabilities(); const req=${JSON.stringify({ ...request, acceptanceId })};
const reply=result=>console.log(JSON.stringify({version:1,acceptanceId:req.acceptanceId,command:req.command,result}));
const invoke=async(name,args)=>{const tool=tools.find(t=>t.name===name);if(!tool)throw Error('Installed coding tool missing');return (await tool.execute('isolated-windows-acceptance',args)).structuredContent};
const listedTargets=await invoke('coding_targets',{});
if(req.command==='preflight'){reply({ok:true,platform:process.platform,targetConfigured:listedTargets.targets.some(t=>t.id==='mac'),source:${JSON.stringify(windowsSource)}});return;}
if(!req.project.startsWith(${JSON.stringify(root + '/windows-native-')})||req.taskId===${JSON.stringify(existingDemoId)})throw Error('Fixture identity required');
const tasks=await invoke('coding_tasks_list',{target:'mac',project:req.project});
if(tasks.tasks.length!==1||tasks.tasks[0].taskId!==req.taskId||tasks.tasks[0].project!==req.project)throw Error('Exact fixture session not uniquely listed');
const result=await invoke(req.command==='prompt'?'coding_task_prompt':'coding_task_status',{target:'mac',project:req.project,taskId:req.taskId,...(req.command==='prompt'?{prompt:req.prompt,...(req.streamingBehavior?{streamingBehavior:req.streamingBehavior}:{})}:{})});
reply(result);})().catch(()=>{console.error('Isolated Windows acceptance request failed');process.exitCode=1});`
  const child = spawn('ssh', sshArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stdin.on('error', () => {})
  child.stderr.resume()
  const response = observeAcceptanceFrame(child, { acceptanceId, validate: frame => {
    assert.equal(frame.version, 1)
    assert.equal(frame.command, request.command)
    if (request.command === 'preflight') {
      assert.deepEqual(frame.result, { ok: true, platform: 'win32', targetConfigured: true, source: windowsSource })
      return
    }
    assert.equal(frame.result.version, 1)
    assert.equal(frame.result.ok, true)
    assert.match(frame.result.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    assert.equal(frame.result.task.taskId, request.taskId)
    assert.equal(frame.result.task.project, request.project)
  } })
  child.stdin.end(script)
  return await response
}

async function until(predicate, message) {
  const deadline = Date.now() + 10_000
  while (!await predicate()) {
    if (Date.now() > deadline) throw Error(message)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test('OPTIONAL installed Windows coding tools continue an isolated original Mac Pi', {
  timeout: 180_000,
  skip: !enabled ? 'Set ODESK_NATIVE_WINDOWS_ACCEPTANCE=1 for authorized disposable Windows SSH acceptance' : process.platform !== 'darwin' ? 'This acceptance requires the configured Mac target host' : false,
}, async t => {
  // All deployment/configuration and ownership checks precede fixture writes.
  await access(join(packageDir, 'index.ts')); await access(helper)
  const rootInfo = await stat(root), runtimeInfo = await stat(runtimeDir)
  assert.ok(rootInfo.isDirectory() && runtimeInfo.isDirectory())
  assert.equal(rootInfo.uid, process.getuid())
  assert.equal(runtimeInfo.uid, process.getuid())
  assert.equal(runtimeInfo.mode & 0o777, 0o700)
  assert.ok(Buffer.byteLength(join(runtimeDir, `${'0'.repeat(36)}.sock`)) < 104)
  const preflight = await windowsRequest({ command: 'preflight' })
  assert.deepEqual(preflight, { ok: true, platform: 'win32', targetConfigured: true, source: windowsSource })

  const project = await mkdtemp(join(root, 'windows-native-'))
  let worker
  const releases = []
  const savedEnv = new Map()
  t.after(async () => {
    for (const release of releases) release()
    if (worker) {
      await worker.session.abort()
      await worker.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' })
      worker.session.dispose()
    }
    for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    await rm(project, { recursive: true, force: true })
  })
  const agentDir = await isolateAgentDirectory(t, project)
  const desks = join(project, 'desks.json')
  await writeFile(desks, JSON.stringify({ desks: [] }))
  const changes = { ODK_SESSION_HOST_SOCKET: runtimeDir, ODK_DESK_LINK_DESKS_FILE: desks, PI_DIRECTORY_SESSIONS_DIR: join(project, 'registry'),
    ODK_DESK_LINK_ADDRESS: '', ODK_DESK_LINK_TOKEN: '', ODK_DESK_LINK_CONTROL_TOKEN: '' }
  for (const [key, value] of Object.entries(changes)) { savedEnv.set(key, process.env[key]); process.env[key] = value }
  const { default: extension } = await import(pathToFileURL(join(packageDir, 'index.ts')).href)
  const loader = new DefaultResourceLoader({ cwd: project, agentDir, noExtensions: true, noSkills: true, noPromptTemplates: true,
    settingsManager: SettingsManager.inMemory({ packages: [] }), extensionFactories: [extension], agentsFilesOverride: () => ({ agentsFiles: [] }),
    systemPromptOverride: () => 'Offline disposable Windows transport acceptance.' })
  await loader.reload()
  let activeGate, activeEntered
  const prompts = {
    idle: '继续原来的任务，把 idle-marker.txt 写成 idle-delivered。',
    followUp: '继续原来的任务，把 followUp-marker.txt 写成 followUp-delivered，下一轮执行。',
    steer: '继续原来的任务，把 steer-marker.txt 写成 steer-delivered。',
  }
  worker = await offlineSession({ cwd: project, agentDir, resourceLoader: loader, tools: ['write'],
    sessionManager: SessionManager.create(project, join(project, 'sessions')) }, async context => {
    const user = context.messages.filter(message => message.role === 'user').at(-1)
    const text = typeof user?.content === 'string' ? user.content : user?.content?.map(part => part.text || '').join('')
    if (text?.startsWith('hold:')) { activeEntered(); await activeGate; return assistant('Held turn finished.') }
    if (context.messages.at(-1)?.role === 'toolResult') return assistant('Fixture marker written in the original session.')
    const mode = Object.keys(prompts).find(mode => prompts[mode] === text)
    return mode ? assistant([{ type: 'toolCall', id: `write-${mode}`, name: 'write', arguments: { path: `${mode}-marker.txt`, content: `${mode}-delivered` } }], 'toolUse') : assistant('Original session ready.')
  })
  worker.session.setActiveToolsByName(['write'])
  await worker.session.prompt('Initialize only this disposable task.')
  const sessionId = worker.session.sessionManager.getSessionId(), sessionFile = worker.session.sessionManager.getSessionFile()
  assert.notEqual(sessionId, existingDemoId)
  await access(join(runtimeDir, `${sessionId}.json`))
  const receipts = []
  for (const mode of ['idle', 'followUp', 'steer']) {
    let pending, release
    if (mode !== 'idle') {
      activeGate = new Promise(resolve => { release = resolve; releases.push(resolve) })
      const entered = new Promise(resolve => { activeEntered = resolve })
      pending = worker.session.prompt(`hold:${mode}`)
      // Cleanup may abort this turn after a transport failure. Attach a rejection
      // observer immediately; the later await still preserves its failure.
      pending.catch(() => {})
      await entered
    }
    const receipt = await windowsRequest({ command: 'prompt', project, taskId: sessionId, prompt: prompts[mode], ...(mode === 'followUp' ? { streamingBehavior: 'followUp' } : {}) })
    receipts.push(receipt)
    assert.equal(receipt.task.taskId, sessionId); assert.equal(receipt.task.project, project)
    assert.equal(receipt.submitted, true); assert.equal(receipt.accepted, false); assert.equal(receipt.delivery, 'unknown')
    assert.equal(receipt.retry, 'never'); assert.equal(receipt.reconciliation, 'session_execution_only')
    if (mode !== 'idle') { await assert.rejects(access(join(project, `${mode}-marker.txt`)), { code: 'ENOENT' }); release(); await pending }
    await until(async () => { try { return await readFile(join(project, `${mode}-marker.txt`), 'utf8') === `${mode}-delivered` } catch { return false } }, `${mode} marker missing; do not resend`)
    await until(() => !worker.session.isStreaming, `${mode} turn did not settle`)
  }
  assert.equal(worker.session.sessionManager.getSessionId(), sessionId); assert.equal(worker.session.sessionManager.getSessionFile(), sessionFile)
  const messages = (await readFile(sessionFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(entry => entry.type === 'message')
  for (const prompt of Object.values(prompts)) assert.equal(messages.filter(entry => entry.message.role === 'user' && JSON.stringify(entry.message.content).includes(prompt)).length, 1)
  const status = await windowsRequest({ command: 'status', project, taskId: sessionId })
  const mutationIds = receipts.map(receipt => receipt.mutationId)
  assert.equal(new Set(mutationIds).size, 3)
  for (const mutationId of mutationIds) {
    assert.match(mutationId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    assert.ok(status.task.deliveries.some(delivery => delivery.mutationId === mutationId && delivery.submitted && delivery.state === 'unknown'))
  }
  assert.equal(status.task.prompt, prompts.steer); assert.equal(status.task.activity, 'idle')
  assert.equal(status.task.response, 'Fixture marker written in the original session.')
  t.diagnostic(JSON.stringify({ evidence: 'windows-openssh-original-native-pi', installedWindowsSource: windowsSource, model: 'offline-scripted', realProvider: false,
    microphone: false, originalSessionId: sessionId, identityPreserved: true, exactPersistedPrompts: 3, markerWrites: 3, receipts: 'submitted-unknown', mutationIds, replacementStarts: 0 }))
})
