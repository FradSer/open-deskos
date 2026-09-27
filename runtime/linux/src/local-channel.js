'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const net = require('node:net')
const path = require('node:path')

// The version of the transport handshake itself, which is separate from the
// protocol each channel carries on top of it.
const CHANNEL_VERSION = 1
const TOKEN_FILENAME = 'local-channel.token'
const TOKEN_BYTES = 32
// A handshake is one short line. The cap is what stops a peer that never sends
// a newline from holding a connection open forever.
const MAX_HANDSHAKE_BYTES = 512
const PROBE_TIMEOUT_MS = 1000

/**
 * Whether an endpoint is a Windows named pipe rather than a Unix socket path.
 * The two have different rules, and a host that treats one as the other either
 * chmods a pipe (which does nothing) or tries to own one (which is meaningless).
 */
function isNamedPipe(endpoint) {
  return typeof endpoint === 'string' && /^\\\\\.\\pipe\\/i.test(endpoint)
}

const TCP_PREFIX = 'tcp://'

/** A desk can also be reached over the network, which is what makes a plugin portable. */
function isTcpEndpoint(endpoint) {
  return typeof endpoint === 'string' && endpoint.toLowerCase().startsWith(TCP_PREFIX)
}

/** `tcp://host:port`; port 0 lets the host pick one, which a test can state. */
function parseTcpEndpoint(endpoint) {
  if (!isTcpEndpoint(endpoint)) return null
  const rest = endpoint.slice(TCP_PREFIX.length)
  const separator = rest.lastIndexOf(':')
  if (separator <= 0) return null
  const host = rest.slice(0, separator).trim()
  const port = Number.parseInt(rest.slice(separator + 1).trim(), 10)
  if (host.length === 0 || !Number.isInteger(port) || port < 0 || port > 65535) return null
  return { host, port }
}

/**
 * What an endpoint is, and whether anything authenticates it. A path on a Unix
 * host is authenticated by the private directory it sits in; a named pipe and a
 * network address are not, so the token is what authenticates them.
 */
function describeEndpoint(endpoint, platform) {
  if (isTcpEndpoint(endpoint)) {
    const tcp = parseTcpEndpoint(endpoint)
    if (tcp === null) throw new Error(`refusing ${endpoint}: it is not tcp://host:port`)
    return { kind: 'tcp', tcp, ownership: false }
  }
  if (typeof endpoint === 'string' && endpoint.includes('://')) {
    throw new Error(`refusing ${endpoint}: an endpoint is a socket path, a named pipe, or tcp://host:port`)
  }
  const pipe = isNamedPipe(endpoint)
  return { kind: pipe ? 'pipe' : 'path', tcp: null, ownership: !pipe && platform !== 'win32' }
}

function tokenFile(stateDir, join = path.join) {
  return join(stateDir, TOKEN_FILENAME)
}

/**
 * A Unix socket is authenticated by ownership: it lives in a directory only its
 * owner can enter, so only its owner can connect. A named pipe carries no owner,
 * mode, or uid, and there is no directory to keep private, so a Windows host has
 * nothing to authenticate a runtime channel with beyond a secret both ends hold.
 * That secret is a token in a file only this user can read, sent as the first
 * line of the connection. Where ownership can authenticate a peer it stays the
 * gate, and our own clients present the token there as a second layer.
 */
function requiresToken({ endpoint = '', platform = process.platform } = {}) {
  return platform === 'win32' || isNamedPipe(endpoint) || isTcpEndpoint(endpoint)
}

