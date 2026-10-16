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

test('identifies Remote CDC and the fixed S3 USB JTAG serial device', () => {
  assert.equal(isOpenDeskOsRemoteDevice('usb-Open_DeskOS_Remote_ABC-if00'), true)
  assert.equal(isOpenDeskOsRemoteDevice('usb-Espressif_USB_JTAG_serial_debug_unit_F0:9E:9E:11:23:CC-if00'), true)
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

test('closing a CDC connection retains a timed-out read and retries after its callback completes', async () => {
  let closed = false
  let finishRead
  let entered
  const reading = new Promise(resolve => { entered = resolve })
  const connection = new (require('../lib/usb-cdc-adapter').CdcConnection)('/dev/mock', {
    io: {
      read(_fd, _buffer, _offset, _length, _position, callback) { finishRead = callback; entered() },
      write(_fd, _buffer, _offset, length, _position, callback) { queueMicrotask(() => callback(null, length)) },
      close(_fd, callback) { closed = true; queueMicrotask(() => callback(null)) },
    },
    fd: 41,
    pollIntervalMs: 1,
    closeTimeoutMs: 5,
  })
  await reading
  const closing = connection.close()
  assert.equal(connection.close(), closing)
  await assert.rejects(closing, { code: 'ODK_CDC_DRAIN_TIMEOUT' })
  assert.equal(closed, false)
  assert.equal(connection.listenerCount('read-idle'), 0)
  finishRead(null, 0)
  await connection.close()
  assert.equal(closed, true)
})

test('closing a CDC connection cancels nonblocking polling before service shutdown', async () => {
  let closed = false
  const connection = new (require('../lib/usb-cdc-adapter').CdcConnection)('/dev/mock', {
    io: {
      read(_fd, _buffer, _offset, _length, _position, callback) {
        queueMicrotask(() => callback(Object.assign(new Error('try again'), { code: 'EAGAIN' })))
      },
      write(_fd, _buffer, _offset, length, _position, callback) { queueMicrotask(() => callback(null, length)) },
      close(_fd, callback) { closed = true; queueMicrotask(() => callback(null)) },
    },
    fd: 42,
    pollIntervalMs: 1,
  })

  await connection.close()

  assert.equal(closed, true)
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
  connections[0].emit('message', { v: PROTOCOL_VERSION, type: 'input', input: 'primary' })
  assert.equal(messages.length, 2)

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

test('adapter retains failed connection cleanup and rejects restart until stop succeeds', async () => {
  const connection = new FakeConnection('/dev/mock')
  let fail = true
  let closes = 0
  connection.close = async () => { closes++; if (fail) throw Error('connection busy') }
  const adapter = new UsbCdcAdapter({ discoverDevice: async () => ({ devicePath: '/dev/mock' }), createConnection: async () => connection, scanIntervalMs: 60_000 })
  const messages = []
  adapter.on('message', record => messages.push(record))
  await adapter.start()
  await assert.rejects(adapter.stop(), /connection busy/)
  assert.equal(adapter.connection, connection)
  assert.equal(adapter.isConnected, false)
  connection.emit('message', { v: 1, type: 'input', input: 'primary' })
  assert.equal(messages.length, 0)
  await assert.rejects(adapter.start(), /resources|connection/)
  fail = false
  await adapter.stop()
  assert.equal(closes, 2)
  assert.equal(adapter.connection, null)
})

test('stop waits for late device open and retains its failed cleanup', async () => {
  let enter
  let finish
  const entered = new Promise(resolve => { enter = resolve })
  const pending = new Promise(resolve => { finish = resolve })
  const connection = new FakeConnection('/dev/mock')
  let fail = true
  connection.close = async () => { if (fail) throw Error('late close failed') }
  const adapter = new UsbCdcAdapter({ discoverDevice: async () => ({ devicePath: '/dev/mock' }), createConnection: () => { enter(); return pending }, scanIntervalMs: 60_000 })
  adapter.on('adapter-error', () => {})
  const starting = adapter.start()
  await entered
  const stopping = adapter.stop()
  let stopped = false
  void stopping.then(() => { stopped = true }, () => {})
  await Promise.resolve()
  assert.equal(stopped, false)
  finish(connection)
  await assert.rejects(stopping, /late close failed/)
  await starting
  assert.equal(adapter.connection, connection)
  assert.equal(adapter.scanTimer, null)
  fail = false
  await adapter.stop()
  assert.equal(adapter.connection, null)
})

test('descriptor close error remains unresolved and does not repeat a potentially completed OS close', async () => {
  let closes = 0
  const connection = new (require('../lib/usb-cdc-adapter').CdcConnection)('/dev/mock', {
    io: { close(_fd, callback) { closes++; callback(Error('descriptor cleanup unknown')) } }, fd: 43,
  })
  await assert.rejects(connection.close(), /descriptor cleanup unknown/)
  await assert.rejects(connection.close(), /descriptor cleanup unknown/)
  assert.equal(closes, 1)
})

test('read failure reports unresolved close without an unhandled rejection or connection reuse', async (t) => {
  let closes = 0
  const connection = new (require('../lib/usb-cdc-adapter').CdcConnection)('/dev/mock', {
    io: {
      read(_fd, _buffer, _offset, _length, _position, callback) { queueMicrotask(() => callback(Error('device removed'))) },
      close(_fd, callback) { closes++; callback(Error('release unknown')) },
    }, fd: 44,
  })
  const adapter = new UsbCdcAdapter({ discoverDevice: async () => ({ devicePath: '/dev/mock' }), createConnection: async () => connection, scanIntervalMs: 60_000 })
  t.after(() => adapter.stop().catch(() => {}))
  const error = new Promise(resolve => adapter.once('adapter-error', resolve))
  const reasons = []
  adapter.on('disconnected', event => reasons.push(event.reason))
  await adapter.start()
  assert.match((await error).message, /release unknown/)
  assert.deepEqual(reasons, ['device-replaced', 'cleanup-failed'])
  assert.equal(adapter.isConnected, false)
  assert.equal(adapter.connection, connection)
  await assert.rejects(adapter.send({ v: 1 }), /disconnected/)
  await assert.rejects(adapter.stop(), /release unknown/)
  await assert.rejects(adapter.stop(), /release unknown/)
  assert.equal(closes, 1)
})

test('CDC close waits for the active write and cancels queued writes before closing its descriptor', async () => {
  let finishWrite
  let enter
  const writing = new Promise(resolve => { enter = resolve })
  const events = []
  const connection = new (require('../lib/usb-cdc-adapter').CdcConnection)('/dev/mock', {
    io: {
      read() { assert.fail('polling should be cancelled before its first read') },
      write(_fd, _buffer, _offset, length, _position, callback) {
        events.push('write')
        finishWrite = () => callback(null, length)
        enter()
      },
      close(_fd, callback) { events.push('close'); callback(null) },
    }, fd: 45, closeTimeoutMs: 1000,
  })
  const first = connection.send({ v: 1 })
  const second = connection.send({ v: 1 })
  const cancelled = assert.rejects(second, /disconnected/)
  await writing
  const closing = connection.close()
  assert.equal(connection.close(), closing)
  await Promise.resolve()
  assert.deepEqual(events, ['write'])
  finishWrite()
  await Promise.all([first, cancelled, closing])
  assert.deepEqual(events, ['write', 'close'])
})

test('CDC write timeout retains the descriptor until its active write finishes', async () => {
  let finishWrite
  let enter
  let closes = 0
  const writing = new Promise(resolve => { enter = resolve })
  const connection = new (require('../lib/usb-cdc-adapter').CdcConnection)('/dev/mock', {
    io: {
      read(_fd, _buffer, _offset, _length, _position, callback) { callback(null, 0) },
      write(_fd, _buffer, _offset, length, _position, callback) { finishWrite = () => callback(null, length); enter() },
      close(_fd, callback) { closes++; callback(null) },
    }, fd: 46, closeTimeoutMs: 5,
  })
  const sending = connection.send({ v: 1 })
  await writing
  await assert.rejects(connection.close(), { code: 'ODK_CDC_DRAIN_TIMEOUT' })
  assert.equal(closes, 0)
  finishWrite()
  await sending
  await connection.close()
  assert.equal(closes, 1)
})
