import { readFrames, writeFrame } from './channel-frames.mjs'
import { validReplyTo } from './session-replies.mjs'
import fs from 'node:fs/promises'
import net from 'node:net'
import { dirname, isAbsolute, join } from 'node:path'
import { loadPersonalAgentRuntimeReport } from './plugin-composition.mjs'
import {
  MAX_HANDSHAKE_BYTES,
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
const MAX_FRAME_BYTES = 131_072
const MAX_QUEUED_BYTES = 4 * MAX_FRAME_BYTES
const sentStatuses = new WeakMap()
const sentFrames = new WeakMap()
const sentChannels = new WeakMap()

export function statusFrames(status) {
  const { briefing, remote, conversation, ...voice } = status
  const frames = [`${JSON.stringify(voice)}\n`]
  if (briefing) frames.push(`${JSON.stringify({ v: 1, type: 'briefing', briefing })}\n`)
  if (remote) frames.push(`${JSON.stringify({v:1,type:'remote_conversation',remote})}\n`)
  if (conversation) frames.push(`${JSON.stringify({v:1,type:'conversation',conversation})}\n`)
  if (frames.some(frame => Buffer.byteLength(frame) > MAX_FRAME_BYTES)) throw Error('Status frame too large')
  return frames
}

/**
 * The endpoint this host reaches the Personal Agent service on: the named pipe the Shell
 * Host already names for the voice link on Windows, and the runtime directory
 * socket on a Unix host. A Unix host without an absolute runtime directory
 * cannot place it, and the caller refuses to start rather than invent a path.
 */
export function personalAgentEndpoint(env = process.env, platform = process.platform) {
  if (platform === 'win32') return '\\\\.\\pipe\\odk-personal-agent'
  const runtimeDir = typeof env.XDG_RUNTIME_DIR === 'string' && isAbsolute(env.XDG_RUNTIME_DIR) ? env.XDG_RUNTIME_DIR : null
  if (!runtimeDir) return null
  return join(runtimeDir, 'odk-personal-agent', 'agent.sock')
}

export function personalAgentControlEndpoint(env = process.env, platform = process.platform) {
  const voice = personalAgentEndpoint(env, platform)
  if (!voice) return null
  if (platform === 'win32') return voice + '-control'
  return join(env.XDG_RUNTIME_DIR, 'odk-personal-agent', 'control.sock')
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
  if (active) throw Error('Personal Agent service already running')
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
  const connections = new Set()
  const diagnosisClients = new WeakSet()
  const sendStatus = (client, status) => send(client, { ...status,
    ...(options.conversation ? { conversation: options.conversation.snapshot().conversation } : {}),
    ...(diagnosisClients.has(client) ? { runtimeDiagnosis: 1 } : {}),
  })

  /** An admitted client joins the broadcast list and starts reading commands. */
  function open(client, remainder) {
    clients.add(client)
    client.on('close', () => { clients.delete(client); options.piConfig?.disconnect(client); void options.remoteVoice?.close(client).catch(() => {}) })
    readFrames(client, async command => {
      if (client.destroyed) return
      if (command.type === 'pi_config') {
        if (typeof command.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(command.requestId)
          || Object.keys(command).some(k=>!['v','type','requestId','command'].includes(k))) return client.destroy()
        // Do not block frame reading during OAuth. Answers and cancellation use this channel.
        void (async () => {
          try {
            if (!options.piConfig) throw Error('Pi configuration unavailable')
            const result = await options.piConfig.request(command.command, client)
            await writeFrame(client, {v:1,type:'pi_config_result',requestId:command.requestId,result})
          } catch {
            await writeFrame(client, {v:1,type:'pi_config_result',requestId:command.requestId,error:'Pi configuration unavailable or busy. Retry when the agent is idle.'})
          }
        })().catch(()=>client.destroy())
        return
      }
      if (options.piConfig?.busy && ['text','toggle','voice_start','proposal_respond'].includes(command.type)) {
        if(command.type==='voice_start')await writeFrame(client,{v:1,type:'voice_started',requestId:command.requestId,accepted:false})
        if(command.type==='proposal_respond')sendStatus(client,{...service.status,proposalError:'Pi configuration is active. Retry when it closes.'})
        if(command.type==='text') await writeFrame(client,{v:1,type:'text_receipt',requestId:command.requestId,accepted:false})
        return
      }
      if (command.type.startsWith('voice_')) {
        if (!options.remoteVoice || !await options.remoteVoice.handle(client, command, frame => writeFrame(client, frame))) client.destroy()
        return
      }
        if (command?.v !== 1 || !['runtime_diagnose', 'text', 'toggle', 'status', 'proactive_event', 'proposal_presented', 'proposal_list', 'proposal_respond'].includes(command.type)) return client.destroy()
        if (command.type === 'status' && command.runtimeDiagnosis === 1) diagnosisClients.add(client)
        if (command.type === 'runtime_diagnose') {
          if (Object.keys(command).some(key => !['v', 'type', 'requestId'].includes(key))
            || typeof command.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(command.requestId)) return client.destroy()
          /** @type {{ host: string, instance: string, state: string, reason?: string, plugins: object[] }} */
          let runtime = { host: 'personal-agent', instance: 'resident', state: 'unavailable', reason: 'not-supported', plugins: [] }
          if (options.runtimeSnapshot) {
            try {
              const { sanitizeRuntimePlugins } = loadPersonalAgentRuntimeReport()
              const plugins = options.runtimeSnapshot()
              if (typeof plugins?.then === 'function') {
                void Promise.resolve(plugins).catch(() => {})
                throw Error('Runtime snapshot must be synchronous')
              }
              runtime = { host: 'personal-agent', instance: 'resident', state: 'available',
                plugins: sanitizeRuntimePlugins({ plugins }, 'personal-agent') }
            } catch { runtime.reason = 'invalid-report' }
          }
          const frame = `${JSON.stringify({ v: 1, type: 'runtime_diagnosis', requestId: command.requestId, runtime })}\n`
          if (client.writableLength + Buffer.byteLength(frame) > MAX_QUEUED_BYTES) client.destroy()
          else client.write(frame)
          return
        }
        if (command.type === 'text') {
          if (Object.keys(command).some(key => !['v', 'type', 'text', 'requestId', 'replyTo'].includes(key))
            || typeof command.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(command.requestId)
            || command.replyTo!==undefined && !validReplyTo(command.replyTo)
            || typeof command.text !== 'string' || !command.text.trim() || Buffer.byteLength(command.text, 'utf8') > 3000) return client.destroy()
          const accepted = service.sendText(command.text,command.replyTo)
          client.write(`${JSON.stringify({ v: 1, type: 'text_receipt', requestId: command.requestId, accepted })}\n`)
          return
        }
        if (command.type === 'proactive_event') {
          if (Object.keys(command).some(key => !['v', 'type', 'readingIds'].includes(key)) || !Array.isArray(command.readingIds) || !command.readingIds.length || command.readingIds.length > 32 || !command.readingIds.every(id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))) return client.destroy()
          try { service.servicePush(command.readingIds); sendStatus(client, service.status) } catch { sendStatus(client, { ...service.status, proposalError: 'Service update refused; check selected readings and Jev configuration.' }) }
          return
        }
        if (command.type.startsWith('proposal_')) {
          if (command.type === 'proposal_presented' && (!Array.isArray(command.ids) || command.ids.length > 64 || !command.ids.every(id => typeof id === 'string' && id.length === 36))) return client.destroy()
          if (command.type === 'proposal_respond' && (typeof command.id !== 'string' || command.id.length !== 36 || !['accept', 'ignore', 'mute'].includes(command.decision) || (command.confirmation !== undefined && (typeof command.confirmation !== 'string' || command.confirmation.length > 2048)))) return client.destroy()
          void service.proposalCommand(command).then(() => sendStatus(client, service.status), () => {
            sendStatus(client, { ...service.status, proposalError: 'Suggestion response refused; check confirmation, source freshness and service availability.' })
          })
        } else if (command.type === 'toggle') {
          void service.toggle().then(
            () => sendStatus(client, service.status),
            () => { service.setState('error', 'Personal Agent request failed'); sendStatus(client, service.status) },
          )
        } else sendStatus(client, service.status)
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
      if (buffer.length > MAX_FRAME_BYTES + MAX_HANDSHAKE_BYTES) return refuse()
      const newline = buffer.indexOf(0x0a)
      if (newline === -1) {
        if (buffer.length > (ownership ? MAX_INPUT_BYTES : MAX_HANDSHAKE_BYTES)) refuse()
        return
      }
      if (!ownership && newline + 1 > MAX_HANDSHAKE_BYTES) return refuse()
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
    connections.add(client)
    client.on('close', () => connections.delete(client))
    client.on('error', () => client.destroy())
    gate(client)
  })
  const unsubscribe = service.subscribe(status => { for (const client of clients) sendStatus(client, status) })
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
    try { await options.remoteVoice?.close() } finally {
      for (const client of connections) client.destroy()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve(undefined)))
    }
  } }
}

