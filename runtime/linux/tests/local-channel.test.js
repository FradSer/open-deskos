'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { setTimeout: delay } = require('node:timers/promises')

const {
  CHANNEL_VERSION,
  TOKEN_FILENAME,
  isNamedPipe,
  listenChannel,
  readOrCreateToken,
  requiresToken,
  tokenFile,
} = require('../src/local-channel')
const { posixOnlyReason } = require('./not-ported')

const unixHost = process.platform !== 'win32'

async function temporaryDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-local-channel-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}

/** One connection: optional handshake, then one line, then whatever comes back. */
function exchange(endpoint, { token, line, timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const target = endpoint.startsWith('tcp://')
      ? (() => { const [host, port] = endpoint.slice('tcp://'.length).split(':'); return { host, port: Number.parseInt(port, 10) } })()
      : endpoint
    const socket = net.createConnection(target)
    let received = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => {
      if (token !== undefined) socket.write(`${JSON.stringify({ v: CHANNEL_VERSION, token })}\n`)
      if (line !== undefined) socket.write(line)
    })
    socket.on('data', (chunk) => { received += chunk.toString('utf8') })
    socket.on('timeout', () => finish({ received, closed: true, timedOut: true }))
    socket.on('error', () => finish({ received, closed: true, errored: true }))
    socket.on('close', () => finish({ received, closed: true }))
  })
}

function collect() {
  const connections = []
  const rejections = []
  return {
    connections,
    rejections,
    onConnection: (socket) => {
      const connection = { text: '', closed: false }
      connections.push(connection)
      socket.setEncoding('utf8')
      socket.on('data', (chunk) => { connection.text += chunk })
      socket.on('close', () => { connection.closed = true })
      if (connection.text.length === 0) socket.write('') // keep the stream flowing for the test
    },
    onReject: (reason) => rejections.push(reason),
  }
}

/** A port nothing is using right now, for the tests that need a network endpoint. */
function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

test('a Unix channel is authenticated by ownership, so a client without a token is accepted', { skip: posixOnlyReason('unix-socket') }, async (t) => {
  const dir = await temporaryDir(t)
  const endpoint = path.join(dir, 'channel', 'service.sock')
  const token = await readOrCreateToken({ stateDir: dir })
  const sink = collect()
  const channel = await listenChannel({ endpoint, stateDir: dir, token, platform: 'linux', onConnection: sink.onConnection, onReject: sink.onReject })
  t.after(() => channel.close())

  const result = await exchange(endpoint, { line: '{"v":1,"type":"snapshot"}\n' })

  assert.equal(sink.rejections.length, 0)
  assert.equal(sink.connections.length, 1)
  assert.equal(sink.connections[0].text, '{"v":1,"type":"snapshot"}\n', 'the protocol reads the request, not the transport')
  assert.equal(result.closed, true)
})

test('the handshake is consumed rather than handed to the protocol', async (t) => {
  const dir = await temporaryDir(t)
  const endpoint = unixHost ? path.join(dir, 'channel', 'service.sock') : '\\\\.\\pipe\\odk-local-channel-test-' + process.pid
  const token = await readOrCreateToken({ stateDir: dir })
  const sink = collect()
  const channel = await listenChannel({ endpoint, stateDir: dir, token, onConnection: sink.onConnection, onReject: sink.onReject })
  t.after(() => channel.close())

  // Both frames in one write is the case a careless reader gets wrong: the
  // handshake must leave the protocol starting exactly at its own byte.
  const result = await exchange(endpoint, { token, line: '{"v":1,"type":"snapshot"}\n' })

  assert.equal(sink.rejections.length, 0)
  assert.equal(sink.connections.length, 1)
  assert.equal(sink.connections[0].text, '{"v":1,"type":"snapshot"}\n')
  assert.equal(result.received, '')
})

test('a client that presents the wrong token never reaches the protocol', async (t) => {
  const dir = await temporaryDir(t)
  const endpoint = unixHost ? path.join(dir, 'channel', 'service.sock') : '\\\\.\\pipe\\odk-local-channel-bad-' + process.pid
  const token = await readOrCreateToken({ stateDir: dir })
  const sink = collect()
  const channel = await listenChannel({ endpoint, stateDir: dir, token, onConnection: sink.onConnection, onReject: sink.onReject })
  t.after(() => channel.close())

  const result = await exchange(endpoint, { token: 'not-the-token', line: '{"v":1,"type":"snapshot"}\n' })

  assert.equal(sink.connections.length, 0)
  assert.equal(sink.rejections.length, 1)
  assert.match(sink.rejections[0], /token/)
  assert.equal(result.closed, true)
})

