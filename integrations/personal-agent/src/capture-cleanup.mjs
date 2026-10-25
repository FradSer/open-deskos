import { lstat, readdir, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'

// Run before opening the channel. Only private recorder-owned temporary directories qualify.
export async function cleanStaleCaptures(directory) {
  const info = await lstat(directory)
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.()
    || (info.mode & 0o077) || await realpath(directory) !== directory) throw Error('Unsafe capture directory')
  for (const name of await readdir(directory)) {
    if (!/^(?:capture|remote-voice)-[A-Za-z0-9]{6}$/.test(name)) continue
    const path = join(directory, name), entry = await lstat(path)
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.uid !== info.uid || (entry.mode & 0o077)) throw Error('Unsafe stale capture')
    await rm(path, { recursive: true })
  }
}
