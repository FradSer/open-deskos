'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { readBoundedFile, ensureDirectory, writeExclusive } = require('./user-app-files')
const { validatePluginManifest } = require('./plugin-host')
const { readDevelopmentPlugin } = require('./development-plugins')

const MAX_FILES = 64
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_TOTAL_BYTES = 16 * 1024 * 1024
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const revisionPattern = /^[a-f0-9]{64}$/

function validPath(value) {
  return typeof value === 'string' && value.length <= 128 && value !== 'bundle.json'
    && value.split('/').every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(part)
      && !part.endsWith('.') && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))
}

async function fileInventory(root, directories, relative = '', files = [], budget = { entries: 0 }) {
  for await (const entry of await fs.opendir(path.join(root, relative))) {
    if (++budget.entries > MAX_FILES * 8 + 1) throw Error('native package inventory too large')
    const name = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw Error('unsafe native package link')
    if (entry.isDirectory()) {
      if (!validPath(name) || name.split('/').length > 8) throw Error('invalid native package path')
      if (!directories.has(name)) throw Error('unlisted native directory inventory')
      await fileInventory(root, directories, name, files, budget)
    } else {
      files.push(name)
      if (files.length > MAX_FILES + 1) throw Error('native package inventory too large')
    }
  }
  return files.sort()
}

async function readNativeBundle(root, keyring) {
  const descriptorBytes = await readBoundedFile(root, 'bundle.json', 16384)
  const descriptor = JSON.parse(descriptorBytes.toString('utf8'))
  if (!descriptor || descriptor.schemaVersion !== 1 || typeof descriptor.replace !== 'boolean'
    || typeof descriptor.keyId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(descriptor.keyId)
    || Object.keys(descriptor).some(key => !['schemaVersion', 'keyId', 'replace', 'files', 'signature'].includes(key))
    || !Array.isArray(descriptor.files) || !descriptor.files.length || descriptor.files.length > MAX_FILES) throw Error('invalid native bundle')
  let previous = ''
  const paths = new Set()
  const portablePaths = new Map()
  for (const file of descriptor.files) {
    if (!file || !validPath(file.path) || file.path <= previous || paths.has(file.path.toLowerCase())
      || Object.keys(file).some(key => !['path', 'sha256'].includes(key))
      || typeof file.sha256 !== 'string' || !revisionPattern.test(file.sha256)) throw Error('invalid native package path or hash')
    previous = file.path
    paths.add(file.path.toLowerCase())
    const parts = file.path.split('/')
    for (let index = 1; index <= parts.length; index++) {
      const prefix = parts.slice(0, index).join('/')
      const folded = prefix.toLowerCase()
      if (portablePaths.has(folded) && portablePaths.get(folded) !== prefix) throw Error('invalid native package path case collision')
      portablePaths.set(folded, prefix)
    }
  }
  const rule = keyring.get(descriptor.keyId)
  if (!rule) throw Error('unknown native publisher')
  const key = rule.publicKey?.type === 'public' ? rule.publicKey : crypto.createPublicKey(rule.publicKey)
  if (key.asymmetricKeyType !== 'ed25519' || key.type !== 'public') throw Error('invalid native publisher key')
  const payload = Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify({ schemaVersion: 1, keyId: descriptor.keyId, replace: descriptor.replace, files: descriptor.files }))
  if (typeof descriptor.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(descriptor.signature)
    || !crypto.verify(null, payload, key, Buffer.from(descriptor.signature, 'base64'))) throw Error('invalid native signature')
  const directories = new Set(descriptor.files.flatMap(file => {
    const parts = file.path.split('/')
    return parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join('/'))
  }))
  const actual = await fileInventory(root, directories)
  const expected = ['bundle.json', ...descriptor.files.map(file => file.path)].sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected) || !paths.has('manifest.json')) throw Error('incomplete native file inventory')
  const files = new Map()
  let total = 0
  for (const file of descriptor.files) {
    const bytes = await readBoundedFile(root, file.path, file.path === 'manifest.json' ? 16384 : MAX_FILE_BYTES)
    if (hash(bytes) !== file.sha256) throw Error('native file hash mismatch')
    total += bytes.length
    if (total > MAX_TOTAL_BYTES) throw Error('native package too large')
    files.set(file.path, bytes)
  }
  const manifest = validatePluginManifest(JSON.parse(files.get('manifest.json').toString('utf8')))
  if (!Array.isArray(rule.identities) || !rule.identities.includes(manifest.id)
    || !Array.isArray(rule.hosts) || !rule.hosts.includes(manifest.host)) throw Error('native publisher identity or host not authorized')
  return { descriptorBytes, manifest, files, revision: hash(payload), replacement: descriptor.replace }
}

// This store stages signed Shell code without selecting or executing it. A
// signature establishes publisher identity; capability grants remain separate.
function createNativePluginStore({ stateDir, keyring }) {
  if (!path.isAbsolute(stateDir) || !(keyring instanceof Map)) throw Error('native store requires an absolute root and explicit keyring')
  const revisions = path.join(stateDir, 'revisions')
  function declaration(root, bundle) {
    const plugin = readDevelopmentPlugin(root, { replacement: bundle.replacement, nativeAppearance: true })
    if (!isDeepStrictEqual(plugin.manifest, bundle.manifest)) throw Error('native manifest changed after verification')
    return plugin
  }
  async function snapshot(revision) {
    if (typeof revision !== 'string' || !revisionPattern.test(revision)) throw Error('invalid native revision')
    const root = path.join(revisions, revision)
    const bundle = await readNativeBundle(root, keyring)
    if (bundle.revision !== revision) throw Error('native revision mismatch')
    const plugin = declaration(root, bundle)
    return { ...plugin, revision, replacement: bundle.replacement, files: bundle.files }
  }
  async function read(revision) {
    const { files, ...plugin } = await snapshot(revision)
    return plugin
  }
  return {
    read,
    snapshot,
    async stage(source) {
      const bundle = await readNativeBundle(source, keyring)
      await fs.mkdir(stateDir, { recursive: true, mode: 0o700 })
      try { await ensureDirectory(stateDir, 'revisions') } catch (error) {
        if (error.code !== 'EEXIST') throw error
        // Another writer created the directory; validate its ownership and type.
        await ensureDirectory(stateDir, 'revisions')
      }
      const staging = await fs.mkdtemp(path.join(revisions, '.native-stage-'))
      try {
        for (const [name, bytes] of bundle.files) await writeExclusive(staging, name, bytes)
        await writeExclusive(staging, 'bundle.json', bundle.descriptorBytes)
        const copied = await readNativeBundle(staging, keyring)
        if (copied.revision !== bundle.revision) throw Error('native snapshot mismatch')
        declaration(staging, copied)
        try { await fs.rename(staging, path.join(revisions, bundle.revision)) } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error
          await read(bundle.revision)
        }
        return { revision: bundle.revision, manifest: structuredClone(bundle.manifest), replacement: bundle.replacement }
      } finally {
        // Only this operation's private staging directory can be removed.
        await fs.rm(staging, { recursive: true, force: true })
      }
    },
  }
}

module.exports = { createNativePluginStore }
