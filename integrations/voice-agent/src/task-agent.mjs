import { createAgentSession, DefaultResourceLoader, getAgentDir, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { privateDirectory } from './task-store.mjs'
import { boundedText } from './task-service.mjs'

const HISTORY_BYTES = 192 * 1024
const EVENT_BODY_BYTES = { result: 64 * 1024, assistant: 16 * 1024, user: 8 * 1024, thinking: 4 * 1024, tool: 4 * 1024 }

function boundedEvent(kind, text, extra = {}) {
  if (typeof text !== 'string' || !text.trim()) return undefined
  const original = text.trim()
  const limit = EVENT_BODY_BYTES[kind] ?? EVENT_BODY_BYTES.result
  const bounded = boundedText(original, limit).replace(/\s+$/, '')
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
  if (!entry || entry.type !== 'message' || !entry.message || typeof entry.message !== 'object') return []
  const message = entry.message
  const content = Array.isArray(message.content) ? message.content : []
  if (message.role === 'toolResult') {
    const text = content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n\n')
    const toolName = typeof message.toolName === 'string' && message.toolName.trim() ? message.toolName.trim() : undefined
    const event = boundedEvent('result', text, toolName ? { toolName } : {})
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
      return { events: [], entries: [], boundary, continuation: start, oversized: true }
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
  const resourceLoader = new DefaultResourceLoader({
    cwd: task.project,
    agentDir: getAgentDir(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
  })
  await resourceLoader.reload()
  const modelRuntime = await createRuntime({ signal: AbortSignal.timeout(15000) })
  const separator = model?.indexOf('/') ?? -1
  const selected = model ? modelRuntime.getModel(model.slice(0, separator), model.slice(separator + 1)) : undefined
  if (model && !selected) throw new Error('未找到配置的模型')
  const sessionManager = SessionManager.create(task.project, sessionDir)
  const { session } = await createSession({ cwd: task.project, resourceLoader, sessionManager, modelRuntime, ...(selected ? { model: selected } : {}) })
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
