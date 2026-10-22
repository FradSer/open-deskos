import { constants } from 'node:fs'
import { open, lstat, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { FileError } from '@earendil-works/pi-durable/env'
import { JsonlStorage } from '@earendil-works/pi-durable/storage/jsonl'
import lockfile from 'proper-lockfile'
import { checkProactivePath, protectProactivePath } from './proactive-private.mjs'

const NO_FOLLOW = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
const storageName = /^(?:main|(?:doc|task)-(?:0|[1-9]\d*))\.jsonl(?:\.reclaim)?$/

function privateFile(info) {
  if (!info.isFile() || info.nlink !== 1 || (process.platform !== 'win32' &&
      (info.uid !== process.getuid() || (info.mode & 0o077) !== 0))) throw Error('Unsafe private durable storage file')
}

/** Keep the upstream JSONL format, but hold file handles before private reads or writes. */
class PrivateStorageEnv extends NodeExecutionEnv {
  constructor(directory) { super({ cwd: directory }); this.directory = directory }

  async handle(path, flags, create = false) {
    if (dirname(path) !== this.directory || !storageName.test(path.slice(this.directory.length + 1))) throw Error('Unsafe private durable storage path')
    checkProactivePath(this.directory)
    let handle, created = false
    if (create) {
      try { handle = await open(path, flags | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW, 0o600); created = true }
      catch (error) { if (error.code !== 'EEXIST') throw error }
    }
    if (!handle) handle = await open(path, flags | NO_FOLLOW)
    try {
      if (created) protectProactivePath(path)
      checkProactivePath(path)
      privateFile(await lstat(path))
      privateFile(await handle.stat())
      return handle
    } catch (error) { await handle.close(); throw error }
  }

  /** @template T
   * @param {string} path @param {number} flags @param {boolean} create
   * @param {import('@earendil-works/chord').Context} context
   * @param {(handle: import('node:fs/promises').FileHandle) => Promise<T>} execute
   * @returns {Promise<import('@earendil-works/pi-durable/env').Result<T, FileError>>}
   */
  async operation(path, flags, create, context, execute) {
    let handle
    try {
      context.abortSignal?.throwIfAborted()
      handle = await this.handle(path, flags, create)
      const value = await execute(handle)
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: new FileError(error.code === 'ENOENT' ? 'not_found' : 'invalid',
        'Unsafe or unavailable private durable storage file', path) }
    } finally { await handle?.close() }
  }

  readBinaryFile(path, context) {
    return this.operation(path, constants.O_RDONLY, false, context, handle => handle.readFile())
  }
  appendFile(path, content, context) {
    return this.operation(path, constants.O_WRONLY | constants.O_APPEND, true, context, async handle => {
      await handle.writeFile(content)
      await handle.sync()
    })
  }
  writeFile(path, content, context) {
    return this.operation(path, constants.O_WRONLY, true, context, async handle => { await handle.truncate(0); await handle.writeFile(content) })
  }
  truncateFile(path, size, context) {
    return this.operation(path, constants.O_RDWR, false, context, async handle => { await handle.truncate(size) })
  }
  flushFile(path, context) {
    return this.operation(path, constants.O_RDWR, false, context, async handle => { await handle.sync() })
  }
}

/** Only one Harness can own a JSONL directory. Use the same lock policy on every host. */
export async function openPrivateDurableStorage(directory, context) {
  const release = await lockfile.lock(directory, { lockfilePath: join(directory, '.writer.lock'), stale: 120000, update: 10000, retries: 0 })
  let storage
  try {
    for (const name of await readdir(directory)) {
      if (storageName.test(name)) {
        const path = join(directory, name)
        checkProactivePath(path)
        privateFile(await lstat(path))
      }
    }
    storage = await JsonlStorage.open(directory, new PrivateStorageEnv(directory), context, { fsync: true })
    const closeStorage = storage.close.bind(storage)
    let closing
    storage.close = closeContext => {
      if (!closing) closing = (async () => {
        try { await closeStorage(closeContext) }
        finally { await release() }
      })()
      return closing
    }
    return storage
  } catch (error) {
    try { await storage?.close(context) }
    finally { await release() }
    throw error
  }
}
