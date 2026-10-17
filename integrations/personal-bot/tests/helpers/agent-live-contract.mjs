import { stat, readFile, writeFile } from 'node:fs/promises'

const MAX_LIVE_OUTPUT_TOKENS = 16384
const MAX_LIVE_DEADLINE_MS = 1800000

export const agentLivePlan = Object.freeze({ maxRequests: 80, maxOutputTokens: 2048, deadlineMs: 900000,
  syntheticData: true, providerCallsRequireLiveFlag: true, productionWrites: false, physicalCapture: false,
  scenarios: ['natural-language Skill installation', 'natural-language MCP installation', 'saved identity creation',
    'saved child report, completion and learning', 'saved identity restart and active avatar metadata', 'temporary child isolation',
  ],
})

export const liveStopPolicy = Object.freeze({ automaticRetries: 0, automaticWorkflowReplay: false,
  healthChecksPerProviderOperation: 1, explicitTargetedRetriesPerProviderOperation: 1,
  persistentTransientFailure: 'external_blocked only after recorded health and explicit targeted retry evidence',
  neverAutomaticallyRetry: [451], neverExternalBlocked: ['configuration', 'permission', 'authorization', 'resource', 'evidence', 'quality'] })

export function selectLiveEvaluation({ mode, scenario, taskEvaluation = false, hasContinuation = false, inspect = false } = {}) {
  const selected = mode ?? (hasContinuation ? 'learning' : taskEvaluation ? 'targeted' : 'core')
  if (!['core', 'targeted', 'learning'].includes(selected) || (taskEvaluation && (selected !== 'targeted' || (scenario && scenario !== 'saved-report')))
    || (hasContinuation && selected !== 'learning') || (selected === 'learning' && !hasContinuation && !inspect)
    || (selected !== 'targeted' && scenario !== undefined)) throw Error('Invalid live evaluation selection')
  const target = selected === 'targeted' ? scenario ?? 'saved-report' : undefined
  if (target !== undefined && !['saved-report', 'provider-health'].includes(target)) throw Error('Invalid live targeted scenario')
  return { mode: selected, ...(target ? { scenario: target } : {}),
    coverage: selected === 'core' ? 'delivery_core' : selected === 'learning' ? 'learning_benefit' : target === 'saved-report' ? 'targeted_saved_report' : 'provider_health' }
}

/** Parse all scope and resource options before credentials or containers are accessed. */
export function parseLiveOptions(args) {
  const flags = ['--live', '--plan', '--host-relay', '--task-evaluation']
  const prefixes = ['--output=', '--max-requests=', '--max-output-tokens=', '--deadline-ms=', '--continue-from=', '--mode=', '--scenario=']
  if (args.some(arg => !flags.includes(arg) && !prefixes.some(prefix => arg.startsWith(prefix)))
    || [...flags, ...prefixes].some(key => args.filter(arg => flags.includes(key) ? arg === key : arg.startsWith(key)).length > 1)
    || args.includes('--live') === args.includes('--plan')) throw Error('Invalid live command options')
  const value = prefix => args.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
  if (prefixes.some(prefix => value(prefix) === '') || (args.includes('--plan') && (value('--output=') || args.includes('--host-relay')))) throw Error('Invalid live command options')
  const continuationDirectory = value('--continue-from=')
  const selection = selectLiveEvaluation({ mode: value('--mode='), scenario: value('--scenario='), taskEvaluation: args.includes('--task-evaluation'),
    hasContinuation: continuationDirectory !== undefined, inspect: args.includes('--plan') })
  const resources = {}
  for (const [prefix, name] of [['--max-requests=', 'maxRequests'], ['--max-output-tokens=', 'maxOutputTokens'], ['--deadline-ms=', 'deadlineMs']]) {
    const raw = value(prefix)
    if (raw !== undefined) { if (!/^[1-9]\d*$/.test(raw)) throw Error('Invalid live resource option'); resources[name] = Number(raw) }
  }
  return { live: args.includes('--live'), selection, plan: createLivePlan({ ...resources, ...selection }), continuationDirectory,
    output: value('--output='), hostRelay: args.includes('--host-relay') }
}

/** Count generation and Jev requests before dispatch, including correction attempts. */
export function createLiveRequestBudget(maxRequests = agentLivePlan.maxRequests) {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 256) throw Error('Invalid live request limit')
  const calls = []
  let exhausted = false
  return { calls, get exhausted() { return exhausted }, reserve(kind, phase) {
    if (!['generation', 'jev'].includes(kind) || typeof phase !== 'string') throw Error('Invalid live request metadata')
    if (calls.length >= maxRequests) { exhausted = true; throw Error('Live request budget exhausted') }
    const call = { kind, phase, startedAt: new Date().toISOString() }
    calls.push(call)
    return call
  } }
}

