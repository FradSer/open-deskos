import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { CallToolResultSchema, ListToolsResultSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { validateMcpManifest } from './catalog.mjs'

const RESPONSE_LIMIT = 1024 * 1024
const RESULT_LIMIT = 65536
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/
const unknownOutcome = () => Error('MCP tool outcome unknown; do not retry automatically. Query authoritative state before another mutation.')

async function withDeadline(operation, signal, timeoutMs) {
  const deadline = new AbortController()
  const callSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
  const timer = setTimeout(() => deadline.abort(Error('MCP request deadline exceeded')), timeoutMs)
  let cancel
  try {
    callSignal.throwIfAborted()
    const stopped = new Promise((_, reject) => { cancel = () => reject(callSignal.reason); callSignal.addEventListener('abort', cancel, { once: true }) })
    return await Promise.race([Promise.resolve().then(() => { callSignal.throwIfAborted(); return operation(callSignal) }), stopped])
  } finally { clearTimeout(timer); if (cancel) callSignal.removeEventListener('abort', cancel) }
}

/** Bounds apply to JSON and SSE bodies, including initialization and server notifications. */
export function boundedMcpFetch(fetchImpl = globalThis.fetch, { timeoutMs = 20000, maxBytes = RESPONSE_LIMIT, signal = undefined } = {}) {
  return async (url, init = {}) => {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: AbortSignal.any([
      ...(signal ? [signal] : []), ...(init.signal ? [init.signal] : []), AbortSignal.timeout(timeoutMs),
    ]) })
    if (!response.body) return response
    const reader = response.body.getReader()
    let bytes = 0
    return new Response(new ReadableStream({
      async pull(controller) {
        try {
          const chunk = await reader.read()
          if (chunk.done) { controller.close(); return }
          bytes += chunk.value.byteLength
          if (bytes > maxBytes) { await reader.cancel(); throw Error('MCP response byte limit exceeded') }
          controller.enqueue(chunk.value)
        } catch { controller.error(Error('MCP response is unavailable or exceeds its limit')) }
      },
      async cancel() { await reader.cancel() },
    }), { status: response.status, statusText: response.statusText, headers: response.headers })
  }
}

function resolveReferences(references = {}, env) {
  return Object.fromEntries(Object.entries(references).map(([name, source]) => {
    const value = env[source.fromEnv]
    if (typeof value !== 'string' || !value || Buffer.byteLength(value) > 8192 || /[\0\r\n]/.test(value)) throw Error('Required MCP host configuration is unavailable')
    return [name, value]
  }))
}

function redactor(values) {
  const fragments = values.flatMap(value => {
    const bearer = /^\s*Bearer\s+(.+?)\s*$/i.exec(value)
    if (bearer) return [bearer[1]]
    const basic = /^\s*Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(value)
    if (!basic) return []
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    return [basic[1], decoded, ...(separator >= 0 && separator < decoded.length - 1 ? [decoded.slice(separator + 1)] : [])].filter(Boolean)
  })
  const secrets = [...new Set([...values, ...fragments])].sort((a, b) => b.length - a.length)
  const string = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), value)
  function redact(value) {
    if (typeof value === 'string') return string(value)
    if (Array.isArray(value)) return value.map(redact)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [string(key), redact(item)]))
    return value
  }
  return redact
}

/** One installed connector owns one MCP session. No shell, sampling, roots, or elicitation capability is granted.
 * @param {object} manifest
 * @param {{env?: Record<string, string|undefined>, signal?: AbortSignal, timeoutMs?: number, fetchImpl?: typeof fetch, cwd?: string}} [options]
 */
