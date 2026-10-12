import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, win32 } from 'node:path'

// The version of the transport handshake itself, which is separate from the
// voice protocol carried on top of it. Both ends publish this same frame, so a
// client and this service never have to agree on anything else.
export const CHANNEL_VERSION = 1
export const TOKEN_FILENAME = 'local-channel.token'
export const TOKEN_BYTES = 32
// A handshake is one short line. The cap is what stops a peer that never sends
// a newline from holding a connection open forever.
export const MAX_HANDSHAKE_BYTES = 512

/**
 * The token every local channel on this host shares. Where ownership cannot
 * authenticate a peer it is the only thing that does, so it is created on first
 * use and then left alone: a channel that replaced it would lock out services
 * already running.
 *
 * The location is the one the Shell Host already resolves, so the two ends of
 * the channel read one file rather than one file each.
 */
export function channelTokenFile(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || win32.join(homedir(), 'AppData', 'Local')
    return win32.join(local, 'odk', TOKEN_FILENAME)
  }
  return join(env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'odk', TOKEN_FILENAME)
}

async function read(file, fsModule) {
  try {
    return (await fsModule.readFile(file, 'utf8')).trim() || null
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Read the host's channel token, creating it on first use.
 *
 * Services publish complete candidate files without replacing a winner.
 * A competing service reads the published token.
 *
 * @param {{ file?: string, fsModule?: typeof fs }} options
 */
export async function readOrCreateChannelToken({ file, fsModule = fs } = {}) {
  if (typeof file !== 'string' || file.length === 0) {
    throw Error('a channel token file is required where ownership cannot authenticate the peer')
  }
  const existing = await read(file, fsModule)
  if (existing) return existing

  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  await fsModule.mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const candidateDir = await fsModule.mkdtemp(join(dirname(file), '.local-channel-token-'))
  const candidate = join(candidateDir, TOKEN_FILENAME)
  try {
    await fsModule.writeFile(candidate, `${token}\n`, { mode: 0o600, flag: 'wx' })
    try { await fsModule.link(candidate, file) } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const raced = await read(file, fsModule)
      if (!raced) throw Error('runtime channel token file is empty')
      return raced
    }
    await fsModule.chmod(file, 0o600).catch(() => {})
    return token
  } finally {
    await fsModule.rm(candidateDir, { recursive: true, force: true })
  }
}

/**
 * Read the host's channel token without creating one.
 *
 * A listener owns the token file and creates it; a client that finds none is
 * talking to a host where the service is not running. Creating one there would
 * write a credential into whatever directory the process happens to be standing
 * in, so a client returns nothing and lets its caller report that.
 *
 * @param {{ file?: string, fsModule?: typeof fs }} options
 */
export async function readChannelToken({ file, fsModule = fs } = {}) {
  if (typeof file !== 'string' || file.length === 0) return null
  return await read(file, fsModule)
}

/** The one frame a client sends before its own first command. */
export function channelHandshake(token) {
  return `${JSON.stringify({ v: CHANNEL_VERSION, token })}\n`
}

/** The token in a handshake line, or null when the line is not one. */
export function parseHandshake(line) {
  let record
  try { record = JSON.parse(line) } catch { return null }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  if (record.v !== CHANNEL_VERSION || typeof record.token !== 'string') return null
  return record.token
}

/** Constant-time comparison, with the length checked first because timingSafeEqual requires it. */
export function tokenMatches(expected, given) {
  if (typeof given !== 'string') return false
  const wanted = Buffer.from(String(expected), 'utf8')
  const presented = Buffer.from(given, 'utf8')
  return wanted.length === presented.length && timingSafeEqual(wanted, presented)
}
