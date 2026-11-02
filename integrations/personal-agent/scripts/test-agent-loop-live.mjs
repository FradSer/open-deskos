// Full production pipeline against live model and live Jev: batch judgment,
// near-miss reconsideration, the bounded repair round, and host qualification.
// Opt in with: node scripts/test-agent-loop-live.mjs [--rounds 3]
import { execFileSync } from 'node:child_process'
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

function liveGenerate(input) {
  // The resident retries once through generatedFormatCorrection; mirror that here.
  const attempt = request => {
    const raw = execFileSync('pi', ['-ne', '-p', generationInstructions + '\n\nInput:\n' + JSON.stringify(request)], {
      encoding: 'utf8', timeout: 200000, maxBuffer: 4 << 20
    })
    return raw.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '')
  }
  let text = attempt(input)
  try {
    return validateGeneratedBatch(JSON.parse(text), input.topics, input.maxCandidates)
  } catch (first) {
    note(`  first attempt failed: ${first.message}; correcting format`)
    const correction = { ...input, formatCorrection: generatedFormatCorrection(first) }
    text = attempt(correction)
    try {
      return validateGeneratedBatch(JSON.parse(text), input.topics, input.maxCandidates)
    } catch (second) {
      note(`  correction failed: ${second.message}`)
      note(`  raw head: ${JSON.stringify(text.slice(0, 400))}`)
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
      return liveGenerate(input)
    },
    judge: createJevJudge({ env: process.env }),
    onGeneration: record => note(`  phase=${record.phase} candidates=${record.candidates}`),
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
    note(`round ${index}: ${published.length} published`)
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
