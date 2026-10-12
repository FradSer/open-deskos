'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createPluginHost } = require('../src/plugin-host')
const { createDataSourcePlugins, DATA_PORTS } = require('../src/plugins/data-sources')
const { createQuotaSource } = require('../src/quota-source')
const { fetchOpenCodeGo } = require('../src/opencode-go')
const http = require('node:http')

test('quota disable cancels and waits for the actual pending read before restart', async () => {
  let finish
  const pending = new Promise(resolve => { finish = resolve })
  let entered
  const entering = new Promise(resolve => { entered = resolve })
  let signal
  let calls = 0
  const handlers = new Map()
  const host = createPluginHost({ capabilities: {
    ipc: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    'source.quota': { read: options => { calls++; signal = options?.signal; entered(); return pending } },
  } })
  host.register(createDataSourcePlugins().find(plugin => plugin.manifest.id === 'odk.source.quota'))
  await host.start()
  const source = host.get(DATA_PORTS.quota)
  const reading = source.read()
  await entering
  let disabled = false
  const disabling = host.setEnabled('odk.source.quota', false).then(() => { disabled = true })
  const enabling = host.setEnabled('odk.source.quota', true)
  try {
    assert.equal(signal?.aborted, true)
    await new Promise(setImmediate)
    assert.equal(disabled, false)
    const stopped = await source.read()
    assert.equal(stopped.state, 'unavailable')
    assert.equal(calls, 1)
  } finally { finish({ state: 'available', snapshot: { accounts: [] } }) }
  assert.equal((await reading).state, 'unavailable')
  await Promise.all([disabling, enabling])
  assert.notEqual(host.get(DATA_PORTS.quota), source)
  await host.stop()
  assert.equal(handlers.size, 0)
})

