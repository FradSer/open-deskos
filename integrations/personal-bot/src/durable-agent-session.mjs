import { randomUUID } from 'node:crypto'
import { minimatch } from 'minimatch'
import { BACKGROUND_CONTEXT, withAbortSignal } from '@earendil-works/chord/context'
import { defineExtension, hook, LiveDoc, ToolTask } from '@earendil-works/pi-durable'
import { createReadTool } from '@earendil-works/pi-durable/tools'
import { createReadOnlyTools, createFindTool } from '@earendil-works/pi-coding-agent'
import { openDurableRuntime, durableCapability, createPiExecutionTarget } from './durable-runtime.mjs'
import { importLegacyContext } from './durable-legacy-context.mjs'

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
 * durableDirectory?: string, ephemeral?: boolean
 * }} options
 * @param {{createTarget?: typeof createPiExecutionTarget}} [dependencies]
 */
export async function createDurableAgentSession(options, { createTarget = createPiExecutionTarget } = {}) {
  const { cwd, customTools = [], modelRuntime, resourceLoader, settingsManager, ephemeral = false, durableDirectory } = options
  let model = options.model
  if (!model) {
    const provider = settingsManager?.getDefaultProvider()
    const id = settingsManager?.getDefaultModel()
    model = provider && id ? modelRuntime.getModel(provider, id) : undefined
    model ??= (await modelRuntime.getAvailable())[0]
  }
  if (!model) throw Error('Pi authentication required')
  const excluded = new Set(options.excludeTools ?? [])
  const target = ephemeral || excluded.has('read') ? undefined : createTarget({ cwd })
  const inspection = target ? inspectionTools(cwd, target) : []
  const capabilities = customTools.map(tool => durableCapability(tool, { callers: ['model', 'tools'] }))
  const tools = [...inspection, ...capabilities]
  const codeMode = !ephemeral
  const instructions = [resourceLoader?.getSystemPrompt(), ...(resourceLoader?.getAppendSystemPrompt() ?? []),
    ...(resourceLoader?.getAgentsFiles().agentsFiles ?? []).map(file => `Project context (${file.path}):\n${file.content}`),
    ...(resourceLoader?.getSkills().skills ?? []).map(skill => `Available Skill: ${skill.name}. ${skill.description}\nRead ${skill.filePath} when this Skill applies.`),
  ].filter(Boolean).join('\n\n')
  let runtime, activeRequestId, streaming = false, disposed = false, closing
  const listeners = new Set()
  let activeTools = new Set(tools.map(tool => tool.name))
  if (codeMode) activeTools.add('codemode')
  // A recovered run may execute concurrently with admission of a later request.
  // Match persisted submission identity, rather than borrowing mutable host intent.
  const authority = defineExtension({ name: 'odk.owner-turn-authority', hooks: [hook(ToolTask, {
    beforeTool: async (_call, api, context) => {
      if (!activeRequestId || disposed || !runtime) return { block: 'No active owner request authorizes this tool call' }
      const requestId = activeRequestId
      const live = await api.snapshot(LiveDoc, api.conversationId, context)
      for (const id of live?.run?.inputs ?? []) {
        const submission = await runtime.harness.submission(id)
        const record = await submission?.status(context)
        if (record?.requestId === requestId && activeRequestId === requestId && !disposed) return undefined
      }
      return { block: 'Recovered work cannot borrow another owner request authorization' }
    },
  })] })
  try {
    runtime = await openDurableRuntime({ directory: durableDirectory, ephemeral, models: codeMode ? codeModeModels(modelRuntime) : modelRuntime,
      model: { provider: model.provider, modelId: model.id }, tools, instructions, cwd, codeMode,
      env: target ? () => target.env : undefined, extensions: [authority],
      settings: { compaction: { enabled: !ephemeral }, stream: { timeoutMs: 90000 } },
    })
    if (!ephemeral) await importLegacyContext(runtime.conversation, options.sessionManager, model)
    const context = BACKGROUND_CONTEXT
    const view = await runtime.conversation.viewState(context)
    const emit = event => { for (const listener of listeners) listener(event) }
    let seen = new Set(view.value.entries.map(entry => entry.id))
    let lastPartial = ''
    const unsubscribe = view.subscribe(value => {
      if (!streaming || disposed) return
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
    const configureTools = () => runtime.conversation.configure({ tools: [...activeTools].map(name => ({ name })),
      modelTools: codeMode ? [...activeTools].map(name => ({ name })) : [] }, context)
    return { session: {
      model, runtime,
      get isStreaming() { return streaming },
      setActiveToolsByName(names) { activeTools = new Set(names); if (!disposed) return configureTools() },
      getActiveToolNames() { return [...activeTools] },
      subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback) },
      async recover(signal) {
        if (disposed) throw Error('Personal Agent is closed')
        const recovery = signal ? withAbortSignal(signal, context) : context
        runtime.harness.resume()
        await runtime.harness.waitForIdle(recovery)
        recovery.abortSignal?.throwIfAborted()
      },
      async prompt(text) {
        if (disposed) throw Error('Personal Agent is closed')
        if (streaming) throw Error('Agent request already in progress')
        streaming = true
        seen = new Set(view.value.entries.map(entry => entry.id))
        lastPartial = ''
        activeRequestId = randomUUID()
        try {
          await configureTools()
          await runtime.prompt(text, { requestId: activeRequestId })
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
        } finally { streaming = false; activeRequestId = undefined; lastPartial = '' }
      },
      abort: () => runtime.abort(),
      dispose() {
        if (!closing) {
          disposed = true
          activeRequestId = undefined
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
