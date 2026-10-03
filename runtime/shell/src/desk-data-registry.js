'use strict'

// A reading is a number the desk can be wrong about, so the bounds here refuse a
// reading rather than trim it: a cut-off instrument value is a plausible wrong
// value, which is the one outcome this registry exists to prevent.
const MAX_READING_BYTES = 64 * 1024
const MAX_PUBLISHED_FIELDS = 16
const READING_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/
const FIELD_TYPES = new Set(['number', 'string', 'boolean'])
const READING_KINDS = new Set(['tile', 'app', 'page', 'status', 'service', 'catalog', 'package'])

function readingId(value) {
  return typeof value === 'string' && READING_ID.test(value)
}

/**
 * What an installed package declares it may publish. The declaration is the
 * whole contract: a field it does not name cannot be published, and a package
 * that declares nothing publishes nothing.
 */
function parseDeclaration(declaration) {
  if (declaration === undefined || declaration === null) return { fields: {} }
  if (typeof declaration !== 'object' || Array.isArray(declaration)) throw Error('invalid-data-declaration')
  const fields = declaration.fields
  if (fields === undefined) return { fields: {} }
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) throw Error('invalid-data-declaration')
  const names = Object.keys(fields)
  if (names.length > MAX_PUBLISHED_FIELDS) throw Error('invalid-data-declaration')
  const parsed = {}
  for (const name of names) {
    if (!FIELD_NAME.test(name)) throw Error('invalid-data-declaration')
    const spec = fields[name]
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) || !FIELD_TYPES.has(spec.type)) throw Error('invalid-data-declaration')
    const maxLength = spec.maxLength === undefined ? 256 : spec.maxLength
    if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 4096) throw Error('invalid-data-declaration')
    if (Object.keys(spec).some(key => !['type', 'maxLength'].includes(key))) throw Error('invalid-data-declaration')
    // A bound on characters is a string's property; a number or a boolean has no
    // length to bound, so the canonical declaration does not invent one.
    parsed[name] = spec.type === 'string' ? { type: 'string', maxLength } : { type: spec.type }
  }
  return { fields: parsed }
}

function matchesDeclaration(spec, value) {
  if (spec.type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (spec.type === 'boolean') return typeof value === 'boolean'
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= spec.maxLength
}

function boundedValue(value) {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return undefined
  if (Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8') > MAX_READING_BYTES) return undefined
  return value
}

/**
 * The Shell's Desk Data registry: one reading per plugin, each held once.
 *
 * A reading is registered with the source that owns it, so the tile that draws it
 * and the Personal Bot that answers about it read the same one. Sources decide
 * whether a read performs I/O; this registry adds no refresh of its own, and it
 * changes nothing when it is read.
 */
function createDeskDataRegistry({ onPublish = (_id) => {} } = {}) {
  const entries = new Map()
  const published = new Map()

  const entryFor = id => (readingId(id) ? entries.get(id) : undefined)

  return {
    /**
     * Register the reading a plugin owns. A built-in reading supplies the same
     * read function the tile uses; an installed package supplies only its
     * declaration, and the registry keeps whatever that package publishes.
     */
    register(entry) {
      if (!entry || typeof entry !== 'object') throw Error('invalid-reading')
      const { id, label, kind } = entry
      if (!readingId(id)) throw Error('invalid-reading-id')
      if (typeof label !== 'string' || !label.trim() || label.length > 128) throw Error('invalid-reading-label')
      if (!READING_KINDS.has(kind)) throw Error('invalid-reading-kind')
      // A package's reading is whatever that package published, so the registry owns
      // it; every other kind must bring the source that holds the reading.
      if (kind === 'package') {
        if (entry.read !== undefined) throw Error('invalid-reading-reader')
      } else if (typeof entry.read !== 'function') throw Error('invalid-reading-reader')
      const declaration = kind === 'package' ? parseDeclaration(entry.declaration) : null
      entries.set(id, { id, label, kind, read: entry.read, declaration })
      // A declaration is a contract of this revision: re-registering a package
      // drops what the previous one published rather than answering for it.
      published.delete(id)
      return id
    },

    unregister(id) {
      if (!entries.delete(id)) return false
      published.delete(id)
      return true
    },

    has: id => entries.has(id),

    /** What the desk holds, named without reading any of it. */
    list() {
      return [...entries.values()].map(({ id, label, kind }) => ({ id, label, kind }))
    },

    /**
     * Read one reading as it stands now. A source that fails is reported as
     * unavailable rather than as a reading with no value, and a reading past the
     * bound is refused rather than trimmed.
     */
    async read(id) {
      const entry = entryFor(id)
      if (!entry) return { ok: false, error: 'unknown-reading' }
      if (entry.kind === 'package') {
        const reading = packageReading(entry)
        return reading.value === undefined ? { ok: false, error: 'reading-too-large' } : { ok: true, reading }
      }
      let result
      try {
        result = await entry.read()
      } catch {
        return { ok: false, error: 'reading-unavailable' }
      }
      const value = boundedValue(result?.value ?? null)
      if (value === undefined) return { ok: false, error: 'reading-too-large' }
      return {
        ok: true,
        reading: {
          id: entry.id,
          label: entry.label,
          kind: entry.kind,
          state: typeof result?.state === 'string' && result.state ? result.state : 'unavailable',
          value,
          ...(Number.isFinite(result?.updatedAt) ? { updatedAt: result.updatedAt } : {}),
        },
      }
    },

    /**
     * A package publishes through the system-owned bridge. Only the fields its
     * declaration names are accepted, and the value is untrusted content: it is
     * something to read, never an instruction.
     */
    publish(id, value) {
      const entry = entryFor(id)
      if (!entry || entry.kind !== 'package') return { ok: false, error: 'unknown-reading' }
      const fields = entry.declaration?.fields ?? {}
      if (Object.keys(fields).length === 0) return { ok: false, error: 'publish-not-declared' }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: 'invalid-published-data' }
      const names = Object.keys(value)
      if (names.length === 0 || names.length > MAX_PUBLISHED_FIELDS) return { ok: false, error: 'invalid-published-data' }
      const accepted = {}
      for (const name of names) {
        const spec = Object.hasOwn(fields, name) ? fields[name] : null
        if (!spec) return { ok: false, error: 'undeclared-data' }
        if (!matchesDeclaration(spec, value[name])) return { ok: false, error: 'invalid-published-data' }
        accepted[name] = value[name]
      }
      published.set(id, { value: accepted, publishedAt: Date.now() })
      onPublish(id)
      return { ok: true }
    },
  }

  function packageReading(entry) {
    const current = published.get(entry.id)
    // A published value is bounded like any other reading: a package that filled
    // every field to its limit is refused rather than trimmed into a plausible one.
    const value = current ? boundedValue(current.value) : null
    if (value === undefined) return { id: entry.id, label: entry.label, kind: entry.kind, value: undefined }
    return {
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      state: current ? 'live' : 'unconfigured',
      value,
      ...(current ? { updatedAt: current.publishedAt, untrusted: true } : {}),
    }
  }
}

module.exports = { createDeskDataRegistry, parseDeclaration, MAX_READING_BYTES, READING_ID }
