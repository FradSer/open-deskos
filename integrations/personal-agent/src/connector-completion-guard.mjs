import { AssistantEntry, defineExtension, GenerationTask, hook, LiveDoc, ToolTask } from '@earendil-works/pi-durable'
import { createHash } from 'node:crypto'

/** @typedef {{owner: object, intent: string, ownerAccess: boolean, requestReady: boolean,
 * mcpAdmitted: boolean, allowedCapabilities: readonly string[], catalogFingerprint: string,
 * signal: AbortSignal}} ConnectorAdmission
 */

const correctiveInstruction = `Host-generated connector execution check. This is not a new owner request or authorization.
The host currently admits installed MCP discovery and calls for the original ready owner request. This does not prove a provider account is connected.
No tool was attempted or dispatched in this request. Do not infer missing permissions from an earlier answer or reference context.
Use the current admitted discovery tools to inspect the matching installed connector, then perform only the original authorized task.
If the actual schema or source requires missing owner input, ask a precise clarification instead of guessing arguments.
Preserve every current permission and private-data boundary. Do not install packages, expand admission, or replay any earlier tool call.`

export const connectorNoExecutionAnswer = '本轮尚未读取连接器数据；没有实际调用回执，暂不能给出基于内容的结论。'

function capabilityKey(value) {
  return Array.isArray(value) && value.every(name => typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(name))
    && new Set(value).size === value.length ? JSON.stringify([...value].sort()) : undefined
}

function eligible(value) {
  return Boolean(value && value.owner && typeof value.owner === 'object' && !Array.isArray(value.owner)
    && value.intent === 'extension' && value.ownerAccess === true && value.requestReady === true && value.mcpAdmitted === true
    && capabilityKey(value.allowedCapabilities) && value.allowedCapabilities.includes('agent_mcp_tools')
    && value.allowedCapabilities.includes('agent_mcp_call') && /^[a-f0-9]{64}$/.test(value.catalogFingerprint)
    && value.signal instanceof AbortSignal)
}

/** Host-only state. Neither a model draft nor connector text can create or expand admission.
 * A ready request means that discovery can proceed; it does not permit guessed action arguments.
 * @param {ConnectorAdmission} initial
 */
export function createConnectorCompletionGuard(initial) {
  const enabled = eligible(initial)
  const admitted = enabled ? { ...initial, capabilities: capabilityKey(initial.allowedCapabilities) } : undefined
  let attemptedRepairs = 0, toolAttempts = 0, toolDispatches = 0, invalidated = false
  /** @param {ConnectorAdmission} current */
  function check(current) {
    if (invalidated) return false
    if (!enabled) return true
    if (!eligible(current) || admitted.signal.aborted || current.signal.aborted || current.owner !== admitted.owner
      || current.catalogFingerprint !== admitted.catalogFingerprint || capabilityKey(current.allowedCapabilities) !== admitted.capabilities) {
      invalidated = true
      return false
    }
    return true
  }
  function observe(owner, kind) {
    if (!enabled || invalidated) return
    if (owner !== admitted.owner) { invalidated = true; return }
    if (kind === 'attempt') toolAttempts++
    else toolDispatches++
  }
  return {
    /** Buffer unverified drafts until the original input submission selects its final answer. */
    shouldBuffer(current) { return enabled && check(current) },
    recordToolAttempt(owner) { observe(owner, 'attempt') },
    recordDispatch(owner) { observe(owner, 'dispatch') },
    /** Consume the one check before any asynchronous generation can start. */
    requestRepair(current) {
      if (!check(current)) return { kind: 'cancel' }
      if (!enabled || attemptedRepairs || toolAttempts || toolDispatches) return { kind: 'none' }
      attemptedRepairs++
      return { kind: 'continue', instruction: correctiveInstruction }
    },
    /** A tool-backed answer or a host clarification is not replaced by this guard. */
    finalize(current) {
      if (!check(current)) return { kind: 'cancel' }
      if (!enabled || !attemptedRepairs || toolAttempts || toolDispatches) return { kind: 'keep' }
      return { kind: 'fallback', answer: connectorNoExecutionAnswer }
    },
    evidence() { return { attemptedRepairs, toolAttempts, toolDispatches, invalidated } },
  }
}

