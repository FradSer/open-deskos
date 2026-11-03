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
  assert.deepEqual(Object.keys(config.providers), ['magpie'])
  assert.equal(config.providers.magpie.models.length, 1)
  assert.equal(config.providers.magpie.models[0].id, 'hunyuan-eval/hy4-dev')
  assert.equal(config.providers.magpie.apiKey, '$MAGPIE_API_KEY')
  assert.equal(config.providers.magpie.name, 'magpie')
  const escaped = 'Open\u00c2\u00a0deskOS'
  assert.equal(config.providers.magpie.headers['User-Agent'], escaped)
  assert.equal(config.providers.magpie.headers['X-Client-Name'], escaped)
  assert.equal(config.providers.magpie.headers['User-Agent'].split(' ')[0], escaped, 'no ASCII space for magpie to cut at')
  assert.equal(Buffer.from(escaped, 'latin1').toString('utf8').replace(/\u00a0/g, ' '), 'Open deskOS')
  assert.doesNotMatch(await readFile(modelsPath, 'utf8'), /synthetic-gateway-key/)
  const settings = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
  assert.equal(settings.defaultProvider, 'magpie')
  assert.equal(settings.defaultModel, 'hunyuan-eval/hy4-dev')
  assert.deepEqual(settings.enabledModels, ['magpie/hunyuan-eval/hy4-dev'])

  const previous = process.env.MAGPIE_API_KEY
  process.env.MAGPIE_API_KEY = 'synthetic-gateway-key'
  t.after(() => { if (previous === undefined) delete process.env.MAGPIE_API_KEY; else process.env.MAGPIE_API_KEY = previous })
  const runtime = await ModelRuntime.create({ modelsPath, allowModelNetwork: false, refreshOnCreate: false, credentials })
  const model = runtime.getModel('magpie', 'hunyuan-eval/hy4-dev')
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
  assert.equal(Buffer.from(request.headers.get('user-agent'), 'latin1').toString('utf8').replace(/\u00a0/g, ' '), 'Open deskOS')
  assert.equal(Buffer.from(request.headers.get('x-client-name'), 'latin1').toString('utf8').replace(/\u00a0/g, ' '), 'Open deskOS')
})
