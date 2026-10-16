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


test('Remote Bridge Host forwards valid state records above 64 KiB through its socket', async (t) => {
  const runtimeDirectory = await fs.promises.mkdtemp('/tmp/odk-rbh-')
  const socketPath = path.join(runtimeDirectory, 'bridge.sock')
  const transport = new MockTransport({ id: 'odk.remote.transport.usb-cdc', transport: 'usb-cdc' })
  const host = new RemoteBridgeHost({ transports: [transport], socketPath, logger: { error() {} } })
  t.after(async () => {
    await host.stop()
    await fs.promises.rm(runtimeDirectory, { recursive: true, force: true })
  })
  await host.start()
  const client = await connectClient(socketPath)
  t.after(() => client.socket.destroy())
  await client.next()
  transport.isConnected = true
  transport.emit('connected', { transport: 'usb-cdc' })
  await client.next()
  const record = { v: 1, type: 'state', name: 'x'.repeat(131072), page: 1, pages: 1, canPrev: false, canNext: false }
  client.socket.write(JSON.stringify(record) + '\n')
  assert.equal((await client.next()).state, 'usb')
  assert.deepEqual(transport.sent, [{ ...record, link: 'wired' }])
})

test('multi-transport Host forwards current Remote input unchanged and rejects invalid or retired input', async t => {
  const directory = await fs.promises.mkdtemp('/tmp/odk-rbh-input-')
  const usb = new MockTransport({ id: 'odk.remote.transport.usb-cdc', priority: 100, transport: 'usb-cdc' })
  const wireless = new MockTransport({ id: 'odk.remote.transport.c6-uart', priority: 50, transport: 'wireless' })
  const host = new RemoteBridgeHost({ transports: [usb, wireless], socketPath: path.join(directory, 'bridge.sock'), logger: { error() {} } })
  await host.start()
  t.after(async () => { await host.stop(); await fs.promises.rm(directory, { recursive: true, force: true }) })
  const client = await connectClient(host.socketPath)
  t.after(() => client.socket.destroy())
  assert.equal((await client.next()).state, 'disconnected')
  for (const [index, input] of ['left', 'right', 'up', 'down', 'primary', 'secondary', 'back', 'mic', 'action'].entries()) {
    const record = { v: 1, type: 'input', input, ...(input === 'action' ? { action: 'fixture.action' } : {}) }
    const transport = index % 2 ? wireless : usb
    transport.emit('message', record)
    assert.deepEqual(await client.next(), record)
  }
  for (const record of [
    { v: 1, type: 'action', action: 'fixture.action' },
    { v: 1, type: 'action', id: 'fixture.action' },
    { v: 1, type: 'input', input: 'action', id: 'fixture.action' },
  ]) {
    wireless.emit('message', record)
    assert.deepEqual(await client.next(), record)
  }
  for (const record of [
    { type: 'input', input: 'back' }, { v: 2, type: 'input', input: 'back' },
    { v: 1, type: 'input', input: 'unknown' }, { v: 1, type: 'input', input: 'action' },
    { v: 1, type: 'action', action: '' }, { v: 2, type: 'action', action: 'fixture.action' },
  ]) usb.emit('message', record)
  const navigation = { v: 1, type: 'navigate', direction: 'next' }
  wireless.emit('message', navigation)
  assert.deepEqual(await client.next(), navigation)
  await host.setTransportEnabled(usb.manifest.id, false)
  usb.emit('message', { v: 1, type: 'input', input: 'back' })
  const current = { v: 1, type: 'input', input: 'primary' }
  wireless.emit('message', current)
  assert.deepEqual(await client.next(), current)
})