async function readToken(file, fsModule) {
  try {
    return (await fsModule.readFile(file, 'utf8')).trim() || null
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * The token every runtime channel on this host shares. It is created on first
 * use and then left alone: a channel that replaced it would lock out services
 * already running, and the file is what makes two processes agree.
 */
async function readOrCreateToken({ stateDir, fsModule = fs } = {}) {
  if (typeof stateDir !== 'string' || stateDir.length === 0) {
    throw new Error('a state directory is required for the runtime channel token')
  }
  const file = tokenFile(stateDir)
  const existing = await readToken(file, fsModule)
  if (existing) return existing

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url')
  await fsModule.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  try {
    await fsModule.writeFile(file, `${token}\n`, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    // Every service on a cold host can start at once, so they race. The file
    // decides which token is in use, and the loser adopts the winner's rather
    // than leaving the host holding two.
    if (error.code !== 'EEXIST') throw error
    const raced = await readToken(file, fsModule)
    if (raced) return raced
    await fsModule.writeFile(file, `${token}\n`, { mode: 0o600 })
  }
  // A host without mode bits has nothing to set, and nothing to leak by failing.
  await fsModule.chmod(file, 0o600).catch(() => {})
  return token
}

function handshakeFrame(token) {
  return `${JSON.stringify({ v: CHANNEL_VERSION, token })}\n`
}

/** Present the token on a connection before the channel's own first frame. */
function writeHandshake(socket, token) {
  socket.write(handshakeFrame(token))
}

function tokenMatches(expected, given) {
  if (typeof given !== 'string') return false
  const wanted = Buffer.from(String(expected), 'utf8')
  const presented = Buffer.from(given, 'utf8')
  // Length is compared first because timingSafeEqual refuses different lengths,
  // and the comparison itself must not leak the token one byte at a time.
  return wanted.length === presented.length && crypto.timingSafeEqual(wanted, presented)
}

function parseHandshake(line) {
  let record
  try {
    record = JSON.parse(line)
  } catch {
    return { kind: 'other' }
  }
  if (!record || typeof record !== 'object' || record.v !== CHANNEL_VERSION || typeof record.token !== 'string') return { kind: 'other' }
  return { kind: 'handshake', token: record.token }
}

async function prepareDirectory(directory, fsModule) {
  let created = false
  try {
    await fsModule.mkdir(directory, { mode: 0o700 })
    created = true
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
  }
  if (created) {
    await fsModule.chmod(directory, 0o700)
    return
  }
  // An existing directory is never chmodded: this service may not own it, and
  // locking a shared directory down would break whatever else lives there.
  const info = await fsModule.stat(directory)
  if (!info.isDirectory()) throw new Error(`refusing ${directory}: it is not a directory`)
  if (info.uid !== process.getuid()) throw new Error(`refusing ${directory}: it is not owned by this user`)
  if ((info.mode & 0o077) !== 0) throw new Error(`refusing ${directory}: it is group- or world-accessible`)
}

async function describeEndpointFile(endpoint, fsModule) {
  try {
    return await fsModule.lstat(endpoint)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/** Whether something is answering at this endpoint right now. */
function probeEndpoint(endpoint, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const probe = net.connect(endpoint)
    const done = (value) => {
      probe.destroy()
      resolve(value)
    }
    probe.setTimeout(timeoutMs, () => done(false))
    probe.once('connect', () => done(true))
    probe.once('error', () => done(false))
  })
}

/**
 * Listen on a runtime channel endpoint and gate every connection before the
 * channel's own protocol sees it.
 *
 * The endpoint is a Unix socket path on a Unix host and a named pipe on a
 * Windows host; the only steps that differ are the ones that do not exist on the
 * other platform, which is why they are decided here rather than at each caller.
 */
async function listenChannel({
  endpoint,
  token,
  stateDir = '',
  onConnection,
  onReject = () => {},
  platform = process.platform,
  fsModule = fs,
  probe = probeEndpoint,
} = {}) {
  if (typeof endpoint !== 'string' || endpoint.length === 0) throw new Error('a channel endpoint is required')
  if (typeof onConnection !== 'function') throw new Error('a channel connection handler is required')

  const shape = describeEndpoint(endpoint, platform)
  const ownershipAuthenticates = shape.ownership
  const tokenRequired = !ownershipAuthenticates
  let channelToken = typeof token === 'string' ? token : ''
  if (tokenRequired && channelToken.length === 0) {
    // The listener resolves the shared token itself rather than making every
    // caller read the file first, so a channel cannot be bound unauthenticated.
    if (typeof stateDir !== 'string' || stateDir.length === 0) {
      throw new Error(`refusing ${endpoint}: this endpoint has no owner to authenticate it, so it requires a token`)
    }
    channelToken = await readOrCreateToken({ stateDir, fsModule })
  }

  const sockets = new Set()
  const server = net.createServer((socket) => gate(socket))

  function gate(socket) {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.on('error', () => {})

    let buffer = Buffer.alloc(0)
    let settled = false

    const reject = (reason) => {
      if (settled) return
      settled = true
      socket.removeListener('data', onData)
      onReject(reason)
      socket.destroy()
    }

    // The handshake is removed from the stream here, so the channel's protocol
    // starts at its own first byte even when a client wrote both in one frame.
    const accept = (remainder) => {
      if (settled) return
      settled = true
      socket.removeListener('data', onData)
      socket.pause()
      try {
        onConnection(socket)
      } catch {
        socket.destroy()
        return
      }
      if (remainder.length > 0) socket.unshift(remainder)
      process.nextTick(() => {
        if (!socket.destroyed) socket.resume()
      })
    }

    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > MAX_HANDSHAKE_BYTES) return reject('handshake-too-large')
      const newline = buffer.indexOf(0x0a)
      if (newline === -1) return
      const line = buffer.subarray(0, newline).toString('utf8')
      const remainder = buffer.subarray(newline + 1)
      const parsed = parseHandshake(line)
      if (parsed.kind === 'handshake') {
        // Compare against the token this listener resolved, which is not the same
        // value as the argument when the listener read the shared token itself.
        if (tokenMatches(channelToken, parsed.token)) return accept(remainder)
        return reject('token rejected')
      }
      if (tokenRequired) return reject('token required')
      // Ownership already established that only this user could connect, so a
      // client that was written before the token existed still reaches the
      // protocol with every byte it sent intact.
      return accept(buffer)
    }

    socket.on('data', onData)
  }

  function bind() {
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      const onListening = () => {
        server.off('error', reject)
        resolve()
      }
      if (shape.kind === 'tcp') server.listen(shape.tcp.port, shape.tcp.host, onListening)
      else server.listen(endpoint, onListening)
    })
  }

  if (ownershipAuthenticates) await prepareDirectory(path.dirname(endpoint), fsModule)

  try {
    await bind()
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error
    // Something already holds the endpoint. A live service is never stolen from,
    // because unlinking its socket would leave two services answering to the
    // same name; only the file a stopped service left behind is replaced. A
    // network address has no file to replace, so it is simply refused.
    if (shape.kind === 'tcp') throw new Error(`refusing ${endpoint}: the address is already in use`)
    if (await probe(endpoint)) throw new Error(`refusing ${endpoint}: another service is already listening`)
    if (!ownershipAuthenticates) throw new Error(`refusing ${endpoint}: it is held by something this host cannot identify`)
    const info = await describeEndpointFile(endpoint, fsModule)
    if (!info || !info.isSocket()) throw new Error(`refusing ${endpoint}: it exists and is not a socket`)
    if (info.uid !== process.getuid()) throw new Error(`refusing ${endpoint}: it is not owned by this user`)
    await fsModule.unlink(endpoint)
    await bind()
  }

  if (ownershipAuthenticates) await fsModule.chmod(endpoint, 0o600).catch(() => {})

  return {
    endpoint,
    tokenRequired,
    async close() {
      for (const socket of [...sockets]) socket.destroy()
      sockets.clear()
      await new Promise((resolve) => server.close(resolve))
      // A stopped service must not leave a path that still looks like a channel.
      // A network address and a named pipe have nothing to withdraw.
      if (ownershipAuthenticates) {
        await fsModule.unlink(endpoint).catch((error) => {
          if (error.code !== 'ENOENT') throw error
        })
      }
    },
  }
}

module.exports = {
  CHANNEL_VERSION,
  TOKEN_FILENAME,
  MAX_HANDSHAKE_BYTES,
  describeEndpoint,
  handshakeFrame,
  isNamedPipe,
  isTcpEndpoint,
  listenChannel,
  parseTcpEndpoint,
  readOrCreateToken,
  requiresToken,
  tokenFile,
  writeHandshake,
}