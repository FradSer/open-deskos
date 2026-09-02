'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { RemoteBridgeHost } = require('../lib/remote-bridge-host')
const { MockTransport } = require('./mock-transport')
const { createJsonLineReader } = require('../lib/json-line-reader')
const { PROTOCOL_VERSION } = require('../lib/protocol')

test('Remote Bridge Host registers and arbitrates transports by priority', async (t) => {
  const runtimeDirectory = await fs.promises.mkdtemp('/tmp/odk-rbh-')
  const socketPath = path.join(runtimeDirectory, 'bridge.sock')
  const usbTransport = new MockTransport({ id: 'odk.remote.transport.usb-cdc', priority: 100, transport: 'usb-cdc' })
  const wirelessTransport = new MockTransport({ id: 'odk.remote.transport.c6-uart', priority: 50, transport: 'wireless' })

  const host = new RemoteBridgeHost({
    transports: [wirelessTransport, usbTransport],
    socketPath,
    logger: { error() {} },
  })

  await host.start()
  t.after(async () => {
    await host.stop()
    await fs.promises.rm(runtimeDirectory, { recursive: true, force: true })
  })

  assert.equal(usbTransport.started, true)
  assert.equal(wirelessTransport.started, true)

  const client = await connectClient(socketPath)
  t.after(() => client.socket.destroy())

  assert.deepEqual(await client.next(), { v: PROTOCOL_VERSION, type: 'link', state: 'disconnected' })

  // Connect wireless first
  wirelessTransport.isConnected = true
  wirelessTransport.emit('connected', { transport: 'wireless' })
  assert.deepEqual(await client.next(), { v: PROTOCOL_VERSION, type: 'link', state: 'syncing' })

  // Connect higher priority USB
  usbTransport.isConnected = true
  usbTransport.emit('connected', { transport: 'usb-cdc' })
  assert.deepEqual(await client.next(), { v: PROTOCOL_VERSION, type: 'link', state: 'syncing' })

  // Disconnect USB -> fail back to wireless
  usbTransport.isConnected = false
  usbTransport.emit('disconnected', { transport: 'usb-cdc' })
  assert.deepEqual(await client.next(), { v: PROTOCOL_VERSION, type: 'link', state: 'wireless' })
})

async function connectClient(socketPath) {
  const socket = net.createConnection(socketPath)
  await once(socket, 'connect')
  const records = []
  const waiters = []
  const reader = createJsonLineReader((line) => {
    const record = JSON.parse(line)
    const waiter = waiters.shift()
    if (waiter) waiter.resolve(record)
    else records.push(record)
  })
  socket.on('data', (chunk) => reader.push(chunk))
  return {
    socket,
    records,
    next() {
      if (records.length > 0) return Promise.resolve(records.shift())
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for socket record')), 500)
        waiters.push({
          resolve(record) {
            clearTimeout(timer)
            resolve(record)
          },
        })
      })
    },
  }
}