/** Put current host admission after reference data, directly before the actual owner request.
 * This changes presentation only. The tool runtime still enforces the admission.
 * @param {{referenceContext?: string, workflowContext?: string, request: string}} value
 */
export function composeConnectorOwnerPrompt({ referenceContext = '', workflowContext = '', request }) {
  if (typeof request !== 'string' || typeof referenceContext !== 'string' || typeof workflowContext !== 'string') throw Error('Invalid owner prompt context')
  return `${referenceContext}${referenceContext && !referenceContext.endsWith('\n') ? '\n' : ''}${workflowContext}${workflowContext && !workflowContext.endsWith('\n') ? '\n' : ''}Personal Agent request:\n${request}`
}

/** Read the full installed catalog again. A routing-description cache is not admission evidence.
 * @param {{list: () => Promise<Array<{id: string, kind: string, revision: string, policy?: {ownerOnly?: boolean, privateData?: boolean}}>>}} catalog
 * @param {{ownerAccess: boolean}} options
 */
export async function snapshotConnectorCatalog(catalog, { ownerAccess }) {
  const inventory = await catalog.list()
  if (!Array.isArray(inventory) || inventory.length > 128) throw Error('Connector catalog snapshot is unavailable')
  const entries = inventory.filter(entry => entry.kind === 'mcp' && (ownerAccess || entry.policy?.ownerOnly !== true))
    .map(entry => {
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.id) || !/^[a-f0-9]{64}$/.test(entry.revision)) throw Error('Connector catalog snapshot is unavailable')
      return { id: entry.id, revision: entry.revision, ownerOnly: entry.policy?.ownerOnly === true, privateData: entry.policy?.privateData === true }
    }).sort((a, b) => a.id.localeCompare(b.id))
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw Error('Connector catalog snapshot is unavailable')
  return { mcpAdmitted: entries.length > 0, catalogFingerprint: createHash('sha256').update(JSON.stringify(entries)).digest('hex') }
}

/** @typedef {{guard: ReturnType<typeof createConnectorCompletionGuard>, admission: ConnectorAdmission, requestId: string}} ConnectorBinding */

/** Keep a corrective generation inside the original Durable input, with a host-authored audit memo.
 * getBinding and submissionStatus are composition-root callbacks, never model tools.
 * The existing owner authority hook must remain installed; this extension grants no tool authority.
 * @param {{getBinding: () => ConnectorBinding | undefined | Promise<ConnectorBinding | undefined>,
 * recordRepair: (receipt: {origin: string, phase: string, ownerRequestId: string, catalogFingerprint: string,
 * authorizesNewActions: boolean, replayTools: boolean}, context: import('@earendil-works/chord').Context) => Promise<void>,
 * submissionStatus: (id: import('@earendil-works/pi-durable').SubmissionId, context: import('@earendil-works/chord').Context) => Promise<import('@earendil-works/pi-durable').SubmissionRecord | undefined>}} options
 */
