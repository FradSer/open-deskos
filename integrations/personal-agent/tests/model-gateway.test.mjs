import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'

const script = fileURLToPath(new URL('../scripts/configure-model-gateway.mjs', import.meta.url))
const credentials = { read: async () => undefined, list: async () => [],
  modify: async () => { throw Error('Read only fixture') }, delete: async () => { throw Error('Read only fixture') } }

test('the Open deskOS gateway config sends one model through the shared endpoint as Open deskOS', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'odk-model-gateway-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const modelsPath = join(dir, 'models.json')
  const configured = spawnSync(process.execPath, [script, '--models-path', modelsPath], { encoding: 'utf8', env: process.env })
  assert.equal(configured.status, 0, configured.stderr)

  const config = JSON.parse(await readFile(modelsPath, 'utf8'))
  assert.deepEqual(Object.keys(config.providers), ['open-deskos'])
  assert.equal(config.providers['open-deskos'].models.length, 1)
  assert.equal(config.providers['open-deskos'].models[0].id, 'hunyuan-eval/hy4-dev')
  assert.equal(config.providers['open-deskos'].apiKey, '$MAGPIE_API_KEY')
  assert.equal(config.providers['open-deskos'].headers['User-Agent'], 'Open deskOS')
  assert.equal(config.providers['open-deskos'].headers['X-Client-Name'], 'Open deskOS')
  assert.doesNotMatch(await readFile(modelsPath, 'utf8'), /synthetic-gateway-key/)
  const settings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
  assert.equal(settings.defaultProvider, 'open-deskos')
  assert.equal(settings.defaultModel, 'hunyuan-eval/hy4-dev')
  assert.deepEqual(settings.enabledModels, ['open-deskos/hunyuan-eval/hy4-dev'])

  const previous = process.env.MAGPIE_API_KEY
  process.env.MAGPIE_API_KEY = 'synthetic-gateway-key'
  t.after(() => { if (previous === undefined) delete process.env.MAGPIE_API_KEY; else process.env.MAGPIE_API_KEY = previous })
  const runtime = await ModelRuntime.create({ modelsPath, allowModelNetwork: false, refreshOnCreate: false, credentials })
  const model = runtime.getModel('open-deskos', 'hunyuan-eval/hy4-dev')
  assert.ok(model)
  let request
  const result = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'hi', timestamp: 0 }] }, {
    maxRetries: 0,
    fetch: async (url, options) => {
      request = { url: String(url), headers: new Headers(options.headers), body: JSON.parse(options.body) }
      return new Response('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  assert.equal(result.stopReason, 'stop')
  assert.equal(request.url, 'http://10.10.0.195:3425/v1/chat/completions')
  assert.equal(request.body.model, 'hunyuan-eval/hy4-dev')
  assert.equal(request.headers.get('authorization'), 'Bearer synthetic-gateway-key')
  assert.equal(request.headers.get('user-agent'), 'Open deskOS')
  assert.equal(request.headers.get('x-client-name'), 'Open deskOS')
})
