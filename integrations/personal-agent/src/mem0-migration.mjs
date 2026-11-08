import { closeSync, fsyncSync, lstatSync, openSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { openProactiveTemporary, readProactiveFile } from './proactive-private.mjs'
import { privateMemoryDirectory } from './mem0.mjs'

export function readLegacyMemory(file, bytes) {
  if (!file) return undefined
  try { lstatSync(file) } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw error
  }
  privateMemoryDirectory(dirname(file))
  return JSON.parse(readProactiveFile(file, bytes))
}

/** The receipt contains no memory content. Publish it only after all native writes complete. */
export function memoryMigration(stateDir, name, migrate) {
  let running
  return () => {
    if (!running) running = (async () => {
      const directory = join(stateDir, 'personal-agent', 'memory-migrations')
      const receipt = join(directory, name)
      privateMemoryDirectory(directory)
      let exists = true
      try { lstatSync(receipt) } catch (error) {
        if (error.code !== 'ENOENT') throw error
        exists = false
      }
      if (exists) { readProactiveFile(receipt, 0); return }
      await migrate()
      try {
        const fd = openProactiveTemporary(receipt)
        try { fsyncSync(fd) } finally { closeSync(fd) }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        readProactiveFile(receipt, 0)
      }
      if (process.platform === 'win32') return
      const fd = openSync(directory, 'r')
      try { fsyncSync(fd) } finally { closeSync(fd) }
    })().catch(error => { running = undefined; throw error })
    return running
  }
}
