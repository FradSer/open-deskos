import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createPersonalAgent } from '../../src/agent.mjs'
import { ProactiveWatch } from '../../src/proactive.mjs'
import { createJevJudge } from '../../src/proactive-jev.mjs'
import { proposalStateStore } from '../../src/proactive-state.mjs'
import { PersonalAgentService } from '../../src/service.mjs'
import { listen } from '../../src/socket.mjs'
import { proactiveJevCases } from '../fixtures/proactive-jev-cases.mjs'
import { liveJevResponse } from '../fixtures/live-jev-response.mjs'

const require = createRequire(import.meta.url)
const { createPersonalAgentClient } = require('../../../../runtime/shell/src/personal-agent-client.js')
let input = ''
for await (const chunk of process.stdin) input += chunk
const credentials = JSON.parse(input)
input = ''
const env = { TYPESAFE_API_KEY: credentials.jevKey, ODK_JEV_TIMEOUT_MS: '30000' }
const report = { candidate: credentials.candidate, fingerprints: credentials.fingerprints, startedAt: new Date().toISOString(),
  platform: process.platform, arch: process.arch, node: process.version,
  generationModel: `${credentials.provider}/${credentials.model.id}`, defaultDurableSession: true,
  simulatedReadings: true, realGeneration: true, realJev: true, renderedUI: false,
  calls: [], generations: [], judgments: [], notifications: [], scenarios: [], ownerTurns: 0, captures: 0, actions: 0 }
