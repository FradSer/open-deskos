const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { StringDecoder } = require('node:string_decoder')
const { boundedEvent } = require('./pi-session-events')

const HOST_PROTOCOL = 1
const MAX_HOST_RECORD_BYTES = 256 * 1024
const DEFAULT_CONNECT_TIMEOUT_MS = 5000
const DEFAULT_REQUEST_TIMEOUT_MS = 5000

// The Hosted Pi host publishes where it answers, in the session's runtime directory, so the Desk Link
// Service never reads the host's own private configuration. Reading that file here meant a second
// reader with its own policy — this one did not check the owner or mode the daemon requires — and two
// answers to one question. An explicit socket stays available for isolated runs and tests.
const HOST_ENDPOINT_VERSION = 1

function hostEndpointFile(env) {
  const runtimeDir = (env.XDG_RUNTIME_DIR ?? '').trim()
  return path.isAbsolute(runtimeDir) ? path.join(runtimeDir, 'open-deskos', 'hosted-pi', 'endpoint.json') : null
}

function resolveHostedPiSocketPath(env = process.env, readFile = fs.readFileSync) {
  const explicit = (env.ODK_HOSTED_PI_SOCKET ?? '').trim()
  if (explicit.length > 0) {
    if (!path.isAbsolute(explicit)) throw new Error('ODK_HOSTED_PI_SOCKET must be absolute')
    return explicit
  }
  const file = hostEndpointFile(env)
  if (!file) return null
  try {
    const descriptor = JSON.parse(readFile(file, 'utf8'))
    if (descriptor?.version !== HOST_ENDPOINT_VERSION) return null
    return typeof descriptor.socketPath === 'string' && path.isAbsolute(descriptor.socketPath) ? descriptor.socketPath : null
  } catch {
    return null
  }
}

function hostError(error) {
  if (error?.code === 'ENOENT' || error?.code === 'ECONNREFUSED') return new Error('pi host unavailable')
  return error instanceof Error ? error : new Error('pi host unavailable')
}

function taskRequest(record, consoleIdentity) {
  const requestId = record.requestId || randomUUID()
  const mutation = typeof record.mutationId === 'string' ? { mutationId: record.mutationId } : {}
  const attachment = typeof record.attachmentId === 'string' ? { attachmentId: record.attachmentId } : {}
  const base = { version: HOST_PROTOCOL, requestId }
  if (record.type === 'list') return { ...base, command: 'list' }
  if (record.type === 'launch') {
    if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) throw new Error('launch identity required')
    return { ...base, command: 'start', ...mutation, taskId: record.sessionId, project: record.project, prompt: record.prompt, ...(consoleIdentity ? { console: consoleIdentity } : {}) }
  }
  if (record.type === 'history') return { ...base, command: 'history', taskId: record.sessionId, position: record.after ?? 0, ...(record.limit ? { limit: record.limit } : {}) }
  if (record.type === 'attach') return {
    ...base, command: 'attach', ...attachment, taskId: record.sessionId,
    ...(Number.isSafeInteger(record.after) ? { position: record.after } : {}),
    ...(record.limit ? { limit: record.limit } : {}), console: consoleIdentity,
  }
  if (record.type === 'prompt') return { ...base, command: 'prompt', ...mutation, ...attachment, taskId: record.sessionId, prompt: record.prompt, streamingBehavior: record.streamingBehavior || 'steer', ...(consoleIdentity ? { console: consoleIdentity } : {}) }
  if (record.type === 'cancel') return { ...base, command: 'cancel', ...mutation, ...attachment, taskId: record.sessionId, ...(typeof record.turnId === 'string' ? { expectedTurnId: record.turnId } : {}), ...(consoleIdentity ? { console: consoleIdentity } : {}) }
  if (record.type === 'end') return { ...base, command: 'end', ...mutation, ...attachment, taskId: record.sessionId, ...(consoleIdentity ? { console: consoleIdentity } : {}) }
  throw new Error('unsupported pi host request')
}

function normalizeTask(task) {
  return {
    sessionId: task.taskId,
    status: task.state,
    lifecycle: task.lifecycle,
    turnOutcome: task.turnOutcome,
    project: task.project,
    goal: typeof task.goal === 'string' ? task.goal : typeof task.prompt === 'string' ? task.prompt : '',
    startedAt: Date.parse(task.createdAt) || 0,
    updatedAt: Date.parse(task.updatedAt) || 0,
    activity: typeof task.response === 'string' ? task.response : '',
  }
}

