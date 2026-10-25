import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { watch } from 'node:fs'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { openMcpSession, boundedMcpFetch } from '../src/agent-catalog/mcp.mjs'

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-agent-mcp-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const events = join(directory, 'events')
  await writeFile(events, '')
  const manifest = { schemaVersion: 1, kind: 'mcp', id: 'offline-fixture', name: 'Offline fixture', transport: { type: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/agent-mcp-server.mjs', import.meta.url))], env: { FIXTURE_EVENTS: { fromEnv: 'ODK_MCP_EVENTS' }, FIXTURE_SECRET: { fromEnv: 'ODK_MCP_FIXTURE_SECRET' } } } }
  return { events, manifest, env: { ODK_MCP_EVENTS: events, ODK_MCP_FIXTURE_SECRET: 'connector-private-fixture' } }
}

async function event(file, expected) {
  return new Promise((resolve, reject) => {
    const watcher = watch(file, () => { void inspect() })
    const timer = setTimeout(() => finish(Error('Fixture event deadline exceeded')), 5000)
    function finish(error) { clearTimeout(timer); watcher.close(); error ? reject(error) : resolve(undefined) }
    async function inspect() { try { if ((await readFile(file, 'utf8')).includes(expected)) finish() } catch (error) { finish(error) } }
    void inspect()
  })
}

test('real stdio MCP preserves session state, validates inputs, redacts connector credentials and closes its process', async t => {
  const { manifest, env, events } = await fixture(t)
  const previous = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'provider-private-fixture'
  t.after(() => { if (previous === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = previous })
  const session = await openMcpSession(manifest, { env })
  t.after(() => session.close())
  assert.deepEqual((await session.tools()).map(tool => tool.name), ['echo', 'wait', 'fail', 'large'])
  const first = await session.call('echo', { text: 'one' })
  assert.equal(first.structuredContent.calls, 1)
  assert.equal(first.structuredContent.connectorCredential, '[redacted]')
  assert.equal(first.structuredContent.inheritedProviderCredential, null)
  await assert.rejects(session.call('echo', { text: 123 }), /arguments/i)
  await assert.rejects(session.call('unknown', {}), /declared|available/i)
  assert.equal((await session.call('echo', { text: 'two' })).structuredContent.calls, 2)
  assert.equal((await session.call('fail', { text: 'x' })).isError, true)
  const pid = Number((await readFile(events, 'utf8')).match(/pid:(\d+)/)[1])
  await session.close()
  assert.throws(() => process.kill(pid, 0), /ESRCH/)
  await assert.rejects(session.call('echo', { text: 'late' }), /closed/i)
})

test('cancelling an executing MCP mutation reports uncertainty and never repeats it', async t => {
  const { manifest, env, events } = await fixture(t)
  const session = await openMcpSession(manifest, { env })
  t.after(() => session.close())
  const controller = new AbortController()
  const pending = session.call('wait', { text: 'effect' }, controller.signal)
  const observed = assert.rejects(pending, /outcome unknown.*do not retry/i)
  await event(events, 'called:wait')
  controller.abort()
  await observed
  await session.close()
  assert.equal((await readFile(events, 'utf8')).split('called:wait').length - 1, 1)
})

test('oversized MCP output returns a bounded failure without replay', async t => {
  const { manifest, env, events } = await fixture(t)
  const session = await openMcpSession(manifest, { env })
  t.after(() => session.close())
  const result = await session.call('large', { text: 'effect' })
  assert.equal(result.isError, true)
  assert.match(JSON.stringify(result), /exceeds.*limit/i)
  assert(JSON.stringify(result).length < 1000)
  assert.equal((await readFile(events, 'utf8')).split('called:large').length - 1, 1)
})

test('MCP HTTP fetch rejects redirects and bounds streamed response bytes', async () => {
  let options
  const request = boundedMcpFetch(async (_url, init) => { options = init; return new Response('x'.repeat(20)) }, { maxBytes: 10, timeoutMs: 1000 })
  const response = await request('https://example.invalid/mcp', {})
  assert.equal(options.redirect, 'error')
  await assert.rejects(response.text(), /limit|response/i)
})

test('real Streamable HTTP discovers and calls a server with host-owned header references', async t => {
  const server = new Server({ name: 'local-http-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'report', description: 'Read a fixture report', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] }))
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'Three regions checked. http-private-fixture' }] }))
  await server.connect(transport)
  const headers = [], methods = []
  const http = createServer((request, response) => {
    headers.push(request.headers.authorization)
    methods.push(request.method)
    void transport.handleRequest(request, response).catch(() => { response.destroy() })
  })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  t.after(async () => { await server.close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)) })
  const session = await openMcpSession({ schemaVersion: 1, kind: 'mcp', id: 'http-fixture', name: 'HTTP fixture', transport: {
    type: 'streamable-http', url: `http://127.0.0.1:${http.address().port}/mcp`, headers: { Authorization: { fromEnv: 'ODK_MCP_HTTP_AUTH' } },
  } }, { env: { ODK_MCP_HTTP_AUTH: ' Bearer http-private-fixture ' } })
  t.after(() => session.close())
  assert.equal((await session.tools())[0].name, 'report')
  const result = await session.call('report', {})
  assert.match(result.content[0].text, /Three regions/)
  assert(!JSON.stringify(result).includes('http-private-fixture'))
  assert(headers.length >= 3)
  assert(headers.every(value => value === 'Bearer http-private-fixture'))
  await session.close()
  assert(methods.includes('DELETE'))
})

