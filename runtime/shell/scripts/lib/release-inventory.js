const fs = require('node:fs')
const path = require('node:path')
const { observeReleaseCloseouts } = require('./release-closeout')

const DEFAULT_LIMITS = Object.freeze({
  maxDurationMs: 30000,
  maxEntries: 1000000,
  maxDirectoryEntries: 10000,
  maxDepth: 64,
  maxProcesses: 4096,
  maxThreads: 65536,
  maxMountEntries: 100000,
  maxFds: 65536,
  maxFileBytes: 4 * 1024 * 1024,
  maxReadBytes: 32 * 1024 * 1024,
  maxReferences: 100000,
})
const STATES = new Set(['preparing', 'ready', 'recovering', 'interrupted', 'settled'])
const safe = value => Number.isSafeInteger(value) && value >= 0
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0') && path.normalize(value) === value
const inside = (value, parent) => value === parent || value.startsWith(parent + path.sep)
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key))
const identity = stat => ({ dev: stat.dev, ino: stat.ino })
const same = (a, b) => a.dev === b.dev && a.ino === b.ino
const key = stat => `${stat.dev}:${stat.ino}`
const emptyLedger = () => ({ schemaVersion: 1, revision: 0, reservations: [] })

function validLedger(ledger) {
  if (!only(ledger, ['schemaVersion', 'revision', 'reservations']) || ledger.schemaVersion !== 1 || !safe(ledger.revision) || !Array.isArray(ledger.reservations)) return false
  const ids = new Set()
  const requests = new Set()
  return ledger.reservations.every(item => {
    if (!only(item, ['id', 'requestId', 'candidatePath', 'owner', 'state', 'claims']) || typeof item.id !== 'string' || !item.id || typeof item.requestId !== 'string' || !item.requestId || ids.has(item.id) || requests.has(item.requestId) || !absolute(item.candidatePath) || !STATES.has(item.state) || !object(item.owner) || !Array.isArray(item.claims) || !item.claims.length) return false
    const owner = item.owner
    if (!only(owner, ['bootId', 'pid', 'startTime']) || typeof owner.bootId !== 'string' || !owner.bootId || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !(typeof owner.startTime === 'string' && /^\d+$/.test(owner.startTime) || safe(owner.startTime))) return false
    const pools = new Set()
    if (!item.claims.every(claim => {
      if (!only(claim, ['filesystemId', 'bytes', 'inodes']) || typeof claim.filesystemId !== 'string' || !claim.filesystemId || pools.has(claim.filesystemId) || !safe(claim.bytes) || !safe(claim.inodes)) return false
      pools.add(claim.filesystemId)
      return true
    })) return false
    ids.add(item.id); requests.add(item.requestId)
    return true
  })
}

