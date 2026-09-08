import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VoiceService } from '../src/service.mjs'

function fixture(overrides = {}) {
  const calls = []
  const recording = { stop: async () => 'audio.wav', cleanup: async () => calls.push('cleanup'), done: new Promise(() => {}) }
  const service = new VoiceService({ record: async () => recording, transcribe: async () => 'hello', prompt: async text => { calls.push(text) }, ...overrides })
  service.subscribe(s => calls.push(s.state))
  return { service, calls }
}

test('toggle capture sends transcript once and removes audio', async () => {
  const { service, calls } = fixture()
  await service.toggle()
  assert.equal(service.status.state, 'recording')
  await service.toggle()
  assert.deepEqual(calls, ['recording', 'transcribing', 'thinking', 'hello', 'cleanup', 'idle'])
})

test('busy toggle ignored; provider failure safely retryable', async () => {
  let finish
  const { service, calls } = fixture({ transcribe: () => new Promise(resolve => { finish = resolve }) })
  await service.toggle()
  const turn = service.toggle()
  await new Promise(resolve => setImmediate(resolve))
  await service.toggle()
  finish('hello')
  await turn
  assert.equal(calls.filter(x => x === 'recording').length, 1)
  const failed = fixture({ transcribe: async () => { throw Error('secret') } })
  await failed.service.toggle()
  await failed.service.toggle()
  assert.equal(failed.service.status.state, 'error')
  assert.ok(!JSON.stringify(failed.service.status).includes('secret'))
  assert.ok(failed.calls.includes('cleanup'))
  await failed.service.toggle()
  assert.equal(failed.service.status.state, 'recording')
  await failed.service.close()
})

test('cleanup failure is contained and produces safe error', async () => {
  const { service } = fixture({ record: async () => ({ done: new Promise(() => {}), stop: async () => 'audio', cleanup: async () => { throw Error('private-path') } }) })
  await service.toggle()
  await service.toggle()
  assert.equal(service.status.state, 'error')
  assert.ok(!service.status.message.includes('private-path'))
})

test('final response is a bounded status message', async () => {
  const { service } = fixture({ prompt: async () => 'x'.repeat(2000) })
  await service.toggle()
  await service.toggle()
  assert.equal(service.status.message, 'x'.repeat(1024))
})

test('deadline stops recording and shutdown discards capture', async () => {
  const { service, calls } = fixture({ maxRecordingMs: 10 })
  await service.toggle()
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.ok(calls.includes('hello'))
  await service.toggle()
  await service.close()
  assert.equal(calls.filter(x => x === 'hello').length, 1)
})
