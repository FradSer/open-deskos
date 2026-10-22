import { openSync, closeSync, fstatSync, readSync, statSync, constants } from 'node:fs'
import { isAbsolute, extname } from 'node:path'
import { createRequire } from 'node:module'
import { validatePersonalAgentReplacement } from './plugin-composition.mjs'
import { validateHostedPiReplacement } from './task-composition.mjs'

const require = createRequire(import.meta.url)

export function loadPersonalAgentReplacements(file, { trusted = false } = {}) {
  return loadSelection(file, { trusted, validate: validatePersonalAgentReplacement, limit: 5 })
}

export function loadHostedPiReplacements(file, { trusted = false } = {}) {
  return loadSelection(file, { trusted, validate: validateHostedPiReplacement, limit: 3 })
}

function loadSelection(file, { trusted, validate, limit }) {
  if (trusted !== true) throw Error('native development entries require explicit native trust')
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK || 0))
  let bytes
  try {
    if (!fstatSync(fd).isFile()) throw Error('development selection requires a regular file')
    bytes = Buffer.alloc(16385)
    let size = 0
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null)
      if (!count) break
      size += count
    }
    if (size > 16384) throw Error('development selection exceeds 16 KiB')
    bytes = bytes.subarray(0, size)
  } finally { closeSync(fd) }
  const selection = JSON.parse(bytes.toString('utf8'))
  if (!selection || selection.schemaVersion !== 1 || !Array.isArray(selection.replacements)
    || selection.replacements.length > limit || Object.keys(selection).some(key => !['schemaVersion', 'replacements'].includes(key))) throw Error('invalid development startup selection')
  const identities = new Set()
  return selection.replacements.map(definition => {
    if (!definition || Object.keys(definition).some(key => !['manifest', 'entry'].includes(key))) throw Error('invalid resident replacement definition')
    const manifest = validate(definition.manifest)
    if (identities.has(manifest.id)) throw Error('duplicate resident replacement')
    identities.add(manifest.id)
    if (typeof definition.entry !== 'string' || definition.entry.includes('\0') || !isAbsolute(definition.entry)
      || extname(definition.entry) !== '.cjs') throw Error('resident entry requires an absolute CommonJS file')
    const entry = definition.entry
    return { manifest, async create(context, bindings) {
      if (!statSync(entry).isFile()) throw Error('resident entry must be a regular file')
      const implementation = require(entry)
      if (typeof implementation.create !== 'function') throw Error('resident entry must export create')
      return implementation.create(context, bindings)
    } }
  })
}
