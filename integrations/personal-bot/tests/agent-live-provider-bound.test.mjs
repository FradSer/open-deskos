import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { capLiveModelOutput, createLiveRequestBudget, createBudgetedFetch } from './helpers/agent-live-contract.mjs'

test('supported actual SDK adapters honor counted HTTP and disable provider retries', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-agent-provider-bound-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  for (const api of ['openai-responses', 'openai-completions', 'anthropic-messages']) await t.test(api, async () => {
    const runtime = await ModelRuntime.create({ authPath: join(directory, `${api}.json`), modelsPath: null, refreshOnCreate: false })
    runtime.registerProvider('contract-fixture', { api, baseUrl: 'https://example.invalid/v1', apiKey: 'offline-only', models: [{
      id: 'fixture', name: 'Fixture', reasoning: true, input: ['text'], contextWindow: 32768, maxTokens: 16384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }] })
    const budget = createLiveRequestBudget(5)
    let dispatched = 0, emittedCeiling
    const fetch = createBudgetedFetch({ budget, kind: 'generation', phase: () => api, maxOutputTokens: 2048, fetchImpl: async (_url, options) => {
      dispatched++
      assert.equal(options.redirect, 'error')
      const payload = JSON.parse(options.body)
      emittedCeiling = payload.max_output_tokens ?? payload.max_completion_tokens ?? payload.max_tokens
      return new Response(JSON.stringify({ error: { type: 'overloaded_error', message: 'Controlled offline error' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    } })
    const stream = runtime.streamSimple(capLiveModelOutput(runtime.getModel('contract-fixture', 'fixture')), {
      messages: [{ role: 'user', content: 'Offline transport contract', timestamp: Date.now() }],
    }, { apiKey: 'offline-only', maxTokens: 2048, reasoning: 'medium', maxRetries: 0, fetch })
    const result = await stream.result()
    assert(emittedCeiling > 0 && emittedCeiling <= 2048, `${api} emitted ${emittedCeiling} tokens`)
    assert.equal(result.stopReason, 'error')
    assert.equal(dispatched, 1, 'the SDK must not retry a failed HTTP request')
    assert.equal(budget.calls.length, 1)
    assert.equal(budget.calls[0].httpStatus, 503)
  })
})
