'use strict'
const fs = require('node:fs')

// Hold the checked file descriptor for the whole test: later failure records
// cannot follow a replaced path, and no private bytes precede permission checks.
function privateReceipt(file, protect) {
  let fd
  try {
    const before = fs.existsSync(file) ? fs.lstatSync(file) : null
    if (before && (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)) throw Error('Unsafe receipt')
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600)
    const info = fs.fstatSync(fd)
    if (!info.isFile() || info.nlink !== 1 || fs.realpathSync(file) !== file || (process.platform !== 'win32' && info.uid !== process.getuid())) throw Error('Unsafe receipt')
    if (process.platform !== 'win32') fs.fchmodSync(fd, 0o600)
    protect(file)
    const after = fs.lstatSync(file)
    if (!after.isFile() || after.isSymbolicLink() || after.ino !== info.ino || after.dev !== info.dev) throw Error('Receipt changed while securing it')
    return {
      write(value) {
        const bytes = Buffer.from(value)
        let offset = 0
        while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset, offset)
        fs.ftruncateSync(fd, bytes.length)
      },
      close() { fs.closeSync(fd) },
    }
  } catch {
    if (fd !== undefined) fs.closeSync(fd)
    throw Error('Private receipt unavailable')
  }
}
module.exports = { privateReceipt }
