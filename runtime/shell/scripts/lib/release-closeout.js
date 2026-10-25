const path = require('node:path')
const { createHash } = require('node:crypto')

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key))
const integer = value => Number.isSafeInteger(value) && value >= 0
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)
const absolute = value => typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value && !/[\x00-\x1f\x7f]/.test(value)
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const ownerValid = value => only(value, ['bootId', 'pid', 'startTime']) && uuid(value.bootId) && Number.isSafeInteger(value.pid) && value.pid > 0 && typeof value.startTime === 'string' && /^\d+$/.test(value.startTime)
const hash = value => createHash('sha256').update(value).digest('hex')
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const dispositionValid = value => ['committed', 'rolled-back', 'abandoned'].includes(value)
const bindingValid = value => only(value, ['path', 'dev', 'ino']) && absolute(value.path) && integer(value.dev) && Number.isSafeInteger(value.ino) && value.ino > 0
const fingerprint = s => [s.dev, s.ino, s.uid, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs]
class ObservationFailure extends Error {}

/** Recognize existing administrative receipts. This observer never creates a closeout or releases a gate. */
function observeReleaseCloseouts({ root, procRoot, observedAt, releases, io, maxEntries }) {
  const result = { schemaVersion: 1, complete: false, transactions: [], unresolved: [] }
  const watched = new Map(), ancestry = new Map(), owners = [], gateObservations = new Map()
  const inputsRoot = path.join(root, 'state/deployment-inputs')
  const backupRoot = path.join(root, 'state/deployment-backups')
  const indexPath = path.join(root, 'state/release-control/reconciliation.json')
  const gatePaths = ['update.lock', 'state/update.lock', 'state/release-control/update.lock'].map(p => path.join(root, p))
  let kernelSnapshot, bootSnapshot, processViewSnapshot, available = false, visited = 0
  const fail = reason => { throw new ObservationFailure(reason) }
  function watch(filename) {
    io.tick()
    const s = io.optionalStat(filename)
    const observation = s ? fingerprint(s) : null
    if (watched.has(filename) && !same(watched.get(filename), observation)) fail('closeout-snapshot-changed')
    watched.set(filename, observation)
    return s
  }
  function trusted(filename, file = true) {
    // Trust the complete named ancestry, including the runtime root's parents.
    const parts = path.resolve(filename).split(path.sep).filter(Boolean)
    let cursor = path.parse(filename).root
    for (let i = -1; i < parts.length; i++) {
      if (i >= 0) cursor = path.join(cursor, parts[i])
      const insideRoot = cursor === root || cursor.startsWith(root + path.sep)
      const s = insideRoot ? watch(cursor) : io.optionalStat(cursor)
      if (!insideRoot && s) {
        const observed = [s.dev, s.ino, s.uid, s.mode]
        if (ancestry.has(cursor) && !same(ancestry.get(cursor), observed)) fail('closeout-snapshot-changed')
        ancestry.set(cursor, observed)
      }
      if (!s || s.isSymbolicLink() || s.uid !== 0 || (s.mode & 0o022) || (i === parts.length - 1 && file ? !s.isFile() || s.nlink !== 1 : !s.isDirectory())) fail('closeout-untrusted-path')
    }
  }
  function document(filename) {
    trusted(filename)
    const body = io.read(filename)
    watch(filename)
    return { body, value: JSON.parse(body), stat: io.optionalStat(filename) }
  }
  function children(directory) {
    const s = watch(directory)
    if (!s) return []
    if (!s.isDirectory() || s.isSymbolicLink()) fail('closeout-legacy-scope-invalid')
    const names = io.list(directory)
    for (const name of names) {
      if (!identifier(name)) fail('closeout-legacy-scope-invalid')
      const child = watch(path.join(directory, name))
      if (!child?.isDirectory() || child.isSymbolicLink()) fail('closeout-legacy-scope-invalid')
    }
    return names.map(name => path.join(directory, name))
  }
  function verifyBinding(binding, parent) {
    if (!bindingValid(binding) || path.dirname(binding.path) !== parent) fail('closeout-binding-invalid')
    const s = watch(binding.path)
    if (!s?.isDirectory() || s.isSymbolicLink() || s.dev !== binding.dev || s.ino !== binding.ino) fail('closeout-binding-stale')
  }
  function ownerExited(owner) {
    if (!ownerValid(owner)) fail('closeout-owner-invalid')
    if (typeof process.getuid !== 'function' || process.getuid() !== 0) fail('closeout-owner-observation-incomplete')
    const boot = io.read(path.join(procRoot, 'sys/kernel/random/boot_id')).trim()
    if (!uuid(boot)) fail('closeout-owner-observation-incomplete')
    if (bootSnapshot !== undefined && boot !== bootSnapshot) fail('closeout-snapshot-changed')
    bootSnapshot = boot
    if (owner.bootId !== boot) return true
    let stat
    try { stat = io.read(path.join(procRoot, String(owner.pid), 'stat')) } catch (error) {
      if (error.code === 'ENOENT') return true
      fail('closeout-owner-observation-incomplete')
    }
    const end = stat.lastIndexOf(') ')
    const fields = stat.slice(end + 2).trim().split(/\s+/)
    if (end < 0 || !stat.startsWith(owner.pid + ' (') || fields.length < 20 || !/^\d+$/.test(fields[19])) fail('closeout-owner-observation-incomplete')
    return fields[19] !== owner.startTime
  }
  function processView() {
    const bootId = io.read(path.join(procRoot, 'sys/kernel/random/boot_id')).trim()
    const pidNamespace = io.readlink(path.join(procRoot, 'self/ns/pid'))
    const mountNamespace = io.readlink(path.join(procRoot, 'self/ns/mnt'))
    if (!uuid(bootId) || !/^pid:\[\d+\]$/.test(pidNamespace) || !/^mnt:\[\d+\]$/.test(mountNamespace)
      || io.readlink(path.join(procRoot, '1/ns/pid')) !== pidNamespace || io.readlink(path.join(procRoot, '1/ns/mnt')) !== mountNamespace) fail('closeout-process-view-incomplete')
    return { bootId, pidNamespace, mountNamespace }
  }
  function kernelLocks() {
    const text = io.read(path.join(procRoot, 'locks'))
    const rows = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      const fields = line.trim().split(/\s+/)
      if (!/^\d+:$/.test(fields.shift())) fail('closeout-kernel-locks-incomplete')
      if (fields[0] === '->') fields.shift()
      if (!['FLOCK', 'POSIX', 'OFDLCK', 'LEASE'].includes(fields[0]) || fields.length !== 7 || !/^-?\d+$/.test(fields[3]) || !/^(READ|WRITE|UNLCK)$/.test(fields[2]) || !/^\d+$/.test(fields[5]) || !/^(EOF|\d+)$/.test(fields[6])
        || (fields[0] === 'LEASE' ? !/^(ACTIVE|BREAKING)$/.test(fields[1]) : fields[1] !== 'ADVISORY')) fail('closeout-kernel-locks-incomplete')
      const m = fields[4].match(/^([0-9a-f]+):([0-9a-f]+):(\d+)$/i)
      if (!m) fail('closeout-kernel-locks-incomplete')
      rows.push({ major: BigInt('0x' + m[1]), minor: BigInt('0x' + m[2]), ino: BigInt(m[3]) })
    }
    return { text, rows }
  }
  function held(rows, s) {
    const dev = BigInt(s.dev)
    const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n)
    const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n)
    return rows.some(row => row.major === major && row.minor === minor && row.ino === BigInt(s.ino))
  }
  function stableTree(directory, receiptPath, receiptStat, depth = 0) {
    if (depth > 64 || ++visited > maxEntries) fail('closeout-tree-budget')
    const s = watch(directory)
    if (!s || s.isSymbolicLink() || !s.isDirectory()) fail('closeout-evidence-tree-invalid')
    if (s.mtimeMs > receiptStat.mtimeMs || s.ctimeMs > receiptStat.ctimeMs) fail('closeout-evidence-stale')
    for (const name of io.list(directory)) {
      const target = path.join(directory, name)
      if (target === receiptPath) continue
      const child = watch(target)
      if (!child || ++visited > maxEntries || child.mtimeMs > receiptStat.mtimeMs || child.ctimeMs > receiptStat.ctimeMs) fail('closeout-evidence-stale')
      if (child.isSymbolicLink()) {
        io.reference(target, 'backup')
        watch(target)
      }
      if (child.isDirectory() && !child.isSymbolicLink()) stableTree(target, receiptPath, receiptStat, depth + 1)
    }
  }
  let inputPaths = [], backupPaths = []
  try {
    inputPaths = children(inputsRoot); backupPaths = children(backupRoot)
    const s = watch(indexPath)
    if (!s) {
      const gatePresent = gatePaths.some(filename => watch(filename))
      if (inputPaths.length || backupPaths.length || gatePresent) result.unresolved.push({ reason: 'closeout-index-absent' })
      else result.complete = true
    } else {
      available = true
      const index = document(indexPath).value
      if (!only(index, ['schemaVersion', 'kind', 'processView', 'transactions', 'gates']) || index.schemaVersion !== 1 || index.kind !== 'release-reconciliation-index' || !Array.isArray(index.transactions) || !Array.isArray(index.gates) || index.transactions.length > 10000 || index.gates.length > 3) fail('closeout-index-invalid')
      if (!only(index.processView, ['bootId', 'pidNamespace', 'mountNamespace']) || !uuid(index.processView.bootId) || !/^pid:\[\d+\]$/.test(index.processView.pidNamespace ?? '') || !/^mnt:\[\d+\]$/.test(index.processView.mountNamespace ?? '')) fail('closeout-process-view-invalid')
      processViewSnapshot = processView()
      if (!same(processViewSnapshot, index.processView)) fail('closeout-process-view-mismatch')
      const coveredInputs = new Set(), coveredBackups = new Set(), transactionIds = new Map(), transactionGates = new Set()
      for (const entry of index.transactions) {
        const keys = ['transactionId', 'candidate', 'inputs', 'backups', 'gatePaths', 'owner', 'disposition', 'noPendingWork', 'closedAt', 'terminalEvidence']
        if (!only(entry, keys) || !identifier(entry.transactionId) || transactionIds.has(entry.transactionId) || !dispositionValid(entry.disposition) || entry.noPendingWork !== true || typeof entry.closedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(entry.closedAt) || !Number.isFinite(Date.parse(entry.closedAt)) || Date.parse(entry.closedAt) > observedAt || !ownerValid(entry.owner)) fail('closeout-transaction-invalid')
        transactionIds.set(entry.transactionId, entry)
        if (!only(entry.candidate, ['path', 'dev', 'ino', 'sourceRevision']) || !/^[a-f0-9]{40}$/i.test(entry.candidate.sourceRevision ?? '')) fail('closeout-binding-invalid')
        const { sourceRevision, ...candidateBinding } = entry.candidate
        verifyBinding(candidateBinding, path.join(root, 'releases'))
        const candidate = releases.find(row => row.path === candidateBinding.path && row.metadataValid && row.complete)
        if (!candidate) fail('closeout-binding-stale')
        const metadataPath = path.join(candidate.path, 'release.json')
        watch(metadataPath)
        if (JSON.parse(io.read(metadataPath)).sourceRevision !== sourceRevision) fail('closeout-binding-stale')
        watch(metadataPath)
        if (!Array.isArray(entry.inputs) || !Array.isArray(entry.backups) || !entry.backups.length || entry.inputs.length + entry.backups.length > 10000 || !Array.isArray(entry.gatePaths) || entry.gatePaths.length > 3) fail('closeout-binding-invalid')
        for (const [bindings, parent, covered] of [[entry.inputs, inputsRoot, coveredInputs], [entry.backups, backupRoot, coveredBackups]]) {
          for (const binding of bindings) {
            verifyBinding(binding, parent)
            if (covered.has(binding.path)) fail('closeout-coverage-conflict')
            covered.add(binding.path)
          }
        }
        for (const gatePath of entry.gatePaths) {
          if (!gatePaths.includes(gatePath) || transactionGates.has(gatePath)) fail('closeout-gate-invalid')
          transactionGates.add(gatePath)
        }
        if (!only(entry.terminalEvidence, ['path', 'sha256']) || !entry.backups.some(binding => entry.terminalEvidence.path === path.join(binding.path, 'closeout-receipt.json')) || !/^[a-f0-9]{64}$/.test(entry.terminalEvidence.sha256 ?? '')) fail('closeout-receipt-invalid')
        const receipt = document(entry.terminalEvidence.path)
        const expected = { schemaVersion: 1, kind: 'release-transaction-closeout', ...Object.fromEntries(keys.filter(k => k !== 'terminalEvidence').map(k => [k, entry[k]])), final: true, pendingRecovery: false }
        // Compare every typed field without echoing any receipt body or unrecognized fields.
        if (hash(receipt.body) !== entry.terminalEvidence.sha256 || !only(receipt.value, Object.keys(expected)) || Object.keys(expected).some(k => !same(receipt.value[k], expected[k]))) fail('closeout-receipt-invalid')
        for (const binding of [...entry.inputs, ...entry.backups]) stableTree(binding.path, entry.terminalEvidence.path, receipt.stat)
        owners.push(entry.owner)
        if (!ownerExited(entry.owner)) fail('closeout-owner-active')
        result.transactions.push({ transactionId: entry.transactionId, candidatePath: candidate.path, disposition: entry.disposition, closedAt: entry.closedAt })
      }
      if (inputPaths.some(p => !coveredInputs.has(p)) || backupPaths.some(p => !coveredBackups.has(p)) || coveredInputs.size !== inputPaths.length || coveredBackups.size !== backupPaths.length) fail('closeout-coverage-incomplete')
      const locks = kernelLocks(); kernelSnapshot = locks.text
      const coveredGates = new Set()
      for (const gate of index.gates) {
        const transaction = transactionIds.get(gate?.transactionId)
        if (!only(gate, ['transactionId', 'path', 'dev', 'ino', 'sha256', 'owner']) || !transaction || !transaction.gatePaths.includes(gate.path) || !same(transaction.owner, gate.owner) || !gatePaths.includes(gate.path) || coveredGates.has(gate.path) || !bindingValid({ path: gate.path, dev: gate.dev, ino: gate.ino }) || !/^[a-f0-9]{64}$/.test(gate.sha256 ?? '') || !ownerValid(gate.owner)) fail('closeout-gate-invalid')
        coveredGates.add(gate.path)
        trusted(gate.path)
        const s = watch(gate.path)
        if (s.dev !== gate.dev || s.ino !== gate.ino || s.size > 4096 || hash(io.read(gate.path)) !== gate.sha256) fail('closeout-gate-stale')
        watch(gate.path)
        owners.push(gate.owner)
        const exited = ownerExited(gate.owner), active = held(locks.rows, s)
        gateObservations.set(gate.path, { status: active || !exited ? 'active' : 'idle', reconciled: !active && exited })
        if (active || !exited) fail('closeout-gate-active')
      }
      if ([...transactionGates].some(p => !coveredGates.has(p))) fail('closeout-gate-uncovered')
      if (gatePaths.some(p => watch(p) && !coveredGates.has(p))) fail('closeout-gate-uncovered')
      result.complete = true
    }
  } catch (error) {
    result.complete = false
    result.unresolved.push({ reason: error instanceof ObservationFailure ? error.message : 'closeout-observation-incomplete' })
  }
  return {
    result, available, gateObservations,
    revalidate() {
      try {
        for (const [filename, before] of ancestry) {
          io.tick()
          const s = io.optionalStat(filename)
          if (!s || !same(before, [s.dev, s.ino, s.uid, s.mode])) fail('closeout-snapshot-changed')
        }
        for (const [filename, before] of watched) {
          io.tick()
          const s = io.optionalStat(filename)
          if (!same(before, s ? fingerprint(s) : null)) fail('closeout-snapshot-changed')
        }
        if (result.complete) {
          if (processViewSnapshot !== undefined && !same(processView(), processViewSnapshot)) fail('closeout-snapshot-changed')
          if (kernelSnapshot !== undefined && kernelLocks().text !== kernelSnapshot) fail('closeout-snapshot-changed')
          if (owners.some(owner => !ownerExited(owner))) fail('closeout-owner-active')
        }
        return true
      } catch {
        result.complete = false
        result.unresolved.push({ reason: 'closeout-snapshot-changed' })
        return false
      }
    },
  }
}

module.exports = { observeReleaseCloseouts }