const events = new EventEmitter()
const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }))
const wait = async name => (await once(events, name, { signal: AbortSignal.timeout(110000) }))[0]
let phase = 'initializing', bot, watch, server, client, topic, reading, measuredAt
const reserve = kind => {
  assert.ok(report.calls.length < credentials.maxRequests, 'External request budget exhausted')
  const call = { kind, phase, startedAt: new Date().toISOString() }
  report.calls.push(call)
  return call
}
const forbidden = counter => async () => { report[counter]++; assert.fail(`Unexpected ${counter}`) }
const service = new PersonalAgentService({ record: forbidden('captures'), transcribe: forbidden('captures'), prompt: forbidden('ownerTurns') })
async function createBot() {
  return createPersonalAgent({ stateDir: '/tmp/agent', model: report.generationModel, env,
    personal: { profile: 'personal', skillPaths: [], memoryFile: '/tmp/agent/memory.json' } }, {
    createRuntime: async () => {
      const runtime = await ModelRuntime.create({ authPath: '/tmp/agent/auth.json', modelsPath: null, refreshOnCreate: false })
      runtime.registerProvider(credentials.provider, { ...credentials.providerConfig, models: [credentials.model] })
      return new Proxy(runtime, { get(target, key) {
        if (key === 'streamSimple') return (model, context, options) => {
          const call = reserve('generation'), started = performance.now()
          const stream = target.streamSimple(model, context, { ...options, maxTokens: 4096 })
          void stream.result().then(message => {
            call.elapsedMs = Math.round(performance.now() - started)
            call.stopReason = message.stopReason; call.usage = message.usage
          }).catch(() => { call.failed = true })
          return stream
        }
        const value = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      } })
    },
  })
}
const judge = createJevJudge({ env, fetchImpl: async (url, options) => {
  const call = reserve('jev'), started = performance.now()
  const captured = await liveJevResponse(await fetch(url, options), Object.keys(JSON.parse(options.body).questions))
  Object.assign(call, captured.metadata, { elapsedMs: Math.round(performance.now() - started) })
  return captured.response
} })
function makeWatch(stateName, overrides = {}) {
  const config = { version: 2, pollMs: 1500, maxAgeMs: 1800000, cooldownMs: 60000, maxCandidates: 2, maxPush: 1,
    suppressed: [], snoozed: {}, rules: [{ id: topic.id, goal: topic.goal,
      observations: [{ readingId: 'simulation.source', fields: ['status'] }], delivery: 'immediate', urgent: false }], ...overrides }
  const store = proposalStateStore(`/tmp/proactive/${stateName}/state.json`)
  const value = new ProactiveWatch({ config, loadState: store.load, saveState: store.save, judge,
    read: async id => ({ id, label: 'Simulated source', state: 'live', value: { status: reading, measured_at: measuredAt ?? new Date().toISOString() } }),
    generate: async request => { const result = await bot.generateProposals(request); log('candidates', { phase, result }); return result },
    save: async () => {}, phrase: bot.phraseProposal, execute: forbidden('actions'),
    onGeneration: record => { report.generations.push({ phase, ...record }); log('generation', { phase, ...record }) },
    onJudgment: record => { report.judgments.push({ phase, ...record }); log('judgment', { phase, ...record }) },
    publish: frame => { service.propose(frame); events.emit('cycle', frame) },
  })
  const presented = value.presented.bind(value)
  value.presented = async ids => { await presented(ids); events.emit('presented') }
  service.attachWatch(value)
  return value
}
async function cycle(start) {
  const done = wait('cycle')
  start?.()
  const frame = await done
  await watch.inflight
  // A protocol response is a barrier after previously queued notification frames.
  await client.diagnose()
  assert.equal(watch.judgmentError, '', watch.judgmentError)
  return frame
}
async function acknowledge(ids) {
  const done = wait('presented')
  assert.equal(client.proposalCommand({ type: 'proposal_presented', ids }), true)
  await done
  await client.diagnose()
}
function pass(name, details = {}) {
  const result = { phase, name, passed: true, ...details }
  report.scenarios.push(result); log('passed', result)
}
function delivered(frame) {
  assert.equal(frame.popup, true, 'No candidate passed live judgment on the first inference round')
  const notification = report.notifications.findLast(item => item.phase === phase)
  assert.ok(notification, 'Shell client did not receive the popup')
  const proposals = watch.list().filter(p => p.status === 'pending')
  assert.ok(proposals.length)
  assert.ok(proposals.every(p => p.action === null && p.judgment.probability >= 0.8 && p.judgment.groundingProbability >= 0.8))
  return proposals
}
try {
  await mkdir('/tmp/agent', { recursive: true, mode: 0o700 })
  bot = await createBot()
  server = await listen('/tmp/channel/agent.sock', service)
  client = createPersonalAgentClient({ socketPath: server.path })
  client.subscribe(status => {
    if (status.state === 'idle') events.emit('ready')
    if (status.proposalPopup) {
      const record = { phase, at: new Date().toISOString(), proposals: status.proposals }
      report.notifications.push(record); log('notification', record)
    }
  })
  const ready = wait('ready'); client.start(); await ready
  for (let round = 1; round <= credentials.rounds; round++) {
    topic = proactiveJevCases.find(sample => sample.id === 'parcel-recommendation')
    reading = '当前没有待领取包裹，也没有即将到期的包裹。'
    phase = `round-${round}:normal-heartbeat`
    watch = makeWatch(`parcel-${round}`)
    const normal = await cycle(() => watch.start())
    assert.equal(normal.popup, false); assert.equal(watch.list().filter(p => p.status === 'pending').length, 0)
    pass('normal observations do not interrupt')

    phase = `round-${round}:changed-heartbeat`; reading = topic.observation
    const first = delivered(await cycle())
    assert.equal(report.generations.at(-1).trigger, 'heartbeat')
    pass('real background timer delivers on its first changed-observation inference', { advice: first[0].advice, judgment: first[0].judgment })
    await acknowledge(first.map(p => p.id))

    phase = `round-${round}:duplicate-heartbeat`
    assert.equal((await cycle()).popup, false)
    pass('acknowledged observations do not repeat')
    await watch.close(); await bot.close()

    phase = `round-${round}:restart-heartbeat`
    bot = await createBot(); watch = makeWatch(`parcel-${round}`, { pollMs: 60000 })
    assert.equal(watch.list().find(p => p.id === first[0].id)?.presented, true)
    assert.equal((await cycle(() => watch.start())).popup, false)
    pass('restart preserves acknowledgment without another popup')
    await watch.close()

    phase = `round-${round}:service-push`
    topic = proactiveJevCases.find(sample => sample.id === 'ci-recommendation'); reading = topic.observation
    watch = makeWatch(`ci-${round}`, { pollMs: 60000 })
    delivered(await cycle(() => assert.equal(client.servicePush(['simulation.source']), true)))
    assert.equal(report.generations.at(-1).trigger, 'service_push')
    pass('authenticated service event delivers on its first inference without starting a heartbeat')
    await watch.close()

    // Reuse the real accepted, unacknowledged proposal to isolate delivery policy.
    phase = `round-${round}:quiet-policy`
    const clock = new Date()
    const quietHours = { start: clock.toISOString().slice(11, 16), end: new Date(clock.getTime() + 600000).toISOString().slice(11, 16), timeZone: 'UTC' }
    watch = makeWatch(`ci-${round}`, { pollMs: 60000, quietHours })
    assert.equal(watch.quiet(), true)
    assert.ok(watch.list().some(p => p.status === 'pending'))
    assert.equal((await cycle(() => watch.emit())).popup, false)
    pass('quiet hours defer a real accepted proposal', { mode: 'delivery-policy replay; no additional inference' })
    await watch.close()

    phase = `round-${round}:busy-policy`
    watch = makeWatch(`ci-${round}`, { pollMs: 60000 })
    watch.setBusy(true)
    assert.equal((await cycle(() => watch.emit())).popup, false)
    delivered(await cycle(() => watch.setBusy(false)))
    pass('accepted proposal waits until the service is idle', { mode: 'delivery-policy replay; no additional inference' })
    await acknowledge(watch.list().filter(p => p.status === 'pending').map(p => p.id))
    await watch.close()

    phase = `round-${round}:stale`
    measuredAt = new Date(Date.now() - 3600000).toISOString()
    watch = makeWatch(`ci-${round}`, { pollMs: 60000 })
    const count = report.calls.length
    assert.equal((await cycle(() => watch.start())).popup, false)
    assert.equal(report.calls.length, count)
    assert.equal(watch.list().filter(p => p.status === 'pending').length, 0)
    pass('stale observations expire advice without any inference')
    await watch.close(); measuredAt = undefined
  }
  assert.equal(report.ownerTurns, 0); assert.equal(report.captures, 0); assert.equal(report.actions, 0)
  report.passed = true
} catch (error) {
  report.passed = false
  report.failure = { phase, name: error.name, message: error.name === 'AssertionError' ? error.message : 'Live verification failed; inspect sanitized events' }
  log('failed', report.failure)
} finally {
  await watch?.close().catch(() => {})
  client?.stop()
  await server?.close().catch(() => {})
  await bot?.close().catch(() => {})
  report.finishedAt = new Date().toISOString()
  await writeFile('/evidence/result.json', JSON.stringify(report, null, 2), { mode: 0o600 })
  log('result', { passed: report.passed, scenarios: report.scenarios.length, externalCalls: report.calls.length })
}
process.exitCode = report.passed ? 0 : 1
