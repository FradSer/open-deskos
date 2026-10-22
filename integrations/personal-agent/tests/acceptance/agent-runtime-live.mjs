import { parsePluginInput } from '../../src/agent-plugins/prompt.mjs'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { generationDeadlineMs } from '../../src/proactive-generation-session.mjs'
import { createPersonalAgent } from '../../src/agent.mjs'
import { createJevIntentRouter } from '../../src/intent-routing.mjs'
import { openAgentCatalog } from '../../src/agent-catalog/catalog.mjs'
import { createExperienceStore } from '../../src/agent-plugins/experience.mjs'
import { liveJevResponse } from '../fixtures/live-jev-response.mjs'
import { createJevClient } from '../../src/jev-client.mjs'
import { reportScore, reportData, reportSkill } from '../fixtures/agent-learning-reports.mjs'
import { capLiveModelOutput, fullExperienceReceipt, assertLivePairResults, createLivePlan, selectLiveEvaluation, classifyLiveFailure, liveStopPolicy, recordLiveGenerationUsage, selectLiveChildAdmission, assertLiveChildTurn, createLiveRequestBudget, createBudgetedFetch, learningComparison } from '../helpers/agent-live-contract.mjs'
import { pluginEvidenceMetadata, toolExecutionMetadata } from '../helpers/agent-live-plugin-evidence.mjs'

let input = ''
for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 262144) throw Error('Live configuration exceeds its limit') }
const credentials = JSON.parse(input)
input = ''
const evaluation = selectLiveEvaluation({ mode: credentials.evaluation?.mode ?? credentials.plan?.mode, scenario: credentials.evaluation?.scenario ?? credentials.plan?.scenario, taskEvaluation: credentials.taskEvaluation === true, hasContinuation: Boolean(credentials.continuation) })
const plan = createLivePlan({ ...credentials.plan, ...evaluation })
const pluginTimeoutMs = generationDeadlineMs(credentials.pluginTimeoutMs)
const offline = credentials.offlineFixture === true
const fixture = offline ? await import('../helpers/agent-live-offline.mjs') : undefined
const budget = createLiveRequestBudget(plan.maxRequests)
const report = { candidate: credentials.candidate, fingerprints: credentials.fingerprints, startedAt: new Date().toISOString(),
  model: { provider: credentials.provider, id: credentials.model.id, api: credentials.model.api, pricingKnown: credentials.pricingKnown === true, actualCharge: 'not_established' },
  fixtureProtocol: 'shared_method_supplied_data_v2',
  limits: { pluginTimeoutMs, maxRequests: plan.maxRequests, maxOutputTokens: plan.maxOutputTokens, deadlineMs: plan.deadlineMs }, transport: credentials.transport ?? 'direct',
  platform: process.platform, arch: process.arch, syntheticData: true, realModel: false, realJev: false, offlineFixture: offline,
  productionWrites: false, physicalCapture: false, renderedUI: false, calls: budget.calls, scenarios: [], pairs: [], routes: [], taskChecks: [], pluginChecks: [], toolChecks: [],
  coverage: evaluation.coverage, evaluation, stopPolicy: liveStopPolicy, learning: { status: 'not_run', generalLearningBenefit: 'not_established' },
  setup: { method: evaluation.mode === 'core' ? 'natural_language' : evaluation.mode === 'learning' ? 'accepted_experience' : evaluation.scenario === 'provider-health' ? 'none' : 'host_fixture', naturalLanguageVerified: false },
  ...(credentials.continuation ? { experienceSource: credentials.continuation.source } : {}) }