export function createConnectorCompletionExtension({ getBinding, submissionStatus, recordRepair }) {
  if (typeof recordRepair !== 'function') throw Error('Connector verification requires a private host audit sink')
  /** @param {import('@earendil-works/pi-durable').HookApi} api
   * @param {import('@earendil-works/chord').Context} context */
  async function active(api, context) {
    const binding = await getBinding()
    if (!binding?.requestId || context.abortSignal?.aborted) return undefined
    const live = await api.snapshot(LiveDoc, api.conversationId, context)
    for (const id of live?.run?.inputs ?? []) {
      const input = await submissionStatus(id, context)
      const current = await getBinding()
      if (input?.type === 'input' && input.requestId === binding.requestId && current?.requestId === binding.requestId
        && current.guard === binding.guard && current.admission.owner === binding.admission.owner && !context.abortSignal?.aborted) return current
    }
    return undefined
  }
  return defineExtension({ name: 'odk.connector-completion-check', hooks: [
    hook(GenerationTask, {
      afterResponse: async (answer, api, context) => {
        if (!answer.content.some(part => part.type === 'toolCall')) return
        const binding = await active(api, context)
        if (binding) binding.guard.recordToolAttempt(binding.admission.owner)
      },
      onYield: async (_answer, api, context) => {
        const binding = await active(api, context)
        if (!binding) return undefined
        const decision = binding.guard.requestRepair(binding.admission)
        if (decision.kind !== 'continue') return undefined
        const receipt = { origin: 'host', phase: 'prepared',
          ownerRequestId: binding.requestId, catalogFingerprint: binding.admission.catalogFingerprint,
          authorizesNewActions: false, replayTools: false }
        const memo = await api.memo('odk.connector-completion-repair', receipt, context)
        // Task memos disappear at terminal state. Preserve origin in a passive application entry too.
        await recordRepair(receipt, context)
        const current = await active(api, context)
        if (!current || current.guard !== binding.guard || memo.ownerRequestId !== binding.requestId
          || binding.guard.finalize(current.admission).kind === 'cancel') return undefined
        return { continue: decision.instruction }
      },
    }),
    hook(ToolTask, { beforeTool: async (_call, api, context) => {
      const binding = await active(api, context)
      if (binding) binding.guard.recordDispatch(binding.admission.owner)
      return undefined
    } }),
  ] })
}

/** Select the final entry of the one original input; intermediate answers remain private Durable history.
 * The caller must suppress its normal streaming watcher while this buffered operation runs.
 * getAdmission must read current session capabilities and the complete visible catalog, not a cached routing description.
 * @param {{runtime: Awaited<ReturnType<typeof import('./durable-runtime.mjs').openDurableRuntime>>,
 * guard: ReturnType<typeof createConnectorCompletionGuard>, getAdmission: () => ConnectorAdmission | Promise<ConnectorAdmission>,
 * text: string, requestId: string, context: import('@earendil-works/chord').Context,
 * afterTurn?: (answer: string) => string | Promise<string>, publish?: (answer: string) => void}} options
 */
export async function runBufferedConnectorSubmission({ runtime, guard, getAdmission, text, requestId, context, afterTurn, publish }) {
  const first = guard.finalize(await getAdmission())
  if (first.kind === 'cancel') throw Error('Connector request admission changed or was cancelled')
  const submission = await runtime.submit(text, { requestId, whenBusy: 'reject' })
  const outcome = await submission.wait(context)
  if (outcome.status !== 'done' || outcome.type !== 'input') throw Error('Connector request did not complete')
  const entry = await runtime.conversation.commit(tx => tx.entry(AssistantEntry, outcome.answer), context)
  if (!entry) throw Error('Connector request has no committed final answer')
  const draft = (entry.model ?? []).filter(message => message.role === 'assistant')
    .flatMap(message => message.content.filter(part => part.type === 'text').map(part => part.text)).join('\n')
  const decision = guard.finalize(await getAdmission())
  if (decision.kind === 'cancel') throw Error('Connector request admission changed or was cancelled')
  let answer = decision.kind === 'fallback' ? decision.answer : draft
  if (decision.kind === 'fallback') {
    // This passive application entry is not a new human input or an execution grant.
    const receipt = await runtime.conversation.submit({ type: 'write', entry: { kind: 'odk.connector-completion',
      data: { origin: 'host', originalRequestId: requestId, sourceAnswerEntryId: entry.id,
        reason: 'no_tool_execution_after_one_check', authorizesNewActions: false, answer } } }, context)
    await receipt.wait(context)
  }
  if (afterTurn) answer = await afterTurn(answer)
  if (guard.finalize(await getAdmission()).kind === 'cancel') throw Error('Connector request admission changed or was cancelled')
  publish?.(answer)
  return { answer, answerEntryId: entry.id, inputSubmissionId: submission.id,
    origin: decision.kind === 'fallback' ? 'host' : 'model', evidence: guard.evidence() }
}
