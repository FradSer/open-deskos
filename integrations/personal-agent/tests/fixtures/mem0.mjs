import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { createMemoryStore } from '../../src/memory.mjs'
import { createExperienceStore } from '../../src/agent-plugins/experience.mjs'

/** A host-side SDK stub. Real SDK operations have a separate live check. */
export function fixtureMem0({ extract = messages => messages.map(message => message.content).slice(-1), beforePut } = {}) {
  const banks = new Map(), requests = []
  return {
    enabled: true,
    requests,
    async warm() {},
    async close() {},
    scope(owner, kind) {
      const bank = JSON.stringify([owner, kind])
      if (!banks.has(bank)) banks.set(bank, { records: [], imports: new Set() })
      const { records, imports } = banks.get(bank)
      const make = (key, memory, metadata) => ({
        id: randomUUID(), memory, metadata: { ...metadata, odk_key: key }, created_at: metadata.created_at ?? new Date().toISOString(),
      })
      function select(filters, limit) {
        return records.filter(item => Object.entries(filters).every(([key, value]) =>
          value?.in ? value.in.includes(item.metadata[key]) : item.metadata[key] === value)).slice(0, limit)
      }
      return {
        async list(filters = {}, limit = 513, signal) {
          signal?.throwIfAborted()
          requests.push({ kind, operation: 'list' })
          return structuredClone(select(filters, limit))
        },
        async search(query, { limit = 32, filters = {}, signal } = {}) {
          signal?.throwIfAborted()
          requests.push({ kind, operation: 'search', query })
          const terms = query.toLowerCase().match(/[a-z0-9]{3,}|[\p{Script=Han}]/gu) ?? []
          return structuredClone(select(filters, 513).filter(item => terms.some(term => item.memory.toLowerCase().includes(term))).slice(0, limit))
        },
        async put(key, memory, metadata = {}, { replace = true, signal } = {}) {
          signal?.throwIfAborted()
          await beforePut?.({ kind, key, memory, metadata, signal })
          signal?.throwIfAborted()
          requests.push({ kind, operation: 'put', key })
          const found = records.find(item => item.metadata.odk_key === key)
          if (found) {
            if (replace) Object.assign(found, { memory, metadata: { ...metadata, odk_key: key } })
            return { id: found.id, created: false }
          }
          const item = make(key, memory, metadata)
          records.push(item)
          return { id: item.id, created: true }
        },
        async remove(key) {
          const index = records.findIndex(item => item.metadata.odk_key === key)
          if (index >= 0) records.splice(index, 1)
        },
        async updateMetadata(id, metadata) {
          Object.assign(records.find(item => item.id === id).metadata, metadata)
        },
        async ingest(key, messages, metadata, prompt, signal) {
          signal?.throwIfAborted()
          if (imports.has(key)) return []
          requests.push({ kind, operation: 'ingest', key, messages, metadata })
          const added = (await extract(messages, { kind, metadata, prompt, signal })).map(memory => make(key, memory, metadata))
          signal?.throwIfAborted()
          records.push(...added)
          imports.add(key)
          return structuredClone(added)
        },
      }
    },
  }
}

const backends = new Map()
export function fixtureMem0For(file, options = undefined) {
  if (!backends.has(file)) backends.set(file, fixtureMem0(options))
  return backends.get(file)
}

export function fixtureNotes(file, backend = fixtureMem0For(file), stateDir = dirname(file)) {
  return createMemoryStore({ scope: backend.scope(file, 'notes'), stateDir, legacyFile: file })
}

export function fixtureExperience(file, backend = fixtureMem0For(file), stateDir = dirname(file)) {
  return createExperienceStore({ scope: backend.scope(file, 'experience'), stateDir, legacyFile: file })
}
