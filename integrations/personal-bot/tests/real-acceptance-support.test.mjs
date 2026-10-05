import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { acceptanceEndpoint, cleanupAcceptance, acceptanceTools, observePersonalTurn } from './helpers/real-acceptance-support.mjs'

test('cleanup rejection and timeout cannot skip endpoint, environment or owned project cleanup', async () => {
  const completed = []
  const result = await cleanupAcceptance([
    { name: 'abort', run: async () => { throw Error('Rejected abort') } },
    { name: 'close', run: () => new Promise(() => {}) },
    ...['endpoint', 'dispose', 'environment', 'project'].map(name => ({ name, run: () => { completed.push(name) } })),
  ], 25)
  assert.deepEqual(completed, ['endpoint', 'dispose', 'environment', 'project'])
  assert.deepEqual(result.map(item => item.step), ['abort', 'close'])
})

test('a failed prompt preserves its actual mutation ID and identity without replay', async () => {
  const identity = { project: '/private/tmp/fixture', taskId: '11111111-1111-4111-8111-111111111111' }
  const mutationId = '22222222-2222-4222-8222-222222222222'
  const trace = []
  let calls = 0
  const guarded = acceptanceTools([{ name: 'coding_task_prompt', execute: async () => {
    calls++; throw Error(`Task prompt outcome unknown; mutationId=${mutationId}; do not retry`)
  } }], identity, trace)
  const params = { ...identity, target: 'mac', prompt: 'Write only the fixture marker' }
  await assert.rejects(guarded.tools[0].execute('test', params))
  assert.equal(guarded.getOffer().mutationId, mutationId)
  assert.equal(guarded.getOffer().project, identity.project)
  assert.equal(guarded.getOffer().taskId, identity.taskId)
  assert.equal(trace[0].outcome, 'unknown')
  await assert.rejects(guarded.tools[0].execute('test', params))
  assert.equal(calls, 1)
})

test('the acceptance custom catalog permits only required coding reads and exact continuation', async () => {
  const names = ['coding_targets', 'coding_tasks_list', 'coding_task_status', 'coding_task_history', 'coding_task_prompt',
    'memory_update', 'user_app_install', 'didi_submit', 'coding_task_start', 'desk_data']
  const guarded = acceptanceTools(names.map(name => ({ name, execute: () => assert.fail('Catalog check must not execute') })), {}, [])
  assert.deepEqual(guarded.tools.map(tool => tool.name), names.slice(0, 5))
})

test('malformed service frames reject the observer and close its socket', async () => {
  const client = new PassThrough()
  let destroyed = false
  client.destroy = () => { destroyed = true }
  const waiting = observePersonalTurn(client, { handshake: '', states: [], timeoutMs: 200 })
  try { client.emit('data', '{invalid}\n') } catch { /* RED exposes escaped callback exception. */ }
  await assert.rejects(waiting, /Invalid|Malformed/)
  assert.equal(destroyed, true)
})

test('settlement handles late socket errors until close without an unhandled event', async () => {
  const client = new PassThrough()
  client.destroy = () => {}
  const waiting = observePersonalTurn(client, { handshake: '', states: [], timeoutMs: 200 })
  client.emit('data', '{invalid}\n')
  await assert.rejects(waiting, /Invalid|Malformed/)
  assert.doesNotThrow(() => client.emit('error', Error('Late transport error')))
  assert.doesNotThrow(() => client.emit('close'))
  assert.equal(client.listenerCount('error'), 0)
})

test('resident service user identity is required before private provider startup', async () => {
  const support = await import('./helpers/real-acceptance-support.mjs')
  assert.equal(typeof support.assertResidentIdentity, 'function')
  assert.throws(() => support.assertResidentIdentity(1000, 0), /Resident service user required/)
  assert.doesNotThrow(() => support.assertResidentIdentity(1000, 1000))
})

test('private acceptance endpoints preserve the Windows named pipe prefix', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
  assert.deepEqual(acceptanceEndpoint('win32', 'unused', id).split(String.fromCharCode(92)), ['', '', '.', 'pipe', `odk-real-pa-${id}`])
})
