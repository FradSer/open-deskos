import { lstatSync, realpathSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import lockfile from 'proper-lockfile'
import { checkProactivePath, createProactiveDirectory, readProactiveFile, openProactiveTemporary } from '../proactive-private.mjs'

const LIMIT = 1024 * 1024
const ACTIVE_LIMIT = 256
const RECORD_LIMIT = 512
const DIGEST = /^[a-f0-9]{64}$/
const ID = /^[a-f0-9]{32}$/
const sensitive = /password|passwd|api[_ -]?key|secret|bearer\s|token|密码|口令|密钥|令牌|验证码|身份证|银行卡|信用卡|-----BEGIN|\bsk-[A-Za-z0-9_-]+|\b\d{13,19}\b|\beyJ[A-Za-z0-9_-]+\./i

export const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))
export const safeExperienceText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) && !sensitive.test(value)
export const experienceDigest = value => createHash('sha256').update(value).digest('hex')

/** @typedef {{kind: 'hosted_check', version: number, profile: 'personal'|'coding'}} ExperienceScope */
/** @typedef {{target: 'mac'|'cm5', project: string, taskId: string, toolCallId: string}} CheckReceiptLocator */
/** @typedef {{tool: string, digest: string, receipt?: CheckReceiptLocator}} ExperienceSource */
/** @typedef {{title: string, body: string, sources: ExperienceSource[], scope?: ExperienceScope}} ExperienceCandidate */
/** @typedef {ExperienceCandidate & {id: string, createdAt: string, revision?: number, retired?: {at: string, replacedBy?: string}}} ExperienceEntry */

const sameScope = (a, b) => a?.kind === b?.kind && a?.version === b?.version && a?.profile === b?.profile
const validScope = scope => exactKeys(scope, ['kind', 'version', 'profile']) && scope.kind === 'hosted_check'
  && Number.isSafeInteger(scope.version) && scope.version > 0 && ['personal', 'coding'].includes(scope.profile)
const bounded = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value)
const validReceipt = receipt => exactKeys(receipt, ['target', 'project', 'taskId', 'toolCallId'])
  && ['mac', 'cm5'].includes(receipt.target) && bounded(receipt.project, 4096) && /^(?:\/|[a-z]:[\\/])/i.test(receipt.project)
  && typeof receipt.taskId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt.taskId)
  && bounded(receipt.toolCallId, 256)

export const experienceRevision = entry => experienceDigest(JSON.stringify(entry))

function validateEntry(entry, stored = false) {
  if (!exactKeys(entry, ['title', 'body', 'sources', 'scope', ...(stored ? ['id', 'createdAt', 'revision', 'retired'] : [])])
    || !safeExperienceText(entry.title, 120) || !safeExperienceText(entry.body, 2048)
    || (entry.scope !== undefined && !validScope(entry.scope))
    || !Array.isArray(entry.sources) || entry.sources.length < 1 || entry.sources.length > 4
    || !entry.sources.every(source => exactKeys(source, ['tool', 'digest', 'receipt']) && /^[a-zA-Z0-9_.-]{1,100}$/.test(source.tool) && DIGEST.test(source.digest)
      && (entry.scope ? source.tool === 'coding_check' && validReceipt(source.receipt) : source.receipt === undefined))) {
    throw Error('Invalid or sensitive learned experience')
  }
  if (!stored) return
  if (!ID.test(entry.id) || !Number.isFinite(Date.parse(entry.createdAt))
    || (entry.revision !== undefined && (!Number.isSafeInteger(entry.revision) || entry.revision < 1))) throw Error('Invalid experience identity')
  const retired = entry.retired
  if (retired !== undefined && (!entry.revision || !exactKeys(retired, ['at', 'replacedBy'])
    || !Number.isFinite(Date.parse(retired.at)) || (retired.replacedBy !== undefined && !ID.test(retired.replacedBy)))) throw Error('Invalid experience retirement')
}