test('the whole MCP initialization is bounded even if initialized notification ignores abort', { timeout: 5000 }, async () => {
  let initialized = false
  const fakeFetch = async (_url, init) => {
    if (init.method === 'GET') return new Response(null, { status: 405 })
    const message = JSON.parse(init.body)
    if (message.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id,
      result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } }), { headers: { 'content-type': 'application/json' } })
    initialized = true
    return new Promise(() => {})
  }
  await assert.rejects(openMcpSession({ schemaVersion: 1, kind: 'mcp', id: 'stalled-fixture', name: 'Stalled fixture', transport: { type: 'streamable-http', url: 'https://example.invalid/mcp' } }, { fetchImpl: fakeFetch, timeoutMs: 1000 }), /connection failed/i)
  assert.equal(initialized, true)
})

test('MCP tool-list notifications invalidate old schemas before another discovery', async t => {
  const { manifest, env } = await fixture(t)
  const session = await openMcpSession(manifest, { env })
  t.after(() => session.close())
  assert.equal((await session.tools()).length, 4)
  await session.call('echo', { text: 'reveal-tool' })
  assert.equal((await session.tools()).at(-1).name, 'newtool')
  assert.equal((await session.call('newtool', { text: 'new schema' })).content[0].text, 'new schema')
})

test('output schemas from earlier discovery pages still reject invalid successful results without replay', async t => {
  const { manifest, env, events } = await fixture(t)
  manifest.transport.args.push('--pages')
  const session = await openMcpSession(manifest, { env })
  t.after(() => session.close())
  assert.deepEqual((await session.tools()).map(tool => tool.name), ['validated', 'echo'])
  await assert.rejects(session.call('validated', { text: 'effect' }), /outcome unknown.*do not retry/i)
  assert.equal((await readFile(events, 'utf8')).split('called:validated').length - 1, 1)
})

