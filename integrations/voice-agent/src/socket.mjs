import fs from 'node:fs/promises'
import net from 'node:net'
import { dirname, isAbsolute, join } from 'node:path'
import {
  CHANNEL_VERSION,
  MAX_HANDSHAKE_BYTES,
  channelHandshake,
  channelTokenFile,
  parseHandshake,
  readOrCreateChannelToken,
  tokenMatches,
} from './channel-token.mjs'

// The handshake is a contract both ends of the channel publish, so the Shell
// client, a device verification script and this service all take it from here.
export {
  CHANNEL_VERSION,
  MAX_HANDSHAKE_BYTES,
  TOKEN_BYTES,
  TOKEN_FILENAME,
  channelHandshake,
  channelTokenFile,
  parseHandshake,
  readOrCreateChannelToken,
  tokenMatches,
} from './channel-token.mjs'

// The bound on one command's bytes and the budget a peer may leave queued on a
// connection it is not reading. Both are transport limits, not protocol ones.
const MAX_INPUT_BYTES = 4096
const MAX_QUEUED_BYTES = 131_072

/**
 * The endpoint this host reaches the voice service on: the named pipe the Shell
 * Host already names for the voice link on Windows, and the runtime directory
 * socket on a Unix host. A Unix host without an absolute runtime directory
 * cannot place it, and the caller refuses to start rather than invent a path.
 */
export function voiceEndpoint(env = process.env, platform = process.platform) {
  if (platform === 'win32') return '\\\\.\\pipe\\open-deskos-voice-agent'
  const runtimeDir = typeof env.XDG_RUNTIME_DIR === 'string' && isAbsolute(env.XDG_RUNTIME_DIR) ? env.XDG_RUNTIME_DIR : null
  if (!runtimeDir) return null
  return join(runtimeDir, 'open-deskos-voice', 'agent.sock')
}

/** A named pipe carries no owner, no mode and no uid, so there is nothing to check. */
function isNamedPipe(endpoint) {
  return typeof endpoint === 'string' && /^\\\\\.\\pipe\\/i.test(endpoint)
}