function validateState(state) {
  if (!exactKeys(state, ['version', 'entries']) || state.version !== 1 || !Array.isArray(state.entries) || state.entries.length > RECORD_LIMIT) throw Error('Invalid experience state')
  for (const entry of state.entries) validateEntry(entry, true)
  const byId = new Map(state.entries.map(entry => [entry.id, entry]))
  if (byId.size !== state.entries.length || state.entries.filter(entry => !entry.retired).length > ACTIVE_LIMIT) throw Error('Invalid experience inventory')
  for (const entry of state.entries) {
    const id = entry.retired?.replacedBy
    if (id && (entry.id === id || !byId.has(id) || !sameScope(entry.scope, byId.get(id).scope))) throw Error('Invalid experience replacement')
  }
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
  /** @returns {{version: number, entries: ExperienceEntry[]}} */
  function load() {
    prepare()
    try { lstatSync(file) } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, entries: [] }
      throw Error('Experience is unavailable or unsafe')
    }
    return validateState(JSON.parse(readProactiveFile(file, LIMIT)))
  }
  /** @template T
   * @param {(state: ReturnType<typeof load>) => {changed: boolean, value: T}} change
   * @param {AbortSignal} [signal]
   * @returns {Promise<T>}
   */
  async function transaction(change, signal) {
    signal?.throwIfAborted()
    prepare()
    const release = await lockfile.lock(file, { realpath: false, stale: 30000, retries: { retries: 10, minTimeout: 10, maxTimeout: 100 } })
    let temporary
    try {
      signal?.throwIfAborted()
      const state = load()
      const result = change(state)
      if (!result.changed) return result.value
      const content = JSON.stringify(validateState(state))
      if (Buffer.byteLength(content) > LIMIT) throw Error('Experience storage limit exceeded')
      temporary = join(directory, `.experience-${randomUUID()}.tmp`)
      const fd = openProactiveTemporary(temporary)
      try { writeFileSync(fd, content, 'utf8'); fsyncSync(fd) } finally { closeSync(fd) }
      signal?.throwIfAborted()
      renameSync(temporary, file)
      return result.value
    } finally {
      if (temporary) { try { unlinkSync(temporary) } catch {} }
      await release()
    }
  }
  return {
    load,
    /** @param {ExperienceCandidate[]} candidates @param {AbortSignal} [signal] */
    async append(candidates, signal) {
      if (!Array.isArray(candidates) || candidates.length > 4) throw Error('Invalid experience batch')
      for (const entry of candidates) validateEntry(entry)
      return transaction(state => {
        const added = []
        let active = state.entries.filter(entry => !entry.retired).length
        for (const candidate of candidates) {
          const body = candidate.body.trim()
          const key = candidate.scope ? JSON.stringify([candidate.scope.kind, candidate.scope.version, candidate.scope.profile, body]) : body
          const id = experienceDigest(key).slice(0, 32)
          if (state.entries.some(entry => entry.id === id)) continue
          if (active >= ACTIVE_LIMIT || state.entries.length >= RECORD_LIMIT) throw Error('Experience capacity reached; existing entries were preserved')
          state.entries.push({ ...candidate, id, createdAt: new Date().toISOString() })
          active++
          added.push(id)
        }
        return { changed: added.length > 0, value: added }
      }, signal)
    },
    /** Operator-only compare and swap. Preserve the record and its source pointers.
     * @param {{action: 'withdraw'|'replace'|'restore', id: string, expectedRevision: string, replacementId?: string}} request
     */
    async maintain({ action, id, expectedRevision, replacementId }) {
      if (!['withdraw', 'replace', 'restore'].includes(action) || !ID.test(id) || !DIGEST.test(expectedRevision)
        || (action === 'replace' ? !ID.test(replacementId) || replacementId === id : replacementId !== undefined)) throw Error('Invalid experience maintenance request')
      return transaction(state => {
        const entry = state.entries.find(item => item.id === id)
        if (!entry || experienceRevision(entry) !== expectedRevision) throw Error('Experience changed; inspect its current revision')
        if (action === 'restore') {
          if (!entry.retired) throw Error('Experience is already active')
          if (state.entries.filter(item => !item.retired).length >= ACTIVE_LIMIT) throw Error('Active experience capacity reached')
          delete entry.retired
        } else {
          if (entry.retired) throw Error('Experience is already retired')
          if (action === 'replace') {
            const replacement = state.entries.find(item => item.id === replacementId)
            if (!replacement || replacement.retired || !sameScope(entry.scope, replacement.scope)) throw Error('An active replacement in the same scope is required')
          }
          entry.retired = { at: new Date().toISOString(), ...(replacementId ? { replacedBy: replacementId } : {}) }
        }
        entry.revision = (entry.revision ?? 0) + 1
        return { changed: true, value: entry }
      })
    },
  }
}
