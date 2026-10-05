// Authorized device fixture: real installed agent/model/Jev, real service and
// authenticated socket protocol. Only recorder/transcription input is injected.
import { access, mkdtemp, readFile, readlink, rm, stat, writeFile } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createConnection } from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { acceptanceEndpoint, acceptanceTools, assertResidentIdentity, cleanupAcceptance, observePersonalTurn } from './real-acceptance-support.mjs'

if (process.env.ODESK_REAL_PERSONAL_ACCEPTANCE !== '1') throw Error('Explicit ODESK_REAL_PERSONAL_ACCEPTANCE=1 required')
let input = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) {
  input += chunk
  if (Buffer.byteLength(input) > 16_384) throw Error('Acceptance input too large')
}
const request = JSON.parse(input)
if (!request || typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 4096
  || typeof request.project !== 'string' || !/^\/private\/tmp\/odk-session-demo\/real-native-[a-zA-Z0-9]+$/.test(request.project)
  || typeof request.taskId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request.taskId)
  || request.taskId === '01a0f0ba-8e8b-750f-aaae-c29d6fd8e743') throw Error('Exact disposable native fixture required')

let integrationDir = process.env.ODESK_ACCEPTANCE_INTEGRATION_DIR
if (process.platform === 'linux') {
  if (!Number.isSafeInteger(request.residentPid) || request.residentPid < 1) throw Error('Current resident process ID required')
  assertResidentIdentity((await stat(`/proc/${request.residentPid}`)).uid, process.getuid())
  const liveEnv = (await readFile(`/proc/${request.residentPid}/environ`, 'utf8')).split('\0').filter(Boolean)
  for (const entry of liveEnv) {
    const separator = entry.indexOf('=')
    if (separator > 0) process.env[entry.slice(0, separator)] = entry.slice(separator + 1)
  }
  integrationDir = await readlink(`/proc/${request.residentPid}/cwd`)
}
if (!integrationDir || !isAbsolute(integrationDir)) throw Error('Installed integration directory required')
await access(join(integrationDir, 'src', 'agent.mjs'))
process.chdir(integrationDir)
const { createPersonalBot } = await import(pathToFileURL(join(integrationDir, 'src', 'agent.mjs')).href)
const { loadPersonalConfig } = await import(pathToFileURL(join(integrationDir, 'src', 'personal-config.mjs')).href)
const { PersonalBotService } = await import(pathToFileURL(join(integrationDir, 'src', 'service.mjs')).href)
const { listen, channelHandshake } = await import(pathToFileURL(join(integrationDir, 'src', 'socket.mjs')).href)
const { createAgentSession } = await import(pathToFileURL(join(integrationDir, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'index.js')).href)
const configured = await loadPersonalConfig(process.env)
const expectedProfile = process.env.ODESK_ACCEPTANCE_EXPECTED_PROFILE || 'personal'
if (!['coding', 'personal'].includes(expectedProfile) || configured.profile !== expectedProfile) throw Error('Expected resident Personal Agent profile required')
const dir = await mkdtemp(join(tmpdir(), 'odk-real-pa-'))
const startedAt = new Date().toISOString()
let agent, service, server, client
const trace = [], states = []
let session
let guardedTools
let finalReceipt, evidenceFile
let failureStage = 'factory'
async function saveReceipt(receipt) {
  const evidence = JSON.stringify(receipt, null, 2)
  if (Buffer.byteLength(evidence) > 131_072) throw Error('Acceptance evidence too large')
  const evidenceDir = await mkdtemp(join(tmpdir(), 'odk-personal-evidence-'))
  const evidenceFile = join(evidenceDir, 'receipt.json')
  await writeFile(evidenceFile, evidence, { mode: 0o600 })
  return evidenceFile
}
try {
  agent = await createPersonalBot({ workspace: process.env.ODESK_WORKSPACE, stateDir: dir,
    model: process.env.ODESK_PERSONAL_BOT_MODEL,
    personal: { ...configured, memoryFile: join(dir, 'memory.json') }, env: process.env }, {
    createSession: async options => {
      const tools = acceptanceTools(options.customTools || [], request, trace)
      options.customTools = tools.tools
      failureStage = 'sdk-session'
      const result = await createAgentSession(options)
      failureStage = 'factory'
      if (!session) { session = result.session; guardedTools = tools }
      return result
    },
  })
  failureStage = 'channel-listen'
  const token = randomBytes(32).toString('hex')
  service = new PersonalBotService({
    record: async () => ({ stop: async () => 'synthetic-transcript-input', cleanup: async () => {}, done: new Promise(() => {}) }),
    transcribe: async () => request.prompt,
    prompt: (text, onUpdate) => agent.prompt(text, onUpdate),
    failureMessage: 'Real Personal Agent acceptance failed; do not replay a mutation.',
  })
  const endpoint = acceptanceEndpoint(process.platform, dir, randomUUID())
  server = await listen(endpoint, service, { token })
  failureStage = 'channel-observe'
  client = createConnection(endpoint)
  const outcome = await observePersonalTurn(client, { handshake: channelHandshake(token), states })
  const routeEvidence = session.messages.filter(message => message.role === 'user').map(message => message.content)
  const receipt = { event: 'personal_agent_acceptance', startedAt, completedAt: new Date().toISOString(), installedIntegration: integrationDir, model: agent.generationModel,
    profile: configured.profile, injectedTranscript: true, microphone: false, states, transcript: outcome.transcript, finalState: outcome.state,
    response: outcome.message, offeredPrompt: guardedTools?.getOffer(), codingTrace: trace, routeEvidence, expectedTaskId: request.taskId, expectedProject: request.project }
  finalReceipt = receipt
  evidenceFile = await saveReceipt(receipt)
  process.stdout.write(JSON.stringify({ ...receipt, evidenceFile }) + '\n')
  if (outcome.state !== 'idle' || trace.filter(call => call.name === 'coding_task_prompt').length !== 1) process.exitCode = 1
} catch {
  const receipt = { event: 'personal_agent_acceptance_error', startedAt, completedAt: new Date().toISOString(),
    reason: 'Real agent fixture failed; inspect status before any retry', failureStage, offeredPrompt: guardedTools?.getOffer(), codingTrace: trace, states }
  finalReceipt = receipt
  evidenceFile = await saveReceipt(receipt)
  process.stdout.write(JSON.stringify({ ...receipt, evidenceFile }) + '\n')
  process.exitCode = 1
} finally {
  const cleanupFailures = await cleanupAcceptance([
    { name: 'client', run: () => client?.destroy() },
    { name: 'abort', run: () => agent?.abort() },
    { name: 'service', run: () => service?.close() },
    { name: 'server', run: () => server?.close() },
    { name: 'agent', run: () => agent?.close() },
    { name: 'state', run: () => rm(dir, { recursive: true, force: true }) },
  ])
  if (cleanupFailures.length) process.exitCode = 1
  if (finalReceipt && evidenceFile) {
    await writeFile(evidenceFile, JSON.stringify({ ...finalReceipt, cleanupFailures }, null, 2), { mode: 0o600 }).catch(() => { process.exitCode = 1 })
  }
  process.stdout.write(JSON.stringify({ event: 'acceptance_cleanup', cleanupFailures, evidenceFile }) + '\n')
}