const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), plan.deadlineMs)
const bots = new Set()
let phase = 'initializing', retrievals = 0
const retrieved = new Set()
const base = offline ? credentials.fixtureDirectory : '/tmp/agent-runtime-live', candidates = join(base, 'candidates')
process.env.PI_CODING_AGENT_DIR = join(base, 'agent-settings')
const plugins = ['experience', 'completion', 'learning', 'catalog', 'mcp', 'subagents']
const env = { ODK_AGENT_PLUGIN_TIMEOUT_MS: String(pluginTimeoutMs), ODK_AGENT_PACKAGE_CANDIDATES: candidates, TYPESAFE_API_KEY: credentials.jevKey }
const manifest = { schemaVersion: 1, kind: 'mcp', id: 'learning-reports', name: 'Synthetic report connector', transport: {
  type: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('../fixtures/agent-learning-server.mjs', import.meta.url))],
} }
const skill = reportSkill
const modelName = `${credentials.provider}/${credentials.model.id}`
const mark = (name, details = {}) => report.scenarios.push({ name, passed: true, ...details })
function pluginInput(context) {
  const all = JSON.stringify(context.messages)
  if (!all.includes('Check the current Personal Agent task after') && !all.includes('Extract reusable procedural lessons only')) return undefined
  const user = context.messages.findLast(message => message.role === 'user')
  const text = typeof user?.content === 'string' ? user.content : user?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? ''
  try { return parsePluginInput(text.slice('Personal Agent request:\n'.length)) } catch { return undefined }
}
function recordReceipts(context) {
  if (!JSON.stringify(context.messages).includes('Check the current Personal Agent task after')) return
  const user = context.messages.findLast(message => message.role === 'user')
  const text = typeof user?.content === 'string' ? user.content : user?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? ''
  try {
    const value = parsePluginInput(text.slice('Personal Agent request:\n'.length))
    for (const receipt of value.receipts.filter(fullExperienceReceipt)) {
      const key = `${phase}:${receipt.id}:${receipt.text}`
      if (!retrieved.has(key)) { retrieved.add(key); retrievals++ }
    }
  } catch { /* Receipt assertions remain owned by the runtime. */ }
}
async function createRuntime() {
  const runtime = offline ? fixture.createOfflineAcceptanceRuntime(() => phase) : await ModelRuntime.create({ authPath: join(base, 'agent-settings', 'auth.json'), modelsPath: null, refreshOnCreate: false })
  runtime.registerProvider(credentials.provider, { ...credentials.providerConfig, models: [credentials.model] })
  return new Proxy(runtime, { get(target, key) {
    if (key === 'streamSimple') return (model, context, options) => {
      controller.signal.throwIfAborted()
      const calls = []
      const toolCheck = toolExecutionMetadata(context)
      if (toolCheck && report.toolChecks.length < 128) report.toolChecks.push({ phase, ...toolCheck })
      if (offline) calls.push(budget.reserve('generation', phase))
      recordReceipts(context)
      const judgment = pluginInput(context), callPhase = phase
      const effectiveModel = capLiveModelOutput(model, plan.maxOutputTokens)
      const effectiveMaxTokens = effectiveModel.maxTokens
      const stream = target.streamSimple(effectiveModel, context, { ...options, maxTokens: effectiveMaxTokens, maxRetries: 0,
        fetch: createBudgetedFetch({ budget, kind: 'generation', phase: () => phase, signal: controller.signal, maxOutputTokens: effectiveMaxTokens, onCall: call => calls.push(call) }) })
      void stream.result().then(message => {
        const call = calls.at(-1)
        recordLiveGenerationUsage(call, message)
        if (judgment) {
          try { report.pluginChecks.push({ phase: callPhase, ...pluginEvidenceMetadata(judgment, message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) }) }
          catch { report.pluginChecks.push({ phase: callPhase, diagnosticUnavailable: true }) }
        }
      }).catch(() => { for (const call of calls) call.failed = true })
      return stream
    }
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}
async function newBot(stateDir, extra = {}) {
  const bot = await createPersonalAgent({ stateDir, model: modelName, signal: controller.signal, env,
    personal: { profile: 'personal', skillPaths: [], memoryFile: join(stateDir, 'notes.json'), agentPlugins: { enabled: plugins } }, ...extra }, {
    createRuntime,
    createIntentRouter: () => {
      const route = offline ? async () => { budget.reserve('jev', phase); return { intent: phase.startsWith('install-') ? 'package_manage' : phase === 'save-identity' ? 'agent_identity' : 'agent_work' } } : createJevIntentRouter({ env, fetchImpl: async (url, options) => {
      controller.signal.throwIfAborted()
      let call
      const request = createBudgetedFetch({ budget, kind: 'jev', phase: () => phase, signal: controller.signal, onCall: value => { call = value } })
      const captured = await liveJevResponse(await request(url, options), Object.keys(JSON.parse(options.body).questions))
      Object.assign(call, captured.metadata)
      return captured.response
      } })
      return async input => {
        try {
          const mcpCapabilities = input.tools.filter(name => name.startsWith('agent_mcp_')).length
          if (phase.startsWith('holdout-') || credentials.continuation) assert.equal(mcpCapabilities, 0, 'Supplied-data evaluation cannot discover another report')
          const decision = await route(input)
          report.routes.push({ phase, intent: decision.intent, choice: decision.choice, confidence: decision.confidence, threshold: decision.threshold, mcpCapabilities })
          return decision
        } catch (error) { report.routes.push({ phase, invalid: true }); throw error }
      }
    },
  })
  bots.add(bot)
  return bot
}
async function close(bot) { await bot.close(); bots.delete(bot) }
async function delegated(bot, text, id, saved, fixtureAdmission = false) {
  const identity = saved ? bot.agentTasks.identities().find(identity => identity.id === 'reporter') : null
  assert(!saved || identity, 'Requested saved identity is unavailable')
  const before = new Map(bot.agentTasks.list().tasks.map(task => [task.taskId, task.turn]))
  if (fixtureAdmission) bot.agentTasks.start({ request: text, ...(saved ? { identityId: 'reporter' } : { role: 'Analyze the supplied synthetic report through its applicable procedure.' }) })
  else await bot.prompt(text)
  const tasks = bot.agentTasks.list().tasks.filter(task => !before.has(task.taskId) || before.get(task.taskId) !== task.turn)
  report.taskChecks.push({ phase, admissions: tasks.length, fixtureAdmission, coordinatorInference: !fixtureAdmission })
  const admission = selectLiveChildAdmission(before, tasks, identity)
  const task = await bot.agentTasks.wait(admission.taskId)
  assertLiveChildTurn(admission, task)
  Object.assign(report.taskChecks.at(-1), { turn: task.turn, continued: admission.continued, state: task.state, verification: task.verification.status, learning: task.learning, score: reportScore(id, task.response) })
  assert.equal(task.identity?.id ?? null, saved ? 'reporter' : null)
  assert.equal(task.state, 'finished')
  assert.equal(task.verification.status, 'passed')
  const score = reportScore(id, task.response)
  assert.equal(score.passed, true, 'Host report assertions rejected the child answer')
  return { task, score }
}
async function runProviderHealth() {
  await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true, mode: 0o700 })
  report.health = {}
  const failures = []
  phase = 'provider-health:generation'
  try {
    const runtime = await createRuntime()
    const model = runtime.getModel(credentials.provider, credentials.model.id)
    const stream = runtime.streamSimple(model, { messages: [{ role: 'user', content: 'Reply READY for this isolated synthetic health check.', timestamp: Date.now() }] },
      { apiKey: credentials.providerConfig.apiKey, maxRetries: 0, signal: controller.signal })
    const message = await stream.result()
    report.health.generation = { available: message.stopReason === 'stop' && message.content.some(part => part.type === 'text' && part.text.trim()) }
  } catch (error) { report.health.generation = { available: false, failure: classifyLiveFailure(budget.calls.filter(call => call.phase === phase), { exhausted: budget.exhausted, deadline: controller.signal.aborted, errorCode: error?.code }) } }
  if (!report.health.generation.available) {
    failures.push(phase)
    report.health.generation.failure ??= classifyLiveFailure(budget.calls.filter(call => call.phase === phase))
  }
  phase = 'provider-health:jev'
  try {
    if (offline) { budget.reserve('jev', phase); report.health.jev = { available: true } }
    else {
      const request = createJevClient({ env, fetchImpl: async (url, options) => {
        let call
        const fetch = createBudgetedFetch({ budget, kind: 'jev', phase: () => phase, signal: controller.signal, onCall: value => { call = value } })
        const captured = await liveJevResponse(await fetch(url, options), ['health'])
        Object.assign(call, captured.metadata)
        return captured.response
      } })
      const result = await request({ signal: controller.signal, state: { status: 'ready' }, questions: { health: { type: 'choice',
        criteria: { ready: 'The synthetic status is ready.', waiting: 'The synthetic status is waiting.' }, instructions: 'Choose the supplied fixed synthetic status.' } } })
      report.health.jev = { available: result.answers.health?.type === 'choice' && ['ready', 'waiting'].includes(result.answers.health.choice) }
    }
  } catch (error) { report.health.jev = { available: false, failure: classifyLiveFailure(budget.calls.filter(call => call.phase === phase), { exhausted: budget.exhausted, deadline: controller.signal.aborted, errorCode: error?.code }) } }
  if (!report.health.jev.available) {
    failures.push(phase)
    report.health.jev.failure ??= classifyLiveFailure(budget.calls.filter(call => call.phase === phase))
  }
  if (failures.length) { phase = failures[0]; throw Error('Fixed provider health was not established') }
  mark('provider-health', { generation: true, jev: true })
}
async function run() {
  if (evaluation.scenario === 'provider-health') return runProviderHealth()
  await mkdir(join(candidates, 'report-helper'), { recursive: true, mode: 0o700 })
  await mkdir(join(candidates, 'learning-reports'), { mode: 0o700 })
  await mkdir(process.env.PI_CODING_AGENT_DIR, { mode: 0o700 })
  await writeFile(join(process.env.PI_CODING_AGENT_DIR, 'settings.json'), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }), { mode: 0o600 })
  await writeFile(join(candidates, 'report-helper', 'SKILL.md'), skill, { mode: 0o600 })
  await writeFile(join(candidates, 'learning-reports', 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 })
  if (credentials.continuation) {
    const imported = join(base, 'imported', 'experience.json')
    await mkdir(join(base, 'imported'), { recursive: true, mode: 0o700 })
    await writeFile(imported, JSON.stringify(credentials.continuation.experience), { mode: 0o600 })
    assert(createExperienceStore(imported).load().entries.length > 0)
    await runPairs(imported)
    return
  }
  const stateDir = join(base, 'resident'), activity = []
  const config = { onAgentUpdate: tasks => activity.push(...tasks.map(task => ({ state: task.state, identity: task.identity }))) }
  const catalog = await openAgentCatalog(join(stateDir, 'personal-agent', 'packages'))
  if (evaluation.mode === 'targeted') {
    await catalog.installSkill(join(candidates, 'report-helper'))
    await catalog.installMcp(manifest)
  }
  const botConfig = evaluation.mode === 'targeted' ? { ...config, personal: { profile: 'personal', skillPaths: [], memoryFile: join(stateDir, 'notes.json'), agentPlugins: { enabled: plugins, autoLearn: false } } } : config
  let bot = await newBot(stateDir, botConfig)
  if (evaluation.mode === 'targeted') {
    bot.agentTasks.saveIdentity({ id: 'reporter', name: 'Reporter', avatar: 'book', role: 'Use the report-helper Skill to analyze reports and return RESULT=<number>.' })
  } else {
    phase = 'install-skill'
    await bot.prompt('请安装已准备好的 report-helper Skill。')
    assert.equal((await catalog.package('report-helper')).snapshot.kind, 'skill'); mark(phase)
    phase = 'install-mcp'
    await bot.prompt('请安装已准备好的 learning-reports MCP 连接器。')
    assert.equal((await catalog.package('learning-reports')).snapshot.kind, 'mcp'); mark(phase)
    phase = 'save-identity'
    await bot.prompt('创建固化子代理，id 为 reporter，名称 Reporter，头像 book。职责：使用 report-helper Skill 分析指定报告，以 RESULT=<number> 报告结果。')
    assert.equal(bot.agentTasks.identities().find(identity => identity.id === 'reporter')?.avatar, 'book'); mark(phase)
    report.setup.naturalLanguageVerified = !offline
  }
  phase = 'saved-training'
  const training = await delegated(bot, '让固化子代理 reporter 使用 learning-reports 分析 training 报告，并以 RESULT=<number> 返回结果。', 'training', true)
  if (evaluation.mode === 'targeted') { mark(phase, { score: training.score }); await close(bot); return }
  assert.equal(training.task.learning, 'applied')
  assert(activity.some(task => task.state === 'running' && task.identity?.id === 'reporter' && task.identity.avatar === 'book'))
  const experience = join(stateDir, 'personal-agent', 'children', 'homes', 'saved', 'reporter', 'personal-agent', 'experience.json')
  const acceptedExperience = createExperienceStore(experience).load()
  assert(acceptedExperience.entries.length > 0)
  const acceptedContent = JSON.stringify(acceptedExperience)
  await writeFile(offline ? join(base, 'accepted-experience.json') : '/evidence/accepted-experience.json', acceptedContent, { mode: 0o600 })
  report.acceptedExperience = { file: 'accepted-experience.json', entries: acceptedExperience.entries.length, sha256: createHash('sha256').update(acceptedContent).digest('hex') }
  mark(phase, { score: training.score, activeAvatarMetadata: true })
  await close(bot)
  phase = 'saved-restart'
  bot = await newBot(stateDir, config)
  const beforeRestartRetrieval = retrievals
  const restarted = await delegated(bot, '让固化子代理 reporter 使用 learning-reports 分析 restart 报告，并以 RESULT=<number> 返回结果。', 'restart', true)
  assert(retrievals > beforeRestartRetrieval, 'A restarted saved child must retrieve actual full accepted experience')
  mark(phase, { score: restarted.score, experienceReads: retrievals - beforeRestartRetrieval })
  report.taskChecks.at(-1).experienceReads = retrievals - beforeRestartRetrieval
  phase = 'temporary-child'
  const temporary = await delegated(bot, '请用临时子代理分析 learning-reports 的 temporary 报告，以 RESULT=<number> 返回结果。不要使用或创建固化身份。', 'temporary', false)
  mark(phase, { score: temporary.score })
  await close(bot)
}
function suppliedRequest(id) {
  return `Use the report-helper Skill to analyze this supplied current synthetic report. It uses the same procedure as the training report. If the procedure is absent, retrieve matching accepted experience; do not invent a missing method. Do not read other reports. Return exactly one RESULT=<number> marker when supported. Supplied current synthetic report (JSON): ${JSON.stringify(reportData(id))}`
}
async function runPairs(experience) {
  report.learning = { status: 'in_progress', generalLearningBenefit: 'not_established' }
  // Fresh conversations have identical packages and role. Only accepted experience differs.
  report.pairProtocol = { input: 'supplied_synthetic_data', mcpEnabled: false, autoLearn: false, conversationHistory: false, difference: 'accepted_experience_only' }
  const pairedCatalog = await openAgentCatalog(join(base, 'paired-packages'))
  await pairedCatalog.installSkill(join(candidates, 'report-helper')); await pairedCatalog.installMcp(manifest)
  for (const id of ['holdout-1', 'holdout-2', 'holdout-3']) {
    const pair = { id, baseline: undefined, candidate: undefined }
    report.pairs.push(pair)
    for (const variant of ['baseline', 'candidate']) {
      phase = `${id}:${variant}`
      const home = join(base, 'pairs', id, randomUUID())
      await mkdir(join(home, 'personal-agent'), { recursive: true, mode: 0o700 })
      if (variant === 'candidate') await copyFile(experience, join(home, 'personal-agent', 'experience.json'))
      const beforeRetrieval = retrievals
      const worker = await newBot(home, { childAgent: { role: 'Analyze the requested synthetic report. Return exactly one RESULT=<number> marker.', catalogDirectory: join(base, 'paired-packages') },
        personal: { profile: 'personal', skillPaths: [], memoryFile: join(home, 'notes.json'), agentPlugins: { enabled: plugins.filter(id => id !== 'mcp'), autoLearn: false } } })
      const answer = await worker.prompt(suppliedRequest(id))
      pair[variant] = { ...reportScore(id, answer), experienceReads: retrievals - beforeRetrieval, verification: worker.lastTaskResult?.verification.status }
      await close(worker)
    }
  }
  assertLivePairResults(report.pairs)
  report.learning = { status: 'completed', ...learningComparison(report.pairs) }
  mark('paired-heldout', report.learning)
}
try {
  await Promise.race([run(), new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(Error('Live acceptance deadline exceeded')), { once: true }))])
  report.passed = true
} catch (error) {
  report.passed = false
  report.failure = { phase, reason: budget.exhausted ? 'request_limit' : controller.signal.aborted ? 'deadline' : 'acceptance_not_proven',
    ...(report.health?.[phase.split(':')[1]]?.failure ?? classifyLiveFailure(budget.calls.filter(call => call.phase === phase), { exhausted: budget.exhausted, deadline: controller.signal.aborted, errorCode: error?.code })) }
  if (offline) report.failure.fixtureError = String(error.message)
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  controller.abort()
  const closed = await Promise.allSettled([...bots].map(bot => bot.close()))
  report.cleanupPassed = closed.every(result => result.status === 'fulfilled')
  if (!report.cleanupPassed) { report.passed = false; process.exitCode = 1 }
  report.completedAt = new Date().toISOString()
  report.externalRequests = offline ? 0 : budget.calls.length
  report.truncatedGenerationCalls = budget.calls.filter(call => call.kind === 'generation' && call.stopReason === 'length').length
  report.realModel = !offline && budget.calls.some(call => call.kind === 'generation')
  report.realJev = !offline && budget.calls.some(call => call.kind === 'jev')
  report.functionalPassed = report.passed === true
  report.deliveryCorePassed = evaluation.mode === 'core' && report.functionalPassed && credentials.hostValidationRequired !== true
  report.learningEvaluationPassed = evaluation.mode === 'learning' && report.functionalPassed && credentials.hostValidationRequired !== true
  report.targetedPassed = evaluation.mode === 'targeted' && report.functionalPassed && credentials.hostValidationRequired !== true
  if (report.learning.status === 'in_progress') report.learning.status = 'incomplete'
  report.hostValidationRequired = credentials.hostValidationRequired === true
  report.status = !report.functionalPassed ? 'failed' : report.hostValidationRequired ? 'pending_host_validation' : 'passed'
  if (report.hostValidationRequired) report.passed = false
  await writeFile(offline ? join(base, 'report.json') : '/evidence/report.json', JSON.stringify(report, null, 2), { mode: 0o600 })
}
