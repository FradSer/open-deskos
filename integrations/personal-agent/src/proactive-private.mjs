import { chmodSync, lstatSync, realpathSync, openSync, closeSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { readLocalFile } from './personal-config.mjs'
import { createWindowsPrivatePaths } from './proactive-private-windows.mjs'

let windowsPrivatePaths

/** Protect each new ancestor before creating its children. Never repair an existing directory. */
export function createProactiveDirectory(directory) {
  try { mkdirSync(directory, { mode: 0o700 }) }
  catch (error) {
    if (error.code === 'EEXIST') return
    if (error.code !== 'ENOENT') throw error
    const parent = dirname(directory)
    if (parent === directory) throw error
    createProactiveDirectory(parent)
    return createProactiveDirectory(directory)
  }
  protectProactivePath(directory)
}

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
  try {
    windowsPrivatePaths ??= createWindowsPrivatePaths()
    windowsPrivatePaths(operation, path, lstatSync(path).isDirectory())
  } catch { throw Error('Unsafe private proactive path ACL') }
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
