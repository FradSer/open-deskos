// Real generation against the live model, then the live Jev judge.
// Opt in with: node scripts/test-paradigms-live.mjs [--repeat 2]
// It spends real model and classifier calls and prints one row per paradigm.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generationInstructions, validateGeneratedBatch } from '../src/proactive-generation.mjs'
import { createJevJudge } from '../src/proactive-jev.mjs'

const repeatIndex = process.argv.indexOf('--repeat')
const repeat = repeatIndex > -1 ? Number(process.argv[repeatIndex + 1]) : 1
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) throw Error('--repeat takes 1..5')

const stamp = new Date().toISOString()
const action = { id: 'open', label: 'Open the plan' }
const reading = (id, readingId, field, value) => ({ id, readingId, field, value, state: 'live', measuredAt: stamp })

// Each topic supplies only what its paradigm compares against.
const topics = [
  {
    id: 'commute-anomaly',
    goal: 'Tell me when the commute departs from its normal duration.',
    urgent: false, delivery: 'immediate', actions: [action],
    evidence: [
      reading('e0', 'commute.traffic', 'minutes', 52),
      reading('e1', 'commute.traffic', 'baselineMinutes', 24),
      reading('e2', 'commute.traffic', 'delayMinutes', 28),
      reading('e3', 'commute.traffic', 'rainAt', '18:15'),
      reading('e4', 'commute.traffic', 'rainChance', 80)
    ]
  },
  {
    id: 'commitment-guard',
    goal: 'Warn me before a calendar commitment becomes unreachable.',
    urgent: true, delivery: 'immediate', actions: [action],
    evidence: [
      reading('e5', 'calendar.next', 'startsAt', '14:00'),
      reading('e6', 'calendar.next', 'title', '产品评审'),
      reading('e7', 'calendar.next', 'bufferMinutes', 12),
      reading('e8', 'calendar.next', 'travelMinutes', 34),
      reading('e8b', 'calendar.next', 'shortfallMinutes', 22)
    ]
  },
  {
    id: 'commute-tradeoff',
    goal: 'Show the time and price trade-off before I choose a ride.',
    urgent: false, delivery: 'immediate', actions: [action],
    evidence: [
      reading('e9', 'commute.options', 'nowPrice', 32),
      reading('e10', 'commute.options', 'nowDelay', 28),
      reading('e11', 'commute.options', 'laterPrice', 58),
      reading('e12', 'commute.options', 'laterDelay', 9),
      reading('e13', 'commute.options', 'waitMinutes', 40)
    ]
  },
  {
    id: 'release-pipeline',
    goal: 'Tell me when the main branch is verified and ready to deploy.',
    delivery: 'silent', urgent: false, actions: [action],
    evidence: [
      reading('e14', 'ci.main', 'commit', '1998604'),
      reading('e15', 'ci.main', 'passed', 116),
      reading('e16', 'ci.main', 'failed', 0),
      reading('e17', 'ci.main', 'target', 'cm5'),
      reading('e18', 'ci.main', 'deployPending', true),
      reading('e19', 'ci.main', 'deployedRevision', '1998603')
    ]
  }
]

const input = {
  trigger: { kind: 'heartbeat', readingIds: [] },
  context: { now: stamp, local: { date: stamp.slice(0, 10), time: stamp.slice(11, 16) }, quiet: false, busy: false },
  topics, recent: [], maxCandidates: 8
}

let RAW = ''
// The live generator runs through the Pi CLI so this script needs no resident service.
// -ne skips local extensions: this run needs a plain model call, not the operator's toolchain.
function generate() {
  const raw = execFileSync('pi', ['-ne', '-p', generationInstructions + '\n\nInput:\n' + JSON.stringify(input)], {
    encoding: 'utf8', timeout: 240000, maxBuffer: 4 << 20
  })
  RAW = raw
  const text = raw.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '')
  return validateGeneratedBatch(JSON.parse(text), topics, 8)
}

const judge = createJevJudge({ env: process.env })
const rows = []
for (let run = 1; run <= repeat; run++) {
  let candidates
  try { candidates = generate() } catch (error) {
    console.log(`run ${run}: generation failed — ${error.message}`)
    continue
  }
  if (!candidates.length) { console.log(`run ${run}: the model proposed nothing`); continue }
  const judged = candidates.map((candidate, index) => ({ ...candidate, id: `r${run}c${index}`, generated: true }))
  // The classifier occasionally times out on a four-candidate batch; one retry is enough.
  let result
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      result = await judge({ candidates: judged, trigger: input.trigger, context: input.context, recent: [] })
      break
    } catch (error) {
      if (attempt === 2) { console.log(`run ${run}: judge failed — ${error.code ?? error.message}`); break }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
  if (!result) continue
  for (const candidate of judged) {
    const answer = result.answers[candidate.id]
    // The host gate: usefulness and factual support.
    rows.push({
      run, topic: candidate.topicId, advice: candidate.advice,
      preview: candidate.preview ?? null, nextStep: candidate.nextStep ?? null,
      items: candidate.preview?.items?.length ?? 0,
      probability: answer.probability, grounding: answer.groundingProbability,
      threshold: answer.threshold,
      pass: answer.probability >= answer.threshold && answer.groundingProbability >= answer.threshold
    })
  }
}

console.log('\ntopic                 advice                                   items  prob  ground  verdict')
for (const row of rows) {
  console.log(
    row.topic.padEnd(21),
    row.advice.slice(0, 38).padEnd(40),
    String(row.items).padStart(5),
    row.probability.toFixed(2).padStart(5),
    row.grounding.toFixed(2).padStart(7),
    (row.pass ? 'pass' : 'reject').padStart(7)
  )
}
const passed = rows.filter(r => r.pass).length
console.log(`\n${passed}/${rows.length} qualified at threshold ${rows[0]?.threshold ?? 0.8}`)
writeFileSync(join(tmpdir(), 'odk-paradigm-live.json'), JSON.stringify({ stamp, rows }, null, 2))