async function localHttpSession(t, listTools, callTool, { fetchImpl = fetch } = {}) {
  const server = new Server({ name: 'schema-race-fixture', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true })
  server.setRequestHandler(ListToolsRequestSchema, listTools)
  server.setRequestHandler(CallToolRequestSchema, callTool)
  await server.connect(transport)
  const http = createServer((request, response) => { void transport.handleRequest(request, response).catch(() => response.destroy()) })
  http.listen(0, '127.0.0.1')
  await once(http, 'listening')
  t.after(async () => { await server.close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)) })
  const notificationStream = Promise.withResolvers()
  const timeoutMs = 20000 // Keep the product's existing connection deadline.
  const timeout = setTimeout(() => notificationStream.reject(Error('Fixture notification stream was not ready')), timeoutMs)
  const abort = () => notificationStream.reject(t.signal.reason)
  t.signal.addEventListener('abort', abort, { once: true })
  void notificationStream.promise.catch(() => {})
  try {
    const session = await openMcpSession({ schemaVersion: 1, kind: 'mcp', id: 'schema-fixture', name: 'Schema fixture', transport: {
      type: 'streamable-http', url: `http://127.0.0.1:${http.address().port}/mcp`,
    } }, { timeoutMs, fetchImpl: async (url, init) => {
      try {
        const response = await fetchImpl(url, init)
        if (init?.method === 'GET') {
          if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) throw Error('Fixture notification stream is unavailable')
          notificationStream.resolve()
        }
        return response
      } catch (error) {
        if (init?.method === 'GET') notificationStream.reject(error)
        throw error
      }
    } })
    t.after(() => session.close())
    // Initialization can complete before the SDK's asynchronous GET stream exists.
    await notificationStream.promise
    return { server, session }
  } finally {
    clearTimeout(timeout)
    t.signal.removeEventListener('abort', abort)
  }
}

test('HTTP discovery fixture waits for the actual notification stream before returning', async t => {
  const getStarted = Promise.withResolvers(), releaseGet = Promise.withResolvers()
  let streamReceived = false
  t.after(() => releaseGet.resolve())
  const opening = localHttpSession(t, async () => ({ tools: [] }), async () => ({ content: [] }), {
    fetchImpl: async (url, init) => {
      if (init?.method === 'GET') { getStarted.resolve(); await releaseGet.promise }
      const response = await fetch(url, init)
      if (init?.method === 'GET') {
        assert.equal(response.ok, true)
        assert.match(response.headers.get('content-type'), /text\/event-stream/)
        streamReceived = true
      }
      return response
    },
  }).then(fixture => {
    assert.equal(streamReceived, true, 'initialization is not notification-stream readiness')
    return fixture
  })
  await getStarted.promise
  // Yield one event-loop turn; no elapsed-time assumption controls the held GET.
  setImmediate(() => releaseGet.resolve())
  const { server } = await opening
  await server.ping()
})

test('a late discovery response cannot corrupt the active output validation contract', async t => {
  const started = Promise.withResolvers(), release = Promise.withResolvers()
  let lists = 0, calls = 0
  const { server, session } = await localHttpSession(t, async () => {
    const first = ++lists === 1
    if (first) { started.resolve(); await release.promise }
    return { tools: [{ name: 'report', inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', required: ['value'], properties: { value: { type: first ? 'number' : 'string' } } } }] }
  }, async () => { calls++; return { content: [], structuredContent: { value: 'valid' } } })
  t.after(() => release.resolve())
  const old = assert.rejects(session.tools(), /unavailable|incomplete/i)
  await started.promise
  await server.notification({ method: 'notifications/tools/list_changed' })
  await server.ping() // Acknowledgement proves the preceding notification reached this client.
  assert.equal((await session.tools())[0].outputSchema.properties.value.type, 'string')
  release.resolve()
  await old
  assert.equal((await session.call('report', {})).structuredContent.value, 'valid')
  assert.equal(calls, 1)
})

test('a task-required tool on an earlier page is refused before synchronous dispatch', async t => {
  let calls = 0
  const { session } = await localHttpSession(t, async request => request.params?.cursor
    ? { tools: [{ name: 'report', inputSchema: { type: 'object', properties: {} } }] }
    : { tools: [{ name: 'task_only', inputSchema: { type: 'object', properties: {} }, execution: { taskSupport: 'required' } }], nextCursor: 'next' },
  async () => { calls++; return { content: [] } })
  await assert.rejects(session.call('task_only', {}), /requires.*task.*unsupported/i)
  assert.equal(calls, 0)
})
