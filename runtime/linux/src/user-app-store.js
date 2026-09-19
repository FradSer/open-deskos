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
const PLACEMENT_SHAPE = /^\d+(?:\s*\/\s*\d+)?$/
const failure = error => ({ ok: false, error })
const metadata = ({ id, name, version, kind, revision, placement, placementError, service }) => ({ id, name, version, kind, revision, ...(placement ? { placement: { ...placement } } : {}), ...(placementError ? { placementError } : {}), ...(service ? { service: { ...service, secrets: [...service.secrets], egress: service.egress.map(rule => ({ ...rule })) } } : {}) })
const digestOf = (manifest, html) => crypto.createHash('sha256').update(manifest).update(html).digest('hex')

function parseService(service) {
  if (service === undefined) return undefined
  if (!service || typeof service !== 'object' || Array.isArray(service)) throw Error('invalid-manifest')
  const { id, exec, version, secrets, egress, socket } = service
  if (!validId(id) || typeof exec !== 'string' || !exec || exec.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(exec)
    || typeof version !== 'string' || !version.trim() || version.length > 64
    || typeof socket !== 'string' || !/^[a-z][a-z0-9-]{0,63}\.sock$/.test(socket)) throw Error('invalid-manifest')
  if (!Array.isArray(egress) || egress.length === 0 || egress.length > 8) throw Error('invalid-manifest')
  for (const rule of egress) {
    if (!rule || typeof rule !== 'object' || typeof rule.host !== 'string' || !rule.host
      || !Number.isInteger(rule.port) || rule.port < 1 || rule.port > 65535) throw Error('invalid-manifest')
  }
  const names = secrets === undefined ? [] : secrets
  if (!Array.isArray(names) || names.length > 8) throw Error('invalid-manifest')
  for (const name of names) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw Error('invalid-manifest')
  }
  for (const key of Object.keys(service)) {
    if (!['id', 'exec', 'version', 'secrets', 'egress', 'socket'].includes(key)) throw Error('invalid-manifest')
  }
  return { id, exec, version, secrets: [...names], egress: egress.map(rule => ({ ...rule })), socket }
}

function parseManifest(bytes, id) {
  const manifest = JSON.parse(bytes.toString('utf8'))
  if (manifest?.id !== id || manifest.schemaVersion !== 1 || !['widget', 'app'].includes(manifest.kind)
    || typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 128
    || typeof manifest.version !== 'string' || !manifest.version.trim() || manifest.version.length > 64) throw Error('invalid-manifest')
  const service = parseService(manifest.service)
  return service === undefined ? manifest : { ...manifest, service }
}

function loadDesktopLayout() {
  const context = {}
  require('node:vm').runInNewContext(require('node:fs').readFileSync(path.join(__dirname, 'renderer/config/desktop_layout.js'), 'utf8'), context)
  return context.DESKTOP_LAYOUT
}

function gridAxis(value, limit) {
  const match = /^(\d+)(?:\s*\/\s*(\d+))?$/.exec(String(value))
  if (!match) throw Error('invalid-placement')
  const start = Number(match[1]), end = match[2] ? Number(match[2]) : start + 1
  if (start < 1 || end <= start || end > limit + 1) throw Error('invalid-placement')
  return { start, end, text: end === start + 1 ? String(start) : `${start} / ${end}` }
}

function rectangle(placement) {
  return { col: gridAxis(placement?.col, 5), row: gridAxis(placement?.row, 3) }
}

function overlaps(a, b) {
  return a.col.start < b.col.end && b.col.start < a.col.end && a.row.start < b.row.end && b.row.start < a.row.end
}

