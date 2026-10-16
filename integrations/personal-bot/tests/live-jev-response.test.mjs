import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liveJevResponse } from './fixtures/live-jev-response.mjs'

test('live inference evidence preserves the response but excludes provider diagnostics', async () => {
  const body = { model: 'jev-fixture', answers: { c0: { type: 'noul', noul: 0.9, diagnostic: 'private provider content' }, error: 'private provider content', 'private provider diagnostic': { type: 'noul', noul: 0.9 } },
    usage: { input_tokens: 10, output_tokens: 2, diagnostic: 'private provider content' }, error: 'private provider content' }
  const result = await liveJevResponse(Response.json(body), ['c0'])
  assert.deepEqual(await result.response.json(), body)
  assert.deepEqual(result.metadata, { status: 200, usage: { input_tokens: 10, output_tokens: 2 }, rawAnswers: { c0: { type: 'noul', noul: 0.9 } } })
  assert.equal(JSON.stringify(result.metadata).includes('private provider content'), false)
})

test('live inference response capture cancels oversized streaming bodies', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(20000)) },
    cancel() { cancelled = true },
  }))
  await assert.rejects(liveJevResponse(response), /Oversized/)
  assert.equal(cancelled, true)
})