export function createLivePlan({ maxRequests = agentLivePlan.maxRequests, deadlineMs = agentLivePlan.deadlineMs, maxOutputTokens = agentLivePlan.maxOutputTokens, mode = 'core', scenario } = {}) {
  createLiveRequestBudget(maxRequests)
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > MAX_LIVE_DEADLINE_MS) throw Error('Invalid live execution limit')
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > MAX_LIVE_OUTPUT_TOKENS) throw Error('Invalid live output limit')
  const selection = selectLiveEvaluation({ mode, scenario, inspect: true })
  const scenarios = mode === 'core' ? agentLivePlan.scenarios : mode === 'learning'
    ? ['three paired fresh-conversation holdouts with and without accepted experience']
    : selection.scenario === 'saved-report' ? ['saved report execution and completion with host-prepared setup']
      : ['fixed tool-free model health', 'fixed Jev typed-choice health']
  return { ...agentLivePlan, ...selection, maxRequests, deadlineMs, maxOutputTokens, scenarios }
}

/** A single unknown or rejected request does not establish persistent external failure. */
export function classifyLiveFailure(calls, { exhausted = false, deadline = false, errorCode } = {}) {
  const call = calls.at(-1)
  const category = exhausted || deadline || ['length', 'aborted'].includes(call?.stopReason) ? 'resource'
    : ['EACCES', 'EPERM'].includes(errorCode) ? 'permission'
      : ['ENOENT', 'ENOTDIR', 'EINVAL', 'ERR_MODULE_NOT_FOUND'].includes(errorCode) ? 'configuration'
        : [401, 403].includes(call?.httpStatus) ? 'authorization'
    : [429, 502, 503, 504].includes(call?.httpStatus) || call?.transportFailure ? 'external_transient'
      : call?.httpStatus >= 400 ? 'provider_rejected' : call?.stopReason === 'error' ? 'provider_response' : 'quality'
  return { category, ...(call ? { provider: call.kind, operation: call.phase } : {}), retryEligible: category === 'external_transient', externalBlocked: false }
}

/** Only a successful, complete entry can establish actual memory retrieval. */
export function fullExperienceReceipt(receipt) {
  return receipt.tool === 'experience_read' && receipt.status === 'succeeded' && !receipt.truncated
}

export function assertLivePairResults(pairs) {
  if (pairs.length !== 3 || pairs.some(pair => !pair.candidate?.passed || pair.candidate.verification !== 'passed')) {
    throw Error('Accepted experience did not support every verified held-out result')
  }
  if (pairs.some(pair => !(pair.candidate.experienceReads > 0))) throw Error('Every candidate must retrieve actual full accepted experience')
}

export function capLiveModelOutput(model, limit = agentLivePlan.maxOutputTokens) {
  const configured = model.maxTokens ?? limit
  if (!Number.isSafeInteger(configured) || configured < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIVE_OUTPUT_TOKENS) throw Error('Invalid live output limit')
  // Anthropic adds reasoning tokens up to model.maxTokens, even when request maxTokens is lower.
  return { ...model, maxTokens: Math.min(configured, limit) }
}

/** Raw models.json entries are partial definitions, not complete SDK stream models. */
export async function normalizeLiveModel({ modelsPath, provider, selected, source, limit = agentLivePlan.maxOutputTokens }) {
  // The pinned SDK exports ModelRuntime publicly; its memory-only stores are adjacent modules.
  // Load them only for --live, so --plan never initializes models or credentials.
  const entry = import.meta.resolve('@earendil-works/pi-coding-agent')
  const [{ ModelRuntime }, { AuthStorage }, { InMemoryCodingAgentModelsStore }] = await Promise.all([
    import('@earendil-works/pi-coding-agent'), import(new URL('./core/auth-storage.js', entry).href),
    import(new URL('./core/models-store.js', entry).href),
  ])
  const runtime = await ModelRuntime.create({ modelsPath, credentials: AuthStorage.inMemory(),
    modelsStore: new InMemoryCodingAgentModelsStore(), refreshOnCreate: false, allowModelNetwork: false })
  const model = runtime.getModel(provider, selected.id)
  if (!model || model.provider !== provider || model.id !== selected.id || model.api !== (selected.api ?? source.api)
    || model.baseUrl !== (selected.baseUrl ?? source.baseUrl)) throw Error('Configured live model is unavailable or changed')
  // Model headers were carried by the raw definition before normalization. Keep that override.
  return { model: capLiveModelOutput({ ...model, ...(selected.headers ? { headers: selected.headers } : {}) }, limit),
    pricingKnown: ['input', 'output', 'cacheRead', 'cacheWrite'].every(key => Number.isFinite(selected.cost?.[key]) && selected.cost[key] >= 0) }
}

