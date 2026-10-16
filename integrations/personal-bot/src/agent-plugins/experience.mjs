import { lstatSync, realpathSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import lockfile from 'proper-lockfile'
import { checkProactivePath, createProactiveDirectory, readProactiveFile, openProactiveTemporary } from '../proactive-private.mjs'

const LIMIT = 1024 * 1024
const DIGEST = /^[a-f0-9]{64}$/
const ID = /^[a-f0-9]{32}$/
const sensitive = /password|passwd|api[_ -]?key|secret|bearer\s|token|密码|口令|密钥|令牌|验证码|身份证|银行卡|信用卡|-----BEGIN|\bsk-[A-Za-z0-9_-]+|\b\d{13,19}\b|\beyJ[A-Za-z0-9_-]+\./i

export const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))
export const safeExperienceText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) && !sensitive.test(value)
export const experienceDigest = value => createHash('sha256').update(value).digest('hex')

function validateEntry(entry, stored = false) {
  if (!exactKeys(entry, ['title', 'body', 'sources', ...(stored ? ['id', 'createdAt'] : [])])
    || !safeExperienceText(entry.title, 120) || !safeExperienceText(entry.body, 2048)
    || !Array.isArray(entry.sources) || entry.sources.length < 1 || entry.sources.length > 4
    || !entry.sources.every(source => exactKeys(source, ['tool', 'digest']) && /^[a-zA-Z0-9_.-]{1,100}$/.test(source.tool) && DIGEST.test(source.digest))
    || (stored && (!ID.test(entry.id) || !Number.isFinite(Date.parse(entry.createdAt))))) throw Error('Invalid or sensitive learned experience')
}

function validateState(state) {
  if (!exactKeys(state, ['version', 'entries']) || state.version !== 1 || !Array.isArray(state.entries) || state.entries.length > 256) throw Error('Invalid experience state')
  for (const entry of state.entries) validateEntry(entry, true)
  if (new Set(state.entries.map(entry => entry.id)).size !== state.entries.length) throw Error('Duplicate experience identity')
  return state
}

/** One private file holds learned methods; explicit user notes retain their existing store. */
export function createExperienceStore(file) {
  if (!isAbsolute(file)) throw Error('Experience requires an absolute private path')
  const directory = dirname(file)
  function prepare() {
    createProactiveDirectory(directory)
    const info = lstatSync(directory)
    if (!info.isDirectory() || realpathSync(directory) !== directory || (process.platform !== 'win32'
      && (info.uid !== process.getuid?.() || info.mode & 0o077))) throw Error('Unsafe experience directory')
    checkProactivePath(directory)
  }
  function load() {
    prepare()
    try { lstatSync(file) } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, entries: [] }
      throw Error('Experience is unavailable or unsafe')
    }
    return validateState(JSON.parse(readProactiveFile(file, LIMIT)))
  }
  return {
    load,
    /** Merge under a filesystem lock, including across resident profiles and processes.
     * @param {{title: string, body: string, sources: {tool: string, digest: string}[]}[]} candidates
     * @param {AbortSignal} [signal]
     */
    async append(candidates, signal) {
      signal?.throwIfAborted()
      if (!Array.isArray(candidates) || candidates.length > 4) throw Error('Invalid experience batch')
      for (const entry of candidates) validateEntry(entry)
      prepare()
      const release = await lockfile.lock(file, { realpath: false, stale: 30000, retries: { retries: 10, minTimeout: 10, maxTimeout: 100 } })
      let temporary
      try {
        signal?.throwIfAborted()
        const state = load()
        const added = []
        for (const candidate of candidates) {
          const id = experienceDigest(candidate.body.trim()).slice(0, 32)
          if (state.entries.some(entry => entry.id === id)) continue
          if (state.entries.length === 256) throw Error('Experience capacity reached; existing entries were preserved')
          state.entries.push({ ...candidate, id, createdAt: new Date().toISOString() })
          added.push(id)
        }
        if (!added.length) return added
        const content = JSON.stringify(validateState(state))
        if (Buffer.byteLength(content) > LIMIT) throw Error('Experience storage limit exceeded')
        temporary = join(directory, `.experience-${randomUUID()}.tmp`)
        const fd = openProactiveTemporary(temporary)
        try { writeFileSync(fd, content); fsyncSync(fd) } finally { closeSync(fd) }
        signal?.throwIfAborted()
        renameSync(temporary, file)
        return added
      } finally {
        if (temporary) { try { unlinkSync(temporary) } catch {} }
        await release()
      }
    },
  }
}
