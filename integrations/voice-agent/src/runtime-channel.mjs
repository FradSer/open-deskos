import { randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { isAbsolute, join } from 'node:path'
import {
  channelHandshake,
  channelTokenFile,
  readChannelToken,
} from './channel-token.mjs'

/**
 * One runtime channel, the way the Shell Host names it.
 *
 * A link is a logical name: the host decides whether that name is a runtime
 * directory socket or a named pipe, so a client on either host reaches the same
 * service without restating a transport. Nothing here guesses: a Unix host with
 * no runtime directory resolves no endpoint at all, because there is nothing
 * listening to guess at.
 *
 * @param {{ name: string, override?: string, unixSubdirectory: string, unixFilename?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} link
 */
export function resolveChannelEndpoint({ name, override, unixSubdirectory, unixFilename = 'service.sock', env = process.env, platform = process.platform }) {
  if (typeof override === 'string' && override.trim()) return override.trim()
  if (platform === 'win32') return `\\\\.\\pipe\\open-deskos-${name}`
  const runtimeDir = typeof env.XDG_RUNTIME_DIR === 'string' && isAbsolute(env.XDG_RUNTIME_DIR) ? env.XDG_RUNTIME_DIR : null
  if (!runtimeDir) return null
  return join(runtimeDir, unixSubdirectory, unixFilename)
}

/** A named pipe and a network address carry no owner, so the channel token is what authenticates them. */
export function channelRequiresToken(endpoint, platform = process.platform) {
  if (platform === 'win32') return true
  if (typeof endpoint !== 'string') return false
  return /^\\\\\.\\pipe\//i.test(endpoint) || /^tcp:\/\//i.test(endpoint)
}

/**
 * The token this client presents, read and never created.
 *
 * A listener owns the token file and creates it; a client that found none is
 * talking to a Shell that is not running, and inventing a token would be writing
 * a credential into whatever directory the process happens to be standing in.
 *
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, file?: string, fsModule?: typeof import('node:fs/promises') }} options
 */
export async function clientChannelToken({ env = process.env, platform = process.platform, file, fsModule } = {}) {
  return readChannelToken({ file: file || env.ODK_CHANNEL_TOKEN_FILE || channelTokenFile(env, platform), ...(fsModule ? { fsModule } : {}) })
}

/**
 * One request and one response over a runtime channel.
 *
 * The handshake is the listener's first line, so the response is the first line
 * that is not one. Every failure is named for what it was — an absent listener, a
 * missing token, a refusal, a bound — because a caller that cannot tell them apart
 * will report the wrong one to the person who has to fix it.
 *
 * @param {{
 *   endpoint: string, payload: { v: 1, id: string } & Record<string, unknown>,
 *   label: string, timeoutMs?: number, maxResponseBytes?: number,
 *   token?: string | null, tokenRequired?: boolean, signal?: AbortSignal,
 *   connect?: typeof createConnection,
 * }} request
 */
export function channelRequest({ endpoint, payload, label, timeoutMs = 10_000, maxResponseBytes = 512 * 1024, token = null, tokenRequired = false, signal, connect = createConnection }) {
  return new Promise((resolve, reject) => {
    let settled = false
    let output = ''
    const socket = connect(endpoint)
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      socket.destroy()
      error ? reject(error) : resolve(value)
    }
    const abort = () => finish(Error(`${label} request aborted`))
    const timer = setTimeout(() => finish(Error(`${label} request timed out`)), timeoutMs)
    socket.setEncoding('utf8')
    socket.on('connect', () => {
      if (tokenRequired && !token) return finish(Error(`${label} unavailable: this host has no channel token to present`))
      if (token) socket.write(channelHandshake(token))
      socket.write(`${JSON.stringify(payload)}\n`)
    })
    socket.on('data', chunk => {
      output += chunk
      if (Buffer.byteLength(output, 'utf8') > maxResponseBytes) return finish(Error(`${label} response too large`))
      // The listener consumes the handshake before its protocol reads a byte, so
      // the first complete line back is the response. Looking for a line that is
      // not a handshake would instead skip a valid reading whose own fields
      // happen to name a token, which is a reading this client must be able to read.
      const [line] = output.split('\n').slice(0, -1)
      if (!line || !line.trim()) return
      let response
      try { response = JSON.parse(line) } catch { return finish(Error(`${label}: the first line back is not a readable response`)) }
      const record = /** @type {{ v?: unknown, id?: unknown, ok?: unknown, error?: unknown }} */ (response)
      if (record?.v !== 1 || typeof record.ok !== 'boolean') {
        // A frame that opened with something else is a wrong frame, not a slow
        // one: say so now rather than let the request time out and report an
        // absent Shell for a listener that is answering.
        return finish(Error(`${label}: the first line back is not a ${label} response`))
      }
      if (record.id !== payload.id) return finish(Error(`${label} response did not answer this request`))
      if (!record.ok) return finish(Error(typeof record.error === 'string' ? record.error : `${label} request refused`))
      finish(null, response)
    })
    socket.on('error', () => finish(Error(`${label} unavailable`)))
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** One request identifier, so a response is never accepted for the wrong request. */
export const requestId = () => randomUUID()
