import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join } from 'node:path'

/**
 * The Hosted Pi host publishes where it answers, so a client never reads the host's own private
 * configuration to find it. `pi-tasks.json` stays the host's declaration — roots, state directory and
 * socket, with its ownership and mode checked once — and this descriptor is the published fact. Only
 * the daemon writes it, so the two cannot disagree about the socket the host actually bound.
 *
 * It lives in the session's runtime directory because that is the one absolute path the daemon and a
 * client of the same user session can both derive without configuring anything.
 */
export const ENDPOINT_VERSION = 1

/** @param {string} [runtimeDir] */
export function endpointFile(runtimeDir = process.env.XDG_RUNTIME_DIR) {
  if (typeof runtimeDir !== 'string' || !isAbsolute(runtimeDir)) return undefined
  return join(runtimeDir, 'open-deskos', 'hosted-pi', 'endpoint.json')
}

/** @param {string} file @param {{socketPath:string, stateDir:string}} config */
export async function publishEndpoint(file, config) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify({ version: ENDPOINT_VERSION, socketPath: config.socketPath, stateDir: config.stateDir }))
    await handle.sync()
  } finally {
    await handle.close()
  }
  try { await rename(temporary, file) }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
}

/** @param {string} file */
export async function readEndpoint(file) {
  const value = JSON.parse(await readFile(file, 'utf8'))
  if (value?.version !== ENDPOINT_VERSION || typeof value.socketPath !== 'string' || !isAbsolute(value.socketPath)) {
    throw new Error('Hosted Pi 端点描述符无效')
  }
  return value
}

/** @param {string} [file] */
export async function removeEndpoint(file) {
  if (!file) return
  await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error })
}