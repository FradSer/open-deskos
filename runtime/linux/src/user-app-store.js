const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { readBoundedFile, ensureDirectory, writeExclusive } = require('./user-app-files')

const MAX_APPS = 32
const MAX_HTML_BYTES = 256 * 1024
const MAX_MANIFEST_BYTES = 8 * 1024
const MAX_CATALOG_BYTES = 1024 * 1024
const CATALOG = 'user-apps.json'
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id)
const validRevision = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value)
const failure = error => ({ ok: false, error })
const metadata = ({ id, name, version, kind, revision }) => ({ id, name, version, kind, revision })
const digestOf = (manifest, html) => crypto.createHash('sha256').update(manifest).update(html).digest('hex')

function parseManifest(bytes, id) {
  const manifest = JSON.parse(bytes.toString('utf8'))
  if (manifest?.id !== id || manifest.schemaVersion !== 1 || !['widget', 'app'].includes(manifest.kind)
    || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 128
    || typeof manifest.version !== 'string' || !manifest.version.trim() || manifest.version.length > 64) throw Error('invalid-manifest')
  return manifest
}

function createUserAppStore({ workspace, stateDir, verify } = {}) {
  let pending = Promise.resolve()
  function serial(action) {
    const result = pending.then(action)
    pending = result.catch(() => {})
    return result
  }
  const revisionDir = (id, revision) => `apps/${id}/revisions/${revision}`

  async function snapshot(id, revision) {
    if (!validId(id) || !validRevision(revision)) throw Error('invalid-snapshot')
    const relative = revisionDir(id, revision)
    const manifestBytes = await readBoundedFile(stateDir, `${relative}/manifest.json`, MAX_MANIFEST_BYTES)
    const htmlBytes = await readBoundedFile(stateDir, `${relative}/index.html`, MAX_HTML_BYTES)
    const digest = digestOf(manifestBytes, htmlBytes)
    if (digest.slice(0, 32) !== revision) throw Error('invalid-snapshot')
    return { manifest: parseManifest(manifestBytes, id), manifestBytes, htmlBytes, revision, digest }
  }

  async function catalog() {
    let bytes
    try { bytes = await readBoundedFile(stateDir, CATALOG, MAX_CATALOG_BYTES) } catch (error) {
      if (error.code === 'ENOENT') return []
      throw Error('catalog-corrupt')
    }
    try {
      const entries = JSON.parse(bytes.toString('utf8'))
      if (!Array.isArray(entries) || entries.length > MAX_APPS) throw Error('invalid-catalog')
      const ids = new Set()
      for (const entry of entries) {
        if (!entry || ids.has(entry.id) || !Array.isArray(entry.history) || entry.history.length > 1
          || !entry.history.every(validRevision)) throw Error('invalid-catalog')
        const bundle = await snapshot(entry.id, entry.revision)
        if (bundle.digest !== entry.digest || ['name', 'version', 'kind'].some(key => entry[key] !== bundle.manifest[key])) throw Error('invalid-catalog')
        ids.add(entry.id)
      }
      return entries
    } catch { throw Error('catalog-corrupt') }
  }

  async function prepareState() {
    if (!stateDir || !path.isAbsolute(stateDir)) throw Error('state-not-configured')
    await fs.mkdir(stateDir, { recursive: true, mode: 0o700 })
    const info = await fs.lstat(stateDir)
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('unsafe-state')
  }

  async function commit(entries) {
    await prepareState()
    const name = `${CATALOG}.${crypto.randomUUID()}.tmp`
    await writeExclusive(stateDir, name, Buffer.from(JSON.stringify(entries)))
    try { await fs.rename(path.join(stateDir, name), path.join(stateDir, CATALOG)) } finally {
      await fs.rm(path.join(stateDir, name), { force: true })
    }
  }

  async function verifyBundle(bundle) {
    if (typeof verify !== 'function') return false
    try {
      const result = await verify({ manifest: structuredClone(bundle.manifest), html: bundle.htmlBytes.toString('utf8'),
        revision: bundle.revision, manifestBytes: Buffer.from(bundle.manifestBytes), htmlBytes: Buffer.from(bundle.htmlBytes) })
      return result === true || result?.ok === true
    } catch { return false }
  }

  async function draft(id) {
    if (!validId(id)) throw Error('invalid-identifier')
    if (!workspace || !path.isAbsolute(workspace)) throw Error('workspace-not-configured')
    try { await fs.access(path.join(workspace, 'apps')) } catch { throw Error('workspace-not-configured') }
    let manifestBytes, htmlBytes
    try {
      manifestBytes = await readBoundedFile(workspace, `apps/${id}/manifest.json`, MAX_MANIFEST_BYTES)
      htmlBytes = await readBoundedFile(workspace, `apps/${id}/index.html`, MAX_HTML_BYTES)
    } catch (error) {
      if (error.code === 'ENOENT') throw Error('package-not-found')
      if (error.message === 'file-too-large') throw Error(manifestBytes ? 'package-too-large' : 'manifest-too-large')
      throw Error('unsafe-package')
    }
    let manifest
    try { manifest = parseManifest(manifestBytes, id) } catch { throw Error('invalid-manifest') }
    const digest = digestOf(manifestBytes, htmlBytes)
    return { manifest, manifestBytes, htmlBytes, digest, revision: digest.slice(0, 32) }
  }

  async function persist(bundle) {
    await prepareState()
    const relative = revisionDir(bundle.manifest.id, bundle.revision)
    await ensureDirectory(stateDir, relative)
    for (const [name, bytes, limit] of [['manifest.json', bundle.manifestBytes, MAX_MANIFEST_BYTES], ['index.html', bundle.htmlBytes, MAX_HTML_BYTES]]) {
      try { await writeExclusive(stateDir, `${relative}/${name}`, bytes) } catch (error) {
        if (error.code !== 'EEXIST') throw error
        const existing = await readBoundedFile(stateDir, `${relative}/${name}`, limit)
        if (!existing.equals(bytes)) throw Error('snapshot-conflict')
      }
    }
  }

  async function prune(id, keep) {
    const relative = `apps/${id}/revisions`
    try {
      const directory = await ensureDirectory(stateDir, relative)
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (validRevision(entry.name) && !keep.includes(entry.name)) await fs.rm(path.join(directory, entry.name), { recursive: true, force: true })
      }
      return true
    } catch { return false }
  }

  function mutate(action) {
    return serial(async () => {
      try { return await action(await catalog()) } catch (error) {
        const known = ['catalog-corrupt', 'workspace-not-configured', 'package-not-found', 'unsafe-package', 'invalid-manifest', 'invalid-identifier', 'manifest-too-large', 'package-too-large']
        return failure(known.includes(error.message) ? error.message : 'persistence-failed')
      }
    })
  }

  async function publish(entries, id, bundle, previous) {
    const entry = { ...metadata({ ...bundle.manifest, revision: bundle.revision }), digest: bundle.digest, history: previous ? [previous] : [] }
    try {
      await persist(bundle)
      await commit(entries.filter(app => app.id !== id).concat(entry))
    } catch (error) {
      const current = entries.find(app => app.id === id)
      await prune(id, current ? [current.revision, ...current.history] : [])
      throw error
    }
    const cleaned = await prune(id, [entry.revision, ...entry.history])
    return { ok: true, app: metadata(entry), ...(!cleaned ? { warning: 'revision-cleanup-failed' } : {}) }
  }

  function install(id) {
    return mutate(async entries => {
      const bundle = await draft(id)
      const previous = entries.find(entry => entry.id === id)
      if (!previous && entries.length >= MAX_APPS) return failure('catalog-limit')
      if (!await verifyBundle(bundle)) return failure('verification-failed')
      const rollback = previous?.revision === bundle.revision ? previous.history[0] : previous?.revision
      return publish(entries, id, bundle, rollback)
    })
  }

  function rollback(id) {
    return mutate(async entries => {
      const current = entries.find(entry => entry.id === id)
      if (!current) return failure('not-found')
      if (!current.history[0]) return failure('no-rollback')
      let bundle
      try { bundle = await snapshot(id, current.history[0]) } catch { return failure('invalid-snapshot') }
      if (!await verifyBundle(bundle)) return failure('verification-failed')
      return publish(entries, id, bundle, current.revision)
    })
  }

  return {
    list: () => serial(async () => (await catalog()).map(metadata)),
    getContent: id => serial(async () => {
      try {
        const entry = (await catalog()).find(app => app.id === id)
        if (!entry) return failure('not-found')
        const bundle = await snapshot(id, entry.revision)
        return { ok: true, app: metadata(entry), html: bundle.htmlBytes.toString('utf8') }
      } catch { return failure('catalog-corrupt') }
    }),
    install,
    update: install,
    rollback,
    remove: id => mutate(async entries => {
      if (!entries.some(entry => entry.id === id)) return failure('not-found')
      await commit(entries.filter(entry => entry.id !== id))
      const cleaned = await prune(id, [])
      return { ok: true, ...(!cleaned ? { warning: 'revision-cleanup-failed' } : {}) }
    }),
  }
}

module.exports = { createUserAppStore, MAX_APPS, MAX_HTML_BYTES }
