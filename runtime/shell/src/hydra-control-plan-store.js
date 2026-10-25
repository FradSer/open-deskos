'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { unicast } = require('./hydra-peer-store')
const MAX_BYTES = 8192, MAX_SEQUENCE = 0xffffffff
const stamp = info => ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].map(name => String(info[name])).join(':')
const bad = () => { throw Error('hydra-plan-state-unavailable') }
function createHydraPlanStore(file) {
  let tail = Promise.resolve()
  function parent() {
    if (process.platform === 'win32' || !path.isAbsolute(file || '') || !fs.constants.O_NOFOLLOW || typeof process.getuid !== 'function') bad()
    const directory = path.dirname(file), info = fs.lstatSync(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || info.mode & 0o022 || fs.realpathSync(directory) !== directory) bad()
    return directory
  }
  function load() {
    parent(); let selected
    try { selected = fs.lstatSync(file, { bigint: true }) } catch (error) { if (error.code === 'ENOENT') return {}; throw error }
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    try {
      const info = fs.fstatSync(fd, { bigint: true })
      if (!info.isFile() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o777n) !== 0o600n || info.nlink !== 1n || info.size > BigInt(MAX_BYTES) || stamp(selected) !== stamp(info)) bad()
      const bytes = Buffer.alloc(MAX_BYTES + 1), count = fs.readSync(fd, bytes, 0, bytes.length, 0)
      if (count !== Number(info.size) || stamp(info) !== stamp(fs.fstatSync(fd, { bigint: true })) || stamp(info) !== stamp(fs.lstatSync(file, { bigint: true }))) bad()
      const value = JSON.parse(bytes.subarray(0, count).toString('utf8'))
      if (!value || Object.keys(value).length !== 2 || value.schemaVersion !== 1 || !value.peers || Array.isArray(value.peers) || typeof value.peers !== 'object' || Object.keys(value.peers).length > 64) bad()
      for (const [peer, nodes] of Object.entries(value.peers)) {
        if (!unicast(peer) || peer !== peer.toLowerCase() || !nodes || Array.isArray(nodes) || typeof nodes !== 'object' || Object.keys(nodes).length > 6) bad()
        for (const [node, sequence] of Object.entries(nodes)) if (!/^[1-6]$/.test(node) || !Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) bad()
      }
      return value.peers
    } finally { fs.closeSync(fd) }
  }
  function write(peer, node, sequence) {
    if (!unicast(peer) || !Number.isInteger(node) || node < 1 || node > 6 || !Number.isInteger(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) bad()
    const directory = parent(), lock = file + '.lock', fd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
    const identity = fs.fstatSync(fd), temporary = path.join(directory, `.hydra-plan-${randomUUID()}.tmp`)
    let handle
    try {
      const peers = load(), selected = peer.toLowerCase()
      if (sequence <= (peers[selected]?.[node] || 0)) bad()
      if (!Object.hasOwn(peers, selected) && Object.keys(peers).length >= 64) bad()
      peers[selected] = { ...peers[selected], [node]: sequence }
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, peers }) + '\n'); if (bytes.length > MAX_BYTES) bad()
      handle = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(handle, bytes); fs.fsyncSync(handle); fs.closeSync(handle); handle = undefined
      fs.renameSync(temporary, file)
      const dir = fs.openSync(directory, fs.constants.O_RDONLY); try { fs.fsyncSync(dir) } finally { fs.closeSync(dir) }
      if ((load()[selected]?.[node] || 0) !== sequence) bad()
    } finally {
      if (handle !== undefined) fs.closeSync(handle)
      try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
      const current = fs.lstatSync(lock)
      if (current.dev !== identity.dev || current.ino !== identity.ino) { fs.closeSync(fd); bad() }
      fs.unlinkSync(lock); fs.closeSync(fd)
    }
  }
  return { get(peer, node) { if (!unicast(peer)) bad(); return load()[peer.toLowerCase()]?.[node] || 0 },
    reserve(peer, node, sequence) { const operation = tail.then(() => write(peer, node, sequence)); tail = operation.catch(() => {}); return operation } }
}
module.exports = { createHydraPlanStore }
