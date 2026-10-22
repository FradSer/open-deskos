// Explicit live-provider acceptance. No microphone, task submission, or owner-state writes.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalBot } from '../src/agent.mjs'
import { createDurableAgentSession } from '../src/durable-agent-session.mjs'
import { HomeBriefing } from '../src/home-briefing.mjs'
import { homeFactVariables } from '../src/home-template.mjs'
import { declaredSources } from '../tests/helpers/declared-sources.mjs'
import { createTaskReadings } from '../src/producer-readings.mjs'
import { odkDataRequest } from '../src/odk-data.mjs'

if (!process.argv.includes('--run')) {
  console.log('Use --run to authorize live Overview model requests with configured Pi authentication.')
  process.exit(0)
}
const output = process.env.ODK_OVERVIEW_LIVE_OUTPUT || await mkdtemp(join(tmpdir(), 'odk-overview-live-'))
await mkdir(output, { recursive: true, mode: 0o700 })
const stateDir = await mkdtemp(join(tmpdir(), 'odk-overview-agent-'))
const report = { realModel: true, microphoneCapture: false, ownerTaskSubmission: false, scenarios: [], passed: false }
let bot, current, requests = 0
try {
  bot = await createPersonalBot({ stateDir, model: process.env.ODK_PERSONAL_BOT_MODEL,
    personal: { profile: 'personal', skillPaths: [], memoryFile: join(stateDir, 'memory.json') },
    env: { ...process.env, ODK_JEV_PROVIDER: 'disabled', ODK_PROACTIVE_GENERATION_TIMEOUT_MS: '180000' },
  }, { createSession: async options => {
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
        telemetry = { startedAt: Date.now(), facts: payload.variables.length }; current.telemetry.push(telemetry)
        console.log(JSON.stringify({ modelRequest: requests, facts: payload.variables.length }))
        for (const fact of payload.variables) { current.seenSources.add(fact.id); current.seenFacts.add(fact.factId) }
        return prompt(text, ...args)
      }
    }
    return result
  } })
  report.model = bot.generationModel
  async function check(name, access, expected, synthetic) {
    current = { seenSources: new Set(), seenFacts: new Set(), requests: 0, telemetry: [], failures: [] }
    let sourceFacts
    const home = new HomeBriefing({ ...access, requireBindings: true,
      generate: input => { sourceFacts = homeFactVariables(input.readings, input.now); return bot.generateBriefing(input) }, publish() {}, onFailure: failure => current.failures.push(failure) })
    const started = Date.now()
    try {
      await home.refresh()
      const row = { name, synthetic, state: home.frame.state, coverage: home.frame.coverage,
        requests: current.requests, telemetry: current.telemetry, failures: current.failures, elapsedMs: Date.now() - started,
        consideredSources: [...current.seenSources].sort(), consideredFacts: current.seenFacts.size,
        items: home.frame.items, passed: false }
      report.scenarios.push(row)
      assert.equal(home.frame.state, 'live', 'Real generation must succeed without fallback')
      for (const fact of sourceFacts) assert.ok(current.seenFacts.has(fact.factId), `Fact did not reach real model: ${fact.factId}`)
      assert.equal(home.frame.omittedSources, 0)
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
      makeReading('pi', 'Pi sessions', 'sessions', { total: 1, counts: { running: 1, waiting: 0 }, sessions: [{ id: 'live-test-session', project: 'Desk runtime', state: 'running', goal: 'Verify Overview', activity: 'Reading source inventory' }] }),
      ...Array.from({ length: state === 'failed' ? 70 : 2 }, (_, index) => makeReading(`connected.${index}`, `Reading ${index}`, 'tasks', { status: 'normal' }))]
    const task = { taskId: 'overview-acceptance-task', identity: { name: 'Release Agent' }, state,
      updatedAt: new Date().toISOString(), request: 'Verify release', verification: { status: 'not_run' }, learning: { status: 'not_run' } }
    const access = await declaredSources({ readings, providers: [createTaskReadings({ list: () => ({ tasks: [task], total: 1 }), status: () => task })] })
    await check(`agent-${state}`, access, 'odk.agent.overview-acceptance-task', true)
  }
  const access = { list: async signal => (await odkDataRequest('list', { signal })).readings, read: async (id, signal) => (await odkDataRequest('read', { id, signal })).reading }
  await check('connected-device-readings', access, undefined, false)
  report.passed = true
} catch (error) {
  report.failure = { name: error.name, message: error.message.slice(0, 250) }
  console.error(JSON.stringify(report.failure))
  process.exitCode = 1
} finally {
  await bot?.close()
  report.requests = requests
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  console.log(JSON.stringify({ passed: report.passed, requests, evidence: output }))
}
