// Full production pipeline against live model and live Jev: batch judgment,
// near-miss reconsideration, the bounded repair round, and host qualification.
// Opt in with: node scripts/test-agent-loop-live.mjs [--rounds 3]
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProactiveWatch } from '../src/proactive.mjs'
import { createJevJudge } from '../src/proactive-jev.mjs'
import { generationInstructions, validateGeneratedBatch, generatedFormatCorrection } from '../src/proactive-generation.mjs'

const rounds = Number(process.argv[process.argv.indexOf('--rounds') + 1] ?? 3)
const stamp = new Date().toISOString()
const action = { id: 'open', label: '打开计划', tool: 'memory_update', params: { category: 'note', value: 'opened' } }

const rules = [
  { id: 'commute-anomaly', goal: 'Tell me when the commute departs from its normal duration.', delivery: 'immediate', urgent: false,
    observations: [{ readingId: 'commute.traffic', fields: ['minutes', 'baselineMinutes', 'delayMinutes', 'rainAt', 'rainChance'] }], actions: [action] },
  { id: 'commitment-guard', goal: 'Warn me before a calendar commitment becomes unreachable.', delivery: 'immediate', urgent: true,
    observations: [{ readingId: 'calendar.next', fields: ['startsAt', 'title', 'bufferMinutes', 'travelMinutes', 'shortfallMinutes'] }], actions: [action] },
  { id: 'commute-tradeoff', goal: 'Show the time and price trade-off before I choose a ride.', delivery: 'immediate', urgent: false,
    observations: [{ readingId: 'commute.options', fields: ['nowPrice', 'nowDelay', 'laterPrice', 'laterDelay', 'waitMinutes', 'priceDelta', 'delayDelta'] }], actions: [action] },
  { id: 'release-pipeline', goal: 'Tell me when the main branch is verified and ready to deploy.', delivery: 'silent', urgent: false,
    observations: [{ readingId: 'ci.main', fields: ['commit', 'passed', 'failed', 'target', 'deployPending', 'deployedRevision'] }], actions: [action] }
]
const readings = {
  'commute.traffic': { minutes: 52, baselineMinutes: 24, delayMinutes: 28, rainAt: '18:15', rainChance: 80, measured_at: stamp },
  'calendar.next': { startsAt: '14:00', title: '产品评审', bufferMinutes: 12, travelMinutes: 34, shortfallMinutes: 22, measured_at: stamp },
  'commute.options': { nowPrice: 32, nowDelay: 28, laterPrice: 58, laterDelay: 9, waitMinutes: 40, priceDelta: 26, delayDelta: 19, measured_at: stamp },
  'ci.main': { commit: '1998604', passed: 116, failed: 0, target: 'cm5', deployPending: true, deployedRevision: '1998603', measured_at: stamp }
}

const log = []
const note = line => { log.push(line); console.log(line) }

