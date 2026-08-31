'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  UsbCdcAdapter,
  discoverUsbCdcDevice,
  isOpenDeskOsRemoteDevice,
} = require('../lib/usb-cdc-adapter')
const { PROTOCOL_VERSION } = require('../lib/protocol')

test('identifies only Open DeskOS Remote /dev/serial/by-id entries', () => {
  assert.equal(isOpenDeskOsRemoteDevice('usb-Open_DeskOS_Remote_ABC-if00'), true)
  assert.equal(isOpenDeskOsRemoteDevice('usb-Other_Device-if00'), false)
})

test('requires an exactly one by-id Remote Control device', async () => {
  const original = require('node:fs').promises.readdir
  require('node:fs').promises.readdir = async () => []
  try {
    assert.deepEqual(await discoverUsbCdcDevice('/not-a-tty-directory'), { reason: 'device-not-found' })
    require('node:fs').promises.readdir = async () => [
      'usb-Open_DeskOS_Remote_one-if00',
      'usb-Open_DeskOS_Remote_two-if00',
    ]
    assert.deepEqual(await discoverUsbCdcDevice('/dev/serial/by-id'), { reason: 'ambiguous-device' })
    require('node:fs').promises.readdir = async () => ['usb-Open_DeskOS_Remote_one-if00']
    assert.deepEqual(await discoverUsbCdcDevice('/dev/serial/by-id'), {
      devicePath: '/dev/serial/by-id/usb-Open_DeskOS_Remote_one-if00',
    })
  } finally {
    require('node:fs').promises.readdir = original
  }
})

test('connects, reports device absence, relays valid messages, reconnects, and does not use ttyACM', async () => {
  const discoveries = [
    { reason: 'device-not-found' },
    { devicePath: '/dev/serial/by-id/usb-Open_DeskOS_Remote_A-if00' },
    { devicePath: '/dev/serial/by-id/usb-Open_DeskOS_Remote_A-if00' },
  ]
  const connections = []
  const adapter = new UsbCdcAdapter({
    scanIntervalMs: 60_000,
    discoverDevice: async () => discoveries.shift() ?? { reason: 'device-not-found' },
    createConnection: async (devicePath) => {
      const connection = new FakeConnection(devicePath)
      connections.push(connection)
      return connection
    },
  })
  const connected = []
  const disconnected = []
  const messages = []
  adapter.on('connected', (details) => connected.push(details))
  adapter.on('disconnected', (details) => disconnected.push(details))
  adapter.on('message', (message) => messages.push(message))

  await adapter.start()
  assert.deepEqual(disconnected, [{ transport: 'usb-cdc', reason: 'device-not-found' }])
  await adapter.scan()
  assert.equal(connected.length, 1)
  assert.match(connections[0].devicePath, /\/dev\/serial\/by-id\//)
  assert.doesNotMatch(connections[0].devicePath, /ttyACM/)
  connections[0].emit('message', { v: PROTOCOL_VERSION, type: 'navigate', direction: 'next' })
  assert.equal(messages.length, 1)

  connections[0].emit('disconnect', 'read-ended')
  await adapter.scan()
  assert.equal(connected.length, 2)
  await adapter.stop()
})

class FakeConnection extends EventEmitter {
  constructor(devicePath) {
    super()
    this.devicePath = devicePath
    this.records = []
  }

  async send(record) {
    this.records.push(record)
  }

  async close() {}
}
