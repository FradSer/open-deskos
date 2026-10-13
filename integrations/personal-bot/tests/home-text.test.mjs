import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PersonalBotService } from '../src/service.mjs'

test('typed turns share streaming session and serialize against voice', async () => {
  let complete
  let calls = 0
  const service = new PersonalBotService({ record: async () => { throw Error('must not record') }, transcribe: async () => '',
    prompt: async (text, snapshot) => { calls++; assert.equal(text, 'Hello 中文'); snapshot('Partial'); return await new Promise(resolve => { complete = resolve }) } })
  assert.equal(service.sendText('Hello 中文'), true)
  assert.equal(service.status.state, 'thinking')
  assert.equal(service.status.transcript, 'Hello 中文')
  assert.equal(service.sendText('duplicate'), false)
  await service.toggle()
  assert.equal(calls, 1)
  complete('Final')
  await service.pending
  assert.equal(service.status.message, 'Final')
  assert.equal(service.status.state, 'idle')
  assert.equal(service.sendText(' '.repeat(3)), false)
  assert.equal(service.sendText('中'.repeat(2000)), false)
  await service.close()
  assert.equal(service.sendText('after close'), false)
})
