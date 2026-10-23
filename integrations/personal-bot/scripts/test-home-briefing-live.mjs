// Explicit live-provider acceptance. No microphone, task submission, or owner-state writes.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalBot } from '../src/agent.mjs'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createDurableAgentSession } from '../src/durable-agent-session.mjs'
import { HomeBriefing } from '../src/home-briefing.mjs'
import { homeFactVariables } from '../src/home-template.mjs'
import { createTaskReadings, createRemoteReadings } from '../src/producer-readings.mjs'
import { declaredSources } from '../tests/helpers/declared-sources.mjs'
import { odkDataRequest } from '../src/odk-data.mjs'

if (!process.argv.includes('--run')) {
  console.log('Use --run to authorize live Overview model requests with configured Pi authentication.')
  process.exit(0)
}
const output = process.env.ODK_OVERVIEW_LIVE_OUTPUT || await mkdtemp(join(tmpdir(), 'odk-overview-live-'))
await mkdir(output, { recursive: true, mode: 0o700 })
const stateDir = await mkdtemp(join(tmpdir(), 'odk-overview-agent-'))
const fingerprint = async () => Object.fromEntries(await Promise.all([
  ...['agent.mjs', 'home-briefing.mjs', 'home-template.mjs', 'producer-readings.mjs'].map(name => `../src/${name}`),
  '../tests/helpers/declared-sources.mjs', '../../../runtime/shell/src/odk-data-registry.js',
  '../../../runtime/shell/src/personal-agent-readings.js', '../../../runtime/shell/src/odk-data.js',
  './test-home-briefing-live.mjs',
].map(async name => [name, createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex')])))
const report = { realModel: true, microphoneCapture: false, ownerTaskSubmission: false, sourceHashes: await fingerprint(), scenarios: [], passed: false }
let bot, current, requests = 0
try {
  bot = await createPersonalBot({ stateDir, model: process.env.ODK_PERSONAL_BOT_MODEL,
    personal: { profile: 'personal', skillPaths: [], memoryFile: join(stateDir, 'memory.json') },
    env: { ...process.env, ODK_JEV_PROVIDER: 'disabled' },
  }, { createRuntime: async options => {
    const runtime = await ModelRuntime.create(options)
    return new Proxy(runtime, { get(target, key) {
      if (key === 'streamSimple') return (model, context, options) => target.streamSimple(model, context, {
        ...options, onPayload: payload => {
          current.controls.push({ model: model.id, provider: model.provider,
            enableThinking: payload.enable_thinking, maxTokens: payload.max_tokens ?? payload.max_completion_tokens })
        },
      })
      const value = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  }, createSession: async options => {
    const result = await createDurableAgentSession(options)
    if (options.ephemeral) {
      assert.deepEqual(options.tools, [])
      assert.deepEqual(options.customTools, [])
      let telemetry
      const prompt = result.session.prompt.bind(result.session)
      result.session.subscribe(event => {
        if (event.type === 'message_end' && event.message.role === 'assistant') {
          const row = telemetry
          if (!row) return
          row.elapsedMs = Date.now() - row.startedAt
          row.stopReason = event.message.stopReason
          row.usage = event.message.usage
          const text = event.message.content.filter(part => part.type === 'text').map(part => part.text).join('')
          try { const value = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '')); if (Array.isArray(value.items) && value.items.every(item => Array.isArray(item.sources) && item.sources.every(Number.isInteger))) row.selection = value } catch {}
          console.log(JSON.stringify({ modelRequestFinished: row.stopReason, elapsedMs: row.elapsedMs }))
        }
      })
      result.session.prompt = async (text, ...args) => {
        assert.ok(++requests <= 24, 'Live request budget exceeded')
        const payload = JSON.parse(text.slice(text.indexOf('Personal Bot request:\n') + 'Personal Bot request:\n'.length))
        assert.ok(Array.isArray(payload.variables))
        current.requests++
        telemetry = { startedAt: Date.now(), facts: payload.variables.length,
          candidates: payload.variables.map(({ selector, id, factId, serviceId, displayable, characters }) => ({ selector, id, factId, serviceId, displayable, characters })) }
        current.telemetry.push(telemetry)
        console.log(JSON.stringify({ modelRequest: requests, facts: payload.variables.length }))
        for (const fact of payload.variables) { if (fact.id) current.seenSources.add(fact.id); if (fact.factId) current.seenFacts.add(fact.factId) }
        if (current.mutate) { const mutate = current.mutate; current.mutate = null; mutate() }
        return prompt(text, ...args)
      }
    }
    return result
  } })
  report.model = bot.generationModel
  async function check(name, access, expected, synthetic, mutate) {
    current = { seenSources: new Set(), seenFacts: new Set(), requests: 0, telemetry: [], failures: [], controls: [], mutate: undefined }
    let sourceFacts
    const home = new HomeBriefing({ ...access, requireBindings: true,
      generate: input => { sourceFacts = homeFactVariables(input.readings, input.now); return bot.generateBriefing(input) }, publish() {}, onFailure: failure => current.failures.push(failure) })
    const started = Date.now()
    if (mutate) current.mutate = () => { mutate(); home.invalidate() }
    try {
      await home.refresh()
      const row = { name, synthetic, state: home.frame.state, coverage: home.frame.coverage,
        requests: current.requests, controls: current.controls, telemetry: current.telemetry, failures: current.failures, elapsedMs: Date.now() - started,
        consideredSources: [...current.seenSources].sort(), consideredFacts: current.seenFacts.size,
        items: home.frame.items, passed: false }
      report.scenarios.push(row)
      assert.equal(home.frame.state, 'live', 'Real generation must succeed without fallback')
      for (const fact of sourceFacts) assert.ok(current.seenFacts.has(fact.factId), `Fact did not reach real model: ${fact.factId}`)
      assert.equal(home.frame.omittedSources, 0)
      const selected = home.frame.items.flatMap(item => item.sources)
      const serviceBySource = new Map(sourceFacts.map(fact => [fact.id, fact.serviceId]))
      const services = selected.map(source => serviceBySource.get(source.id))
      assert.equal(new Set(services).size, services.length, 'Each service can display only one fact')
      row.selectedServices = services
      if (!synthetic) assert.ok(!current.seenSources.has('odk.data.connection'), 'The live source inventory must be reachable')
      assert.equal(current.controls.length, current.requests, 'Every prompt must reach the provider payload boundary')
      for (const control of current.controls) {
        assert.ok(control.maxTokens <= 2048, 'Overview output budget must reach the provider')
        if (control.provider === 'bailian') {
          assert.equal(control.enableThinking, false)
          assert.ok(current.telemetry.every(row => row.usage?.reasoning === 0), 'The provider must confirm zero reasoning tokens')
        }
      }
      if (mutate) {
        assert.match(home.frame.items.map(item => item.text).join(' '), /finished/)
        assert.match(home.frame.items.map(item => item.text).join(' '), /verification not_run/)
      }
      assert.equal(home.frame.coverage.readSources, home.frame.coverage.totalSources)
      if (expected) {
        assert.ok(home.frame.items.some(item => item.sources.some(source => source.id === expected)), `Expected urgent Agent source ${expected}`)
        for (const suffix of [':goal', ':state']) assert.ok(current.seenFacts.has(expected + suffix))
      }
      row.passed = true
      console.log(JSON.stringify({ scenario: name, passed: true, sources: row.coverage.readSources, facts: row.consideredFacts, requests: row.requests }))
    } finally { home.close() }
  }
  const makeReading = (id, label, icon, value) => ({ id, label, kind: 'app', state: 'live', updatedAt: Date.now(), value,
    home: { mode: 'required', priority: 99, icon, fields: Object.keys(value) } })
  for (const state of (process.env.ODK_OVERVIEW_LIVE_DEVICE_ONLY === '1' ? [] : ['failed', 'waiting', 'running'])) {
    const readings = [makeReading('portfolio', 'Portfolio', 'portfolio', { todayChangePercent: 0.1 }),
      makeReading('weather', 'Weather', 'weather', { temperatureC: 23, condition: 'clear' }),
      makeReading('odk.app.pi-sessions', 'Pi sessions', 'sessions', { total: 1, counts: { running: 1, waiting: 0 }, sessions: [{ id: 'live-test-session', project: 'Desk runtime', state: 'running', goal: 'Verify Overview', activity: 'Reading source inventory' }] }),
      ...Array.from({ length: state === 'failed' ? 70 : 2 }, (_, index) => makeReading(`connected.${index}`, `Reading ${index}`, 'tasks', { status: 'normal' }))]
    const task = { taskId: 'overview-acceptance-task', identity: { name: 'Release Agent' }, state,
      updatedAt: new Date().toISOString(), request: 'Verify release', verification: { status: 'not_run' }, learning: { status: 'not_run' } }
    const sibling = { ...task, taskId: 'overview-secondary-task', identity: { name: 'Background Agent' }, state: 'running', request: 'Observe background work' }
    const messages = Array.from({ length: 2 }, (_, index) => ({ id: `overview-report-${index}`, at: Date.now(), text: `Pi report ${index}`, verification: 'reported_unverified', sources: [{ sessionId: `remote-${index}`, taskName: 'Remote Pi task', state: 'settled' }] }))
    const access = await declaredSources({ readings, providers: [
      createTaskReadings({ list: () => ({ tasks: [task, sibling], total: 2 }), status: id => id === task.taskId ? task : sibling }),
      createRemoteReadings({ snapshot: () => ({ state: 'live', messages, nextOffset: null }) }),
    ] })
    try {
      await check(`agent-${state}`, access, 'odk.agent.overview-acceptance-task', true)
      if (state === 'failed') await check('agent-changing-during-generation', access, 'odk.agent.overview-acceptance-task', true, () => { task.state = 'finished' })
    } finally { access.close() }
  }
  const access = { list: async signal => (await odkDataRequest('list', { signal })).readings,
    read: async (id, signal) => (await odkDataRequest('read', { id, signal })).reading }
  await check('connected-device-readings', access, undefined, false)
  report.passed = true
} catch (error) {
  report.failure = { name: error.name, message: error.code === 'ERR_ASSERTION' ? error.message.slice(0, 250) : 'Live setup or generation failed; inspect safe scenario diagnostics.' }
  console.error(JSON.stringify(report.failure))
  process.exitCode = 1
} finally {
  await bot?.close()
  report.requests = requests
  if (JSON.stringify(report.sourceHashes) !== JSON.stringify(await fingerprint())) {
    report.passed = false
    report.failure = { name: 'SourceChanged', message: 'Live verification source changed during the run.' }
    process.exitCode = 1
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ passed: report.passed, requests, evidence: output }))
}
