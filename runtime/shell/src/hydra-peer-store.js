'use strict'
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { TextDecoder } = require('node:util')
const MAX_BYTES = 1024
const unicast = value => typeof value === 'string' && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(value) && !(parseInt(value.slice(0, 2), 16) & 1) && value !== '00:00:00:00:00:00'
function validatePrivate(stat) {
  if (!stat.isFile() || stat.size > MAX_BYTES || (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) throw Error('invalid-hydra-profile')
}
function createHydraPeerStore(file) {
  let tail = Promise.resolve()
  function load() {
    if (!path.isAbsolute(file || '')) throw Error('invalid-hydra-profile')
    let selected
    try { selected = fs.lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    if (selected.isSymbolicLink()) throw Error('invalid-hydra-profile')
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0))
    try {
      const stat = fs.fstatSync(fd); validatePrivate(stat)
      if (stat.ino !== selected.ino || stat.dev !== selected.dev) throw Error('invalid-hydra-profile')
      const bytes = Buffer.alloc(MAX_BYTES + 1), count = fs.readSync(fd, bytes, 0, bytes.length, null)
      if (count > MAX_BYTES) throw Error('invalid-hydra-profile')
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)))
      if (!value || Array.isArray(value) || value.schemaVersion !== 1 || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'peer') || (value.peer !== null && !unicast(value.peer))) throw Error('invalid-hydra-profile')
      return value.peer === null ? null : value.peer.toLowerCase()
    } finally { fs.closeSync(fd) }
  }
  async function persist(peer) {
    if (!path.isAbsolute(file || '') || (peer !== null && !unicast(peer))) throw Error('invalid-hydra-profile')
    const parent = path.dirname(file)
    await fsp.mkdir(parent, { recursive: true, mode: 0o700 })
    const directory = await fsp.lstat(parent)
    if (!directory.isDirectory() || directory.isSymbolicLink() || (process.platform !== 'win32' && (directory.uid !== process.getuid() || (directory.mode & 0o022)))) throw Error('invalid-hydra-profile')
    try {
      const selected = await fsp.lstat(file)
      if (selected.isSymbolicLink()) throw Error('invalid-hydra-profile')
      validatePrivate(selected)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const temporary = path.join(parent, `.hydra-peer-${randomUUID()}.tmp`)
    let handle
    try {
      handle = await fsp.open(temporary, 'wx', 0o600)
      await handle.writeFile(JSON.stringify({ schemaVersion: 1, peer: peer === null ? null : peer.toLowerCase() }) + '\n')
      await handle.sync(); await handle.close(); handle = null
      await fsp.rename(temporary, file)
    } finally {
      await handle?.close()
      await fsp.rm(temporary, { force: true })
    }
  }
  return { load, save(peer) { const operation = tail.then(() => persist(peer)); tail = operation.catch(() => {}); return operation }, drain: () => tail }
}
module.exports = { createHydraPeerStore, unicast }
