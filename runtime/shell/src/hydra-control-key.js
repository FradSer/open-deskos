'use strict'
const fs = require('node:fs')
const path = require('node:path')
const stamp = stat => ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'].map(name => String(stat[name])).join(':')
function readHydraControlKey(file, { platform = process.platform } = {}) {
  const fail = () => { throw Error('hydra-control-key-unavailable') }
  if (platform === 'win32' || typeof process.getuid !== 'function' || !path.isAbsolute(file || '') || !fs.constants.O_NOFOLLOW) return fail()
  let fd
  try {
    if (fs.realpathSync(file) !== file) return fail()
    const selected = fs.lstatSync(file, { bigint: true }), parent = fs.lstatSync(path.dirname(file), { bigint: true })
    if (!parent.isDirectory() || parent.uid !== BigInt(process.getuid()) || parent.mode & 0o022n) return fail()
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
    const before = fs.fstatSync(fd, { bigint: true })
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || (before.mode & 0o777n) !== 0o600n || before.nlink !== 1n || before.size !== 32n || stamp(before) !== stamp(selected)) return fail()
    const bytes = Buffer.alloc(33), count = fs.readSync(fd, bytes, 0, bytes.length, 0)
    if (count !== 32 || !bytes.subarray(0, 32).some(value => value) || stamp(before) !== stamp(fs.fstatSync(fd, { bigint: true })) || stamp(before) !== stamp(fs.lstatSync(file, { bigint: true }))) return fail()
    return Buffer.from(bytes.subarray(0, 32))
  } catch { return fail() } finally { if (fd !== undefined) fs.closeSync(fd) }
}
module.exports = { readHydraControlKey }
