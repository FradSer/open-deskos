'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const { constants } = require('node:fs')
const NO_FOLLOW = constants.O_NOFOLLOW || 0

function relativeParts(relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('invalid-relative-path')
  const parts = relative.split(/[\\/]+/).filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === '..' || part === '.')) throw new Error('invalid-relative-path')
  return parts
}

async function trustedRoot(root) {
  if (typeof root !== 'string' || root.length === 0 || !path.isAbsolute(root)) throw new Error('invalid-root')
  const stat = await fs.lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe-root')
  return path.resolve(root)
}

async function checkParents(root, parts, create) {
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    try {
      const stat = await fs.lstat(current)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe-path')
    } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error
      await fs.mkdir(current, { mode: 0o700 })
      await fs.chmod(current, 0o700)
    }
  }
  return current
}

async function readBoundedFile(root, relative, maxBytes) {
  const parts = relativeParts(relative)
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error('invalid-limit')
  const trusted = await trustedRoot(root)
  const parent = await checkParents(trusted, parts.slice(0, -1), false)
  const file = path.join(parent, parts.at(-1))
  const link = await fs.lstat(file)
  if (!link.isFile() || link.isSymbolicLink()) throw new Error('unsafe-file')
  const handle = await fs.open(file, constants.O_RDONLY | NO_FOLLOW)
  try {
    const initial = await handle.stat()
    if (!initial.isFile() || initial.isSymbolicLink()) throw new Error('unsafe-file')
    if (initial.size > maxBytes) throw new Error('file-too-large')
    const buffer = Buffer.alloc(maxBytes + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }
    const final = await handle.stat()
    if (!final.isFile() || final.size > maxBytes || bytesRead > maxBytes) throw new Error('file-too-large')
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function ensureDirectory(root, relative) {
  const parts = relativeParts(relative)
  const trusted = await trustedRoot(root)
  return checkParents(trusted, parts, true)
}

async function writeExclusive(root, relative, bytes) {
  const parts = relativeParts(relative)
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new Error('invalid-bytes')
  const trusted = await trustedRoot(root)
  const parent = await checkParents(trusted, parts.slice(0, -1), true)
  const file = path.join(parent, parts.at(-1))
  const handle = await fs.open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, 0o600)
  try {
    let offset = 0
    while (offset < bytes.byteLength) {
      const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset)
      if (bytesWritten === 0) throw new Error('write-failed')
      offset += bytesWritten
    }
    await handle.chmod(0o600)
  } finally {
    await handle.close()
  }
  return file
}

module.exports = { readBoundedFile, ensureDirectory, writeExclusive }
