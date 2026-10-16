import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import http from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { openLiveHostRelay } from './helpers/agent-live-relay.mjs'
import { createLivePlan, createLiveRequestBudget, createBudgetedFetch } from './helpers/agent-live-contract.mjs'

test('a reduced live plan cannot expand the authorized request or execution limits', () => {
  assert.equal(createLivePlan({ maxRequests: 78, deadlineMs: 880000 }).maxRequests, 78)
  for (const maxRequests of [0, 81, 1.5]) assert.throws(() => createLivePlan({ maxRequests }), /limit/)
  for (const deadlineMs of [0, 900001, 1.5]) assert.throws(() => createLivePlan({ deadlineMs }), /limit/)
})

test('a loopback relay preserves bytes, provider path and authority without changing the remote target', async t => {
  const upstream = http.createServer((request, response) => request.pipe(response))
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  let relay
  t.after(async () => { await relay?.close(); upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)) })
  const target = `http://127.0.0.1:${upstream.address().port}/v1`
  relay = await openLiveHostRelay(target)
  assert.equal(relay.host, '127.0.0.1')
  assert.equal(new URL(relay.baseUrl).hostname, 'host.docker.internal')
  assert.equal(new URL(relay.baseUrl).pathname, '/v1')
  assert.equal(relay.authority, new URL(target).host)
  const base = relay.baseUrl.replace('host.docker.internal', '127.0.0.1')
  const response = await fetch(`${base}/echo`, { method: 'POST', headers: relay.headers, body: 'offline bytes' })
  assert.equal(await response.text(), 'offline bytes')
  const client = net.connect({ host: relay.host, port: relay.port })
  await once(client, 'connect')
  const closed = once(client, 'close')
  await relay.close()
  await closed
  await assert.rejects(new Promise((resolve, reject) => {
    const late = net.connect({ host: relay.host, port: relay.port }); late.once('connect', () => { late.end(); resolve() }); late.once('error', reject)
  }), /ECONNREFUSED/)
})

test('host relay refuses unsupported or credential-bearing URLs before opening a listener', async () => {
  for (const url of ['https://example.invalid/v1', 'http://user:password@example.invalid/v1', 'http://example.invalid/v1?key=fixture', 'file:///tmp/fixture']) {
    await assert.rejects(openLiveHostRelay(url), /HTTP provider/)
  }
})

test('private relay rejects unknown callers and paths without contacting the provider', async t => {
  let relay, calls = 0
  const server = http.createServer((_request, response) => { calls++; response.end('offline') })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { await relay?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  relay = await openLiveHostRelay(`http://127.0.0.1:${server.address().port}/v1`)
  const base = relay.baseUrl.replace('host.docker.internal', '127.0.0.1')
  assert.equal((await fetch(`${base}/chat/completions`, { method: 'POST' })).status, 403)
  assert.equal((await fetch(`${base}/../admin`, { method: 'POST', headers: relay.headers })).status, 403)
  assert.equal(calls, 0)
})

test('the actual SDK sends the original provider authority through the private relay', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'odk-relay-sdk-'))
  let relay, received
  const server = http.createServer((request, response) => {
    received = { host: request.headers.host, path: request.url, method: request.method, privateKeyForwarded: request.headers['x-odk-live-relay-key'] !== undefined }
    request.resume()
    response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'Controlled offline failure' } }))
  })
  t.after(async () => { await relay?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  relay = await openLiveHostRelay(`http://127.0.0.1:${server.address().port}/v1`)
  const runtime = await ModelRuntime.create({ authPath: join(directory, 'auth.json'), modelsPath: null, refreshOnCreate: false })
  runtime.registerProvider('offline-relay', { api: 'openai-completions', apiKey: 'offline-only',
    baseUrl: relay.baseUrl.replace('host.docker.internal', '127.0.0.1'), headers: relay.headers,
    models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], contextWindow: 32768, maxTokens: 2048,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  })
  const budget = createLiveRequestBudget(1)
  const stream = runtime.streamSimple(runtime.getModel('offline-relay', 'fixture'), {
    messages: [{ role: 'user', content: 'Offline relay transport check', timestamp: Date.now() }],
  }, { apiKey: 'offline-only', maxTokens: 2048, maxRetries: 0,
    fetch: createBudgetedFetch({ budget, kind: 'generation', phase: () => 'offline-relay', maxOutputTokens: 2048 }) })
  assert.equal((await stream.result()).stopReason, 'error')
  assert.deepEqual(received, { host: relay.authority, path: '/v1/chat/completions', method: 'POST', privateKeyForwarded: false })
  assert.equal(budget.calls.length, 1)
  assert.equal(budget.calls[0].httpStatus, 503)
})
