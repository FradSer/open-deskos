// Explicit operator acceptance process. This uses the real provider and a new
// native Pi SDK session; it never creates a Hosted Pi or prompts an older session.
import { access, lstat, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { cleanupAcceptance } from './real-acceptance-support.mjs'
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, getAgentDir } from '@earendil-works/pi-coding-agent'

if (process.env.ODESK_REAL_NATIVE_ACCEPTANCE !== '1') throw Error('Explicit ODESK_REAL_NATIVE_ACCEPTANCE=1 required')
const modelSpec = process.env.ODESK_REAL_NATIVE_MODEL
if (typeof modelSpec !== 'string' || !modelSpec.includes('/')) throw Error('Explicit available provider/model required')
const repository = fileURLToPath(new URL('../../../..', import.meta.url))
const packageDir = join(dirname(repository), 'pi-packages/packages/open-deskos')
const root = '/private/tmp/odk-session-demo'
const runtimeDir = '/Users/FradSer/.local/run/open-deskos/sessions'
const emit = value => process.stdout.write(JSON.stringify(value) + '\n')
const operatorAgentDir = getAgentDir()
let project, session, originalId, originalFile, closing = false
const startedAt = new Date().toISOString()
const savedEnv = new Map()

async function close() {
  if (closing) return
  closing = true
  const cleanupFailures = await cleanupAcceptance([
    { name: 'abort', run: () => session?.abort() },
    { name: 'endpoint', run: () => session?.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }) },
    { name: 'dispose', run: () => session?.dispose() },
    { name: 'environment', run: () => {
      for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    } },
    { name: 'project', run: () => project && rm(project, { recursive: true, force: true }) },
  ])
  if (cleanupFailures.length) process.exitCode = 1
  emit({ event: 'native_cleanup', cleanupFailures })
}

function snapshot() {
  const messages = session.messages
  const text = message => typeof message.content === 'string' ? message.content : message.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') || ''
  return { sessionId: session.sessionManager.getSessionId(), sessionFile: session.sessionManager.getSessionFile(), project,
    name: session.sessionName, model: modelSpec, activity: session.isStreaming ? 'working' : 'idle',
    identityPreserved: originalId === session.sessionManager.getSessionId() && originalFile === session.sessionManager.getSessionFile(),
    userPrompts: messages.filter(message => message.role === 'user').map(text),
    latestResponse: text(messages.findLast(message => message.role === 'assistant') || { content: [] }),
    tools: messages.filter(message => message.role === 'toolResult').map(message => ({ name: message.toolName, isError: !!message.isError })) }
}

async function verify(expected) {
  if (!Array.isArray(expected) || !expected.length || expected.length > 8) throw Error('Bounded marker expectations required')
  const current = snapshot()
  const checks = [], receivedMessages = []
  const persisted = (await readFile(originalFile, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line))
  for (const item of expected) {
    if (!item || typeof item.prompt !== 'string' || typeof item.marker !== 'string' || typeof item.content !== 'string') throw Error('Invalid marker expectation')
    const path = resolve(project, item.marker), scoped = relative(project, path)
    if (!scoped || scoped.startsWith('..') || isAbsolute(scoped)) throw Error('Marker must remain in fixture project')
    const actualPath = await realpath(path), actualScoped = relative(project, actualPath)
    if (!actualScoped || actualScoped.startsWith('..') || isAbsolute(actualScoped)) throw Error('Marker must resolve inside fixture project')
    const info = await lstat(path)
    if (!info.isFile() || info.size > 16_384) throw Error('Marker is missing or too large')
    const observedContent = await readFile(path, 'utf8')
    const markerMatches = observedContent === item.content
    const matching = persisted.filter(entry => entry.type === 'message' && entry.message?.role === 'user').filter(entry => {
      const content = entry.message.content
      return (typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n')) === item.prompt
    })
    receivedMessages.push(...matching.map(entry => ({ role: 'user', content: entry.message.content, timestamp: entry.message.timestamp })))
    checks.push({ marker: item.marker, expectedContent: item.content, observedContent, markerMatches, exactPersistedPromptCount: matching.length })
  }
  const writeResults = persisted.filter(entry => entry.type === 'message' && entry.message?.role === 'toolResult' && entry.message.toolName === 'write').map(entry => ({
    toolName: 'write', toolCallId: entry.message.toolCallId, isError: !!entry.message.isError, timestamp: entry.message.timestamp,
    result: entry.message.content?.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0, 4096) }))
  const result = { ...current, startedAt, verifiedAt: new Date().toISOString(), receivedMessages, writeResults, checks,
    mutationAdmission: 'unknown; session execution evidence is separate',
    passed: current.identityPreserved && current.activity === 'idle' && checks.every(check => check.markerMatches && check.exactPersistedPromptCount === 1) }
  const evidenceDir = await mkdtemp('/tmp/odk-native-evidence-')
  const evidenceFile = join(evidenceDir, 'receipt.json')
  const bytes = JSON.stringify(result, null, 2)
  if (Buffer.byteLength(bytes) > 131_072) throw Error('Fixture evidence too large')
  await writeFile(evidenceFile, bytes, { mode: 0o600 })
  return { ...result, evidenceFile }
}

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  close().then(() => process.exit(process.exitCode || 0), () => {
    emit({ event: 'native_cleanup_error', reason: 'Cleanup failed' }); process.exit(1)
  })
})