export async function openMcpSession(manifest, { env = process.env, signal, timeoutMs = 20000, fetchImpl = globalThis.fetch, cwd } = {}) {
  const selected = validateMcpManifest(manifest)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw Error('Invalid MCP request deadline')
  signal?.throwIfAborted()
  const lifetime = new AbortController()
  const transportConfig = selected.transport
  const variables = resolveReferences(transportConfig.env, env)
  const headers = resolveReferences(transportConfig.headers, env)
  const redact = redactor([...Object.values(variables), ...Object.values(headers)])
  const transport = transportConfig.type === 'stdio'
    ? new StdioClientTransport({ command: transportConfig.command, args: transportConfig.args, env: variables, cwd, stderr: 'pipe', maxBufferSize: RESPONSE_LIMIT })
    : new StreamableHTTPClientTransport(new URL(transportConfig.url), {
      fetch: boundedMcpFetch(fetchImpl, { timeoutMs, signal: lifetime.signal }),
      requestInit: { headers, redirect: 'error' },
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    })
  if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {})
  const client = new Client({ name: 'odk-personal-agent', version: '1.0.0' }, { capabilities: {} })
  client.onerror = () => {}
  let closed = false, closing, discovery, discoveryEpoch = 0
  const definitions = new Map()
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    discoveryEpoch++
    discovery = undefined
    definitions.clear()
  })
  client.onclose = () => { closed = true; lifetime.abort() }
  function close() {
    if (!closing) {
      closed = true
      closing = (async () => {
        try {
          if (transport instanceof StreamableHTTPClientTransport && transport.sessionId) {
            await withDeadline(() => transport.terminateSession(), undefined, Math.min(timeoutMs, 2000)).catch(() => {})
          }
        } finally { lifetime.abort(); await client.close() }
      })()
    }
    return closing
  }
  try { await withDeadline(callSignal => client.connect(transport, { timeout: timeoutMs, signal: callSignal }), signal, timeoutMs) }
  catch { await close().catch(() => {}); throw Error('MCP connection failed; check the installed connector and host configuration') }

  async function discover(signal) {
    if (closed) throw Error('MCP session is closed')
    signal?.throwIfAborted()
    if (!discovery) {
      const epoch = discoveryEpoch
      const attempt = (async () => {
        const tools = []
        const collected = new Map()
        const visited = new Set()
        let cursor, bytes = 0
        for (let page = 0; page < 8; page++) {
          // Own the complete, epoch-bound metadata. SDK listTools/callTool share
          // a per-page cache that late discovery responses can overwrite.
          const result = await client.request({ method: 'tools/list', params: cursor ? { cursor } : {} }, ListToolsResultSchema, { timeout: timeoutMs, signal })
          for (const tool of result.tools) {
            bytes += Buffer.byteLength(JSON.stringify(tool))
            if (tools.length >= 64 || bytes > 262144 || !TOOL_NAME.test(tool.name) || collected.has(tool.name)) throw Error('MCP tool discovery exceeds its limit or has duplicate names')
            const validate = new AjvJsonSchemaValidator().getValidator(tool.inputSchema)
            const validateOutput = tool.outputSchema ? new AjvJsonSchemaValidator().getValidator(tool.outputSchema) : undefined
            collected.set(tool.name, { validate, validateOutput, taskRequired: tool.execution?.taskSupport === 'required' })
            tools.push({ name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema,
              ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
              ...(tool.execution ? { execution: tool.execution } : {}),
              ...(tool.annotations ? { annotations: tool.annotations } : {}) })
          }
          if (!result.nextCursor) {
            if (epoch !== discoveryEpoch || closed) throw Error('MCP tool discovery changed before completion')
            definitions.clear()
            for (const [name, definition] of collected) definitions.set(name, definition)
            return tools
          }
          if (visited.has(result.nextCursor)) throw Error('MCP tool discovery cursor did not advance')
          visited.add(result.nextCursor)
          cursor = result.nextCursor
        }
        throw Error('MCP tool discovery is incomplete')
      })()
      discovery = attempt
      void attempt.catch(() => { if (discovery === attempt) { discovery = undefined; definitions.clear() } })
    }
    try { return await discovery }
    catch { throw Error('MCP tool discovery is unavailable or incomplete') }
  }
  return {
    get closed() { return closed },
    async tools(signal = undefined) {
      const result = redact(await discover(signal))
      if (Buffer.byteLength(JSON.stringify(result)) > 262144) throw Error('MCP tool discovery exceeds its safe data limit')
      return result
    },
    async call(name, args, signal = undefined) {
      if (closed) throw Error('MCP session is closed')
      signal?.throwIfAborted()
      await discover(signal)
      if (!TOOL_NAME.test(name) || !definitions.has(name)) throw Error('MCP tool is not declared or available')
      const definition = definitions.get(name)
      if (definition.taskRequired) throw Error('MCP tool requires task-based execution, which is unsupported')
      if (!args || typeof args !== 'object' || Array.isArray(args) || Buffer.byteLength(JSON.stringify(args)) > 32768 || !definition.validate(args).valid) throw Error('MCP tool arguments do not match its declared schema')
      signal?.throwIfAborted()
      try {
        const result = await withDeadline(callSignal => client.request({ method: 'tools/call', params: { name, arguments: args } }, CallToolResultSchema, { timeout: timeoutMs, signal: callSignal }), signal, timeoutMs)
        if (!result.isError && definition.validateOutput && !definition.validateOutput(result.structuredContent).valid) throw Error('MCP successful result does not match its declared schema')
        const safe = redact(result)
        if (Buffer.byteLength(JSON.stringify(safe)) > RESULT_LIMIT) return { isError: true, content: [{ type: 'text', text: 'MCP tool result exceeds the response limit. The call ran; do not replay it.' }] }
        return safe
      } catch { throw unknownOutcome() }
    },
    close,
  }
}