test('a token-less client is refused only where ownership cannot authenticate it', { skip: process.platform === 'win32' ? false : 'a named pipe only exists on a Windows host' }, async (t) => {
  const dir = await temporaryDir(t)
  const endpoint = '\\\\.\\pipe\\odk-local-channel-gated-' + process.pid
  const token = await readOrCreateToken({ stateDir: dir })
  const sink = collect()
  const channel = await listenChannel({ endpoint, stateDir: dir, token, onConnection: sink.onConnection, onReject: sink.onReject })
  t.after(() => channel.close())

  const result = await exchange(endpoint, { line: '{"v":1,"type":"snapshot"}\n' })

  assert.equal(sink.connections.length, 0, 'a pipe has no owner to check, so the token is the gate')
  assert.equal(sink.rejections.length, 1)
  assert.equal(result.closed, true)
})

test('a host that cannot check ownership states that a token is required', () => {
  assert.equal(requiresToken({ endpoint: '\\\\.\\pipe\\open-deskos-desk-link', platform: 'win32' }), true)
  assert.equal(requiresToken({ endpoint: 'C:\\Users\\frads\\AppData\\Local\\open-deskos\\service.sock', platform: 'win32' }), true)
  assert.equal(requiresToken({ endpoint: '/run/user/1000/open-deskos-desk-link/service.sock', platform: 'linux' }), false)
  assert.equal(isNamedPipe('\\\\.\\pipe\\open-deskos-desk-link'), true)
  assert.equal(isNamedPipe('/run/user/1000/open-deskos-desk-link/service.sock'), false)
  assert.equal(isNamedPipe(undefined), false)
})

test('two processes asking at the same time receive the same token', async (t) => {
  const dir = await temporaryDir(t)
  const [first, second] = await Promise.all([readOrCreateToken({ stateDir: dir }), readOrCreateToken({ stateDir: dir })])

  assert.equal(first, second)
  assert.equal(first.length >= 32, true)
  assert.equal((await fs.readFile(tokenFile(dir), 'utf8')).trim(), first)
  assert.equal(tokenFile(dir), path.join(dir, TOKEN_FILENAME))
})

test('the token file is written so only its owner can read it', { skip: posixOnlyReason('posix-modes') }, async (t) => {
  const dir = await temporaryDir(t)
  await readOrCreateToken({ stateDir: dir })

  const info = await fs.stat(tokenFile(dir))
  assert.equal(info.mode & 0o777, 0o600)
  const directory = await fs.stat(dir)
  assert.equal(directory.uid, process.getuid())
})

test('a socket left behind by a stopped service is taken over', { skip: posixOnlyReason('unix-socket') }, async (t) => {
  const dir = await temporaryDir(t)
  const endpoint = path.join(dir, 'channel', 'service.sock')
  const token = await readOrCreateToken({ stateDir: dir })
  const sink = collect()

  const first = await listenChannel({ endpoint, stateDir: dir, token, onConnection: sink.onConnection, onReject: sink.onReject })
  await first.close() // close() withdraws the socket file, so put one back
  await fs.mkdir(path.dirname(endpoint), { recursive: true, mode: 0o700 })
  const stale = net.createServer()
  await new Promise((resolve) => stale.listen(endpoint, resolve))
  await new Promise((resolve) => stale.close(resolve)) // the listener is gone, the file is not

  const second = await listenChannel({ endpoint, stateDir: dir, token, onConnection: sink.onConnection, onReject: sink.onReject })
  t.after(() => second.close())
  const result = await exchange(endpoint, { line: '{"v":1,"type":"snapshot"}\n' })

  assert.equal(sink.connections.length, 1)
  assert.equal(sink.connections[0].text, '{"v":1,"type":"snapshot"}\n')
  assert.equal(result.closed, true)
})

test('a live service is refused rather than having its socket stolen', { skip: posixOnlyReason('unix-socket') }, async (t) => {
  const dir = await temporaryDir(t)
  const endpoint = path.join(dir, 'channel', 'service.sock')
  const token = await readOrCreateToken({ stateDir: dir })
  const sink = collect()

  const live = await listenChannel({ endpoint, stateDir: dir, token, onConnection: sink.onConnection, onReject: sink.onReject })
  t.after(() => live.close())

  await assert.rejects(
    listenChannel({ endpoint, stateDir: dir, token, onConnection: sink.onConnection, onReject: sink.onReject }),
    /already listening/,
  )

  // The refused attempt must leave the live service working.
  await delay(50)
  const result = await exchange(endpoint, { line: '{"v":1,"type":"snapshot"}\n' })
  assert.equal(sink.connections.length, 1)
  assert.equal(result.closed, true)
})

