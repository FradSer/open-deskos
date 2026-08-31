'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { RemoteBridge, resolveSocketPath } = require('../lib/remote-bridge')
const { PROTOCOL_VERSION } = require('../lib/protocol')
const { createJsonLineReader } = require('../lib/json-line-reader')

test('speaks the Shell client schema over its 0600 runtime socket, syncs state, and relays navigation', async (t) => {
  const runtimeDirectory = await makeRuntimeDirectory()
  const socketPath = path.join(runtimeDirectory, 'open-deskos-remote', 'bridge.sock')
  const adapter = new FakeAdapter()
  const bridge = new RemoteBridge({ adapter, socketPath, logger: silentLogger })
  await bridge.start()
  t.after(async () => {
    await bridge.stop()
    await fs.promises.rm(runtimeDirectory, { recursive: true, force: true })
  })

  assert.equal((await fs.promises.stat(socketPath)).mode & 0o777, 0o600)
  const client = await connectClient(socketPath)
  t.after(() => client.socket.destroy())
  assert.deepEqual(await client.next(), { v: PROTOCOL_VERSION, type: 'link', state: 'disconnected' })

  const shellState = shellStateRecord({ page: 3, canPrev: true, canNext: false })
  client.socket.write(`${JSON.stringify(shellState)}\n`)
  await waitFor(() => bridge.latestShellState !== null)
  adapter.emit('connected', { transport: 'usb-cdc' })

  assert.deepEqual(await client.next(), { v: PROTOCOL_VERSION, type: 'link', state: 'syncing' })
  await waitFor(() => adapter.sent.length === 1)
  assert.deepEqual(adapter.sent[0], { ...shellState, link: 'wired' })
  assert.deepEqual(bridge.latestShellState, shellState)
  assert.deepEqual(await client.next(), { v: PROTOCOL_VERSION, type: 'link', state: 'usb' })

  const navigation = { v: PROTOCOL_VERSION, type: 'navigate', direction: 'previous' }
  adapter.emit('message', navigation)
  assert.deepEqual(await client.next(), navigation)

  adapter.emit('disconnected', { transport: 'usb-cdc', reason: 'read-ended' })
  assert.deepEqual(await client.next(), { v: PROTOCOL_VERSION, type: 'link', state: 'disconnected' })
})

test('resynchronizes retained Shell state after a wired Remote Control reconnects', async (t) => {
  const runtimeDirectory = await makeRuntimeDirectory()
  const adapter = new FakeAdapter()
  const bridge = new RemoteBridge({
    adapter,
    socketPath: path.join(runtimeDirectory, 'open-deskos-remote', 'bridge.sock'),
    logger: silentLogger,
  })
  await bridge.start()
  t.after(async () => {
    await bridge.stop()
    await fs.promises.rm(runtimeDirectory, { recursive: true, force: true })
  })

  const client = await connectClient(bridge.socketPath)
  t.after(() => client.socket.destroy())
  await client.next()
  const shellState = shellStateRecord({ page: 1, canPrev: false, canNext: true })
  client.socket.write(`${JSON.stringify(shellState)}\n`)
  await waitFor(() => bridge.latestShellState !== null)

  adapter.emit('connected', { transport: 'usb-cdc' })
  await client.next()
  await client.next()
  adapter.emit('disconnected', { transport: 'usb-cdc', reason: 'device-removed' })
  await client.next()
  adapter.emit('connected', { transport: 'usb-cdc' })
  assert.equal((await client.next()).state, 'syncing')
  await waitFor(() => adapter.sent.length === 2)
  assert.deepEqual(adapter.sent[1], { ...shellState, link: 'wired' })
  assert.equal((await client.next()).state, 'usb')
})

