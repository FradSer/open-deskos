import { lstatSync, realpathSync, mkdirSync } from 'node:fs'
import { dirname, isAbsolute, normalize } from 'node:path'

/** Directory ownership is the local service authorization boundary. */
export function privateSocketPath(path, create = false) {
  if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path || Buffer.byteLength(path) > 100 || /[\x00-\x1f\x7f]/.test(path)) throw Error('Private Gmail socket path required')
  const parent = dirname(path)
  if (create) mkdirSync(parent, { recursive: true, mode: 0o700 })
  const info = lstatSync(parent)
  if (!info.isDirectory() || realpathSync(parent) !== parent || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('Private Gmail socket directory required')
  return path
}

export function checkSocket(path) {
  privateSocketPath(path)
  const info = lstatSync(path)
  if (!info.isSocket() || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('Private Gmail socket unavailable')
  return info
}