try {
  await access(join(packageDir, 'index.ts'))
  for (const path of [root, runtimeDir]) {
    const info = await stat(path)
    if (!info.isDirectory() || info.uid !== process.getuid()) throw Error('Unexpected fixture directory owner')
    if (path === runtimeDir && (info.mode & 0o777) !== 0o700) throw Error('Endpoint directory must already be private')
  }
  const modelRuntime = await ModelRuntime.create({ authPath: join(operatorAgentDir, 'auth.json'), modelsPath: join(operatorAgentDir, 'models.json'), allowModelNetwork: false })
  const split = modelSpec.indexOf('/'), provider = modelSpec.slice(0, split), id = modelSpec.slice(split + 1)
  const model = (await modelRuntime.getAvailable(provider)).find(candidate => candidate.id === id)
  if (!model) throw Error('Requested model unavailable')
  project = await mkdtemp(join(root, 'real-native-'))
  const agentDir = join(project, 'agent')
  const desks = join(project, 'desks.json')
  await writeFile(desks, JSON.stringify({ desks: [] }), { mode: 0o600 })
  for (const [key, value] of Object.entries({ ODK_SESSION_HOST_SOCKET: runtimeDir, ODK_DESK_LINK_DESKS_FILE: desks,
    PI_DIRECTORY_SESSIONS_DIR: join(project, 'registry'), ODK_DESK_LINK_ADDRESS: '', ODK_DESK_LINK_TOKEN: '', ODK_DESK_LINK_CONTROL_TOKEN: '' })) {
    savedEnv.set(key, process.env[key]); process.env[key] = value
  }
  const { default: extension } = await import(pathToFileURL(join(packageDir, 'index.ts')).href)
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off', defaultTools: ['read', 'write'] })
  const loader = new DefaultResourceLoader({ cwd: project, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true,
    extensionFactories: [extension], agentsFilesOverride: () => ({ agentsFiles: [] }),
    systemPromptOverride: () => `You are the original native Pi session for a bounded remote-continuation acceptance. Use actual read and write tools. Operate only inside ${project}. Do not read credentials or other projects. When asked to write a marker, write the requested exact content without a newline. Never create another session. Reply briefly in Chinese after the write tool finishes.` })
  await loader.reload()
  const result = await createAgentSession({ cwd: project, agentDir, modelRuntime, model, resourceLoader: loader, settingsManager,
    tools: ['read', 'write'], sessionManager: SessionManager.create(project, join(project, 'sessions')) })
  session = result.session
  await session.bindExtensions({})
  session.setActiveToolsByName(['read', 'write'])
  originalId = session.sessionManager.getSessionId(); originalFile = session.sessionManager.getSessionFile()
  session.setSessionName(`Native continuation acceptance ${originalId.slice(-8)}`)
  const initializePrompt = '这是远端继续任务验收。请回复“原会话已就绪”，不要写文件。'
  await session.prompt(initializePrompt, { expandPromptTemplates: false })
  await access(join(runtimeDir, `${originalId}.json`))
  emit({ event: 'ready', ...snapshot(), initializationPrompt: initializePrompt })
  const input = createInterface({ input: process.stdin, terminal: false })
  for await (const line of input) {
    let request
    try {
      if (Buffer.byteLength(line) > 65_536) throw Error('Oversized observer request')
      request = JSON.parse(line)
      if (request.command === 'status') emit({ event: 'status', ...snapshot() })
      else if (request.command === 'verify') emit({ event: 'verification', ...await verify(request.expected) })
      else if (request.command === 'close') { input.close(); break }
      else throw Error('Only read-only status/verify or close is supported')
    } catch { emit({ event: 'observer_error', reason: 'Read-only fixture observation failed' }) }
  }
} catch {
  emit({ event: 'fixture_error', reason: 'Native real-provider fixture failed; inspect authorized model and private paths' })
  process.exitCode = 1
} finally { await close() }
