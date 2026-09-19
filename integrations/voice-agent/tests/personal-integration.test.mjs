import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentOptions, sessionAdapter, createResourceLoader } from '../src/agent.mjs'
import { VoiceService } from '../src/service.mjs'

test('personal SDK options exclude builtin tools and isolate persisted sessions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-integration-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const options = agentOptions(dir, dir, [{ name: 'ride_status' }], 'personal')
  assert.deepEqual(options.tools, ['ride_status'])
  assert.equal(options.noTools, 'builtin')
  assert.ok(options.sessionManager.getSessionDir().includes('personal'))
})

test('personal resource context excludes inherited coding instructions', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'personal-loader-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'APPEND_SYSTEM.md'), 'OLD_CODING_CONTEXT_MARKER')
  const loader = await createResourceLoader(process.cwd(), dir, { profile: 'personal', skillPaths: [] })
  assert.deepEqual(loader.getAppendSystemPrompt(), [])
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, [])
  assert.deepEqual(loader.getSkills().skills, [])
  assert.match(loader.getSystemPrompt(), /个人助手/)
  assert.doesNotMatch(loader.getAppendSystemPrompt().join('\n'), /coding coordinator/)
})

test('ride updates defer during a request and cannot overwrite it or publish after shutdown', async () => {
  const service = new VoiceService({ record: async () => { throw Error('unused') }, transcribe: async () => '', prompt: async () => '' })
  service.setState('thinking', 'current answer', 'my question')
  service.notify('司机已接单')
  assert.equal(service.status.message, 'current answer')
  service.setState('idle', 'answer done')
  assert.match(service.status.message, /answer done/)
  assert.match(service.status.message, /司机已接单/)
  assert.equal(service.status.transcript, 'my question')
  await service.close()
  service.notify('late driver update')
  assert.equal(service.status.message, '')
})

test('transaction-aware failure text does not invite another order', async () => {
  const service = new VoiceService({ record: async () => ({ stop: async () => '/unused', cleanup: async () => {}, done: new Promise(() => {}) }), transcribe: async () => '确认', prompt: async () => { throw Error('timeout') }, failureMessage: '请求未完成。若涉及打车，请先查询订单状态，不要重复下单。' })
  await service.toggle()
  await service.toggle()
  assert.match(service.status.message, /先查询订单状态/)
  assert.doesNotMatch(service.status.message, /try again/)
  await service.close()
})

test('adapter grants only the accepted transcript and clears on completion, rejection and failure', async () => {
  const turns = []
  let resolve
  const session = { isStreaming: false, subscribe: () => () => {},
    prompt: () => new Promise(r => { resolve = r }), dispose() {}, abort() {} }
  const adapter = sessionAdapter(session, { beginTurn: text => turns.push(text) })
  const pending = adapter.prompt('确认叫车')
  await assert.rejects(adapter.prompt('other'), /progress/)
  assert.deepEqual(turns, ['确认叫车'])
  resolve()
  await pending
  assert.deepEqual(turns, ['确认叫车', ''])
  session.prompt = async () => { throw Error('model failed') }
  await assert.rejects(adapter.prompt('next'), /model failed/)
  assert.deepEqual(turns.slice(-2), ['next', ''])
})
