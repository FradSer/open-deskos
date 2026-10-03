import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { channelRequiresToken, channelRequest } from '../src/runtime-channel.mjs'

test('named pipe overrides require a token even when resolved on a Unix host', () => {
  assert.equal(channelRequiresToken('\\\\.\\pipe\\open-deskos-desk-data', 'linux'), true)
  assert.equal(channelRequiresToken('tcp://127.0.0.1:17840', 'linux'), true)
  assert.equal(channelRequiresToken('/run/user/1000/desk-data.sock', 'linux'), false)
})

test('a request already aborted opens no connection', async () => {
  let connections = 0
  await assert.rejects(channelRequest({
    endpoint: '/unused.sock', payload: { v: 1, id: 'request' }, label: 'Desk data',
    signal: AbortSignal.abort(),
    connect() { connections++; return Object.assign(new EventEmitter(), { setEncoding() {}, destroy() {} }) },
  }), /request aborted/)
  assert.equal(connections, 0)
})

test('a peer closing without a complete response fails immediately', async t => {
  for (const partial of ['', '{"v":1']) {
    await t.test(partial ? 'partial response' : 'empty response', async () => {
      const socket = Object.assign(new EventEmitter(), { setEncoding() {}, destroy() {}, write() {} })
      const response = channelRequest({ endpoint: '/fixture.sock', payload: { v: 1, id: 'request' }, label: 'Desk data', timeoutMs: 100, connect: () => socket })
      socket.emit('data', partial)
      socket.emit('close')
      await assert.rejects(response, /closed before a complete response/)
    })
  }
})