for (const partial of [false, true]) {
  test(`Quota cancellation closes the native HTTP request ${partial ? 'during a response body' : 'before response headers'}`, async t => {
    let entered
    const entering = new Promise(resolve => { entered = resolve })
    const server = http.createServer((_request, response) => {
      if (partial) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{"authfiles":') }
      entered()
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
    const request = http.request
    const requests = []
    http.request = (...args) => {
      const resource = request(...args)
      const owned = { resource, closed: false }
      resource.once('close', () => { owned.closed = true })
      requests.push(owned)
      return resource
    }
    t.after(() => { http.request = request })
    const source = createQuotaSource({ read: options => fetchOpenCodeGo({ configured: true,
      baseUrl: `http://127.0.0.1:${server.address().port}`, managementKey: 'fixture-key' }, options) })
    const pending = source.read()
    await entering
    await source.stop()
    assert.equal((await pending).state, 'unavailable')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].closed, true)
    assert.equal((await source.read()).state, 'unavailable')
    assert.equal(requests.length, 1)
  })
}

for (const optional of [false, true]) {
  test(`Quota cancellation drains concurrent ${optional ? 'optional' : 'primary'} provider requests and fallback attempts`, async t => {
    let entered
    const entering = new Promise(resolve => { entered = resolve })
    let held = 0
    const authfiles = ['codex', 'xai', 'antigravity'].map((type, index) => ({ type, auth_index: String(index), name: `${type}-fixture.json` }))
    const server = http.createServer((request, response) => {
      const send = value => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
      if (request.url.endsWith('/auth-files')) { send({ authfiles }); return }
      let body = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { body += chunk })
      request.on('end', () => {
        const call = JSON.parse(body)
        if (optional && call.url.endsWith('/wham/usage')) {
          send({ status_code: 200, body: JSON.stringify({ rate_limit: { primary_window: { used_percent: 12 } } }) })
        } else if (optional && call.url.includes('/billing?')) {
          send({ status_code: 200, body: JSON.stringify({ config: { creditUsagePercent: 23 } }) })
        } else if (optional && call.url.includes('retrieveUserQuotaSummary')) {
          send({ status_code: 200, body: JSON.stringify({ groups: [{ buckets: [{ remainingFraction: 0.8 }] }] }) })
        } else {
          held++
          if (held === (optional ? 2 : 3)) entered()
        }
      })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
    const original = http.request
    const requests = []
    let completed = 0
    let finishCompleted
    const completedRequests = new Promise(resolve => { finishCompleted = resolve })
    http.request = (...args) => {
      const resource = original(...args)
      const owned = { closed: false, aborted: false }
      resource.once('close', () => {
        owned.closed = true
        if (!owned.aborted && ++completed === 4) finishCompleted()
      })
      resource.once('error', error => { owned.aborted = error.code === 'ABORT_ERR' })
      requests.push(owned)
      return resource
    }
    t.after(() => { http.request = original })
    const source = createQuotaSource({ read: options => fetchOpenCodeGo({ configured: true,
      baseUrl: `http://127.0.0.1:${server.address().port}`, managementKey: 'fixture-key' }, options) })
    const reading = source.read()
    await entering
    // Optional reads start before every completed primary request emits close.
    // Wait for those four resources before testing only the two pending reads.
    if (optional) await completedRequests
    await source.stop()
    assert.equal((await reading).state, 'unavailable')
    assert.equal(requests.filter(request => request.aborted).length, optional ? 2 : 5)
    assert.equal(requests.filter(request => request.aborted).every(request => request.closed), true)
    assert.equal(held, optional ? 2 : 3, 'aborted fallback attempts send no new provider requests')
  })
}

test('Quota native HTTP reads preserve provider fallback, optional failures, and account isolation', async t => {
  const calls = []
  const original = http.request
  const requests = []
  http.request = (...args) => {
    const resource = original(...args)
    const owned = { closed: false }
    resource.once('close', () => { owned.closed = true })
    requests.push(owned)
    return resource
  }
  t.after(() => { http.request = original })
  let antigravityAttempts = 0
  const server = http.createServer((request, response) => {
    const send = value => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
    if (request.url.endsWith('/auth-files')) {
      send({ authfiles: [
        { type: 'codex', auth_index: 'codex', name: 'codex-fixture.json' },
        { type: 'antigravity', auth_index: 'antigravity', name: 'antigravity-fixture.json' },
        { type: 'xai', auth_index: 'xai', name: 'xai-fixture.json' },
        { type: 'xai', auth_index: 'failed', name: 'failed-fixture.json' },
        { type: 'xai', auth_index: 'disabled', disabled: true },
      ] })
      return
    }
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const call = JSON.parse(body)
      calls.push(call)
      let result
      if (call.auth_index === 'failed' || call.url.endsWith('rate-limit-reset-credits') || call.url.endsWith('/settings')) {
        send({ status_code: 503 }); return
      }
      if (call.auth_index === 'codex') result = { plan_type: 'pro', rate_limit: { primary_window: { used_percent: 12, reset_at: 1800000000 } } }
      if (call.auth_index === 'xai') result = { config: { creditUsagePercent: 23 } }
      if (call.auth_index === 'antigravity') {
        if (++antigravityAttempts === 1) { send({ status_code: 503 }); return }
        result = { groups: [{ displayName: 'Models', buckets: [{ remainingFraction: 0.8, resetTime: '2027-01-01T00:00:00Z' }] }] }
      }
      send({ status_code: 200, body: JSON.stringify(result) })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const source = createQuotaSource({ read: options => fetchOpenCodeGo({ configured: true,
    baseUrl: `http://127.0.0.1:${server.address().port}`, managementKey: 'fixture-key' }, options) })
  t.after(() => source.stop())
  const result = await source.read()
  assert.equal(result.state, 'available')
  assert.equal(Number.isFinite(Date.parse(result.snapshot.fetchedAt)), true)
  assert.deepEqual(result.snapshot.accounts.map(account => account.id), ['codex', 'antigravity', 'xai', 'failed'])
  const [codex, antigravity, xai, failed] = result.snapshot.accounts
  assert.equal(codex.plan, 'Pro')
  assert.equal(codex.groups[0].quotas[0].remainingPct, 88)
  assert.equal(codex.groups[0].quotas[0].resetAt, new Date(1800000000000).toISOString())
  assert.deepEqual(codex.resetCredits, { available: 0, expiresAt: [] })
  assert.equal(antigravity.groups[0].quotas[0].remainingPct, 80)
  assert.equal(antigravityAttempts, 2)
  assert.equal(xai.groups[0].quotas[0].remainingPct, 77)
  assert.equal(failed.error, 'Provider returned HTTP 503')
  assert.equal(calls.some(call => call.auth_index === 'disabled'), false)
  await source.stop()
  assert.equal(requests.every(request => request.closed), true)
})
