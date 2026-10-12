'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { validateTransportReplacement } = require('./plugin-runtime')

function loadBridgeReplacements(file, { trusted = false } = {}) {
  if (trusted !== true) throw Error('external transports require explicit native trust')
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0))
  let bytes
  try {
    if (!fs.fstatSync(fd).isFile()) throw Error('bridge selection requires a regular file')
    const buffer = Buffer.alloc(16385)
    let size = 0
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null)
      if (!count) break
      size += count
    }
    if (size > 16384) throw Error('bridge selection exceeds 16 KiB')
    bytes = buffer.subarray(0, size)
  } finally { fs.closeSync(fd) }
  const selection = JSON.parse(bytes.toString('utf8'))
  if (!selection || selection.schemaVersion !== 1 || !Array.isArray(selection.replacements)
    || selection.replacements.length > 16 || Object.keys(selection).some(key => !['schemaVersion', 'replacements'].includes(key))) throw Error('invalid bridge selection')
  const identities = new Set()
  return selection.replacements.map(definition => {
    if (!definition || Object.keys(definition).some(key => !['manifest', 'entry'].includes(key))) throw Error('invalid bridge replacement')
    const manifest = validateTransportReplacement(definition.manifest)
    if (identities.has(manifest.id)) throw Error('duplicate bridge replacement')
    identities.add(manifest.id)
    if (typeof definition.entry !== 'string' || definition.entry.includes('\0') || !path.isAbsolute(definition.entry)
      || path.extname(definition.entry) !== '.cjs') throw Error('bridge entry requires an absolute CommonJS file')
    const entry = definition.entry
    return { manifest, async create(context, metadata) {
      if (!fs.statSync(entry).isFile()) throw Error('bridge entry requires a regular file')
      const implementation = require(entry)
      if (typeof implementation.create !== 'function') throw Error('bridge entry must export create')
      return implementation.create(context, metadata)
    } }
  })
}

function transportPlaceholder(definition) {
  return { manifest: structuredClone(definition.manifest), priority: definition.manifest.priority, transport: definition.manifest.transport }
}

module.exports = { loadBridgeReplacements, transportPlaceholder }
