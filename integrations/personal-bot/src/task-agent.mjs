import { createAgentSession, createCodemodeExtension, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent'
import { privateDirectory } from './task-store.mjs'
import { boundedText } from './task-service.mjs'
import { createCodingCheckTool } from './candidate-checks.mjs'

const CHECK_ENTRY = 'open-deskos-coding-check'

/** @returns {import('@earendil-works/pi-coding-agent').ExtensionFactory} */
function checkHistoryExtension() {
  return pi => {
    // Pi persists nested-call arguments/status, never their results. Preserve
    // only host-produced check metadata even if a script omits it or fails.
    pi.on('tool_result', event => {
      if (event.toolName !== 'coding_check' || !event.parentToolCallId) return
      const evidence = event.details && typeof event.details === 'object' && 'codingCheck' in event.details
        ? event.details.codingCheck : undefined
      if (!evidence || Buffer.byteLength(JSON.stringify(evidence)) > 8 * 1024) return
      pi.appendEntry(CHECK_ENTRY, { toolCallId: event.toolCallId, parentToolCallId: event.parentToolCallId,
        isError: event.isError, codingCheck: evidence })
    })
  }
}

// The v1 response carries both events and entries plus an up-to-80 KiB task.
// Charge escaped JSON and keep the duplicated page below the 256 KiB wire cap.
const HISTORY_BYTES = 80 * 1024
const EVENT_BODY_BYTES = { result: 64 * 1024, assistant: 16 * 1024, user: 8 * 1024, thinking: 4 * 1024, tool: 4 * 1024 }

function boundedEvent(kind, text, extra = {}) {
  if (typeof text !== 'string' || !text.trim()) return undefined
  const original = text.trim()
  const limit = EVENT_BODY_BYTES[kind] ?? EVENT_BODY_BYTES.result
  let remaining = limit - Buffer.byteLength(JSON.stringify({ kind, text: '', ...extra, truncated: true }))
  let bounded = ''
  for (const character of boundedText(original, limit)) {
    const cost = Buffer.byteLength(JSON.stringify(character)) - 2
    if (cost > remaining) break
    bounded += character
    remaining -= cost
  }
  bounded = bounded.replace(/\s+$/, '')
  if (!bounded) return undefined
  return { kind, text: bounded, ...extra, ...(bounded !== original ? { truncated: true } : {}) }
}

function formatToolCall(name, input) {
  const toolName = typeof name === 'string' && name.trim() ? name.trim() : 'tool'
  let body = ''
  try { body = typeof input === 'string' ? input : JSON.stringify(input, null, 2) }
  catch { body = '[unserializable arguments]' }
  return `${toolName}${body ? `\n${body}` : ''}`
}

/** Map one complete persisted Pi message entry onto bounded Session Events. */
export function sessionEventsFromEntry(entry) {
  if (entry?.type === 'custom' && entry.customType === CHECK_ENTRY && entry.data?.codingCheck) {
    const serialized = JSON.stringify({ codingCheck: entry.data.codingCheck })
    if (Buffer.byteLength(serialized) > 8 * 1024) return []
    const event = boundedEvent('result', serialized, { toolName: 'coding_check',
      toolCallId: boundedText(String(entry.data.toolCallId), 256),
      parentToolCallId: boundedText(String(entry.data.parentToolCallId), 256), isError: entry.data.isError === true })
    return event ? [event] : []
  }
  if (!entry || entry.type !== 'message' || !entry.message || typeof entry.message !== 'object') return []
  const message = entry.message
  const content = Array.isArray(message.content) ? message.content : []
  if (message.role === 'toolResult') {
    const output = content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n\n')
    const toolName = typeof message.toolName === 'string' && message.toolName.trim() ? boundedText(message.toolName.trim(), 256) : undefined
    // Only the host tool result can supply this prefix. Put it ahead of output so
    // truncating a verbose command does not erase the evidence in details.
    let header = ''
    if (toolName === 'coding_check' && message.details?.codingCheck) {
      const serialized = JSON.stringify({ codingCheck: message.details.codingCheck })
      if (Buffer.byteLength(serialized) <= 8 * 1024) header = serialized
    }
    const toolCallId = typeof message.toolCallId === 'string' ? boundedText(message.toolCallId, 256) : undefined
    const event = boundedEvent('result', [header, output].filter(Boolean).join('\n\n'), {
      ...(toolName ? { toolName } : {}), ...(toolCallId ? { toolCallId } : {}),
      ...(typeof message.isError === 'boolean' ? { isError: message.isError } : {}),
    })
    return event ? [event] : []
  }
  const events = []
  if (message.role === 'user') {
    const text = content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n\n')
    const event = boundedEvent('user', text)
    if (event) events.push(event)
    return events
  }
  if (message.role !== 'assistant') return events
  for (const part of content) {
    if (part?.type === 'thinking') {
      const event = boundedEvent('thinking', part.thinking)
      if (event) events.push(event)
    } else if (part?.type === 'toolCall') {
      const event = boundedEvent('tool', formatToolCall(part.name, part.arguments))
      if (event) events.push(event)
    }
  }
  const reply = content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n\n')
  const event = boundedEvent('assistant', reply)
  if (event) events.push(event)
  return events
}

function assistantOutcome(session, fromIndex, aborted) {
  const final = session.messages.slice(fromIndex).findLast(message => message.role === 'assistant')
  const text = final?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') || ''
  return { text: boundedText(text), stopReason: aborted ? 'aborted' : final?.stopReason }
}

function historyPage(entries, after = 0, limit = 64) {
  const start = Number.isSafeInteger(after) && after >= 0 ? after : 0
  const count = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 64
  const boundary = entries.length
  const events = []
  let bytes = 0
  let scanned = start
  let physicalEntries = 0
  while (scanned < boundary && physicalEntries < count) {
    const position = scanned + 1
    const entryEvents = sessionEventsFromEntry(entries[scanned])
    const mapped = entryEvents.length > 0 ? [{ position, events: entryEvents }] : []
    const cost = Buffer.byteLength(JSON.stringify(mapped))
    if (physicalEntries > 0 && bytes + cost > HISTORY_BYTES) break
    if (physicalEntries === 0 && cost > HISTORY_BYTES) {
      // One entry larger than the whole page budget cannot be split or skipped:
      // returning the same position as `continuation` would loop forever, so
      // refuse with a reason the coordinator can report instead.
      throw new Error(`Hosted Pi 历史条目 ${position} 超出有界预算，未返回该条内容；可用 position=${position} 读取后续历史`)
    }
    events.push(...mapped)
    bytes += cost
    scanned++
    physicalEntries++
  }
  const continuation = scanned < boundary ? scanned : null
  return { events, entries: events, boundary, continuation }
}

/**
 * Creates one persistent Hosted Pi session. The caller owns its lifecycle and may
 * prompt it repeatedly; cancelling a turn does not dispose the session.
 * @param {{task:{project:string},sessionDir:string,model?:string,onEvent?:(event:object)=>void}} input
 * @param {{createSession?:typeof createAgentSession,createRuntime?:typeof ModelRuntime.create}} [dependencies]
 */
export async function createHostedSession(input, { createSession = createAgentSession, createRuntime = options => ModelRuntime.create(options) } = {}) {
  const { task, sessionDir, model, onEvent } = input
  await privateDirectory(sessionDir)
  // Same untrusted-project policy as the resident coordinator: only the
  // operator's agent dir configures this session.
  const settingsManager = SettingsManager.create(task.project, getAgentDir(), { projectTrusted: false })
  const resourceLoader = new DefaultResourceLoader({
    cwd: task.project,
    agentDir: getAgentDir(),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    extensionFactories: [createCodemodeExtension({ mode: 'on', models: false }), checkHistoryExtension()],
    appendSystemPrompt: ['Use codemode to batch independent inspection with awaited Promise.allSettled; keep dependent operations and mutations sequential. Full coding tools remain available. Pi v1.0 guards unknown tool members; use "name" in tools or discovery, not typeof tools.name, for optional tools. A typo suggestion does not authorize replay of earlier mutations. Prefer coding_check for test/typecheck/lint/build commands so host-observed process outcomes and source samples accompany them. A failed script does not undo side effects or authorize retry. Matching source samples and exit zero are not independent verification.'],
  })
  await resourceLoader.reload()
  const modelRuntime = await createRuntime({ signal: AbortSignal.timeout(15000) })
  const separator = model?.indexOf('/') ?? -1
  const selected = model ? modelRuntime.getModel(model.slice(0, separator), model.slice(separator + 1)) : undefined
  if (model && !selected) throw new Error('未找到配置的模型')
  const sessionManager = SessionManager.create(task.project, sessionDir)
  settingsManager.applyOverrides({
    // Full coding capability plus orchestration; codemode batches work without
    // narrowing the worker's own tools.
    defaultTools: [...(settingsManager.getDefaultTools() ?? ['read', 'bash', 'edit', 'write']), 'codemode'],
  })
  const { session } = await createSession({ cwd: task.project, resourceLoader, sessionManager, modelRuntime, settingsManager,
    customTools: [createCodingCheckTool(task.project)], ...(selected ? { model: selected } : {}) })
  await session.bindExtensions({})
  let publishedPosition = sessionManager.getEntries().length
  let flushScheduled = false
  const flushEntries = () => {
    flushScheduled = false
    const entries = sessionManager.getEntries()
    while (publishedPosition < entries.length) {
      const position = publishedPosition + 1
      const events = sessionEventsFromEntry(entries[publishedPosition])
      if (events.length > 0) onEvent?.({ position, events })
      publishedPosition++
    }
  }
  const scheduleFlush = () => {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(flushEntries)
  }
  const unsubscribe = session.subscribe(event => {
    // Regular messages are persisted after message_end listeners return; custom
    // entries emit entry_appended. Deferring one microtask observes both durably.
    if (event.type === 'message_end' || event.type === 'entry_appended') scheduleFlush()
  })
  let disposed = false
  let abortRequested = false
  return {
    get isStreaming() { return session.isStreaming },
    get sessionFile() { return session.sessionFile ?? sessionManager.getSessionFile() },
    async prompt(text) {
      if (disposed) throw new Error('Hosted Pi 已结束')
      const fromIndex = session.messages.length
      abortRequested = false
      await session.prompt(text, { expandPromptTemplates: false })
      flushEntries()
      return assistantOutcome(session, fromIndex, abortRequested)
    },
    async deliver(text, streamingBehavior) {
      if (disposed) throw new Error('Hosted Pi 已结束')
      if (streamingBehavior === 'steer') await session.steer(text)
      else if (streamingBehavior === 'followUp') await session.followUp(text)
      else throw new Error('流式提示需要 delivery behavior')
    },
    async abort() { if (!disposed) { abortRequested = true; await session.abort() } },
    boundary() { return sessionManager.getEntries().length },
    history(after, limit) { return historyPage(sessionManager.getEntries(), after, limit) },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      session.dispose()
    },
  }
}

/** Read persisted Pi history without recreating or replaying the Hosted Pi. */
export function readHostedHistory(sessionFile, after, limit) {
  if (!sessionFile) return { events: [], entries: [], boundary: 0, continuation: null }
  return historyPage(SessionManager.open(sessionFile).getEntries(), after, limit)
}

/** Compatibility wrapper for callers that still need a one-shot adapter. */
export async function runTask(input, dependencies = {}) {
  input.signal.throwIfAborted()
  const hosted = await createHostedSession(input, dependencies)
  const abort = () => { hosted.abort().catch(() => {}) }
  input.signal.addEventListener('abort', abort, { once: true })
  try {
    input.signal.throwIfAborted()
    const result = await hosted.prompt(input.task.prompt)
    return { ...result, stopReason: input.signal.aborted ? 'aborted' : result.stopReason }
  } finally {
    input.signal.removeEventListener('abort', abort)
    hosted.dispose()
  }
}
