import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const script = fileURLToPath(new URL('../scripts/test-intents-live.mjs', import.meta.url))
const preload = 'data:text/javascript,' + encodeURIComponent(`globalThis.fetch = async (_url, options) => {
  console.log('FIXTURE_FETCH');
  const request = JSON.parse(options.body);
  return Response.json({model:'jev-fixture', answers:{intent:{type:'choice',choice:'task_query',confidence:1,
    probabilities:Object.fromEntries(Object.keys(request.questions.intent.criteria).map(key => [key,key === 'task_query' ? 1 : 0]))}}});
};`)
const options = { env: { PATH: process.env.PATH, TYPESAFE_API_KEY: 'fixture-only' }, timeout: 5000 }

test('live intent harness rejects any unknown case ID before inference rather than silently reporting partial success', async () => {
  await assert.rejects(run(process.execPath, ['--import', preload, script, 'query-cn', 'missing-case'], options), error => {
    assert.match(error.stderr, /Unknown synthetic case/)
    assert.doesNotMatch(error.stdout, /FIXTURE_FETCH/)
    return true
  })
})

test('live intent harness selected cases use the real response parser with an offline HTTP fixture', async () => {
  const { stdout } = await run(process.execPath, ['--import', preload, script, 'query-cn'], options)
  const rows = stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))
  assert.equal(rows[0].id, 'query-cn')
  assert.equal(rows[0].model, 'jev-fixture')
  assert.deepEqual(rows.at(-1), { cases: 1, passed: 1, failed: 0 })
  assert.equal(stdout.split('FIXTURE_FETCH').length - 1, 1)
})
