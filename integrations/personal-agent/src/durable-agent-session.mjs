import { randomUUID } from 'node:crypto'
import { minimatch } from 'minimatch'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import { defineExtension, GenerationTask, hook, LiveDoc, ToolTask } from '@earendil-works/pi-durable'
import { createReadTool } from '@earendil-works/pi-durable/tools'
import { createReadOnlyTools, createFindTool, createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent'
import { openDurableRuntime, durableCapability, createPiExecutionTarget } from './durable-runtime.mjs'
import { importLegacyContext } from './durable-legacy-context.mjs'
import { createConnectorCompletionGuard, createConnectorCompletionExtension, runBufferedConnectorSubmission } from './connector-completion-guard.mjs'
import { stripLegacyMemoryContext } from './memory.mjs'
import { readResidentHistory } from './history-evidence.mjs'

/** @typedef {{status: 'succeeded'|'failed', output: string, diagnostics: {severity: 'info'|'warn'|'error', code?: string, message: string}[], truncated: boolean}} ComputationOutcome */
/** @typedef {{requestId: string, taskId: string, callId: string, source: string, truncated: boolean, kind: 'computation', learningEligible: false}} ComputationStart */
/** @typedef {{read: () => Promise<{content: string, privateData: boolean}>, currentOnly: boolean, onPrivateData?: () => void}} OwnerMemoryProjection */

/** Remove only recognized snapshots from historical user input. */
function withoutLegacyMemory(message) {
  if (message.role !== 'user') return message
  if (typeof message.content === 'string') {
    const content = stripLegacyMemoryContext(message.content)
    return content === message.content ? message : { ...message, content }
  }
  return { ...message, content: message.content.map(part => part.type === 'text'
    ? { ...part, text: stripLegacyMemoryContext(part.text) } : part) }
}

/** @param {import('@earendil-works/pi-ai').Message} message */
function ownerMessageText(message) {
  if (message.role !== 'user') return undefined
  if (typeof message.content === 'string') return message.content
  if (message.content.length === 1 && message.content[0].type === 'text') return message.content[0].text
}

/** Keep executable source and results as bounded, untrusted computation evidence. */
function computationOutcome(result) {
  let output = '', truncated = false
  for (const part of result.output ?? []) {
    if (part.type !== 'text') { truncated = true; continue }
    const text = `${output ? '\n' : ''}${part.text}`
    const remaining = Math.max(0, 16000 - output.length)
    output += text.slice(0, remaining)
    if (text.length > remaining) truncated = true
  }
  const diagnostics = (result.diagnostics ?? []).slice(0, 16).map(item => ({
    severity: item.severity, ...(item.code ? { code: item.code.slice(0, 128) } : {}), message: item.message.slice(0, 1000),
  }))
  truncated ||= (result.diagnostics?.length ?? 0) > diagnostics.length || (result.diagnostics ?? []).some(item =>
    item.message.length > 1000 || (item.code?.length ?? 0) > 128 || /truncat|limit/i.test(item.code ?? ''))
  // Code Mode formats its own truncation before ToolTask hooks run. A spill
  // path and the SDK's warning both mean that the retained text is incomplete.
  truncated ||= Boolean(result.details?.fullOutputPath) || output.includes('Warning: truncated output')
  return { status: result.isError ? 'failed' : 'succeeded', output, diagnostics, truncated }
}

/** Preserve reviewed historical direct calls without advertising their schemas.
 * Durable validates against its persisted execution loadout. Only the provider
 * transport sees the smaller declaration set, as the previous Code Mode did.
 * @param {import('@earendil-works/pi-ai').Models} source
 */
function codeModeModels(source) {
  const stream = (model, context, options) => source.streamSimple(model, { ...context,
    messages: context.messages.map(message => message.role === 'system' && message.toolsAdded
      ? { ...message, toolsAdded: message.toolsAdded.filter(tool => tool.name === 'codemode') } : message),
  }, options)
  return new Proxy(source, { get(target, key) {
    if (key === 'streamSimple') return stream
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

/** Reuse Pi's find schema and output bounds with the environment's daemon inventory. */
function inspectionTools(cwd, target) {
  return [createReadTool(), ...createReadOnlyTools(cwd).filter(tool => tool.name !== 'read').map(tool => {
    if (tool.name === 'find') tool = { ...tool, execute: /** @param {import('@earendil-works/pi-coding-agent').FindToolInput} args */ (id, args, signal, onUpdate) => {
      const call = signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT
      return createFindTool(cwd, { operations: {
        exists: async path => { const result = await target.env.exists(path, call); if (result.ok === false) throw result.error; return result.value },
        glob: async (pattern, path, options) => {
          // Pi env takes entry names, rather than the SDK glob exclusions.
          const result = await target.env.listFiles(path, { exclude: ['node_modules', '.git'], maxEntries: 50000, maxBytes: 4 * 1024 * 1024, timeoutMs: 10000 }, call)
          if (result.ok === false) throw result.error
          if (result.value.truncated) throw Error('Pi environment file inventory is incomplete; narrow the search path')
          const fullPath = pattern.includes('/')
          const effective = fullPath && !pattern.startsWith('/') && !pattern.startsWith('**/') ? `**/${pattern}` : pattern
          return result.value.entries.filter(entry => minimatch(fullPath ? `${path.replaceAll('\\', '/')}/${entry.path}` : entry.path.split('/').at(-1), effective, { dot: true }))
            .map(entry => entry.path).slice(0, options.limit)
        },
      } }).execute(id, args, signal, onUpdate)
    } }
    return durableCapability({ ...tool, exposure: 'direct' }, { callers: ['model', 'tools'] })
  })]
}

/** The resident port keeps its response events while Durable owns execution and storage.
 * @param {import('@earendil-works/pi-coding-agent').CreateAgentSessionOptions & {
 * durableDirectory?: string, ephemeral?: boolean,
 * observeInspectionTools?: (tools: import('@earendil-works/pi-durable').ToolRegistration[]) => import('@earendil-works/pi-durable').ToolRegistration[],
 * observeCodeModeExecution?: (start: ComputationStart) => ((outcome: ComputationOutcome) => void)
 * connectorAdmission?: () => import('./connector-completion-guard.mjs').ConnectorAdmission | undefined | Promise<import('./connector-completion-guard.mjs').ConnectorAdmission | undefined>
 * }} options
 * @param {{createTarget?: typeof createPiExecutionTarget}} [dependencies]
 */
export async function createDurableAgentSession(options, { createTarget = createPiExecutionTarget } = {}) {
  const { cwd, customTools = [], modelRuntime, resourceLoader, settingsManager, ephemeral = false, durableDirectory } = options
  // Pi owns model restoration, defaults, availability, and thinking resolution.
  const native = await createAgentSession({cwd, modelRuntime, resourceLoader, settingsManager,
    model:options.model, thinkingLevel:options.thinkingLevel, sessionManager:SessionManager.inMemory(cwd), tools:[], customTools:[]})
  let model = native.session.model
  let thinkingLevel = native.session.thinkingLevel
  await native.session.dispose()
  if (!model) throw Error('Pi authentication required')
  const excluded = new Set(options.excludeTools ?? [])
  const target = ephemeral || excluded.has('read') ? undefined : createTarget({ cwd })
  const inspection = target ? inspectionTools(cwd, target) : []
  const observedInspection = options.observeInspectionTools ? options.observeInspectionTools(inspection) : inspection
  const capabilities = customTools.map(tool => durableCapability(tool, { callers: ['model', 'tools'] }))
  const tools = [...observedInspection, ...capabilities]
  const codeMode = !ephemeral
  const instructions = [resourceLoader?.getSystemPrompt(), ...(resourceLoader?.getAppendSystemPrompt() ?? []),
    ...(resourceLoader?.getAgentsFiles().agentsFiles ?? []).map(file => `Project context (${file.path}):\n${file.content}`),
    ...(resourceLoader?.getSkills().skills ?? []).map(skill => `Available Skill: ${skill.name}. ${skill.description}\nRead ${skill.filePath} when this Skill applies.`),
  ].filter(Boolean).join('\n\n')
  let runtime, activeRequestId, streaming = false, disposed = false, closing
  /** @type {{requestId: string, text: string, projection: OwnerMemoryProjection} | undefined} */
  let ownerMemory
  let connectorGuard, completedConnectorGuard, connectorBuffered = false
  const computations = new Map()
  const listeners = new Set()
  let activeTools = new Set(tools.map(tool => tool.name))
  if (codeMode) activeTools.add('codemode')
  async function connectorAdmission() {
    try {
      const admission = await options.connectorAdmission?.()
      if (!admission) throw Error('Missing admission')
      return admission
    } catch { throw Error('Current connector admission could not be checked') }
  }
  const connectorCompletion = createConnectorCompletionExtension({
    getBinding: async () => {
      const requestId = activeRequestId, guard = connectorGuard
      if (!requestId || !guard || disposed) return undefined
      const admission = await connectorAdmission()
      if (requestId !== activeRequestId || guard !== connectorGuard || disposed) return undefined
      return { requestId, guard, admission }
    },
    submissionStatus: async (id, context) => (await runtime?.harness.submission(id))?.status(context),
    recordRepair: async (receipt, context) => {
      await (await runtime.conversation.submit({ type: 'write', entry: { kind: 'odk.connector-repair', data: receipt } }, context)).wait(context)
    },
  })
  // A recovered run may execute concurrently with admission of a later request.
  // Match persisted submission identity, rather than borrowing mutable host intent.
  function isActive(requestId, context) {
    return Boolean(requestId && activeRequestId === requestId && !disposed && !context.abortSignal?.aborted)
  }
  async function ownsRun(requestId, api, context) {
    if (!runtime || !isActive(requestId, context)) return false
    const live = await api.snapshot(LiveDoc, api.conversationId, context)
    for (const id of live?.run?.inputs ?? []) {
      const submission = await runtime.harness.submission(id)
      const record = await submission?.status(context)
      if (record?.type === 'input' && record.requestId === requestId && isActive(requestId, context)) return true
    }
    return false
  }
  const authority = defineExtension({ name: 'odk.owner-turn-authority', hooks: [hook(GenerationTask, {
    beforeRequest: async ({ messages }, api, context) => {
      if (!codeMode) return undefined
      const projected = messages.map(withoutLegacyMemory)
      const bound = ownerMemory
      if (!bound || !await ownsRun(bound.requestId, api, context)) return { messages: projected }
      const index = messages.findLastIndex(message => ownerMessageText(message) === bound.text)
      if (index === -1) throw Error('Current owner memory request has no matching input')
      const current = await bound.projection.read()
      if (ownerMemory !== bound || !isActive(bound.requestId, context)) throw Error('Owner memory request expired')
      if (current.privateData) bound.projection.onPrivateData?.()
      const message = projected[index]
      if (message.role !== 'user') throw Error('Current owner memory request has no user input')
      if (current.content) projected[index] = { ...message, content: current.content + ownerMessageText(message) }
      const visible = bound.projection.currentOnly
        ? [...projected.slice(0, index).filter(message => message.role === 'system'), ...projected.slice(index)]
        : projected
      return { messages: visible }
    },
  }), hook(ToolTask, {
    beforeTool: async (call, api, context) => {
      const requestId = activeRequestId
      if (!isActive(requestId, context)) return { block: 'No active owner request authorizes this tool call' }
      if (!await ownsRun(requestId, api, context)) return { block: 'Recovered work cannot borrow another owner request authorization' }
      if (call.name === 'codemode' && options.observeCodeModeExecution) {
        const source = typeof call.arguments.code === 'string' ? call.arguments.code : ''
        const finish = options.observeCodeModeExecution({ requestId, taskId: String(api.taskId), callId: call.id,
          source: source.slice(0, 16000), truncated: source.length > 16000, kind: 'computation', learningEligible: false })
        computations.set(api.taskId, { requestId, finish })
      }
      return undefined
    },
    afterTool: (call, result, api, context) => {
      if (call.name !== 'codemode') return undefined
      const computation = computations.get(api.taskId)
      computations.delete(api.taskId)
      if (!computation || disposed || context.abortSignal?.aborted || activeRequestId !== computation.requestId) return undefined
      computation.finish(computationOutcome(result))
      return undefined
    },
  })] })
  try {
    runtime = await openDurableRuntime({ directory: durableDirectory, ephemeral, models: codeMode ? codeModeModels(modelRuntime) : modelRuntime,
      model: { provider: model.provider, modelId: model.id }, tools, instructions, cwd, codeMode,
      env: target ? () => target.env : undefined, extensions: [authority, connectorCompletion],
      thinkingLevel, settings: { compaction: { enabled: !ephemeral }, stream: { timeoutMs: 90000 } },
    })
    if (!ephemeral) await importLegacyContext(runtime.conversation, options.sessionManager, model)
    const context = BACKGROUND_CONTEXT
    const view = await runtime.conversation.viewState(context)
    const emit = event => { for (const listener of listeners) listener(event) }
    let seen = new Set(view.value.entries.map(entry => entry.id))
    let lastPartial = ''
    const unsubscribe = view.subscribe(value => {
      if (!streaming || disposed || connectorBuffered) return
      for (const entry of value.entries) {
        if (seen.has(entry.id)) continue
        seen.add(entry.id)
        for (const message of entry.model ?? []) {
          if (message.role === 'assistant') {
            emit({ type: 'message_end', message })
            lastPartial = ''
          }
        }
      }
      const message = value.docs['pi.live']?.generation?.message
      const partial = message?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? ''
      if (message && partial !== lastPartial) {
        lastPartial = partial
        emit({ type: 'message_update', message, assistantMessageEvent: { type: 'text_delta' } })
      }
    })
    // Non-codemode (ephemeral) sessions still expose tools whose capability declares
    // the model as a caller. Clearing modelTools here hides customTools that
    // openDurableRuntime already registered, so generation sessions lose their tools.
    const modelFacing = tools.filter(tool => !tool.callers || tool.callers.includes('model'))
    const configureTools = () => runtime.conversation.configure({ tools: [...activeTools].map(name => ({ name })),
      modelTools: codeMode ? [...activeTools].map(name => ({ name })) : modelFacing.filter(tool => activeTools.has(tool.name)).map(tool => ({ name: tool.name })) }, context)
    return { session: {
      get model() { return model }, runtime,
      getThinkingLevel() { return thinkingLevel },
      async setModel(next) {
        if(streaming || disposed)throw Error('Personal Agent is busy')
        await runtime.conversation.configure({model:{provider:next.provider,modelId:next.id}}, context)
        model=next
      },
      async setThinkingLevel(level) {
        if(streaming || disposed)throw Error('Personal Agent is busy')
        await runtime.conversation.configure({thinkingLevel:level},context)
        thinkingLevel=level
      },
      get isStreaming() { return streaming },
      setActiveToolsByName(names) { activeTools = new Set(names); if (!disposed) return configureTools() },
      getActiveToolNames() { return [...activeTools] },
      hasBufferedConnectorCompletion() { return Boolean(connectorBuffered || completedConnectorGuard) },
      async validateConnectorPublication() {
        if (completedConnectorGuard?.finalize(await connectorAdmission()).kind === 'cancel') throw Error('Connector admission changed before publication')
      },
      subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) },
      readHistory: (signal) => readResidentHistory(runtime.conversation, signal ? withAbortSignal(signal, context) : context),
      async recover(signal) {
        if (disposed) throw Error('Personal Agent is closed')
        const recovery = signal ? withAbortSignal(signal, context) : context
        runtime.harness.resume()
        await runtime.harness.waitForIdle(recovery)
        recovery.abortSignal?.throwIfAborted()
      },
      /** @param {string} text @param {{memory?: OwnerMemoryProjection, expandPromptTemplates?: boolean, entry?: import('@earendil-works/pi-durable').InputEntry}} [turnOptions] */
      async prompt(text, turnOptions) {
        if (disposed) throw Error('Personal Agent is closed')
        if (streaming) throw Error('Agent request already in progress')
        streaming = true
        completedConnectorGuard = undefined
        seen = new Set(view.value.entries.map(entry => entry.id))
        lastPartial = ''
        activeRequestId = randomUUID()
        ownerMemory = turnOptions?.memory ? { requestId: activeRequestId, text, projection: turnOptions.memory } : undefined
        try {
          await configureTools()
          const admission = options.connectorAdmission ? await options.connectorAdmission() : undefined
          connectorGuard = admission ? createConnectorCompletionGuard(admission) : undefined
          connectorBuffered = Boolean(connectorGuard?.shouldBuffer(admission))
          if (connectorBuffered) {
            const result = await runBufferedConnectorSubmission({ runtime, guard: connectorGuard,
              getAdmission: connectorAdmission, text, requestId: activeRequestId, context, entry: turnOptions?.entry })
            const final = await runtime.conversation.viewState(context)
            try {
              const message = final.value.entries.find(entry => entry.id === result.answerEntryId)?.model?.find(message => message.role === 'assistant')
              if (!message) throw Error('Connector request has no final assistant entry')
              completedConnectorGuard = connectorGuard
              emit({ type: 'message_end', message: result.origin === 'model' ? message
                : { ...message, content: [{ type: 'text', text: result.answer }] }, origin: result.origin })
            } finally { final.dispose() }
            return
          }
          await runtime.prompt(text, { requestId: activeRequestId, entry: turnOptions?.entry })
          // Chord listeners can coalesce revisions. Read the committed final view
          // before resolving the port, so final assistant text is always delivered.
          const final = await runtime.conversation.viewState(context)
          try {
            for (const entry of final.value.entries) {
              if (seen.has(entry.id)) continue
              seen.add(entry.id)
              for (const message of entry.model ?? []) if (message.role === 'assistant') emit({ type: 'message_end', message })
            }
          } finally { final.dispose() }
        } finally { streaming = false; connectorBuffered = false; connectorGuard = undefined; activeRequestId = undefined; ownerMemory = undefined; computations.clear(); lastPartial = '' }
      },
      abort: () => { activeRequestId = undefined; ownerMemory = undefined; completedConnectorGuard = undefined; computations.clear(); return runtime.abort() },
      dispose() {
        if (!closing) {
          disposed = true
          activeRequestId = undefined
          ownerMemory = undefined
          computations.clear()
          unsubscribe(); view.dispose(); listeners.clear()
          closing = (async () => { try { await runtime.close() } finally { await target?.close() } })()
        }
        return closing
      },
    } }
  } catch (error) {
    try { await runtime?.close() } finally { await target?.close() }
    throw error
  }
}
