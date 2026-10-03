import { spawnSync } from 'node:child_process'
import { chmodSync, lstatSync, realpathSync, openSync, closeSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { readLocalFile } from './personal-config.mjs'

const helper = fileURLToPath(new URL('./proactive-private.ps1', import.meta.url))

/** Windows mode bits are not ACLs. Never relax existing owner files while reading. */
export function checkProactivePath(path) {
  if (process.platform !== 'win32') return
  acl('Check', path)
}

/** Only called for new task-owned directories or temporary files before publishing. */
export function protectProactivePath(path) {
  if (process.platform === 'win32') acl('Protect', path)
  else chmodSync(path, lstatSync(path).isDirectory() ? 0o700 : 0o600)
}

function acl(operation, path) {
  if (realpathSync(path) !== path || lstatSync(path).isSymbolicLink()) throw Error('Unsafe private proactive path')
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-Operation', operation, '-Path', path], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 8192 })
  if (result.status !== 0 || result.stdout.trim() !== 'PRIVATE_PATH_OK') throw Error('Unsafe private proactive path ACL')
}

export function readProactiveFile(file, limit) {
  checkProactivePath(file)
  const value = readLocalFile(file, limit, process.platform !== 'win32')
  if (lstatSync(file).nlink !== 1) throw Error('Unsafe private proactive file')
  return value
}

/** Secure an empty exclusive temporary file before any private bytes are written. */
export function openProactiveTemporary(file) {
  checkProactivePath(dirname(file))
  const fd = openSync(file, 'wx', 0o600)
  try { protectProactivePath(file); return fd } catch (error) {
    closeSync(fd)
    try { unlinkSync(file) } catch {}
    throw error
  }
}