function validateGenerationOutput(body, limit) {
  try {
    const payload = JSON.parse(body)
    const limits = ['max_tokens', 'max_output_tokens', 'max_completion_tokens'].filter(key => Object.hasOwn(payload, key)).map(key => payload[key])
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIVE_OUTPUT_TOKENS || !limits.length
      || limits.some(value => !Number.isSafeInteger(value) || value < 1 || value > limit)
      || (payload.n !== undefined && payload.n !== 1)) throw Error()
  } catch { throw Error('Invalid live generation output limit') }
}

export function createBudgetedFetch({ budget, kind, phase, signal, maxOutputTokens, fetchImpl = fetch, onCall = () => {} }) {
  return async (input, options = {}) => {
    signal?.throwIfAborted()
    if (kind === 'generation' && maxOutputTokens !== undefined) validateGenerationOutput(options.body, maxOutputTokens)
    const call = budget.reserve(kind, phase()), started = performance.now()
    onCall(call)
    const activeSignal = signal && options.signal ? AbortSignal.any([signal, options.signal]) : signal ?? options.signal
    try {
      const response = await fetchImpl(input, { ...options, signal: activeSignal, redirect: 'error' })
      call.httpStatus = response.status
      return response
    } catch (error) {
      call.failed = true
      const code = error?.cause?.code ?? error?.code
      if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code) && !activeSignal?.aborted) call.transportFailure = code
      throw error
    }
    finally { call.elapsedMs = Math.round(performance.now() - started) }
  }
}

/** Retain usage metadata without retaining generated content. */
export function recordLiveGenerationUsage(call, message) {
  if (!call) return
  call.stopReason = message.stopReason
  call.inputTokens = message.usage?.input
  call.outputTokens = message.usage?.output
  const reasoning = message.usage?.reasoning
  if (Number.isFinite(reasoning) && reasoning >= 0) call.reasoningTokens = reasoning
}

/** One new handle or one exact continuation is a fresh host admission. */
export function selectLiveChildAdmission(before, tasks, identity = null) {
  const changed = tasks.filter(task => !before.has(task.taskId) || before.get(task.taskId) !== task.turn)
  if (changed.length !== 1) throw Error('Exactly one fresh child admission is required')
  const task = changed[0], continued = before.has(task.taskId)
  const admission = { taskId: task.taskId, turn: continued ? before.get(task.taskId) + 1 : 1,
    identity: identity ? { id: identity.id, revision: identity.revision } : null, continued }
  assertLiveChildTurn(admission, task)
  return admission
}

export function assertLiveChildTurn(admission, task) {
  if (task?.taskId !== admission.taskId || task?.turn !== admission.turn
    || (admission.identity ? task.identity?.id !== admission.identity.id || task.identity?.revision !== admission.identity.revision : task.identity !== null)) {
    throw Error('Child task turn or identity changed')
  }
}

export function learningComparison(pairs) {
  const baseline = pairs.filter(pair => pair.baseline.passed).length
  const candidate = pairs.filter(pair => pair.candidate.passed).length
  return { cases: pairs.length, baseline, candidate, difference: candidate - baseline,
    conclusion: candidate > baseline ? 'Improvement observed on these synthetic cases only.' : 'No improvement established on these synthetic cases.',
    generalLearningBenefit: 'not_established' }
}

export function finalizeAgentAcceptance(result, { exitCode, sourceUnchanged, sourceFailure = false, forcedCleanup = false }) {
  const passed = exitCode === 0 && result.functionalPassed === true && result.cleanupPassed === true
    && result.hostValidationRequired === true && sourceUnchanged === true && !sourceFailure && !forcedCleanup
  return { ...result, passed, status: passed ? 'passed' : 'failed', sourceUnchanged: sourceUnchanged === true,
    deliveryCorePassed: passed && result.evaluation?.mode === 'core',
    learningEvaluationPassed: passed && result.evaluation?.mode === 'learning',
    targetedPassed: passed && result.evaluation?.mode === 'targeted',
    ...(sourceFailure ? { hostFailure: 'source_fingerprint_unavailable' } : {}),
    fingerprintScope: 'Personal Bot source, referenced Shell JavaScript/JSON, acceptance artifacts, and package lockfiles; dependency bytes are outside this sample.' }
}

export async function finalizeAgentAcceptanceFile(file, { exitCode, fingerprints, fingerprint, forcedCleanup }) {
  if ((await stat(file)).size > 262144) throw Error('Oversized verification report')
  const result = JSON.parse(await readFile(file, 'utf8'))
  let sourceUnchanged = false, sourceFailure = false
  try { sourceUnchanged = JSON.stringify(await fingerprint()) === JSON.stringify(fingerprints) } catch { sourceFailure = true }
  const final = finalizeAgentAcceptance(result, { exitCode, sourceUnchanged, sourceFailure, forcedCleanup })
  await writeFile(file, JSON.stringify(final, null, 2), { mode: 0o600 })
  return final
}
