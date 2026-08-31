const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { RemoteBridge } = require('../../../integrations/remote-bridge/lib/remote-bridge')

const {
  createRemoteBridgeClient,
  resolveRemoteBridgeSocketPath,
} = require('../src/remote-bridge-client')

class FakeRemoteLinkAdapter extends EventEmitter {
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

class FakeSocket extends EventEmitter {
  constructor() {
    super()
    this.destroyed = false
    this.writes = []
  }

  write(record) {
    this.writes.push(record)
    return true
  }

  destroy() {
    this.destroyed = true
    this.emit('close')
  }
}

function waitFor(predicate, message = 'timed out waiting for condition') {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 200
    const check = () => {
      if (predicate()) return resolve()
      if (Date.now() >= deadline) return reject(new Error(message))
      setTimeout(check, 1)
    }
    check()
  })
}

test('resolves the runtime Remote Bridge socket and confines overrides to explicit test mode', () => {
  assert.equal(
    resolveRemoteBridgeSocketPath({ XDG_RUNTIME_DIR: '/run/user/1000' }),
    path.join('/run/user/1000', 'open-deskos-remote', 'bridge.sock'),
  )
  assert.equal(
    resolveRemoteBridgeSocketPath({
      XDG_RUNTIME_DIR: '/run/user/1000',
      ODESK_REMOTE_BRIDGE_SOCKET: '/tmp/ignored.sock',
    }),
    path.join('/run/user/1000', 'open-deskos-remote', 'bridge.sock'),
  )
  assert.equal(
    resolveRemoteBridgeSocketPath({
      ODESK_SHELL_TEST_MODE: '1',
      ODESK_REMOTE_BRIDGE_SOCKET: '/tmp/open-deskos-remote-test.sock',
    }),
    '/tmp/open-deskos-remote-test.sock',
  )
  assert.throws(
    () => resolveRemoteBridgeSocketPath({
      ODESK_SHELL_TEST_MODE: '1',
      ODESK_REMOTE_BRIDGE_SOCKET: 'relative.sock',
    }),
    /absolute Unix socket path/,
  )
})

test('forwards only valid C6 navigation records to subscribers', async () => {
  const socket = new FakeSocket()
  const navigations = []
  const client = createRemoteBridgeClient({
    socketPath: '/tmp/open-deskos-remote-test.sock',
    createConnection: () => socket,
  })
  client.onNavigation((direction) => navigations.push(direction))
  client.start()
  socket.emit('data', Buffer.from('{"v":1,"type":"navigate","direction":"next"}\n'))
  socket.emit('data', Buffer.from('{"v":1,"type":"navigate","direction":"invalid"}\n'))
  socket.emit('data', Buffer.from('{"v":2,"type":"navigate","direction":"previous"}\n'))
  assert.deepEqual(navigations, ['next'])
  client.stop()
})

test('actual Remote Bridge synchronizes Shell state, link state, and C6 navigation', async (t) => {
  const runtimeDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'odk-shell-remote-'))
  const socketPath = path.join(runtimeDirectory, 'open-deskos-remote', 'bridge.sock')
  const adapter = new FakeRemoteLinkAdapter()
  const bridge = new RemoteBridge({ adapter, socketPath, logger: { error() {} } })
  const client = createRemoteBridgeClient({ socketPath, reconnectDelayMs: 1 })
  const linkStates = []
  const navigations = []
  client.onLinkState((state) => linkStates.push(state))
  client.onNavigation((direction) => navigations.push(direction))
  await bridge.start()
  client.start()
  t.after(async () => {
    client.stop()
    await bridge.stop()
    await fs.promises.rm(runtimeDirectory, { recursive: true, force: true })
  })

  client.publishPageState({ page: 3, pages: 3, name: '用量', canPrev: false, canNext: true })
  await waitFor(() => bridge.latestShellState !== null)
  adapter.emit('connected', { transport: 'usb-cdc' })
  await waitFor(() => adapter.sent.length === 1 && linkStates.at(-1) === 'usb')
  adapter.emit('message', { v: 1, type: 'navigate', direction: 'previous' })
  await waitFor(() => navigations.length === 1)
  adapter.emit('disconnected', { transport: 'usb-cdc' })
  await waitFor(() => linkStates.at(-1) === 'disconnected')
  adapter.emit('connected', { transport: 'uart-c6' })
  await waitFor(() => adapter.sent.length === 2 && linkStates.at(-1) === 'wireless')

  assert.deepEqual(bridge.latestShellState, {
    v: 1,
    type: 'state',
    page: 3,
    pages: 3,
    name: '用量',
    canPrev: true,
    canNext: false,
  })
  assert.deepEqual(adapter.sent[0], { ...bridge.latestShellState, link: 'wired' })
  assert.deepEqual(adapter.sent[1], { ...bridge.latestShellState, link: 'wireless' })
  assert.deepEqual(linkStates, ['disconnected', 'syncing', 'usb', 'disconnected', 'syncing', 'wireless'])
  assert.deepEqual(navigations, ['previous'])
})

test('reconnects, resends complete authoritative state, and forwards only valid link records', async () => {
  const sockets = []
  const linkStates = []
  const client = createRemoteBridgeClient({
    socketPath: '/tmp/open-deskos-remote-test.sock',
    reconnectDelayMs: 1,
    createConnection() {
      const socket = new FakeSocket()
      sockets.push(socket)
      queueMicrotask(() => socket.emit('connect'))
      return socket
    },
  })
  client.onLinkState((state) => linkStates.push(state))
  client.start()
  await waitFor(() => sockets.length === 1)

  client.publishPageState({ page: 1, pages: 3, name: '概览', canPrev: true, canNext: false })
  assert.deepEqual(JSON.parse(sockets[0].writes[0]), {
    v: 1,
    type: 'state',
    page: 1,
    pages: 3,
    name: '概览',
    canPrev: false,
    canNext: true,
  })

  sockets[0].emit('data', Buffer.from('{"v":1,"type":"link","state":"usb"}\n'))
  assert.equal(linkStates.at(-1), 'usb')
  sockets[0].emit('data', Buffer.from('{"v":1,"type":"link","state":"wireless"}\n'))
  assert.equal(linkStates.at(-1), 'wireless')
  sockets[0].emit('data', Buffer.from('{"v":1,"type":"link","state":"invented"}\n'))
  assert.equal(linkStates.at(-1), 'wireless')

  sockets[0].emit('close')
  await waitFor(() => sockets.length === 2 && sockets[1].writes.length === 1)
  assert.equal(linkStates.includes('disconnected'), true)
  assert.equal(linkStates.at(-1), 'disconnected')
  assert.deepEqual(JSON.parse(sockets[1].writes[0]), {
    v: 1,
    type: 'state',
    page: 1,
    pages: 3,
    name: '概览',
    canPrev: false,
    canNext: true,
  })

  client.stop()
})
