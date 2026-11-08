// Live generation through the real Agent path:
//   createPersonalAgent (real ModelRuntime + real ephemeral Durable session)
//     -> bot.generateProposals (one scoped read tool, model decides suggestions)
//     -> ProactiveWatch (host structural validation, no classifier)
//     -> published proposals, rendered into the conversation.
// No bare `pi -ne -p` generator. No scripted model responses.
// Usage: node scripts/test-agent-path-live.mjs [--rounds 2] [--cases]
import { createServer } from 'node:net'
import { mkdtemp, rm, mkdir, realpath } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalAgent } from '../src/agent.mjs'
import { createDurableAgentSession } from '../src/durable-agent-session.mjs'
import { ProactiveWatch } from '../src/recommendations/index.mjs'

const roundIndex = process.argv.indexOf('--rounds')
const rounds = Number(roundIndex > -1 ? process.argv[roundIndex + 1] : 2)
const total = Number.isInteger(rounds) && rounds >= 1 && rounds <= 4 ? rounds : 2
const casesMode = process.argv.includes('--cases')
const stamp = new Date().toISOString()
const actionFor = label => ({ id: 'open', label, tool: 'memory_update', params: { category: 'note', value: 'opened' } })

const rules = [
  { id: 'commute-anomaly', goal: 'Tell me when the commute departs from its normal duration.', delivery: 'immediate', urgent: false,
    observations: [{ readingId: 'commute.traffic', fields: ['minutes', 'baselineMinutes', 'delayMinutes', 'rainAt', 'rainChance'] }], actions: [actionFor('查看通勤安排')] },
  { id: 'commitment-guard', goal: 'Warn me before a calendar commitment becomes unreachable.', delivery: 'immediate', urgent: true,
    observations: [{ readingId: 'calendar.next', fields: ['startsAt', 'title', 'bufferMinutes', 'travelMinutes', 'shortfallMinutes'] }], actions: [actionFor('查看日程')] },
  { id: 'commute-tradeoff', goal: 'Show the time and price trade-off before I choose a ride.', delivery: 'immediate', urgent: false,
    observations: [{ readingId: 'commute.options', fields: ['nowPrice', 'nowDelay', 'laterPrice', 'laterDelay', 'waitMinutes', 'priceDelta', 'delayDelta'] }], actions: [actionFor('比较两个方案')] },
  { id: 'release-pipeline', goal: 'Tell me when the main branch is verified and ready to deploy.', delivery: 'silent', urgent: false,
    observations: [{ readingId: 'ci.main', fields: ['commit', 'passed', 'failed', 'target', 'deployPending', 'deployedRevision'] }], actions: [actionFor('查看发布状态')] }
]
const readings = {
  'commute.traffic': { minutes: 52, baselineMinutes: 24, delayMinutes: 28, rainAt: '18:15', rainChance: 80, measured_at: stamp },
  'calendar.next': { startsAt: '14:00', title: '产品评审', bufferMinutes: 12, travelMinutes: 34, shortfallMinutes: 22, measured_at: stamp },
  'commute.options': { nowPrice: 32, nowDelay: 28, laterPrice: 58, laterDelay: 9, waitMinutes: 40, priceDelta: 26, delayDelta: 19, measured_at: stamp },
  'ci.main': { commit: '1998604', passed: 116, failed: 0, target: 'cm5', deployPending: true, deployedRevision: '1998603', measured_at: stamp }
}

// A real Open DeskOS Data Link endpoint so proactive_read can actually fetch a
// reading. This is the same authenticated channel the resident uses.
const socketDir = await mkdtemp(join(tmpdir(), 'odk-agent-path-'))
const socketPath = join(socketDir, 'odk-data.sock')
const dataReads = []
const server = createServer(socket => {
  socket.setEncoding('utf8')
  let buffer = ''
  socket.on('data', chunk => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      let request
      try { request = JSON.parse(line) } catch { continue }
      dataReads.push(request.readingId)
      const reading = readings[request.readingId]
      socket.write(JSON.stringify({ v: 1, id: request.id, ok: true,
        reading: reading ? { id: request.readingId, state: 'live', label: request.readingId, value: reading } : null }) + '\n')
    }
  })
})
await new Promise(resolve => server.listen(socketPath, resolve))

const env = { ...process.env, ODK_DATA_SOCKET: socketPath }
const stateDir = await realpath(await mkdir(join(socketDir, 'state'), { recursive: true, mode: 0o700 }).then(() => join(socketDir, 'state')))
const log = []
const note = line => { log.push(line); console.log(line) }

