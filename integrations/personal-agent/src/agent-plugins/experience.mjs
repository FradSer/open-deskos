import { memoryDigest } from '../mem0.mjs'
import { memoryMigration, readLegacyMemory } from '../mem0-migration.mjs'
import { sensitiveMemoryPattern } from '../memory.mjs'

const LIMIT = 1024 * 1024
const ACTIVE_LIMIT = 256
const RECORD_LIMIT = 512
const DIGEST = /^[a-f0-9]{64}$/
const ID = /^[a-f0-9]{32}$/


export const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))
export const safeExperienceText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && Buffer.byteLength(value) <= limit && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) && !sensitiveMemoryPattern.test(value)
export const experienceDigest = memoryDigest

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

export const experienceRevision = entry => experienceDigest(JSON.stringify([
  entry.id, entry.title, entry.body, entry.sources, entry.scope, entry.createdAt, entry.revision, entry.retired,
]))

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

export function validateExperienceSnapshot(state) {
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

/** Mem0 stores and recalls lessons. Scope and source validation are host-owned. */
export function createExperienceStore({ scope, legacyFile = undefined, stateDir }) {
  let serial = Promise.resolve()

  function encode({ id, title, body, ...fields }) {
    return { key: id, text: title + '\n' + body, metadata: { experience: { id, title, ...fields } } }
  }

  function decode(item) {
    const fields = item.metadata?.experience
    if (!fields) return undefined
    const body = fields.title ? item.memory.slice(fields.title.length + 1) : item.memory
    const entry = {
      ...fields, id: fields.id ?? item.id.replaceAll('-', ''), title: fields.title ?? body.slice(0, 100).trim(),
      body, createdAt: fields.createdAt ?? item.created_at,
    }
    try { validateEntry(entry, true); return entry } catch { return undefined }
  }

  async function put(entry, signal) {
    const { key, text, metadata } = encode(entry)
    return scope.put(key, text, metadata, { replace: false, signal })
  }

  const ready = memoryMigration(stateDir, 'experience', async () => {
    const data = readLegacyMemory(legacyFile, LIMIT)
    if (data === undefined) return
    for (const entry of validateExperienceSnapshot(data).entries) await put(entry, undefined)
  })

  async function records(query = '', signal = undefined) {
    await ready()
    const items = query.trim() ? await scope.search(query, { limit: RECORD_LIMIT, signal }) : await scope.list({}, RECORD_LIMIT + 1, signal)
    if (items.length > RECORD_LIMIT) throw Error('Experience capacity reached')
    return items.map(item => ({ item, entry: decode(item) })).filter(row => row.entry !== undefined)
  }

  function mutate(operation) {
    const work = serial.then(operation)
    serial = work.then(() => {}, () => {})
    return work
  }

  return {
    async load() { return { version: 1, entries: (await records()).map(row => row.entry) } },
    async search(query, signal = undefined) { return (await records(query, signal)).map(row => row.entry) },
    /** Import host-verified fixture or operator records through the same Mem0 store. */
    async append(candidates, signal = undefined) {
      if (!Array.isArray(candidates) || candidates.length > 4) throw Error('Invalid experience batch')
      for (const entry of candidates) validateEntry(entry)
      return mutate(async () => {
        const entries = (await records()).map(row => row.entry)
        const added = []
        for (const candidate of candidates) {
          signal?.throwIfAborted()
          const body = candidate.body.trim()
          const key = candidate.scope ? JSON.stringify([candidate.scope.kind, candidate.scope.version, candidate.scope.profile, body]) : body
          const id = experienceDigest(key).slice(0, 32)
          if (entries.some(entry => entry.id === id)) continue
          if (entries.length >= RECORD_LIMIT || entries.filter(entry => !entry.retired).length >= ACTIVE_LIMIT) throw Error('Experience capacity reached')
          const entry = { ...candidate, id, createdAt: new Date().toISOString() }
          const result = await put(entry, signal)
          if (result.created) { added.push(id); entries.push(entry) }
        }
        return added
      })
    },
    async learn(facts, profile, signal) {
      const entries = (await records()).map(row => row.entry)
      const added = []
      for (const fact of facts) {
        signal?.throwIfAborted()
        if (!safeExperienceText(fact.text, 2048)) continue
        if (entries.length + added.length >= RECORD_LIMIT || entries.filter(entry => !entry.retired).length + added.length >= ACTIVE_LIMIT) break
        const source = { tool: 'coding_check', digest: experienceDigest(fact.text), receipt: fact.receipt }
        const definition = { kind: 'hosted_check', version: 1, profile }
        const key = experienceDigest(JSON.stringify([definition, source]))
        const result = await scope.ingest(key, [{ role: 'assistant', content: fact.text }],
          { experience: { scope: definition, sources: [source] } },
          'Store only a reusable procedure supported by this verified check. Describe the evidence limit. A successful check and matching samples only establish the observed result and sampled source consistency. Do not infer authorization, current state, or test adequacy.', signal)
        for (const item of result) if (safeExperienceText(item.memory, 2048)) added.push(item.id.replaceAll('-', ''))
      }
      return added
    },
    /** Operator-only compare and swap. Preserve the native record and source pointers. */
    async maintain({ action, id, expectedRevision, replacementId }) {
      if (!['withdraw', 'replace', 'restore'].includes(action) || !ID.test(id) || !DIGEST.test(expectedRevision)
        || (action === 'replace' ? !ID.test(replacementId) || replacementId === id : replacementId !== undefined)) throw Error('Invalid experience maintenance request')
      return mutate(async () => {
        const stored = await records()
        const row = stored.find(row => row.entry.id === id)
        const entry = row?.entry
        if (!entry || experienceRevision(entry) !== expectedRevision) throw Error('Experience changed; inspect its current revision')
        if (action === 'restore') {
          if (!entry.retired) throw Error('Experience is already active')
          if (stored.filter(({ entry }) => !entry.retired).length >= ACTIVE_LIMIT) throw Error('Active experience capacity reached')
          delete entry.retired
        } else {
          if (entry.retired) throw Error('Experience is already retired')
          if (action === 'replace') {
            const replacement = stored.find(row => row.entry.id === replacementId)?.entry
            if (!replacement || replacement.retired || !sameScope(entry.scope, replacement.scope)) throw Error('An active replacement in the same scope is required')
          }
          entry.retired = { at: new Date().toISOString(), ...(replacementId ? { replacedBy: replacementId } : {}) }
        }
        entry.revision = (entry.revision ?? 0) + 1
        const { body: _body, title: _title, ...fields } = entry
        await scope.updateMetadata(row.item.id, { experience: { ...fields, ...(row.item.metadata.experience.title ? { title: entry.title } : {}) } })
        return entry
      })
    },
  }
}