function formatToolCall(name, input) {
  const toolName = typeof name === 'string' && name.trim() ? name.trim() : 'tool'
  let body = ''
  try { body = typeof input === 'string' ? input : JSON.stringify(input, null, 2) }
  catch { body = '[unserializable arguments]' }
  return `${toolName}${body ? `\n${body}` : ''}`
}

function sessionEventsFromEntry(entry) {
  const canonical = boundedEvent(entry)
  if (canonical) return [canonical]
  if (!entry || entry.type !== 'message' || !entry.message || typeof entry.message !== 'object') return []
  const message = entry.message
  const content = Array.isArray(message.content) ? message.content : []
  if (message.role === 'toolResult') {
    const text = content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n\n')
    const event = boundedEvent({ kind: 'result', text, ...(typeof message.toolName === 'string' ? { toolName: message.toolName } : {}) })
    return event ? [event] : []
  }
  if (message.role === 'user') {
    const text = content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n\n')
    const event = boundedEvent({ kind: 'user', text })
    return event ? [event] : []
  }
  if (message.role !== 'assistant') return []
  const events = []
  for (const part of content) {
    if (part?.type === 'thinking') {
      const event = boundedEvent({ kind: 'thinking', text: part.thinking })
      if (event) events.push(event)
    } else if (part?.type === 'toolCall') {
      const event = boundedEvent({ kind: 'tool', text: formatToolCall(part.name, part.arguments) })
      if (event) events.push(event)
    }
  }
  const reply = content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n\n')
  const assistant = boundedEvent({ kind: 'assistant', text: reply })
  if (assistant) events.push(assistant)
  return events
}

function normalizeHistory(sessionId, history, through) {
  const requestedBoundary = Number.isSafeInteger(through) && through >= 0 ? through : null
  const hostBoundary = Number.isSafeInteger(history?.boundary) && history.boundary >= 0 ? history.boundary : 0
  const boundary = requestedBoundary === null ? hostBoundary : Math.min(hostBoundary, requestedBoundary)
  const entries = Array.isArray(history?.entries)
    ? history.entries.map((item) => {
      if (!Number.isSafeInteger(item?.position) || item.position <= 0 || item.position > boundary) return null
      const events = Array.isArray(item.events)
        ? item.events.map(boundedEvent).filter(Boolean)
        : sessionEventsFromEntry(item.event ?? item.entry)
      return events.length > 0 ? { position: item.position, events } : null
    }).filter(Boolean)
    : []
  const continuation = Number.isSafeInteger(history?.continuation) && history.continuation >= 0 && history.continuation < boundary
    ? history.continuation
    : null
  return {
    sessionId,
    entries,
    nextPosition: continuation,
    boundary,
    ...(history?.oversized === true ? { oversized: true } : {}),
  }
}

function normalizeResult(record, response) {
  if (record.type === 'list') return { sessions: Array.isArray(response.tasks) ? response.tasks.map(normalizeTask) : [], truncated: response.truncated === true }
  if (record.type === 'launch') return { ...response, sessionId: response.task?.taskId, state: response.task?.state }
  if (record.type === 'history') return normalizeHistory(record.sessionId, response.history, record.through)
  return response
}

function normalizeEvent(event, sessionId) {
  if (event.type === 'replaced') return [{ type: 'error', reason: 'attach replaced', sessionId }]
  if (event.type === 'state') return [{
    type: 'state', sessionId,
    state: event.state,
    lifecycle: event.lifecycle,
    activity: event.activity,
    turnOutcome: event.turnOutcome,
    response: event.response,
  }]
  if (event.type === 'event' && Number.isSafeInteger(event.position)) {
    const events = Array.isArray(event.events)
      ? event.events.map(boundedEvent).filter(Boolean)
      : sessionEventsFromEntry(event.event ?? event.entry)
    return events.length > 0 ? [{ type: 'event', sessionId, position: event.position, events }] : []
  }
  return []
}

