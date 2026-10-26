import { constants, lstatSync, fstatSync, realpathSync, openSync, readSync, mkdirSync, writeFileSync, fsyncSync, closeSync, linkSync, unlinkSync } from 'node:fs'
import { dirname, join, isAbsolute, normalize } from 'node:path'
import { randomUUID } from 'node:crypto'

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const unsafe = () => Error('Gmail credentials are unavailable or unsafe.')
const localPath = path => typeof path === 'string' && isAbsolute(path) && normalize(path) === path && !/[\x00-\x1f\x7f]/.test(path)
const secret = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\s\x00-\x1f\x7f]/.test(value)

export function validateGmailCredentials(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'clientId,clientSecret,refreshToken,schemaVersion,scope'
    || value.schemaVersion !== 1 || value.scope !== GMAIL_SCOPE
    || !secret(value.clientId) || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.clientId)
    || !secret(value.clientSecret) || !secret(value.refreshToken)) throw unsafe()
  return value
}

function directory(path) {
  if (!localPath(path) || process.platform === 'win32') throw unsafe()
  const parent = dirname(path)
  const info = lstatSync(parent)
  if (!info.isDirectory() || realpathSync(parent) !== parent) throw unsafe()
  if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw unsafe()
}

function createDirectory(path) {
  try { mkdirSync(path, { mode: 0o700 }) }
  catch (error) {
    if (error.code === 'EEXIST') return
    if (error.code !== 'ENOENT' || dirname(path) === path) throw error
    createDirectory(dirname(path))
    mkdirSync(path, { mode: 0o700 })
  }
}

/** Bounded private I/O without a dependency on the resident implementation. */
function readPrivateFile(path) {
  if (realpathSync(path) !== path) throw unsafe()
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd)
    if (!before.isFile() || before.nlink !== 1 || before.size > 32768 || (before.mode & 0o077) !== 0 || before.uid !== process.getuid?.()) throw unsafe()
    const buffer = Buffer.alloc(32769)
    let size = 0
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null)
      if (!count) break
      size += count
    }
    const after = fstatSync(fd), current = lstatSync(path)
    if (size > 32768 || after.nlink !== 1 || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || current.dev !== after.dev || current.ino !== after.ino) throw unsafe()
    return buffer.subarray(0, size).toString('utf8')
  } finally { closeSync(fd) }
}

/** Check operator storage before starting a browser authorization. */
export function validateGmailCredentialDestination(path) {
  try {
    if (!localPath(path)) throw unsafe()
    createDirectory(dirname(path))
    directory(path)
    try { lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    throw unsafe()
  } catch { throw unsafe() }
}

/** No credential bytes or path details escape failures. An absent grant is unconfigured. */
export function readGmailCredentials(path) {
  try {
    if (!localPath(path)) throw unsafe()
    try { lstatSync(path) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    directory(path)
    return validateGmailCredentials(JSON.parse(readPrivateFile(path)))
  } catch { throw unsafe() }
}

/** Publish only a new private grant. Never replace an existing operator file. */
export function writeGmailCredentials(path, value) {
  let temporary
  try {
    validateGmailCredentials(value)
    validateGmailCredentialDestination(path)
    temporary = join(dirname(path), `.gmail-${randomUUID()}.tmp`)
    const fd = openSync(temporary, 'wx', 0o600)
    try { writeFileSync(fd, JSON.stringify(value), 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
    // An exclusive hard link publishes complete bytes without replacing a raced grant.
    linkSync(temporary, path)
  } catch { throw unsafe() }
  finally { if (temporary) { try { unlinkSync(temporary) } catch {} } }
}

export function removeGmailCredentials(path, expectedGrant = undefined) {
  try {
    const current = readGmailCredentials(path)
    if (current) {
      if (expectedGrant !== undefined) {
        validateGmailCredentials(expectedGrant)
        if (Object.keys(current).some(key => current[key] !== expectedGrant[key])) throw unsafe()
      }
      directory(path)
      unlinkSync(path)
    }
  }
  catch { throw unsafe() }
}