async function removeStale(path, fsModule, netModule) {
  try {
    const info = await fsModule.lstat(path)
    if (!info.isSocket()) throw Error('Control path is not a socket')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  const active = await new Promise((resolve, reject) => {
    const probe = netModule.connect(path)
    probe.once('connect', () => { probe.destroy(); resolve(true) })
    probe.once('error', error => {
      if ('code' in error && (error.code === 'ECONNREFUSED' || error.code === 'ENOENT')) resolve(false)
      else reject(error)
    })
  })
  if (active) throw Error('Voice service already running')
  await fsModule.unlink(path)
}

async function prepareDirectory(directory, fsModule) {
  await fsModule.mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await fsModule.lstat(directory)
  if (!info.isDirectory() || info.uid !== process.getuid?.()) throw Error('Unsafe control directory')
  await fsModule.chmod(directory, 0o700)
}

/**
 * The token this listener compares against, resolved rather than assumed.
 *
 * A Unix host is authenticated by ownership and carries no token unless the
 * caller asks for one as a second layer. A named pipe has nothing else to
 * authenticate a peer with, so the listener resolves the host's shared token
 * itself rather than binding a channel nobody can verify.
 */
async function resolveToken({ endpoint, platform, env, fsModule, ownership, token, tokenFile }) {
  if (typeof token === 'string' && token.length > 0) return token
  if (tokenFile) return readOrCreateChannelToken({ file: tokenFile, fsModule })
  if (ownership) return ''
  const file = platform === 'win32' ? channelTokenFile(env, platform) : null
  if (!file) throw Error(`refusing ${endpoint}: a named pipe has no owner to authenticate it, so it requires a channel token`)
  return readOrCreateChannelToken({ file, fsModule })
}

/**
 * Listen on the voice control channel.
 *
 * Where ownership can authenticate a peer it stays the gate: a private
 * directory, a 0600 socket, and a client that sends no handshake at all still
 * reaches the protocol with every byte it wrote. A named pipe has no owner, no
 * mode and no directory to keep private, so there the shared channel token is
 * the gate instead, and a connection without a valid one is destroyed before a
 * single protocol byte is read.
 */
export async function listen(path, service, options = {}) {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const fsModule = options.fsModule ?? fs
  const netModule = options.net ?? net
  const ownership = !isNamedPipe(path) && platform !== 'win32'
  const channelToken = await resolveToken({ endpoint: path, platform, env, fsModule, ownership, token: options.token, tokenFile: options.tokenFile })
  if (ownership) {
    await prepareDirectory(dirname(path), fsModule)
    await removeStale(path, fsModule, netModule)
  }
  const clients = new Set()

  /** An admitted client joins the broadcast list and starts reading commands. */
  function open(client, remainder) {
    clients.add(client)
    client.setEncoding('utf8')
    let pending = ''
    client.on('error', () => client.destroy())
    client.on('close', () => clients.delete(client))
    client.on('data', data => {
      pending += data
      if (Buffer.byteLength(pending) > MAX_INPUT_BYTES) return client.destroy()
      let newline
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline)
        pending = pending.slice(newline + 1)
        let command
        try { command = JSON.parse(line) } catch { return client.destroy() }
        if (command?.v !== 1 || !['toggle', 'status'].includes(command.type)) return client.destroy()
        if (command.type === 'toggle') {
          void service.toggle().then(
            () => send(client, service.status),
            () => { service.setState('error', 'Voice request failed'); send(client, service.status) },
          )
        } else send(client, service.status)
      }
    })
    if (remainder.length > 0) client.unshift(remainder)
    process.nextTick(() => { if (!client.destroyed) client.resume() })
  }

  /**
   * Hold a connection at the handshake until the peer is admitted or refused.
   *
   * The first line is the gate. Where a token is required the 512-byte cap is
   * what stops a peer that never sends a newline from holding the connection
   * open; where ownership is the gate the cap stays today's input bound, so a
   * client that predates the token is not held to a rule it never knew about.
   */
  function gate(client) {
    let buffer = Buffer.alloc(0)
    let settled = false
    const refuse = () => {
      if (settled) return
      settled = true
      client.removeListener('data', onData)
      client.destroy()
    }
    const admit = remainder => {
      if (settled) return
      settled = true
      client.removeListener('data', onData)
      client.pause()
      open(client, remainder)
    }
    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > (ownership ? MAX_INPUT_BYTES : MAX_HANDSHAKE_BYTES)) return refuse()
      const newline = buffer.indexOf(0x0a)
      if (newline === -1) return
      const line = buffer.subarray(0, newline).toString('utf8')
      const remainder = buffer.subarray(newline + 1)
      if (Buffer.byteLength(line) <= MAX_HANDSHAKE_BYTES) {
        const presented = parseHandshake(line)
        if (presented !== null) return tokenMatches(channelToken, presented) ? admit(remainder) : refuse()
      }
      // Ownership has already established that only this user could connect, so
      // a client that writes no handshake reaches the protocol with every byte
      // it sent intact. A pipe has no such guarantee, so silence is a refusal.
      if (ownership) admit(buffer)
      else refuse()
    }
    client.on('data', onData)
  }

  const server = netModule.createServer(client => {
    client.on('error', () => client.destroy())
    gate(client)
  })
  const unsubscribe = service.subscribe(status => { for (const client of clients) send(client, status) })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(path, () => { server.removeListener('error', reject); resolve(undefined) })
    })
  } catch (error) {
    unsubscribe()
    // A pipe another service holds cannot be probed for ownership, and taking its
    // name would leave two services answering to it, so it is only refused.
    if (!ownership && error.code === 'EADDRINUSE') throw Error(`refusing ${path}: another service is already listening`)
    throw error
  }
  if (ownership) await fsModule.chmod(path, 0o600)
  return { path, tokenRequired: !ownership, close: async () => {
    unsubscribe()
    for (const client of clients) client.destroy()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)))
  } }
}

function send(client, status) {
  if (client.destroyed) return
  const frame = `${JSON.stringify(status)}\n`
  if (client.writableLength + Buffer.byteLength(frame) > MAX_QUEUED_BYTES) client.destroy()
  else client.write(frame)
}