// One model call at a time: the runtime serialises its own generation, and concurrent
// child processes would otherwise contend for the same provider session.
let queue = Promise.resolve()
// Chain after the previous task settles; the returned promise keeps this task's own outcome.
const serial = task => {
  const result = queue.then(task, task)
  queue = result.then(() => {}, () => {})
  return result
}
async function liveGenerate(input) {
  // The resident retries once through generatedFormatCorrection; mirror that here.
  // The instruction block plus a four-topic input exceeds the argument limit, so the
  // prompt goes in on stdin: `pi -p` with no positional prompt reads it from there.
  const attempt = request => serial(async () => {
    const child = spawn('pi', ['-ne', '-p'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.stdin.end(generationInstructions + '\n\nInput:\n' + JSON.stringify(request))
    const timer = setTimeout(() => child.kill('SIGKILL'), 200000)
    const code = await new Promise(resolve => child.on('close', resolve))
    clearTimeout(timer)
    if (code !== 0) throw Error(`pi exited ${code}: ${stderr.split('\n').filter(line => !line.startsWith('Warning: No models')).join(' ').slice(0, 300)}`)
    return stdout.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '')
  })
  // The watch validates and normalises the raw response itself, so this returns raw JSON.
  const parse = text => JSON.parse(text)
  let text = await attempt(input)
  try {
    validateGeneratedBatch(parse(text), input.topics, input.maxCandidates)
    note(`  generate ok: ${parse(text).suggestions.length} candidates`)
    return parse(text)
  } catch (first) {
    note(`  first attempt failed: ${first.message}; correcting format`)
    const correction = { ...input, formatCorrection: generatedFormatCorrection(first) }
    text = await attempt(correction)
    try {
      validateGeneratedBatch(parse(text), input.topics, input.maxCandidates)
      note(`  generate ok after correction: ${parse(text).suggestions.length} candidates`)
      return parse(text)
    } catch (second) {
      note(`  correction failed: ${second.message}`)
      note(`  raw head: ${JSON.stringify(text.slice(0, 500))}`)
      throw second
    }
  }
}

async function runRound(index) {
  const watch = new ProactiveWatch({
    config: { version: 2, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000, maxCandidates: 8, maxPush: 4,
      generationIntervalMs: 0, attentionCooldownMs: 0, maxGenerationCalls: 8, suppressed: [], snoozed: {}, routineDays: {}, rules: structuredClone(rules) },
    now: () => Date.now(),
    canExecute: () => true,
    read: async id => ({ id, state: 'live', value: readings[id] }),
    generate: async input => {
      note(`  generate ${input.repair ? 'REPAIR' : 'batch'} (${input.topics.length} topics)`)
      try { return await liveGenerate(input) } catch (error) { note(`  generate failed: ${error.message}`); throw error }
    },
    judge: async args => {
      try {
        const out = await createJevJudge({ env: process.env })(args)
        for (const c of args.candidates) {
          const a = out.answers[c.id]
          note(`  judge ${c.topicId} p=${Number(a.probability).toFixed(2)} g=${Number(a.groundingProbability).toFixed(2)} compl=${a.complementarityProbability === undefined ? 'n/a' : Number(a.complementarityProbability).toFixed(2)}`)
        }
        return out
      } catch (error) {
        note(`  JUDGE ERROR ${error?.stack?.split('\n').slice(0, 2).join(' | ')}`)
        throw error
      }
    },
    onGeneration: record => note(`  phase=${record.phase} candidates=${record.candidates} topics=${(record.topics ?? []).join(',')}${record.budgetUsed !== undefined ? ` budgetUsed=${record.budgetUsed}` : ''}`),
    onJudgment: record => {
      // The runtime receipt carries usefulness, support and threshold; complementarity stays in the answer map.
      for (const d of record.decisions) note(`  judged ${d.ruleId} p=${Number(d.probability).toFixed(2)} g=${Number(d.groundingProbability).toFixed(2)} thr=${d.threshold}`)
    },
    publish: () => {},
    save: async () => {}, saveState: () => {}, execute: async () => 'done', phrase: async ({ advice }) => advice,
  })
  try {
    await watch.tick()
    const published = watch.list().filter(p => p.status === 'pending').map(p => ({
      ruleId: p.ruleId, advice: p.advice, preview: p.preview ?? null, nextStep: p.nextStep,
      probability: p.judgment.probability, grounding: p.judgment.groundingProbability,
      complementarity: p.judgment.complementarityProbability ?? null, threshold: p.judgment.threshold,
    }))
    note(`round ${index}: ${published.length} published; judgmentError=${JSON.stringify(watch.judgmentError ?? '')} failed=${JSON.stringify([...(watch.failedJudgments ?? [])])}`)
    return published
  } catch (error) {
    note(`round ${index} failed: ${error.message}`)
    return []
  } finally { await watch.close().catch(() => {}) }
}

const rounds5 = Number.isInteger(rounds) && rounds >= 1 && rounds <= 5 ? rounds : 3
const all = []
for (let index = 1; index <= rounds5; index++) {
  const published = await runRound(index)
  all.push({ round: index, proposals: published })
  writeFileSync(join(tmpdir(), 'odk-agent-loop-live.json'), JSON.stringify({ stamp, log, rounds: all }, null, 2))
}
const total = all.reduce((sum, round) => sum + round.proposals.length, 0)
console.log(`\n${total} proposals published across ${rounds5} rounds (threshold ${process.env.ODK_JEV_THRESHOLD ?? 0.8})`)
console.log(`output: ${join(tmpdir(), 'odk-agent-loop-live.json')}`)
