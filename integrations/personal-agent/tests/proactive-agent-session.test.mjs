// Regression: the generation session's scoped tools must be visible and executable
// through the real ephemeral Durable session, not merely registered in the registry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDurableAgentSession } from '../src/durable-agent-session.mjs'
import { createProactiveInvestigationTools } from '../src/proactive-investigation.mjs'
import { generationSystemPrompt } from '../src/openui-contract.mjs'
import { sessionAdapter } from '../src/agent.mjs'
import { EMPTY_DOCUMENT } from './openui-fixtures.test.mjs'
import { fixtureModel, assistant, visibleTools } from './helpers/pi-fixture.mjs'
import { DefaultResourceLoader, SettingsManager, SessionManager, getAgentDir } from '@earendil-works/pi-coding-agent'

const stamp = '2026-11-03T09:40:00.000Z'
const action = { id: 'open', label: 'Open the plan' }
const topic = { id: 'commute-anomaly', goal: 'Tell me when the commute departs from its normal duration.',
  urgent: false, delivery: 'immediate', actions: [action],
  evidence: [['minutes', 52], ['baselineMinutes', 24], ['delayMinutes', 28]].map(([field, value], i) =>
    ({ id: `e${i}`, readingId: 'commute.traffic', field, value, state: 'live', measuredAt: stamp })) }
const input = { trigger: { kind: 'heartbeat', readingIds: [] },
  context: { now: stamp, local: { date: '2026-11-03', time: '09:40' }, quiet: false, busy: false },
  topics: [topic], recent: [], maxCandidates: 8 }

async function run(scripted) {
  const dir = await mkdtemp(join(tmpdir(), 'odk-agent-session-'))
  const cwd = join(dir, 'cwd')
  await mkdir(cwd, { recursive: true })
  const reads = []
  const investigation = createProactiveInvestigationTools({ input,
    judge: async ({ candidates }) => ({ model: 'jev-fixture', answers: Object.fromEntries(candidates.map(c => [c.id,
      { probability: 0.9, groundingProbability: 0.9, threshold: 0.8 }])) }),
    read: async id => { reads.push(id); return { reading: { id, state: 'live', value: { minutes: 52, note: '雨势增强' } } } } })
  const contexts = []
  const modelRuntime = {
    getAvailable: async () => [fixtureModel], getAvailableSnapshot: () => [fixtureModel],
    hasConfiguredAuth: () => true, getError: () => undefined, getModel: () => fixtureModel,
    getAuth: async () => ({ auth: { apiKey: 'offline-fixture' } }),
    streamSimple: (_model, context) => {
      contexts.push(context)
      const result = Promise.resolve(scripted(context))
      return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
    },
  }
  const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), noExtensions: true, noSkills: true, noPromptTemplates: true,
    settingsManager: SettingsManager.inMemory({}), agentsFilesOverride: () => ({ agentsFiles: [] }),
    appendSystemPromptOverride: () => [], systemPromptOverride: () => generationSystemPrompt })
  await loader.reload()
  let session
  try {
    const created = await createDurableAgentSession({ cwd, resourceLoader: loader, modelRuntime, model: fixtureModel,
      tools: [], customTools: investigation.tools, ephemeral: true,
      settingsManager: SettingsManager.inMemory({ defaultTools: [], retry: { enabled: false }, compaction: { enabled: false } }),
      sessionManager: SessionManager.inMemory(cwd) })
    session = created.session
    const text = await sessionAdapter(session).prompt(JSON.stringify(input))
    const visible = contexts.flatMap(context => visibleTools(context).map(tool => tool.name))
    const results = contexts.flatMap(context => context.messages.filter(message => message.role === 'toolResult')
      .map(message => ({ toolName: message.toolName, isError: message.isError })))
    return { text, visible, results, reads, activeNames: session.getActiveToolNames() }
  } finally {
    try { await session?.dispose() } catch {}
    await rm(dir, { recursive: true, force: true })
  }
}

test('an ephemeral generation session exposes both scoped tools to the model', async () => {
  const { visible, activeNames } = await run(() => assistant(EMPTY_DOCUMENT))
  assert.deepEqual(activeNames.sort(), ['proactive_judge', 'proactive_read'])
  assert.ok(visible.includes('proactive_read'), 'proactive_read is visible to the model')
  assert.ok(visible.includes('proactive_judge'), 'proactive_judge is visible to the model')
})

test('a model tool call reaches proactive_read and its result returns without error', async () => {
  const { results, reads } = await run(context => {
    const last = context.messages.at(-1)
    if (last?.role === 'toolResult') return assistant(EMPTY_DOCUMENT)
    return assistant([{ type: 'toolCall', id: 'read-1', name: 'proactive_read',
      arguments: { readingId: 'commute.traffic' } }], 'toolUse')
  })
  assert.deepEqual(reads, ['commute.traffic'], 'the scoped reader actually ran')
  const read = results.find(result => result.toolName === 'proactive_read')
  assert.ok(read, 'the SDK produced a tool result')
  assert.equal(read.isError, false, 'the tool call was accepted, not refused')
})

test('a model tool call reaches proactive_judge and returns typed judgments', async () => {
  const { results } = await run(context => {
    const last = context.messages.at(-1)
    if (last?.role === 'toolResult') return assistant(EMPTY_DOCUMENT)
    const args = { suggestions: [{ topicId: 'commute-anomaly', advice: '通勤延误 28 分钟。',
      actionId: 'open', evidenceIds: ['e0', 'e1', 'e2'] }] }
    return assistant([{ type: 'toolCall', id: 'judge-1', name: 'proactive_judge', arguments: args }], 'toolUse')
  })
  const judged = results.find(result => result.toolName === 'proactive_judge')
  assert.ok(judged, 'the SDK produced a judgment tool result')
  assert.equal(judged.isError, false, 'the judgment call was accepted, not refused')
})