test('a path that is not a socket of ours is never deleted', { skip: posixOnlyReason('unix-socket') }, async (t) => {
  const dir = await temporaryDir(t)
  const endpoint = path.join(dir, 'channel', 'service.sock')
  const token = await readOrCreateToken({ stateDir: dir })
  await fs.mkdir(path.dirname(endpoint), { recursive: true, mode: 0o700 })
  await fs.writeFile(endpoint, 'not a socket\n')

  await assert.rejects(
    listenChannel({ endpoint, stateDir: dir, token, onConnection: () => {}, onReject: () => {} }),
    /not a socket/,
  )
  assert.equal(await fs.readFile(endpoint, 'utf8'), 'not a socket\n')
})

test('a directory this user does not own is refused', { skip: posixOnlyReason('posix-ownership') }, async (t) => {
  const dir = await temporaryDir(t)
  const endpoint = path.join(dir, 'channel', 'service.sock')
  const token = await readOrCreateToken({ stateDir: dir })
  await fs.mkdir(path.dirname(endpoint), { recursive: true, mode: 0o700 })
  await fs.chmod(path.dirname(endpoint), 0o777)

  await assert.rejects(
    listenChannel({ endpoint, stateDir: dir, token, onConnection: () => {}, onReject: () => {} }),
    /group- or world-accessible/,
  )
})
test('a listener that resolves its own token accepts exactly that token', async (t) => {
  const dir = await temporaryDir(t)
  const endpoint = `tcp://127.0.0.1:${await freePort()}`
  const token = await readOrCreateToken({ stateDir: dir })
  const sink = collect()
  // No token is passed in: the listener resolves the host's shared token itself,
  // which is the path every caller in the shell now takes. On a Unix socket
  // endpoint ownership authenticates instead, so this uses a network endpoint.
  const channel = await listenChannel({
    endpoint,
    stateDir: dir,
    onConnection: sink.onConnection,
    onReject: sink.onReject,
  })
  t.after(() => channel.close())

  const result = await exchange(endpoint, { token, line: '{"v":1,"type":"snapshot"}\n' })

  assert.deepEqual(sink.rejections, [], 'the listener must compare against the token it resolved, not an absent argument')
  assert.equal(sink.connections.length, 1)
  assert.equal(sink.connections[0].text, '{"v":1,"type":"snapshot"}\n')
  assert.equal(result.closed, true)
})

// The cap exists to stop a peer that never sends a newline from holding a
// connection open. It must not refuse a peer whose first frame is simply large:
// a Service Plugin's hello and its first snapshot are written back to back, and
// a snapshot of a real account is several kilobytes. Refusing those is what made
// a healthy plugin look like a service that could not be reached at all.
test('a first frame larger than the handshake cap is accepted when it ends in a newline', { skip: posixOnlyReason('unix-socket') }, async (t) => {
  const dir = await temporaryDir(t)
  const socketPath = path.join(dir, 'large.sock')
  const seen = collect()
  const channel = await listenChannel({ endpoint: socketPath, stateDir: dir, onConnection: seen.onConnection, onReject: seen.onReject })
  t.after(() => channel.close())

  const big = `${JSON.stringify({ v: 1, type: 'data', payload: 'x'.repeat(4096) })}\n`
  assert.ok(big.length > 512, 'the frame has to exceed the cap for this to mean anything')
  await exchange(socketPath, { line: big })

  assert.deepEqual(seen.rejections, [], 'a complete frame is not an oversized handshake')
  assert.equal(seen.connections.length, 1, 'and the protocol does receive it')
  assert.match(seen.connections[0].text, /"type":"data"/, 'the whole frame reaches the protocol intact')
})

// The same cap still has to hold: a peer that sends bytes and no newline is the
// case it was written for, and loosening it for large complete frames must not
// have removed it.
test('a peer that sends bytes with no newline is still cut off at the cap', { skip: posixOnlyReason('unix-socket') }, async (t) => {
  const dir = await temporaryDir(t)
  const socketPath = path.join(dir, 'silent.sock')
  const seen = collect()
  const channel = await listenChannel({ endpoint: socketPath, stateDir: dir, onConnection: seen.onConnection, onReject: seen.onReject })
  t.after(() => channel.close())

  await exchange(socketPath, { line: 'x'.repeat(4096) })
  assert.deepEqual(seen.rejections, ['handshake-too-large'])
  assert.equal(seen.connections.length, 0, 'a frame that never completes never reaches the protocol')
})
