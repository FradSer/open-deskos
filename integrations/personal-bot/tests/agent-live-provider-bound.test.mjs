import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { capLiveModelOutput, recordLiveGenerationUsage, createLiveRequestBudget, createBudgetedFetch } from './helpers/agent-live-contract.mjs'

test('supported actual SDK adapters honor counted HTTP and disable provider retries', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-agent-provider-bound-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const api of ['openai-responses', 'openai-completions', 'anthropic-messages']) for (const limit of [2048, 16384]) for (const configured of [1024, 16384]) await t.test(`${api}/${limit}/${configured}`, async () => {
    const runtime = await ModelRuntime.create({ authPath: join(directory, `${api}.json`), modelsPath: null, refreshOnCreate: false })
    runtime.registerProvider('contract-fixture', { api, baseUrl: 'https://example.invalid/v1', apiKey: 'offline-only', models: [{
      id: 'fixture', name: 'Fixture', reasoning: true, input: ['text'], contextWindow: 32768, maxTokens: configured,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }] })
    const effectiveModel = capLiveModelOutput(runtime.getModel('contract-fixture', 'fixture'), limit)
    const budget = createLiveRequestBudget(5)
    let dispatched = 0, emittedCeiling
    const fetch = createBudgetedFetch({ budget, kind: 'generation', phase: () => api, maxOutputTokens: effectiveModel.maxTokens, fetchImpl: async (_url, options) => {
      dispatched++
      assert.equal(options.redirect, 'error')
      const payload = JSON.parse(options.body)
      emittedCeiling = payload.max_output_tokens ?? payload.max_completion_tokens ?? payload.max_tokens
      return new Response(JSON.stringify({ error: { type: 'overloaded_error', message: 'Controlled offline error' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    } })
    const stream = runtime.streamSimple(effectiveModel, {
      messages: [{ role: 'user', content: 'Offline transport contract', timestamp: Date.now() }],
    }, { apiKey: 'offline-only', maxTokens: effectiveModel.maxTokens, reasoning: 'medium', maxRetries: 0, fetch })
    const result = await stream.result()
    assert.equal(emittedCeiling, Math.min(limit, configured), `${api} must honor the selected output allowance`)
    assert.equal(result.stopReason, 'error')
    assert.equal(dispatched, 1, 'the SDK must not retry a failed HTTP request')
    assert.equal(budget.calls.length, 1)
    assert.equal(budget.calls[0].httpStatus, 503)
  })
})


test('the formal runner normalizes a cost-omitting model before actual SDK streaming', { skip: process.platform === 'win32' }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-live-model-config-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const agentDir = join(directory, 'agent'), bin = join(directory, 'bin'), capture = join(directory, 'envelope.json')
  await mkdir(agentDir); await mkdir(bin)
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'offline-config', defaultModel: 'fixture' }))
  for (const mode of ['direct', 'relay-model', 'relay-provider']) {
    const selected = { id: 'fixture', api: 'openai-completions', baseUrl: 'http://127.0.0.1:1/model-override', reasoning: false,
      input: ['text'], contextWindow: 32768, maxTokens: 1024, compat: { supportsDeveloperRole: false }, headers: { 'x-model-fixture': 'model' } }
    if (mode === 'relay-provider') { delete selected.baseUrl; selected.maxTokens = 8192; selected.cost = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 } }
    await writeFile(join(agentDir, 'models.json'), JSON.stringify({ providers: { 'offline-config': {
      api: 'anthropic-messages', baseUrl: 'http://127.0.0.1:1/provider-default', apiKey: 'offline-only',
      compat: { supportsStore: false }, headers: { 'x-provider-fixture': 'provider' }, models: [selected],
    } } }))
    await writeFile(join(bin, 'docker'), `#!${process.execPath}
  let input='';for await(const chunk of process.stdin)input+=chunk;await import('node:fs/promises').then(fs=>fs.writeFile(process.env.ODK_LIVE_TEST_CAPTURE,input));
  `, { mode: 0o700 })
    await assert.rejects(promisify(execFile)(process.execPath, ['scripts/test-agent-runtime-live.mjs', '--live', `--output=${join(directory, mode)}`, ...(mode === 'direct' ? [] : ['--host-relay']), ...(mode === 'relay-provider' ? ['--max-output-tokens=16384', '--max-requests=160'] : [])], {
      cwd: new URL('../', import.meta.url), timeout: 15000,
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: directory, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', TYPESAFE_API_KEY: 'offline-only', ODK_LIVE_TEST_CAPTURE: capture, ...(mode === 'relay-provider' ? { ODK_AGENT_PLUGIN_TIMEOUT_MS: '180000' } : {}) },
    }), error => error.code === 1) // The fake container cannot establish acceptance.
    const envelope = JSON.parse(await readFile(capture, 'utf8'))
    assert.deepEqual((await readdir(agentDir)).sort(), ['models.json', 'settings.json'], 'normalization creates no auth or model cache files')
    assert.equal(envelope.pluginTimeoutMs, mode === 'relay-provider' ? 180000 : 90000)
    assert.equal(envelope.plan.maxRequests, mode === 'relay-provider' ? 160 : 80)
    assert.equal(envelope.plan.maxOutputTokens, mode === 'relay-provider' ? 16384 : 2048)
    const runtime = await ModelRuntime.create({ authPath: join(directory, 'auth.json'), modelsPath: null, refreshOnCreate: false })
    runtime.registerProvider(envelope.provider, { ...envelope.providerConfig, models: [envelope.model] })
    let requests = 0, sent
    const stream = runtime.streamSimple(runtime.getModel(envelope.provider, selected.id), {
      messages: [{ role: 'user', content: 'Offline arithmetic fixture', timestamp: 0 }],
    }, { apiKey: 'offline-only', maxRetries: 0, fetch: async (url, options) => {
      requests++
      sent = { url: String(url), headers: new Headers(options.headers) }
      const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, completion_tokens_details: { reasoning_tokens: 1 } } }
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    } })
    const result = await stream.result()
    assert.equal(result.stopReason, 'stop', result.errorMessage)
    const base = mode === 'direct' ? selected.baseUrl : envelope.providerConfig.baseUrl
    assert.equal(sent.url, `${base}/chat/completions`, mode)
    assert.equal(sent.headers.get('x-model-fixture'), 'model'); assert.equal(sent.headers.get('x-provider-fixture'), 'provider')
    if (mode !== 'direct') assert.equal(sent.headers.has('x-odk-live-relay-key'), true)
    const usage = {}; recordLiveGenerationUsage(usage, result)
    assert.equal(usage.reasoningTokens, 1); assert.equal(usage.outputTokens, 2)
    assert.equal(result.usage.input, 5); assert.equal(result.usage.output, 2); assert.equal(requests, 1)
    assert.equal(envelope.provider, 'offline-config'); assert.equal(envelope.model.id, selected.id)
    for (const key of ['api', 'reasoning', 'input', 'contextWindow', 'maxTokens']) assert.deepEqual(envelope.model[key], selected[key])
    assert.deepEqual(envelope.model.compat, { supportsStore: false, supportsDeveloperRole: false })
    assert.equal(envelope.pricingKnown, mode === 'relay-provider')
    if (selected.cost) assert.deepEqual(envelope.model.cost, selected.cost)
    if (mode === 'direct') assert.equal(envelope.model.baseUrl, selected.baseUrl)
    else { assert.equal(envelope.transport, 'private_host_relay'); assert.equal(envelope.model.baseUrl, envelope.providerConfig.baseUrl) }
  }
  const invalid = [['--max-requests=0'], ['--max-requests=257'], ['--max-requests=1.5'], ['--max-requests=invalid'], ['--max-requests=80', '--max-requests=160'], ['--max-output-tokens=0'], ['--max-output-tokens=16385'], ['--max-output-tokens=1.5'], ['--max-output-tokens=invalid'], ['--max-output-tokens=2048', '--max-output-tokens=4096']]
  for (const [index, options] of invalid.entries()) {
    await rm(capture, { force: true })
    await assert.rejects(promisify(execFile)(process.execPath, ['scripts/test-agent-runtime-live.mjs', '--live', `--output=${join(directory, `invalid-${index}`)}`, ...options], {
      cwd: new URL('../', import.meta.url), timeout: 15000,
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: directory, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', TYPESAFE_API_KEY: 'offline-only', ODK_LIVE_TEST_CAPTURE: capture },
    }), error => { assert.equal(error.code, 1); if (options.length > 1) assert.match(error.stderr, /Usage:/); return true })
    await assert.rejects(readFile(capture), { code: 'ENOENT' }, 'invalid options cannot dispatch the fake container from an otherwise valid setup')
  }
  for (const [index, timeout] of ['invalid', '180001'].entries()) {
    await rm(capture, { force: true })
    await assert.rejects(promisify(execFile)(process.execPath, ['scripts/test-agent-runtime-live.mjs', '--live', `--output=${join(directory, `invalid-timeout-${index}`)}`], {
      cwd: new URL('../', import.meta.url), timeout: 15000,
      env: { PATH: `${bin}:${process.env.PATH}`, HOME: directory, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', TYPESAFE_API_KEY: 'offline-only', ODK_LIVE_TEST_CAPTURE: capture, ODK_AGENT_PLUGIN_TIMEOUT_MS: timeout },
    }), error => error.code === 1)
    await assert.rejects(readFile(capture), { code: 'ENOENT' }, 'invalid plugin timeout cannot dispatch a container')
  }


})