// Observe real tool executions without replacing the real session.
const toolCalls = { proactive_read: 0 }
const createSession = async options => {
  const scoped = ['proactive_read']
  const customTools = (options.customTools ?? []).map(tool => scoped.includes(tool.name)
    ? { ...tool, execute: async (...args) => { toolCalls[tool.name]++; return tool.execute(...args) } }
    : tool)
  const created = await createDurableAgentSession({ ...options, customTools })
  const session = created.session
  const subscribe = session.subscribe.bind(session)
  session.subscribe = callback => subscribe(event => {
    if (event?.type === 'tool_execution_start' || event?.type === 'tool_call') note(`  sdk event ${event.type} ${event.name ?? ''}`)
    callback(event)
  })
  return { session }
}

let bot
try {
  bot = await createPersonalAgent({
    stateDir, env,
    personal: { profile: 'personal', memoryFile: join(socketDir, 'memory.json'), skillPaths: [] },
  }, { createSession })
  note(`agent ready: real ModelRuntime + real Durable session`)

  const results = []
  // --cases runs each paradigm alone, so each case has its own real generation,
  // tool calls and host qualification. Otherwise all topics share one round.
  const plan = casesMode
    ? rules.map((rule, index) => ({ round: index + 1, selected: [rule] }))
    : Array.from({ length: total }, (_, index) => ({ round: index + 1, selected: rules }))
  const caseEvidence = []
  for (const item of plan) {
    const before = { ...toolCalls }
    const watch = new ProactiveWatch({
      config: { version: 2, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000, maxCandidates: 8, maxPush: 4,
        generationIntervalMs: 0, attentionCooldownMs: 0, maxGenerationCalls: 4, suppressed: [], snoozed: {}, routineDays: {}, rules: structuredClone(item.selected) },
      now: () => Date.now(),
      canExecute: () => true,
      read: async id => ({ id, state: 'live', value: readings[id] }),
      generate: bot.generateProposals,
      onGeneration: record => note(`  phase=${record.phase} candidates=${record.candidates}`),
      publish: () => {},
      save: async () => {}, saveState: () => {}, execute: async () => 'done', phrase: async ({ advice }) => advice,
    })
    try {
      await watch.tick()
      const proposals = watch.list().filter(p => p.status === 'pending').map(p => ({
        run: item.round, topic: p.ruleId, advice: p.advice, preview: p.preview ?? null, ui: p.ui ?? null, nextStep: p.nextStep,
        pass: true,
      }))
      note(`case ${item.round} (${item.selected.map(r => r.id).join(',')}): ${proposals.length} published`)
      results.push(...proposals)
      caseEvidence.push({ round: item.round, topics: item.selected.map(r => r.id),
        toolCalls: { read: toolCalls.proactive_read - before.proactive_read },
        proposals: proposals.map(p => ({ topic: p.topic, advice: p.advice })) })
    } finally { await watch.close().catch(() => {}) }
  }
  const roundCount = plan.length

  note(`tool executions: proactive_read=${toolCalls.proactive_read}`)
  note(`data-link reads real by tool: ${dataReads.length} (${[...new Set(dataReads)].join(', ') || 'none'})`)
  const evidence = { stamp, path: 'createPersonalAgent -> generateProposals -> real ephemeral Durable session',
    toolCalls: { ...toolCalls }, dataReads, log, rounds: roundCount, cases: caseEvidence, proposals: results }
  writeFileSync(join(tmpdir(), 'odk-agent-path-live.json'), JSON.stringify({ stamp, log,
    rounds: Array.from({ length: roundCount }, (_, i) => ({ round: i + 1,
      proposals: results.filter(r => r.run === i + 1) })) }, null, 2))
  writeFileSync(join(tmpdir(), 'odk-agent-path-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(`\n${results.length} proposals across ${roundCount} ${casesMode ? 'cases' : 'rounds'}`)
  console.log(`corpus: ${join(tmpdir(), 'odk-agent-path-live.json')}`)
  console.log(`evidence: ${join(tmpdir(), 'odk-agent-path-evidence.json')}`)
} catch (error) {
  note(`FAILED: ${error?.stack?.split('\n').slice(0, 5).join(' | ') ?? error}`)
  process.exitCode = 1
} finally {
  try { await bot?.close() } catch {}
  server.close()
  await rm(socketDir, { recursive: true, force: true }).catch(() => {})
}