function createUserAppStore({ workspace, stateDir, verify, layout = loadDesktopLayout() } = {}) {
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
        if (entry.placement !== undefined) {
          if (entry.kind !== 'widget' || !entry.placement || typeof entry.placement.col !== 'string' || typeof entry.placement.row !== 'string') throw Error('invalid-catalog')
          // Shape is corruption; availability is not. A release can legitimately declare a
          // built-in tile in a cell an installed package already holds, and that must
          // degrade to a per-widget placement error instead of hiding the whole catalog.
          if (!PLACEMENT_SHAPE.test(entry.placement.col) || !PLACEMENT_SHAPE.test(entry.placement.row)) throw Error('invalid-catalog')
        }
        ids.add(entry.id)
      }
      return entries
    } catch { throw Error('catalog-corrupt') }
  }

  function desktop(entries) {
    return layout.pages.map((page, index) => ({
      id: page.id, name: page.name, kind: page.kind, surface: page.surface, index: index + 1,
      ...(page.kind === 'grid' ? { columns: 5, rows: 3, occupied: [
        ...(page.widgets || []).map(({ id, col, row }) => ({ id, col, row })),
        ...entries.filter(entry => entry.placement?.pageId === page.id).map(entry => ({ id: entry.id, col: entry.placement.col, row: entry.placement.row })),
      ] } : {}),
    }))
  }

  function choosePlacement(entries, id, target) {
    const pages = desktop(entries.filter(entry => entry.id !== id))
    if (target !== undefined) {
      const page = pages.find(page => page.id === target?.pageId && page.kind === 'grid')
      if (!page) throw Error('invalid-page')
      const rect = rectangle(target)
      if (page.occupied.some(item => overlaps(rect, rectangle(item)))) throw Error('occupied-placement')
      return { pageId: page.id, col: rect.col.text, row: rect.row.text }
    }
    for (const page of pages.filter(page => page.kind === 'grid')) {
      for (let row = 1; row <= page.rows; row++) for (let col = 1; col <= page.columns; col++) {
        const candidate = { pageId: page.id, col: String(col), row: String(row) }
        if (!page.occupied.some(item => overlaps(rectangle(candidate), rectangle(item)))) return candidate
      }
    }
    throw Error('desktop-full')
  }

  /*
   * Why a stored placement can no longer be used. Unavailable geometry is a widget's
   * own problem: the desk reports it, keeps the package's bytes, and leaves removal
   * and re-placement available.
   */
  function placementIssue(entry) {
    const page = layout.pages.find(candidate => candidate.id === entry.placement.pageId)
    if (!page || page.kind !== 'grid') return 'unavailable-page'
    try {
      const rect = rectangle(entry.placement)
      if ((page.widgets || []).some(widget => overlaps(rect, rectangle(widget)))) return 'occupied-placement'
      return null
    } catch {
      return 'invalid-placement'
    }
  }

  async function placedCatalog() {
    const entries = await catalog()
    let changed = false
    for (const entry of entries) {
      if (entry.kind !== 'widget') continue
      if (!entry.placement) {
        try {
          entry.placement = choosePlacement(entries, entry.id)
          delete entry.placementError
          changed = true
        } catch (error) {
          if (error.message !== 'desktop-full') throw error
          entry.placementError = 'desktop-full'
        }
        continue
      }
      // A release can add a built-in tile where an installed package already sits. The
      // package reports the conflict instead of painting over the built-in cell, and the
      // error clears itself if that built-in tile is removed again.
      const error = placementIssue(entry) || undefined
      if (entry.placementError !== error) {
        if (error) entry.placementError = error
        else delete entry.placementError
        changed = true
      }
    }
    if (changed) await commit(entries)
    return entries
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
      try { return await action(await placedCatalog()) } catch (error) {
        const known = ['catalog-corrupt', 'workspace-not-configured', 'package-not-found', 'unsafe-package', 'invalid-manifest', 'invalid-identifier', 'manifest-too-large', 'package-too-large', 'invalid-placement', 'invalid-page', 'occupied-placement', 'desktop-full', 'placement-requires-widget']
        return failure(known.includes(error.message) ? error.message : 'persistence-failed')
      }
    })
  }

  async function publish(entries, id, bundle, previous, placement) {
    const entry = { ...metadata({ ...bundle.manifest, revision: bundle.revision, placement }), digest: bundle.digest, history: previous ? [previous] : [] }
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

  function install(id, placement) {
    return mutate(async entries => {
      const bundle = await draft(id)
      const previous = entries.find(entry => entry.id === id)
      if (!previous && entries.length >= MAX_APPS) return failure('catalog-limit')
      if (bundle.manifest.kind !== 'widget' && placement !== undefined) return failure('placement-requires-widget')
      const target = bundle.manifest.kind === 'widget' ? choosePlacement(entries, id, placement === undefined ? previous?.placement : placement) : undefined
      if (!await verifyBundle(bundle)) return failure('verification-failed')
      const rollback = previous?.revision === bundle.revision ? previous.history[0] : previous?.revision
      return publish(entries, id, bundle, rollback, target)
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
      const placement = bundle.manifest.kind === 'widget' ? choosePlacement(entries, id, current.placement) : undefined
      return publish(entries, id, bundle, current.revision, placement)
    })
  }

  return {
    list: () => serial(async () => (await placedCatalog()).map(metadata)),
    desktop: () => serial(async () => desktop(await placedCatalog())),
    place: (id, placement) => mutate(async entries => {
      const entry = entries.find(entry => entry.id === id)
      if (!entry) return failure('not-found')
      if (entry.kind !== 'widget') return failure('placement-requires-widget')
      if (placement === undefined) return failure('invalid-placement')
      entry.placement = choosePlacement(entries, id, placement)
      delete entry.placementError
      await commit(entries)
      return { ok: true, app: metadata(entry) }
    }),
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