function send(client, status) {
  if (client.destroyed) return
  const previous = sentStatuses.get(client)
  // Audio levels are replaceable. A busy Shell must not accumulate copies of
  // unchanged suggestions on every meter tick; state/content changes still send.
  if (client.writableLength > 0 && previous?.state === 'recording' && status.state === 'recording'
    && Object.keys(previous).length === Object.keys(status).length
    && Object.entries(status).every(([key, value]) => Object.hasOwn(previous, key) && (key === 'level' || previous[key] === value))) return
  let frames
  try { frames = statusFrames(status) } catch { client.destroy(); return }
  const channels = sentChannels.get(client) ?? new Map()
  const extras = frames.slice(1).map(frame => [JSON.parse(frame).type, frame])
  frames = frames.filter((frame, index) => index === 0 || channels.get(JSON.parse(frame).type) !== frame)
  const frame = frames.join('')
  // Open DeskOS Data pushes can echo the current snapshot while the reader is busy.
  // Only byte-identical snapshots are redundant; popup/error/content changes send.
  if (client.writableLength > 0 && sentFrames.get(client) === frame) return
  if (client.writableLength + Buffer.byteLength(frame) > MAX_QUEUED_BYTES) client.destroy()
  else {
    client.write(frame)
    sentStatuses.set(client, status)
    sentFrames.set(client, frame)
    for (const [type, value] of extras) channels.set(type, value)
    sentChannels.set(client, channels)
  }
}