/** Collect a bounded, read-only observation. Unknown facts never authorize reclamation. */
function collectReleaseInventory(options = {}) {
  const { root, procRoot = '/proc', now = Date.now, unitReferences, backupReferences, limits = {} } = object(options) ? options : {}
  let started
  try { started = Number(now()); if (!Number.isFinite(new Date(started).getTime())) started = NaN } catch { started = NaN }
  const result = {
    schemaVersion: 1, root: typeof root === 'string' ? root : '',
    observedAt: Number.isFinite(started) ? new Date(started).toISOString() : null,
    complete: true, uncertainties: [], filesystems: [], releases: [],
    pointers: { current: null, previous: null }, references: [], protections: [], locks: [],
    backupRoots: [], ledger: emptyLedger(), closeouts: { schemaVersion: 1, complete: false, transactions: [], unresolved: [] },
  }
  const unknown = reason => {
    result.complete = false
    if (!result.uncertainties.includes(reason)) result.uncertainties.push(reason)
  }
  const bounds = { ...DEFAULT_LIMITS, ...limits }
  if (!absolute(root) || !absolute(procRoot) || !Number.isFinite(started) || !object(limits) || Object.keys(limits).some(k => !Object.hasOwn(DEFAULT_LIMITS, k)) || Object.values(bounds).some(v => !Number.isSafeInteger(v) || v < 1)) {
    unknown('invalid-collection-options')
    return result
  }
  const releaseRoot = path.join(root, 'releases')
  const stateRoot = path.join(root, 'state')
  let entries = 0, bytesRead = 0, fds = 0
  const refs = new Set()
  const referenceObservations = new Map(), backupObservations = new Map()
  const inodeCatalog = new Map(), mappingCatalog = new Map(), candidateDevices = new Set()
  const magicObservations = new Map(), taskObservations = new Map(), namespaceObservations = new Map(), mountObservations = []
  const taskSets = new Map(), fdSets = new Map(), releaseObservations = new Map(), mappingObservations = new Map()
  function linuxDevice(dev) {
    const value = BigInt(dev)
    return `${((value >> 8n) & 0xfffn) | ((value >> 32n) & 0xfffff000n)}:${(value & 0xffn) | ((value >> 12n) & 0xffffff00n)}`
  }
  function addReference(filename, kind) {
    const token = `${kind}:${filename}`
    if (refs.has(token)) return
    if (refs.size >= bounds.maxReferences) throw Error('references')
    refs.add(token); result.references.push({ path: filename, kind })
  }
  function inodeReference(stat, kind) {
    if (!safe(stat.dev) || !safe(stat.ino)) throw Error('inode')
    for (const release of inodeCatalog.get(key(stat)) ?? []) addReference(release, kind)
  }
  function tick() {
    const current = Number(now())
    if (!Number.isFinite(current) || current < started || current - started > bounds.maxDurationMs) throw Error('budget')
  }
  function list(directory) {
    tick()
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('directory')
    const dir = fs.opendirSync(directory)
    const names = []
    try {
      let item
      while ((item = dir.readSync()) !== null) {
        tick()
        if (names.length >= bounds.maxDirectoryEntries) throw Error('entries')
        names.push(item.name)
      }
    } finally { dir.closeSync() }
    return names.sort()
  }
  function optionalStat(target) {
    try { return fs.lstatSync(target) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  function read(target) {
    tick()
    const before = fs.lstatSync(target)
    if (!before.isFile() || before.isSymbolicLink() || before.size > bounds.maxFileBytes) throw Error('file')
    const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      const opened = fs.fstatSync(fd)
      if (!same(before, opened) || before.size !== opened.size || before.mtimeMs !== opened.mtimeMs || before.ctimeMs !== opened.ctimeMs) throw Error('changed')
      const parts = []
      let total = 0
      for (;;) {
        tick()
        const buffer = Buffer.alloc(Math.min(65536, bounds.maxFileBytes + 1 - total))
        const count = fs.readSync(fd, buffer, 0, buffer.length, null)
        if (!count) break
        total += count; bytesRead += count
        if (total > bounds.maxFileBytes || bytesRead > bounds.maxReadBytes) throw Error('bytes')
        parts.push(buffer.subarray(0, count))
      }
      const after = fs.fstatSync(fd)
      const named = fs.lstatSync(target)
      if (!same(opened, after) || !same(opened, named) || named.isSymbolicLink() || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) throw Error('changed')
      return Buffer.concat(parts).toString('utf8')
    } finally { fs.closeSync(fd) }
  }
  function ancestors(target) {
    const relative = path.relative(root, path.dirname(target))
    let cursor = root
    for (const part of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part)
      const s = optionalStat(cursor)
      if (!s) return false
      if (!s.isDirectory() || s.isSymbolicLink()) throw Error('directory')
    }
    return true
  }
  function readOptionalJson(target) {
    if (!ancestors(target) || !optionalStat(target)) return undefined
    return JSON.parse(read(target))
  }
  function referenceSnapshot(target, kind) {
    let pending = target, links = 0
    const chain = []
    try {
      for (;;) {
        let cursor = path.parse(pending).root, redirected = false
        const parts = pending.split(path.sep).filter(Boolean)
        for (let i = 0; i < parts.length; i++) {
          tick()
          if (parts[i] === '.') continue
          if (parts[i] === '..') { cursor = path.dirname(cursor); continue }
          cursor = path.join(cursor, parts[i])
          const s = fs.lstatSync(cursor)
          if (s.isSymbolicLink()) {
            if (++links > 40) throw Error('reference-links')
            const raw = fs.readlinkSync(cursor)
            chain.push([cursor, s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs, raw])
            // Preserve parent traversal until earlier symlinks have resolved, as the kernel does.
            pending = (path.isAbsolute(raw) ? raw : path.dirname(cursor) + path.sep + raw) + (parts.length > i + 1 ? path.sep + parts.slice(i + 1).join(path.sep) : '')
            redirected = true
            break
          }
          if (i < parts.length - 1 && !s.isDirectory()) throw Error('reference-not-directory')
          chain.push([cursor, s.dev, s.ino, s.mode])
        }
        if (redirected) continue
        const canonical = fs.realpathSync(cursor), targetStat = fs.lstatSync(canonical)
        if (targetStat.isSymbolicLink()) throw Error('reference-changed')
        return { canonical, chain, target: [targetStat.dev, targetStat.ino, targetStat.mode, targetStat.size, targetStat.mtimeMs, targetStat.ctimeMs] }
      }
    } catch (error) {
      if (kind === 'process' && error.code === 'ENOENT') return { missing: true, chain }
      throw error
    }
  }
  function reference(target, kind) {
    tick()
    const clean = target.replace(/ \(deleted\)$/, '')
    if (!absolute(clean)) throw Error('reference')
    const observation = referenceSnapshot(clean, kind)
    const key = kind + ':' + clean
    if (referenceObservations.has(key) && JSON.stringify(referenceObservations.get(key).observation) !== JSON.stringify(observation)) throw Error('reference-changed')
    if (referenceObservations.size >= bounds.maxReferences) throw Error('references')
    referenceObservations.set(key, { path: clean, kind, observation })
    const paths = new Set()
    if (inside(clean, releaseRoot)) paths.add(clean)
    if (observation.canonical) {
      const canonicalRoot = fs.realpathSync(releaseRoot)
      if (inside(observation.canonical, canonicalRoot)) paths.add(path.join(releaseRoot, path.relative(canonicalRoot, observation.canonical)))
    }
    for (const p of paths) {
      addReference(p, kind)
    }
  }
  function protectAll(reason) {
    if (!result.protections.some(p => p.path === releaseRoot && p.reason === reason)) result.protections.push({ path: releaseRoot, reason })
  }
  function pointer(name) {
    const target = path.join(root, name)
    const s = optionalStat(target)
    if (!s) return null
    if (!s.isSymbolicLink()) throw Error('pointer')
    const resolved = fs.realpathSync(target)
    if (path.dirname(resolved) !== fs.realpathSync(releaseRoot) || !fs.lstatSync(resolved).isDirectory()) throw Error('pointer')
    return { target: path.join(releaseRoot, path.basename(resolved)), identity: identity(s), raw: fs.readlinkSync(target) }
  }
  let rootStat
  try {
    rootStat = fs.lstatSync(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('root')
    const pool = fs.statfsSync(root)
    const availableBytes = pool.bavail * pool.bsize
    if (!safe(availableBytes) || !safe(pool.ffree) || !safe(rootStat.dev) || !safe(rootStat.ino)) throw Error('filesystem')
    result.filesystems.push({ id: `dev:${rootStat.dev}`, availableBytes, availableInodes: pool.ffree, complete: true })
  } catch {
    unknown('root-or-filesystem-unavailable')
    return result
  }
  try {
    const s = fs.lstatSync(releaseRoot)
    if (!s.isDirectory() || s.isSymbolicLink() || !safe(s.dev) || !safe(s.ino)) throw Error('release-boundary')
    const device = linuxDevice(s.dev)
    inodeCatalog.set(key(s), new Set([releaseRoot]))
    mappingCatalog.set(`${device}:${s.ino}`, new Set([releaseRoot]))
    candidateDevices.add(device)
    releaseObservations.set(releaseRoot, [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs])
  } catch { unknown('release-boundary-unavailable') }
  const watchedPaths = ['releases', 'state', 'state/release-control', 'state/release-control/ledger.json',
    'state/release-control/pins.json', 'state/release-control/reconciliation.json', 'state/deployment-backups', 'state/deployment-inputs',
    'update.lock', 'state/update.lock', 'state/release-control/update.lock']
  function fingerprint(relative) {
    const target = path.join(root, relative)
    if (!ancestors(target)) return null
    const s = optionalStat(target)
    return s ? [s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs, s.isSymbolicLink() ? fs.readlinkSync(target) : null] : null
  }
  let controls
  try { controls = watchedPaths.map(fingerprint) } catch { unknown('control-state-unavailable') }
  const pointers = {}
  for (const name of ['current', 'previous']) {
    try { pointers[name] = pointer(name); result.pointers[name] = pointers[name]?.target ?? null } catch { unknown('pointer-unresolved') }
  }
  try {
    for (const name of list(releaseRoot)) {
      tick()
      const target = path.join(releaseRoot, name)
      const initial = fs.lstatSync(target)
      if (!initial.isDirectory() || initial.isSymbolicLink() || initial.dev !== rootStat.dev) { unknown('release-boundary-unknown'); continue }
      const release = { id: name, path: target, identity: identity(initial), allocatedBytes: 0, reclaimableBytes: 0, metadataValid: false, complete: true }
      result.releases.push(release)
      const inodes = new Map()
      try {
        function walk(item, depth) {
          tick()
          if (++entries > bounds.maxEntries || depth > bounds.maxDepth) throw Error('tree-budget')
          const s = fs.lstatSync(item)
          releaseObservations.set(item, [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs])
          if (s.dev !== initial.dev || !safe(s.ino) || !safe(s.blocks * 512) || !safe(s.size)) throw Error('tree-boundary')
          if (!s.isFile() && !s.isDirectory() && !s.isSymbolicLink()) throw Error('special-file')
          const k = key(s)
          if (!inodes.has(k)) inodes.set(k, { stat: s, count: 0 })
          inodes.get(k).count++
          if (s.isDirectory()) {
            for (const child of list(item)) walk(path.join(item, child), depth + 1)
            const after = fs.lstatSync(item)
            if (!same(s, after) || s.mtimeMs !== after.mtimeMs || s.ctimeMs !== after.ctimeMs) throw Error('tree-changed')
          }
        }
        walk(target, 0)
        for (const { stat, count } of inodes.values()) {
          release.allocatedBytes += stat.blocks * 512
          if (stat.isDirectory() || stat.nlink === count) release.reclaimableBytes += stat.blocks * 512
          const inodeKey = key(stat), device = linuxDevice(stat.dev), mappingKey = `${device}:${stat.ino}`
          if (!inodeCatalog.has(inodeKey)) inodeCatalog.set(inodeKey, new Set())
          if (!mappingCatalog.has(mappingKey)) mappingCatalog.set(mappingKey, new Set())
          inodeCatalog.get(inodeKey).add(target); mappingCatalog.get(mappingKey).add(target); candidateDevices.add(device)
        }
        if (!safe(release.allocatedBytes) || !safe(release.reclaimableBytes)) throw Error('overflow')
        const metadata = JSON.parse(read(path.join(target, 'release.json')))
        release.metadataValid = metadata.schemaVersion === 1 && metadata.id === name && typeof metadata.sourceRevision === 'string' && /^[a-f0-9]{40}$/i.test(metadata.sourceRevision) && typeof metadata.createdAt === 'string' && Number.isFinite(Date.parse(metadata.createdAt))
        if (!release.metadataValid || !same(initial, fs.lstatSync(target))) throw Error('metadata')
      } catch {
        release.complete = false
        release.reclaimableBytes = 0
        unknown('release-observation-incomplete')
      }
    }
  } catch { unknown('release-scan-incomplete') }
  const legacyScopes = ['state/deployment-backups', 'state/deployment-inputs', 'staging', 'state/release-control/backups']
  result.backupRoots = legacyScopes.map(name => path.join(root, name))
  try {
    if (optionalStat(stateRoot)) for (const name of list(stateRoot)) {
      if (/backup/i.test(name)) result.backupRoots.push(path.join(stateRoot, name))
    }
  } catch { protectAll('backup-coverage-unresolved'); unknown('backup-coverage-incomplete') }
  const externalBackupRoots = ['/var/backups', '/var/lib/odk-firmware-backups', '/mnt/ssd/odk-system-disk-archive']
  if (backupReferences !== undefined || root === '/opt/odk') {
    try {
      if (!only(backupReferences, ['schemaVersion', 'complete', 'observedAt', 'roots', 'references']) || backupReferences.schemaVersion !== 1 || backupReferences.complete !== true || typeof backupReferences.observedAt !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T/.test(backupReferences.observedAt) || !Number.isFinite(Date.parse(backupReferences.observedAt)) || Date.parse(backupReferences.observedAt) > started || started - Date.parse(backupReferences.observedAt) > 60000
        || !Array.isArray(backupReferences.roots) || backupReferences.roots.length > bounds.maxReferences || !Array.isArray(backupReferences.references) || backupReferences.references.length > bounds.maxReferences
        || backupReferences.roots.some(p => !absolute(p)) || new Set(backupReferences.roots).size !== backupReferences.roots.length
        || root === '/opt/odk' && externalBackupRoots.some(p => !backupReferences.roots.includes(p))) throw Error('backup-coverage')
      result.backupRoots.push(...backupReferences.roots)
      for (const ref of backupReferences.references) {
        if (!only(ref, ['path', 'kind']) || !absolute(ref.path) || ref.kind !== 'backup') throw Error('backup-reference')
        reference(ref.path, 'backup')
      }
    } catch { protectAll('backup-coverage-unresolved'); unknown('backup-coverage-incomplete') }
  }
  result.backupRoots = [...new Set(result.backupRoots)]
  const closeout = observeReleaseCloseouts({ root, procRoot, observedAt: started, releases: result.releases,
    io: { read, list, optionalStat, tick, reference, readlink: filename => fs.readlinkSync(filename) }, maxEntries: bounds.maxEntries })
  result.closeouts = closeout.result
  if (closeout.available && !result.closeouts.complete) {
    protectAll('transaction-closeout-unresolved'); unknown('transaction-closeout-unresolved')
  }
  for (const relative of legacyScopes.slice(0, 2)) {
    try {
      const target = path.join(root, relative)
      if (ancestors(target) && optionalStat(target) && list(target).length && !result.closeouts.complete) {
        protectAll('legacy-recovery-unresolved'); unknown('legacy-recovery-unresolved')
      }
    } catch { protectAll('legacy-recovery-unresolved'); unknown('legacy-recovery-unresolved') }
  }
  try {
    const backupDirectories = new Map()
    function backupTree(filename, depth = 0) {
      tick()
      if (++entries > bounds.maxEntries || depth > bounds.maxDepth) throw Error('backup-budget')
      const s = optionalStat(filename)
      if (!s) { backupObservations.set(filename, null); return }
      const observed = [s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs]
      if (backupObservations.has(filename) && JSON.stringify(backupObservations.get(filename)) !== JSON.stringify(observed)) throw Error('backup-changed')
      backupObservations.set(filename, observed)
      if (s.isSymbolicLink()) {
        reference(filename, 'backup')
        const resolved = referenceObservations.get('backup:' + filename)?.observation.canonical
        if (resolved && fs.lstatSync(resolved).isDirectory() && !inside(resolved, fs.realpathSync(releaseRoot))) {
          if (inside(resolved, fs.realpathSync(root))) backupTree(resolved, depth + 1)
          else if (!backupReferences?.roots?.some(p => inside(resolved, p))) throw Error('backup-external-coverage')
        }
      } else if (s.isDirectory()) {
        const k = key(s)
        if (backupDirectories.has(k)) { if (backupDirectories.get(k) !== filename) throw Error('backup-directory-alias'); return }
        backupDirectories.set(k, filename)
        for (const name of list(filename)) backupTree(path.join(filename, name), depth + 1)
      }
      else if (!s.isFile()) throw Error('backup-special-file')
    }
    // External roots are supplied by explicit coverage attestation, not silently traversed.
    for (const directory of result.backupRoots.filter(p => inside(p, root))) {
      if (!ancestors(directory)) { backupObservations.set(directory, null); continue }
      backupTree(directory)
    }
  } catch {
    result.closeouts.complete = false
    result.closeouts.unresolved.push({ reason: 'closeout-backup-coverage-incomplete' })
    protectAll('backup-coverage-unresolved'); unknown('backup-observation-incomplete')
  }
  for (const name of ['update.lock', 'state/update.lock', 'state/release-control/update.lock']) {
    try {
      const target = path.join(root, name)
      if (!ancestors(target)) continue
      const stat = optionalStat(target)
      if (stat) {
        const observation = closeout.gateObservations.get(target)
        const reconciled = result.closeouts.complete && observation?.status === 'idle' && observation.reconciled === true
        result.locks.push({ path: target, identity: identity(stat), recoveryPinned: !reconciled,
          status: reconciled ? 'idle' : observation?.status === 'active' ? 'active' : 'unknown', reconciled })
        if (!reconciled) { protectAll('deployment-gate'); unknown('deployment-gate-unresolved') }
      }
    } catch { protectAll('deployment-gate'); unknown('deployment-gate-unresolved') }
  }
  try {
    const ledger = readOptionalJson(path.join(stateRoot, 'release-control/ledger.json'))
    if (ledger !== undefined) {
      if (!validLedger(ledger)) throw Error('ledger')
      result.ledger = ledger
    }
  } catch { protectAll('ledger-unresolved'); unknown('ledger-unresolved') }
  try {
    const pins = readOptionalJson(path.join(stateRoot, 'release-control/pins.json'))
    if (pins !== undefined) {
      if (!only(pins, ['schemaVersion', 'pins']) || pins.schemaVersion !== 1 || !Array.isArray(pins.pins) || pins.pins.length > bounds.maxReferences) throw Error('pins')
      for (const pin of pins.pins) {
        if (!only(pin, ['path', 'reason']) || !absolute(pin.path) || !inside(pin.path, root) || typeof pin.reason !== 'string' || !pin.reason) throw Error('pin')
        result.protections.push({ path: pin.path, reason: 'explicit-pin' })
        if (result.locks.some(lock => inside(lock.path, pin.path) || inside(pin.path, lock.path))) {
          result.closeouts.complete = false
          result.closeouts.unresolved.push({ reason: 'closeout-gate-explicitly-pinned' })
          protectAll('deployment-gate'); unknown('deployment-gate-explicit-pin')
        }
      }
    }
  } catch { protectAll('pins-unresolved'); unknown('pins-unresolved') }
  try {
    if (!object(unitReferences) || unitReferences.complete !== true || !Array.isArray(unitReferences.references) || unitReferences.references.length > bounds.maxReferences) throw Error('units')
    for (const ref of unitReferences.references) {
      if (!object(ref) || ref.kind !== 'unit' || !absolute(ref.path)) throw Error('unit')
      reference(ref.path, 'unit')
    }
  } catch { unknown('unit-coverage-incomplete') }
  function processIdentity(text, expectedPid) {
    const end = text.lastIndexOf(') ')
    if (end < 0 || !text.startsWith(expectedPid + ' (')) throw Error('stat')
    const fields = text.slice(end + 2).trim().split(/\s+/)
    if (fields.length < 20 || !/^\d+$/.test(fields[19]) || !/^\d+$/.test(fields[6])) throw Error('stat')
    return { startTime: fields[19], state: fields[0], kernelThread: (Number(fields[6]) & 0x200000) !== 0 }
  }
  function identityAt(filename, expectedPid) {
    const observed = processIdentity(read(filename), expectedPid)
    const before = taskObservations.get(filename)
    if (before && (before.startTime !== observed.startTime || before.kernelThread !== observed.kernelThread)) throw Error('process-changed')
    taskObservations.set(filename, { expectedPid, ...observed })
    return observed
  }
  const retainedNamespaces = new Set(), mountNamespaces = new Map()
  function magic(filename, kind) {
    tick()
    const raw = fs.readlinkSync(filename), s = fs.statSync(filename)
    const observed = [raw, s.dev, s.ino, s.mode]
    if (magicObservations.has(filename) && JSON.stringify(magicObservations.get(filename)) !== JSON.stringify(observed)) throw Error('process-reference-changed')
    magicObservations.set(filename, observed)
    inodeReference(s, kind)
    if (raw.startsWith('/')) reference(raw, kind)
    if (/^mnt:\[\d+\]$/.test(raw)) retainedNamespaces.add(raw)
  }
  let threadCount = 0, mountCount = 0, processIdsBefore
  try {
    const processes = list(procRoot).filter(name => /^\d+$/.test(name))
    processIdsBefore = processes
    if (processes.length > bounds.maxProcesses) throw Error('process-budget')
    for (const pid of processes) {
      try {
        tick()
        const base = path.join(procRoot, pid)
        const before = identityAt(path.join(base, 'stat'), pid)
        if (!before.kernelThread) {
          const tids = list(path.join(base, 'task')).filter(name => /^\d+$/.test(name))
          taskSets.set(path.join(base, 'task'), tids)
          if (!tids.includes(pid)) throw Error('missing-process-task')
          for (const tid of tids) {
            if (++threadCount > bounds.maxThreads) throw Error('thread-budget')
            const tb = tid === pid ? base : path.join(base, 'task', tid)
            const initial = identityAt(path.join(tb, 'stat'), tid)
            if (!initial.kernelThread && !['Z', 'X'].includes(initial.state)) {
              for (const name of ['exe', 'cwd', 'root']) magic(path.join(tb, name), 'process')
              const fdRoot = path.join(tb, 'fd'), fdNames = list(fdRoot)
              fdSets.set(fdRoot, fdNames)
              for (const fd of fdNames) {
                if (!/^\d+$/.test(fd) || ++fds > bounds.maxFds) throw Error('fd-budget')
                magic(path.join(fdRoot, fd), 'process')
              }
              if (JSON.stringify(fdNames) !== JSON.stringify(list(fdRoot))) throw Error('fd-set-changed')
              const maps = read(path.join(tb, 'maps'))
              mappingObservations.set(path.join(tb, 'maps'), maps)
              for (const line of maps.split('\n')) {
                if (!line) continue
                const match = line.match(/^[0-9a-f]+-[0-9a-f]+\s+[r-][w-][x-][ps]\s+[0-9a-f]+\s+([0-9a-f]+):([0-9a-f]+)\s+(\d+)(?:\s+(.*))?$/i)
                if (!match) throw Error('maps')
                const device = `${BigInt('0x' + match[1])}:${BigInt('0x' + match[2])}`
                for (const release of mappingCatalog.get(`${device}:${BigInt(match[3])}`) ?? []) addReference(release, 'process')
                if (match[4]?.startsWith('/')) reference(match[4], 'process')
              }
              const nsPath = path.join(tb, 'ns/mnt'), ns = fs.readlinkSync(nsPath)
              if (!/^mnt:\[\d+\]$/.test(ns)) throw Error('namespace')
              namespaceObservations.set(nsPath, ns)
              const namespaceRoot = magicObservations.get(path.join(tb, 'root'))[0] === '/'
              if (!mountNamespaces.has(ns) || !mountNamespaces.get(ns).namespaceRoot && namespaceRoot) mountNamespaces.set(ns, { base: tb, tid, startTime: initial.startTime, namespaceRoot })
            }
            identityAt(path.join(tb, 'stat'), tid)
          }
          if (JSON.stringify(tids) !== JSON.stringify(list(path.join(base, 'task')).filter(name => /^\d+$/.test(name)))) throw Error('thread-set-changed')
        }
        identityAt(path.join(base, 'stat'), pid)
      } catch { unknown('process-observation-incomplete') }
    }
    const after = list(procRoot).filter(name => /^\d+$/.test(name))
    if (JSON.stringify(after) !== JSON.stringify(processes)) throw Error('process-set-changed')
  } catch { unknown('process-coverage-incomplete') }
  try {
    for (const ns of retainedNamespaces) if (!mountNamespaces.has(ns)) throw Error('unrepresented-mount-namespace')
    for (const [ns, representative] of mountNamespaces) {
      const { base, tid, startTime } = representative
      if (!representative.namespaceRoot) throw Error('namespace-root-visibility-incomplete')
      if (identityAt(path.join(base, 'stat'), tid).startTime !== startTime || fs.readlinkSync(path.join(base, 'ns/mnt')) !== ns) throw Error('namespace-changed')
      const filename = path.join(base, 'mountinfo'), text = read(filename), mountStats = []
      if (!text.trim()) throw Error('empty-mountinfo')
      const mountpoints = new Map()
      for (const line of text.split('\n')) {
        if (!line) continue
        if (++mountCount > bounds.maxMountEntries) throw Error('mount-budget')
        const fields = line.split(/\s+/), separator = fields.indexOf('-')
        if (separator < 6 || fields.length < separator + 4 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1]) || !/^\d+:\d+$/.test(fields[2])) throw Error('mountinfo')
        const decode = value => value.replace(/\\([0-7]{3})/g, (_, code) => String.fromCharCode(parseInt(code, 8)))
        const mountRoot = decode(fields[3]), point = decode(fields[4])
        if (!absolute(point) || fields[separator + 1] !== 'nsfs' && !absolute(mountRoot)) throw Error('mountinfo-path')
        if (fields[separator + 1] === 'nsfs') {
          if (/^mnt:\[\d+\]$/.test(mountRoot)) { if (!mountNamespaces.has(mountRoot)) throw Error('unrepresented-mount-namespace') }
          else if (!/^(net|pid|user|uts|ipc|cgroup|time):\[\d+\]$/.test(mountRoot)) throw Error('namespace-mount-unknown')
        }
        if (absolute(mountRoot) && inside(mountRoot, releaseRoot)) addReference(mountRoot, 'mount')
        const device = fields[2].split(':').map(value => BigInt(value).toString()).join(':')
        if (mountpoints.has(point) && (mountpoints.get(point) || candidateDevices.has(device))) throw Error('shadowed-candidate-mount')
        mountpoints.set(point, candidateDevices.has(device))
        if (candidateDevices.has(device)) {
          if (!absolute(point)) throw Error('mountpoint')
          const probe = path.join(base, 'root') + (point === '/' ? '/.' : point), s = fs.statSync(probe)
          if (linuxDevice(s.dev) !== device) throw Error('shadowed-candidate-mount')
          inodeReference(s, 'mount')
          mountStats.push({ path: probe, identity: [s.dev, s.ino, s.mode] })
        }
      }
      mountObservations.push({ filename, text, base, tid, ns, startTime, mountStats })
    }
  } catch { unknown('mount-namespace-observation-incomplete') }
  try {
    for (const [filename, names] of taskSets) if (JSON.stringify(names) !== JSON.stringify(list(filename).filter(name => /^\d+$/.test(name)))) throw Error('task-set-changed')
    for (const [filename, names] of fdSets) if (JSON.stringify(names) !== JSON.stringify(list(filename))) throw Error('fd-set-changed')
    for (const [filename, before] of mappingObservations) if (read(filename) !== before) throw Error('maps-changed')
    for (const [filename, before] of taskObservations) {
      const after = processIdentity(read(filename), before.expectedPid)
      if (before.startTime !== after.startTime || before.kernelThread !== after.kernelThread) throw Error('process-changed')
    }
    for (const [filename, before] of magicObservations) {
      tick()
      const s = fs.statSync(filename)
      if (JSON.stringify(before) !== JSON.stringify([fs.readlinkSync(filename), s.dev, s.ino, s.mode])) throw Error('magic-changed')
    }
    for (const [filename, before] of namespaceObservations) { tick(); if (fs.readlinkSync(filename) !== before) throw Error('namespace-changed') }
    for (const mount of mountObservations) {
      if (read(mount.filename) !== mount.text || processIdentity(read(path.join(mount.base, 'stat')), mount.tid).startTime !== mount.startTime || fs.readlinkSync(path.join(mount.base, 'ns/mnt')) !== mount.ns) throw Error('mount-changed')
      for (const probe of mount.mountStats) {
        tick()
        const s = fs.statSync(probe.path)
        if (JSON.stringify(probe.identity) !== JSON.stringify([s.dev, s.ino, s.mode])) throw Error('mountpoint-changed')
      }
    }
  } catch { unknown('process-reference-changed-during-scan') }
  for (const name of ['current', 'previous']) {
    try {
      const after = pointer(name), before = pointers[name]
      if (!!after !== !!before || after && (!same(after.identity, before.identity) || after.raw !== before.raw || after.target !== before.target)) throw Error('changed')
    } catch { unknown('pointer-changed-during-scan') }
  }
  try { if (!controls || JSON.stringify(watchedPaths.map(fingerprint)) !== JSON.stringify(controls)) throw Error('control-change') } catch { unknown('control-state-changed-during-scan') }
  try {
    if (processIdsBefore === undefined || JSON.stringify(processIdsBefore) !== JSON.stringify(list(procRoot).filter(name => /^\d+$/.test(name)))) throw Error('process-set-changed')
    for (const [filename, before] of releaseObservations) {
      tick()
      const s = fs.lstatSync(filename)
      if (JSON.stringify(before) !== JSON.stringify([s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs])) throw Error('release-changed')
    }
    for (const [filename, before] of backupObservations) {
      tick()
      const s = optionalStat(filename)
      const after = s ? [s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs] : null
      if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('backup-changed')
    }
    for (const { path: filename, kind, observation } of referenceObservations.values()) {
      if (JSON.stringify(referenceSnapshot(filename, kind)) !== JSON.stringify(observation)) throw Error('reference-changed')
    }
  } catch {
    result.closeouts.complete = false
    result.closeouts.unresolved.push({ reason: 'closeout-reference-snapshot-changed' })
    protectAll('backup-reference-unresolved'); unknown('reference-or-backup-changed-during-scan')
  }
  if (!closeout.revalidate()) { protectAll('transaction-closeout-unresolved'); unknown('transaction-closeout-changed-during-scan') }
  if (!result.closeouts.complete) for (const lock of result.locks) { lock.reconciled = false; lock.recoveryPinned = true; if (lock.status === 'idle') lock.status = 'unknown' }
  try { tick(); if (!same(rootStat, fs.lstatSync(root))) throw Error('root-changed') } catch { unknown('snapshot-changed-or-expired') }
  if (!result.complete) protectAll('incomplete-observation')
  return result
}

module.exports = { collectReleaseInventory }