test('marks future non-USB adapter state as wireless without changing retained Shell state', async (t) => {
  const runtimeDirectory = await makeRuntimeDirectory()
  const adapter = new FakeAdapter()
  const bridge = new RemoteBridge({
    adapter,
    socketPath: path.join(runtimeDirectory, 'open-deskos-remote', 'bridge.sock'),
    logger: silentLogger,
  })
  await bridge.start()
  t.after(async () => {
    await bridge.stop()
    await fs.promises.rm(runtimeDirectory, { recursive: true, force: true })
  })

  const client = await connectClient(bridge.socketPath)
  t.after(() => client.socket.destroy())
  await client.next()
  const shellState = shellStateRecord({ page: 2, canPrev: true, canNext: true })
  client.socket.write(`${JSON.stringify(shellState)}\n`)
  await waitFor(() => bridge.latestShellState !== null)
  adapter.emit('connected', { transport: 'uart-c6' })
  await client.next()
  await waitFor(() => adapter.sent.length === 1)
  assert.deepEqual(adapter.sent[0], { ...shellState, link: 'wireless' })
  assert.deepEqual(await client.next(), { v: PROTOCOL_VERSION, type: 'link', state: 'wireless' })
  assert.deepEqual(bridge.latestShellState, shellState)
})

test('rejects unversioned and unsupported navigation emitted by an adapter', async (t) => {
  const runtimeDirectory = await makeRuntimeDirectory()
  const bridge = new RemoteBridge({
    adapter: new FakeAdapter(),
    socketPath: path.join(runtimeDirectory, 'open-deskos-remote', 'bridge.sock'),
    logger: silentLogger,
  })
  await bridge.start()
  t.after(async () => {
    await bridge.stop()
    await fs.promises.rm(runtimeDirectory, { recursive: true, force: true })
  })

  const client = await connectClient(bridge.socketPath)
  t.after(() => client.socket.destroy())
  await client.next()
  bridge.adapter.emit('message', { type: 'navigate', direction: 'next' })
  bridge.adapter.emit('message', { v: PROTOCOL_VERSION + 1, type: 'navigate', direction: 'next' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(client.records.length, 0)
})

test('requires an absolute XDG_RUNTIME_DIR and refuses to delete non-socket or live socket paths', async (t) => {
  assert.throws(() => resolveSocketPath({}), /XDG_RUNTIME_DIR must be an absolute path/)
  assert.throws(() => resolveSocketPath({ XDG_RUNTIME_DIR: 'relative' }), /XDG_RUNTIME_DIR must be an absolute path/)
  assert.equal(resolveSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000' }), '/run/user/1000/open-deskos-remote/bridge.sock')
  const directory = await makeRuntimeDirectory()
  const socketPath = path.join(directory, 'not-a-socket')
  await fs.promises.writeFile(socketPath, 'protected')
  t.after(() => fs.promises.rm(directory, { recursive: true, force: true }))
  const bridge = new RemoteBridge({ adapter: new FakeAdapter(), socketPath, logger: silentLogger })
  await assert.rejects(bridge.start(), /Refusing to replace non-socket path/)
})

test('will not delete a live Remote Bridge socket', async (t) => {
  const runtimeDirectory = await makeRuntimeDirectory()
  const socketPath = path.join(runtimeDirectory, 'open-deskos-remote', 'bridge.sock')
  const first = new RemoteBridge({ adapter: new FakeAdapter(), socketPath, logger: silentLogger })
  await first.start()
  t.after(async () => {
    await first.stop()
    await fs.promises.rm(runtimeDirectory, { recursive: true, force: true })
  })
  const second = new RemoteBridge({ adapter: new FakeAdapter(), socketPath, logger: silentLogger })
  await assert.rejects(second.start(), /Remote Bridge is already listening/)
})

class FakeAdapter extends EventEmitter {
  constructor() {
    super()
    this.sent = []
  }

  async start() {}

  async stop() {}

  async send(record) {
    this.sent.push(record)
  }
}

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
        const timer = setTimeout(() => reject(new Error('Timed out waiting for socket record')), 100)
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

function makeRuntimeDirectory() {
  return fs.promises.mkdtemp('/tmp/odk-rb-')
}

function shellStateRecord({ page, canPrev, canNext }) {
  return {
    v: PROTOCOL_VERSION,
    type: 'state',
    page,
    pages: 3,
    name: '概览',
    canPrev,
    canNext,
  }
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const silentLogger = { error() {} }
