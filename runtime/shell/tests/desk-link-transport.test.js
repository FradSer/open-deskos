'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createDeskLinkTransport } = require('../src/desk-link-client')

test('Desk Link exposes raw transport without constructing a client', async () => {
  const requests = []
  const transport = createDeskLinkTransport({ socketPath: '/fixture/link.sock', platform: 'linux',
    send: async (...args) => { requests.push(args); return { machines: ['fixture'] } } })
  assert.equal(requests.length, 0)
  assert.equal(transport.socketPath, '/fixture/link.sock')
  const controller = new AbortController()
  assert.deepEqual(await transport.request({ v: 1, type: 'machines' }, { signal: controller.signal }), { machines: ['fixture'] })
  assert.deepEqual(requests[0].slice(0, 3), ['/fixture/link.sock', { v: 1, type: 'machines' }, undefined])
  assert.equal(requests[0][3].signal, controller.signal)
  assert.equal(requests[0][3].token, '')
  controller.abort()
  assert.equal(await transport.request({ v: 1, type: 'machines' }, { signal: controller.signal }), null)
  assert.equal(requests.length, 1)
})

test('raw Desk Link transport retains token handshake inputs', async () => {
  const transport = createDeskLinkTransport({ socketPath: '\\\\.\\pipe\\fixture-link', platform: 'win32', token: 'fixture-only',
    send: async (_endpoint, _record, _timeout, channel) => channel })
  const channel = await transport.request({ v: 1, type: 'machines' })
  assert.equal(channel.token, 'fixture-only')
  assert.equal(channel.platform, 'win32')
})

test('Main grants raw Desk Link transport alongside the default constructor', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8')
  assert.ok(/'source\.desk-link':\s*\{\s*create:\s*createDeskLinkClient,\s*createTransport:\s*createDeskLinkTransport\s*\}/.test(main))
})