function createHostedPiSocketAdapter({
  socketPath, env = process.env, connect = net.createConnection, readFile,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT_MS, requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const resolved = socketPath ?? resolveHostedPiSocketPath(env, readFile)

  function open() {
    if (!resolved) return Promise.reject(new Error('pi host unconfigured'))
    return new Promise((resolve, reject) => {
      const socket = connect(resolved)
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        socket.off('error', fail)
        if (error) { socket.destroy(); reject(hostError(error)) } else { socket.on('error', () => socket.destroy()); resolve(socket) }
      }
      const fail = (error) => finish(error)
      const timer = setTimeout(() => finish(new Error('pi host connect timeout')), connectTimeoutMs)
      timer.unref?.()
      socket.once('error', fail)
      socket.once('connect', () => finish())
    })
  }

  function write(socket, record) {
    const line = `${JSON.stringify(record)}\n`
    if (Buffer.byteLength(line) > 64 * 1024) throw new Error('pi host request too large')
    socket.write(line)
  }

  function reader(onRecord, onError) {
    const decoder = new StringDecoder('utf8')
    let pending = ''
    return (chunk) => {
      pending += decoder.write(chunk)
      if (Buffer.byteLength(pending) > MAX_HOST_RECORD_BYTES) return onError(new Error('pi host response too large'))
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (!line || Buffer.byteLength(line) > MAX_HOST_RECORD_BYTES) continue
        try { onRecord(JSON.parse(line)) } catch { onError(new Error('pi host returned malformed data')) }
      }
    }
  }

  return {
    socketPath: resolved,
    async request(record) {
      const socket = await open()
      const request = taskRequest(record, record.console ? { machineName: record.console.machine, sessionId: record.console.sessionId } : null)
      return new Promise((resolve, reject) => {
        let settled = false
        let timer
        const finish = (fn, value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          socket.destroy()
          fn(value)
        }
        timer = setTimeout(() => finish(reject, new Error('pi host request timeout')), requestTimeoutMs)
        timer.unref?.()
        socket.on('data', reader((reply) => {
          if (reply?.requestId !== request.requestId) return
          if (reply.ok !== true) finish(reject, new Error(reply.error || 'pi host refused request'))
          else finish(resolve, normalizeResult(record, reply))
        }, (error) => finish(reject, error)))
        socket.once('close', () => finish(reject, new Error('pi host disconnected')))
        try { write(socket, request) } catch (error) { finish(reject, error) }
      })
    },
    async attach(record, handlers = {}) {
      const socket = await open()
      const consoleIdentity = { machineName: record.console.machine, sessionId: record.console.sessionId }
      const request = taskRequest(record, consoleIdentity)
      return new Promise((resolve, reject) => {
        let attached = false
        let settled = false
        let timer
        const finishAttach = (error, value) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (error) { socket.destroy(); reject(error) } else resolve(value)
        }
        timer = setTimeout(() => finishAttach(new Error('pi host attach timeout')), requestTimeoutMs)
        timer.unref?.()
        socket.on('data', reader((reply) => {
          if (!attached && reply?.requestId === request.requestId) {
            if (reply.ok !== true) {
              finishAttach(new Error(reply.error || 'pi host refused attach'))
              return
            }
            attached = true
            const history = normalizeHistory(record.sessionId, reply.history, record.through)
            finishAttach(null, { boundary: history.boundary, history, connection })
            return
          }
          for (const event of normalizeEvent(reply, record.sessionId)) handlers.onRecord?.(event)
        }, (error) => {
          if (!attached) finishAttach(error)
          else { handlers.onError?.(error); socket.destroy() }
        }))
        const connection = {
          send(command) {
            if (socket.destroyed) return
            // The host owns one correlated request per connection. Attach keeps
            // its event stream, while mutations use their own bounded socket.
            createHostedPiSocketAdapter({ socketPath: resolved, connect, connectTimeoutMs, requestTimeoutMs }).request({ ...command, console: record.console })
              .then((reply) => handlers.onRecord?.({ type: 'ack', requestId: command.requestId, sessionId: record.sessionId, result: reply }))
              .catch((error) => handlers.onRecord?.({ type: 'error', requestId: command.requestId, sessionId: record.sessionId, reason: error.message }))
          },
          close() { socket.destroy() },
        }
        socket.once('close', () => {
          if (!attached) finishAttach(new Error('pi host disconnected'))
          else handlers.onClose?.()
        })
        try { write(socket, request) } catch (error) { finishAttach(error) }
      })
    },
  }
}

module.exports = {
  createHostedPiSocketAdapter,
  resolveHostedPiSocketPath,
  taskRequest,
  normalizeTask,
  normalizeHistory,
  normalizeEvent,
  sessionEventsFromEntry,
  HOST_PROTOCOL,
  MAX_HOST_RECORD_BYTES,
}
