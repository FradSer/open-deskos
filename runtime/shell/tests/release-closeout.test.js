const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const { collectReleaseInventory } = require('../scripts/lib/release-inventory')
const { observeReleaseCloseouts } = require('../scripts/lib/release-closeout')
const { planRelease } = require('../scripts/lib/release-plan')

const bootId = '11111111-2222-4333-8444-555555555555'
const revision = 'a'.repeat(40)
const hash = value => createHash('sha256').update(value).digest('hex')
function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-closeout-')))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'odk'), procRoot = path.join(directory, 'proc')
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(name), { recursive: true, mode: 0o755 })
    fs.writeFileSync(name, typeof value === 'string' ? value : JSON.stringify(value), { mode: 0o600 })
  }
  fs.mkdirSync(path.join(root, 'releases'), { recursive: true })
  write(path.join(procRoot, 'sys/kernel/random/boot_id'), bootId + '\n')
  write(path.join(procRoot, 'locks'), '')
  const processView = { bootId, pidNamespace: 'pid:[1234]', mountNamespace: 'mnt:[5678]' }
  write(path.join(procRoot, '1/stat'), `1 (fixture-init) Z ${Array(18).fill('0').join(' ')} 1 0\n`)
  fs.mkdirSync(path.join(procRoot, '1/task/1'), { recursive: true })
  for (const pid of ['self', '1']) {
    fs.mkdirSync(path.join(procRoot, pid, 'ns'), { recursive: true })
    fs.symlinkSync(processView.pidNamespace, path.join(procRoot, pid, 'ns/pid'))
    fs.symlinkSync(processView.mountNamespace, path.join(procRoot, pid, 'ns/mnt'))
  }
  // Simulate a privileged, root-controlled fixture without weakening the public API.
  const privileged = stat => Object.defineProperties(Object.create(stat), { uid: { value: 0 }, mode: { value: stat.mode & ~0o022 } })
  t.mock.method(process, 'getuid', () => 0)
  for (const name of ['lstatSync', 'fstatSync']) {
    const original = fs[name]
    t.mock.method(fs, name, (...args) => privileged(original(...args)))
  }
  const binding = name => {
    fs.mkdirSync(name, { recursive: true, mode: 0o755 })
    const stat = fs.lstatSync(name)
    return { path: name, dev: stat.dev, ino: stat.ino }
  }
  const transactions = [], gates = []
  function transaction(id = 'txn-1', releaseId = 'old') {
    const candidate = binding(path.join(root, 'releases', releaseId))
    write(path.join(candidate.path, 'release.json'), { schemaVersion: 1, id: releaseId, sourceRevision: revision, createdAt: '2026-10-24T00:00:00Z' })
    write(path.join(candidate.path, 'payload'), 'payload')
    const row = {
      transactionId: id, candidate: { ...candidate, sourceRevision: revision },
      inputs: [binding(path.join(root, 'state/deployment-inputs', id))],
      backups: [binding(path.join(root, 'state/deployment-backups', id))], gatePaths: [],
      owner: { bootId, pid: 4242, startTime: '123' },
      disposition: 'abandoned', noPendingWork: true, closedAt: '2026-10-24T01:00:00Z',
    }
    seal(row)
    transactions.push(row)
    return row
  }
  function seal(row) {
    const { terminalEvidence, ...fields } = row
    const receipt = { schemaVersion: 1, kind: 'release-transaction-closeout', ...fields, final: true, pendingRecovery: false }
    const filename = terminalEvidence?.path ?? path.join(row.backups[0].path, 'closeout-receipt.json')
    const body = JSON.stringify(receipt)
    write(filename, body)
    row.terminalEvidence = { path: filename, sha256: hash(body) }
  }
  function gate(row) {
    const filename = path.join(root, 'state/update.lock')
    write(filename, '4242\n')
    const s = fs.lstatSync(filename)
    gates.push({ transactionId: row.transactionId, path: filename, dev: s.dev, ino: s.ino, sha256: hash('4242\n'), owner: row.owner })
    row.gatePaths.push(filename)
    seal(row)
    return filename
  }
  const indexPath = path.join(root, 'state/release-control/reconciliation.json')
  const save = () => write(indexPath, { schemaVersion: 1, kind: 'release-reconciliation-index', processView, transactions, gates })
  const collect = (options = {}) => collectReleaseInventory({ root, procRoot, unitReferences: { complete: true, references: [] }, ...options })
  return { root, procRoot, write, binding, transaction, transactions, gates, indexPath, save, collect, seal, gate, processView }
}

test('Given verified transaction closeout When legacy backups remain Then their existence no longer blocks every release', t => {
  const f = fixture(t); f.transaction(); f.save()
  const result = f.collect()
  assert.equal(result.complete, true, JSON.stringify({ uncertainties: result.uncertainties, closeouts: result.closeouts }))
  assert.equal(result.closeouts.complete, true)
  assert.equal(result.closeouts.transactions[0].disposition, 'abandoned')
  assert.ok(result.backupRoots.includes(path.join(f.root, 'state/deployment-backups')))
  assert.equal(result.protections.some(p => p.reason === 'legacy-recovery-unresolved'), false)
})

test('Given closed transactions When one owns multiple backups and another has no inputs Then every retained directory is covered', t => {
  const f = fixture(t), first = f.transaction('txn-a', 'a'), second = f.transaction('txn-b', 'b')
  first.backups.push(f.binding(path.join(f.root, 'state/deployment-backups/recovery-extra')))
  fs.rmdirSync(second.inputs[0].path); second.inputs = []
  f.seal(first); f.seal(second); f.save()
  assert.equal(f.collect().closeouts.complete, true)
})

test('Given a complete closeout and an explicitly bound idle gate When observed Then the gate stays on disk with verified idle metadata', t => {
  const f = fixture(t), row = f.transaction(), filename = f.gate(row); f.save()
  const r = f.collect()
  assert.equal(r.complete, true, JSON.stringify(r.closeouts))
  assert.equal(r.closeouts.complete, true)
  assert.deepEqual(r.locks.map(({ status, reconciled, recoveryPinned }) => ({ status, reconciled, recoveryPinned })), [{ status: 'idle', reconciled: true, recoveryPinned: false }])
  assert.equal(fs.readFileSync(filename, 'utf8'), '4242\n')
})

test('Given an index bound to another PID namespace When root sees a filtered empty lock table Then it cannot certify the gate idle', t => {
  const f = fixture(t), row = f.transaction(); f.gate(row)
  f.processView.pidNamespace = 'pid:[9999]'
  f.save(); const r = f.collect()
  assertBlocked(r)
  assert.ok(r.closeouts.unresolved.some(value => value.reason === 'closeout-process-view-mismatch'))
})

test('Given an old index without a process view When root could be inside a filtered PID namespace Then owner absence cannot certify idle', t => {
  const f = fixture(t), row = f.transaction(); f.gate(row); f.save()
  const index = JSON.parse(fs.readFileSync(f.indexPath)); delete index.processView
  f.write(f.indexPath, index)
  assertBlocked(f.collect())
})

function assertBlocked(result) {
  assert.equal(result.complete, false)
  assert.equal(result.closeouts.complete, false)
  assert.ok(result.protections.some(p => p.reason === 'incomplete-observation'))
  for (const lock of result.locks) assert.equal(lock.reconciled, false)
}

test('Given a clean runtime without transactions or gates When collected and planned Then no synthetic recovery blocker is introduced', t => {
  const f = fixture(t), r = f.collect()
  assert.equal(r.complete, true)
  assert.equal(r.closeouts.complete, true)
  const plan = planRelease({ inventory: r, policy: { reserveBytes: 0, reserveInodes: 0 } })
  assert.equal(plan.gc.decision, 'planned')
})

test('Given nonempty legacy directories When no index exists Then no failed receipt alone closes a transaction', t => {
  const f = fixture(t); f.transaction()
  assertBlocked(f.collect())
})

for (const mutation of ['unknown-field', 'no-pending-false', 'failed-disposition', 'future-closeout', 'wrong-candidate-inode', 'wrong-revision', 'duplicate-transaction', 'partial-coverage', 'empty-transactions']) {
  test(`Given ${mutation} When recognizing closeout Then reclamation remains blocked`, t => {
    const f = fixture(t), row = f.transaction()
    if (mutation === 'unknown-field') row.privateBody = 'NEVER-EXPORTED'
    if (mutation === 'no-pending-false') row.noPendingWork = false
    if (mutation === 'failed-disposition') row.disposition = 'failed'
    if (mutation === 'future-closeout') row.closedAt = '2999-01-01T00:00:00Z'
    if (mutation === 'wrong-candidate-inode') row.candidate.ino++
    if (mutation === 'wrong-revision') row.candidate.sourceRevision = 'b'.repeat(40)
    if (mutation === 'duplicate-transaction') f.transactions.push(row)
    if (mutation === 'partial-coverage') f.binding(path.join(f.root, 'state/deployment-backups/uncovered'))
    if (mutation === 'empty-transactions') f.transactions.length = 0
    f.save()
    const result = f.collect(); assertBlocked(result)
    assert.doesNotMatch(JSON.stringify(result), /NEVER-EXPORTED/)
  })
}

for (const mutation of ['failed-receipt', 'missing-receipt', 'wrong-hash', 'pending-recovery', 'external-receipt', 'symlink-receipt', 'receipt-extra-field']) {
  test(`Given ${mutation} When reading terminal evidence Then it never substitutes for an approved closeout`, t => {
    const f = fixture(t), row = f.transaction(), filename = row.terminalEvidence.path
    const receipt = JSON.parse(fs.readFileSync(filename))
    if (mutation === 'failed-receipt') receipt.kind = 'failed-deployment'
    if (mutation === 'pending-recovery') receipt.pendingRecovery = true
    if (mutation === 'receipt-extra-field') receipt.privateBody = 'NEVER-EXPORTED'
    if (['failed-receipt', 'pending-recovery', 'receipt-extra-field'].includes(mutation)) { const body = JSON.stringify(receipt); f.write(filename, body); row.terminalEvidence.sha256 = hash(body) }
    if (mutation === 'missing-receipt') fs.unlinkSync(filename)
    if (mutation === 'wrong-hash') row.terminalEvidence.sha256 = '0'.repeat(64)
    if (mutation === 'external-receipt') { row.terminalEvidence.path = path.join(f.root, 'private.env'); f.write(row.terminalEvidence.path, 'NEVER-EXPORTED') }
    if (mutation === 'symlink-receipt') { fs.renameSync(filename, filename + '.saved'); fs.symlinkSync(filename + '.saved', filename) }
    f.save()
    const result = f.collect(); assertBlocked(result)
    assert.doesNotMatch(JSON.stringify(result), /NEVER-EXPORTED/)
  })
}

test('Given unprivileged ownership When valid-looking receipts are read Then administrative trust is refused', t => {
  const f = fixture(t); f.transaction(); f.save()
  const original = fs.lstatSync
  t.mock.method(fs, 'lstatSync', (filename, ...args) => {
    const s = original(filename, ...args)
    return filename === f.indexPath ? Object.defineProperty(Object.create(s), 'uid', { value: 501 }) : s
  })
  assertBlocked(f.collect())
})

test('Given a writable control ancestor When receipts appear root owned Then the index is untrusted', t => {
  const f = fixture(t); f.transaction(); f.save()
  const original = fs.lstatSync
  t.mock.method(fs, 'lstatSync', (filename, ...args) => {
    const s = original(filename, ...args)
    return filename === path.dirname(f.indexPath) ? Object.defineProperty(Object.create(s), 'mode', { value: s.mode | 0o020 }) : s
  })
  assertBlocked(f.collect())
})

test('Given a live matching boot PID and start time When a closeout claims completion Then owner liveness blocks it', t => {
  const f = fixture(t); f.transaction(); f.save()
  const base = path.join(f.procRoot, '4242')
  f.write(path.join(base, 'stat'), `4242 (writer) S ${Array(18).fill('0').join(' ')} 123 0\n`)
  assertBlocked(f.collect())
})

test('Given a reused PID When its kernel start time differs Then old-owner exit is distinguished without signaling it', t => {
  const f = fixture(t); f.transaction(); f.save()
  const base = path.join(f.procRoot, '4242')
  // A zombie with a new identity needs no exe/fd/maps scan, but is not the old transaction owner.
  f.write(path.join(base, 'stat'), `4242 (replacement) Z ${Array(18).fill('0').join(' ')} 456 0\n`)
  fs.mkdirSync(path.join(base, 'task/4242'), { recursive: true })
  assert.equal(f.collect().closeouts.complete, true)
})

for (const mutation of ['missing-lock-table', 'malformed-lock-table', 'uncovered-gate', 'unbound-transaction-gate', 'wrong-gate-owner', 'wrong-gate-inode', 'changed-gate-content']) {
  test(`Given ${mutation} When a dead owner is observed Then its gate is not assumed idle`, t => {
    const f = fixture(t), row = f.transaction(), filename = f.gate(row)
    if (mutation === 'missing-lock-table') fs.unlinkSync(path.join(f.procRoot, 'locks'))
    if (mutation === 'malformed-lock-table') f.write(path.join(f.procRoot, 'locks'), 'NOT-KERNEL-LOCKS')
    if (mutation === 'uncovered-gate') f.gates.length = 0
    if (mutation === 'unbound-transaction-gate') f.gates[0].transactionId = 'unknown'
    if (mutation === 'wrong-gate-owner') f.gates[0].owner = { ...row.owner, pid: 9999 }
    if (mutation === 'wrong-gate-inode') f.gates[0].ino++
    if (mutation === 'changed-gate-content') f.write(filename, 'replacement\n')
    f.save(); assertBlocked(f.collect())
    assert.ok(fs.existsSync(filename))
  })
}

test('Given a kernel FLOCK holder When its recorded owner is gone Then the actual holder still blocks reconciliation', t => {
  const f = fixture(t), row = f.transaction(), filename = f.gate(row), stat = fs.lstatSync(filename)
  const dev = BigInt(stat.dev), major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n), minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n)
  f.write(path.join(f.procRoot, 'locks'), `1: FLOCK ADVISORY WRITE 9999 ${major.toString(16)}:${minor.toString(16)}:${stat.ino} 0 EOF\n`)
  f.save(); const r = f.collect(); assertBlocked(r)
  assert.equal(r.locks[0].status, 'active')
})

for (const mutation of ['index-replaced', 'receipt-replaced', 'new-backup', 'new-gate', 'lock-table-changed']) {
  test(`Given ${mutation} during observation When the snapshot is revalidated Then previous closeout decisions are revoked`, t => {
    const f = fixture(t), row = f.transaction(); f.save()
    const originalOpen = fs.openSync; let changed = false, lockReads = 0
    t.mock.method(fs, 'openSync', (filename, ...args) => {
      const fd = originalOpen(filename, ...args)
      if (filename === path.join(f.procRoot, 'locks')) lockReads++
      if (!changed && filename === path.join(f.procRoot, 'locks') && (mutation !== 'lock-table-changed' || lockReads === 2)) {
        changed = true
        if (mutation === 'index-replaced') { fs.renameSync(f.indexPath, f.indexPath + '.saved'); f.save() }
        if (mutation === 'receipt-replaced') { fs.renameSync(row.terminalEvidence.path, row.terminalEvidence.path + '.saved'); f.seal(row) }
        if (mutation === 'new-backup') f.binding(path.join(f.root, 'state/deployment-backups/new-transaction'))
        if (mutation === 'new-gate') f.write(path.join(f.root, 'state/update.lock'), '4242\n')
        if (mutation === 'lock-table-changed') f.write(path.join(f.procRoot, 'locks'), '1: FLOCK ADVISORY WRITE 1 00:01:9 0 EOF\n')
      }
      return fd
    })
    assertBlocked(f.collect())
  })
}

test('Given a manual recovery pin on an idle gate When all transactions are closed Then the pin cannot be overridden', t => {
  const f = fixture(t), row = f.transaction(), filename = f.gate(row)
  f.write(path.join(f.root, 'state/release-control/pins.json'), { schemaVersion: 1, pins: [{ path: filename, reason: 'recovery still retained' }] })
  f.save(); const r = f.collect(); assertBlocked(r)
  assert.equal(r.locks[0].recoveryPinned, true)
})

test('Given a manual pin on a gate ancestor When transactions close Then the retained gate is not certified idle', t => {
  const f = fixture(t), row = f.transaction(); f.gate(row)
  f.write(path.join(f.root, 'state/release-control/pins.json'), { schemaVersion: 1, pins: [{ path: path.join(f.root, 'state'), reason: 'retained recovery scope' }] })
  f.save(); assertBlocked(f.collect())
})

for (const scope of ['state/release-control/backups', 'staging', 'state/human-updates-backup']) {
  test(`Given a retained link in ${scope} When its transaction closes Then the linked candidate is not reclaimable`, t => {
    const f = fixture(t), row = f.transaction()
    const backup = f.binding(path.join(f.root, scope))
    fs.symlinkSync(row.candidate.path, path.join(backup.path, 'retained'))
    f.save(); const r = f.collect()
    const plan = planRelease({ inventory: r, policy: { reserveBytes: 0, reserveInodes: 0 } })
    assert.equal(plan.gc.candidates.length, 0)
    assert.ok(r.backupRoots.includes(backup.path))
  })
}

test('Given a backup link through an external alias When the alias changes during collection Then stale target references cannot authorize GC', t => {
  const f = fixture(t), first = f.transaction('first', 'a'), second = f.transaction('second', 'b')
  const alias = path.join(path.dirname(f.root), 'alias')
  fs.symlinkSync(first.candidate.path, alias)
  fs.symlinkSync(alias, path.join(first.backups[0].path, 'retained'))
  f.seal(first); f.seal(second); f.save()
  const original = fs.openSync; let changed = false
  t.mock.method(fs, 'openSync', (filename, ...args) => {
    if (!changed && filename === path.join(f.procRoot, 'locks')) { changed = true; fs.unlinkSync(alias); fs.symlinkSync(second.candidate.path, alias) }
    return original(filename, ...args)
  })
  assertBlocked(f.collect())
})

test('Given a backup link containing symlink then parent traversal When resolving references Then kernel path order protects the actual release', t => {
  const f = fixture(t), row = f.transaction(), parent = path.dirname(f.root)
  fs.mkdirSync(path.join(row.candidate.path, 'subdir'))
  fs.symlinkSync(path.join(row.candidate.path, 'subdir'), path.join(parent, 'pivot'))
  f.write(path.join(parent, 'payload'), 'unrelated lexical target')
  const retained = path.join(row.backups[0].path, 'retained')
  fs.symlinkSync(parent + '/pivot/../payload', retained)
  assert.equal(fs.statSync(retained).ino, fs.statSync(path.join(row.candidate.path, 'payload')).ino)
  f.seal(row); f.save(); const r = f.collect()
  assert.equal(planRelease({ inventory: r, policy: { reserveBytes: 0, reserveInodes: 0 } }).gc.candidates.length, 0)
})

test('Given closeout recognition When current previous process and manual pins protect a candidate Then all those protections survive', t => {
  const f = fixture(t), row = f.transaction(), candidate = row.candidate.path
  for (const name of ['current', 'previous']) fs.symlinkSync(candidate, path.join(f.root, name))
  f.write(path.join(f.root, 'state/release-control/pins.json'), { schemaVersion: 1, pins: [{ path: candidate, reason: 'recovery candidate' }] })
  const base = path.join(f.procRoot, '77')
  f.write(path.join(base, 'stat'), `77 (consumer) S ${Array(18).fill('0').join(' ')} 456 0\n`)
  fs.symlinkSync(candidate, path.join(base, 'cwd')); fs.symlinkSync(path.join(candidate, 'payload'), path.join(base, 'exe'))
  fs.symlinkSync('/', path.join(base, 'root'))
  fs.mkdirSync(path.join(base, 'task/77'), { recursive: true })
  fs.mkdirSync(path.join(base, 'ns'))
  fs.symlinkSync('mnt:[1]', path.join(base, 'ns/mnt'))
  f.write(path.join(base, 'mountinfo'), '1 0 0:0 / / rw - fixture fixture rw\n')
  fs.mkdirSync(path.join(base, 'fd')); fs.symlinkSync(path.join(candidate, 'payload'), path.join(base, 'fd/0'))
  f.write(path.join(base, 'maps'), '')
  f.save(); const r = f.collect()
  assert.equal(r.complete, true)
  assert.equal(r.closeouts.complete, true)
  const plan = planRelease({ inventory: r, policy: { reserveBytes: 0, reserveInodes: 0 } })
  assert.equal(plan.gc.candidates.length, 0)
  assert.deepEqual(plan.gc.protected.find(p => p.path === candidate).reasons.sort(), ['current', 'previous', 'protection:explicit-pin', 'reference:process'].sort())
})

test('Given an independent preparing lease When a historical transaction closes Then the lease still protects its candidate', t => {
  const f = fixture(t), row = f.transaction()
  const claim = { filesystemId: `dev:${row.candidate.dev}`, bytes: 1, inodes: 1 }
  f.write(path.join(f.root, 'state/release-control/ledger.json'), { schemaVersion: 1, revision: 1, reservations: [{ id: 'lease', requestId: 'new-work', candidatePath: row.candidate.path, owner: row.owner, state: 'preparing', claims: [claim] }] })
  f.save(); const r = f.collect()
  assert.equal(r.closeouts.complete, true)
  const plan = planRelease({ inventory: r, policy: { reserveBytes: 0, reserveInodes: 0 } })
  assert.equal(plan.gc.candidates.length, 0)
  assert.ok(plan.gc.protected[0].reasons.includes('reservation:preparing'))
})

test('Given a preserved backup symlink When its transaction closes Then the linked release remains protected', t => {
  const f = fixture(t), row = f.transaction()
  fs.symlinkSync(path.join(row.candidate.path, 'payload'), path.join(row.backups[0].path, 'preserved-artifact'))
  f.seal(row); f.save(); const r = f.collect()
  assert.equal(r.closeouts.complete, true)
  const plan = planRelease({ inventory: r, policy: { reserveBytes: 0, reserveInodes: 0 } })
  assert.equal(plan.gc.candidates.length, 0)
  assert.ok(plan.gc.protected[0].reasons.includes('reference:backup'))
})

test('Given retry evidence newer than the terminal receipt When the old closeout is reused Then it is stale', t => {
  const f = fixture(t), row = f.transaction()
  f.write(path.join(row.inputs[0].path, 'retry.json'), { status: 'preparing' })
  const later = new Date(Date.now() + 10000)
  fs.utimesSync(path.join(row.inputs[0].path, 'retry.json'), later, later)
  f.save(); assertBlocked(f.collect())
})

test('Given an observation permission error When checking owner identity Then it stays unknown without disclosing its message', t => {
  const f = fixture(t); f.transaction(); f.save()
  const original = fs.openSync
  t.mock.method(fs, 'openSync', (filename, ...args) => {
    if (filename === path.join(f.procRoot, 'sys/kernel/random/boot_id')) { const e = Error('PRIVATE-ERROR-BODY'); e.code = 'EACCES'; throw e }
    return original(filename, ...args)
  })
  const r = f.collect(); assertBlocked(r)
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE-ERROR-BODY/)
})

test('Given an unprivileged collector When trusted records appear valid Then incomplete PID visibility cannot prove owner exit', t => {
  const f = fixture(t); f.transaction(); f.save()
  t.mock.method(process, 'getuid', () => 501)
  assertBlocked(f.collect())
})

test('Given a complete fresh external backup attestation When collected Then its roots and release references remain protected', t => {
  const f = fixture(t), row = f.transaction(); f.save()
  const external = path.join(path.dirname(f.root), 'external-archive')
  const r = f.collect({ backupReferences: { schemaVersion: 1, complete: true, observedAt: new Date().toISOString(), roots: [external], references: [{ path: row.candidate.path, kind: 'backup' }] } })
  assert.equal(r.complete, true)
  assert.ok(r.backupRoots.includes(external))
  assert.ok(r.references.some(ref => ref.path === row.candidate.path && ref.kind === 'backup'))
  assert.equal(planRelease({ inventory: r, policy: { reserveBytes: 0, reserveInodes: 0 } }).gc.candidates.length, 0)
})

for (const mutation of ['incomplete', 'stale', 'future', 'relative-root', 'duplicate-root', 'unknown-body', 'invalid-reference']) {
  test(`Given an ${mutation} external backup attestation When collected Then it is never treated as complete`, t => {
    const f = fixture(t); f.transaction(); f.save()
    const value = { schemaVersion: 1, complete: true, observedAt: new Date().toISOString(), roots: ['/external-archive'], references: [] }
    if (mutation === 'incomplete') value.complete = false
    if (mutation === 'stale') value.observedAt = new Date(Date.now() - 60001).toISOString()
    if (mutation === 'future') value.observedAt = new Date(Date.now() + 10000).toISOString()
    if (mutation === 'relative-root') value.roots = ['relative']
    if (mutation === 'duplicate-root') value.roots = ['/external-archive', '/external-archive']
    if (mutation === 'unknown-body') value.privateBody = 'NEVER-EXPORT-BACKUP-BODY'
    if (mutation === 'invalid-reference') value.references = [{ path: '/x', kind: 'arbitrary' }]
    const r = f.collect({ backupReferences: value })
    assert.equal(r.complete, false)
    assert.ok(r.uncertainties.includes('backup-coverage-incomplete'))
    assert.doesNotMatch(JSON.stringify(r), /NEVER-EXPORT-BACKUP-BODY/)
  })
}

test('Given the standard CM5 root When external backup scope coverage is absent Then planning remains blocked', t => {
  const f = fixture(t)
  // Redirect all root-path filesystem operations to this disposable fixture.
  for (const name of ['lstatSync', 'statfsSync', 'opendirSync', 'openSync', 'readlinkSync', 'realpathSync']) {
    const original = fs[name]
    t.mock.method(fs, name, (file, ...args) => original(typeof file === 'string' && (file === '/opt/odk' || file.startsWith('/opt/odk/')) ? f.root + file.slice('/opt/odk'.length) : file, ...args))
  }
  const missing = f.collect({ root: '/opt/odk' })
  assert.equal(missing.complete, false)
  assert.ok(missing.uncertainties.includes('backup-coverage-incomplete'))
  const complete = f.collect({ root: '/opt/odk', backupReferences: { schemaVersion: 1, complete: true, observedAt: new Date().toISOString(), roots: ['/var/backups', '/var/lib/odk-firmware-backups', '/mnt/ssd/odk-system-disk-archive'], references: [] } })
  assert.equal(complete.complete, true, JSON.stringify(complete.uncertainties))
})

test('Given a changed process namespace during collection When receipts are revalidated Then previously idle gates become unknown', t => {
  const f = fixture(t), row = f.transaction(); f.gate(row); f.save()
  const original = fs.openSync; let changed = false
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (!changed && file === path.join(f.procRoot, 'locks')) {
      changed = true
      for (const pid of ['self', '1']) { const filename = path.join(f.procRoot, pid, 'ns/pid'); fs.unlinkSync(filename); fs.symlinkSync('pid:[9999]', filename) }
    }
    return original(file, ...args)
  })
  assertBlocked(f.collect())
})

test('Given a real Linux flock holder When its private fixture gate is observed Then active is blocked until that test owner exits', { skip: process.platform !== 'linux', timeout: 20000 }, async t => {
  if (spawnSync('flock', ['--version'], { encoding: 'utf8' }).status !== 0) { t.skip('util-linux flock is unavailable'); return }
  const f = fixture(t), row = f.transaction(), filename = f.gate(row)
  // Match the actual Linux boot while proving that this transaction's old owner no longer exists.
  row.owner.bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
  row.owner.pid = process.pid
  row.owner.startTime = '0'
  f.processView.bootId = row.owner.bootId
  f.processView.pidNamespace = fs.readlinkSync('/proc/self/ns/pid')
  f.processView.mountNamespace = fs.readlinkSync('/proc/self/ns/mnt')
  f.seal(row); f.save()
  const observe = () => observeReleaseCloseouts({ root: f.root, procRoot: '/proc', observedAt: Date.now(),
    releases: [{ path: row.candidate.path, metadataValid: true, complete: true }], maxEntries: 10000,
    io: {
      tick() {},
      read: file => fs.readFileSync(file, 'utf8'),
      list: directory => fs.readdirSync(directory).sort(),
      optionalStat(file) { try { return fs.lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error } },
      readlink: file => fs.readlinkSync(file),
      reference() { throw Error('Unexpected symlink in Linux lock fixture') },
    },
  })
  // --no-fork replaces flock with this test's Node child; no unrelated process is signaled.
  const holder = spawn('flock', ['--no-fork', '--exclusive', filename, process.execPath, '-e', "process.stdout.write('held'); process.stdin.resume()"], { stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = once(holder, 'exit')
  t.after(() => { holder.stdin.destroy(); if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGTERM') })
  await Promise.race([once(holder.stdout, 'data'), once(holder, 'error').then(([error]) => { throw error })])
  const active = observe()
  assert.equal(active.result.complete, false)
  assert.equal(active.gateObservations.get(filename)?.status, 'active')
  assert.ok(active.result.unresolved.some(item => item.reason === 'closeout-gate-active'))
  holder.stdin.end()
  const [code, signal] = await exited
  assert.equal(code, 0)
  assert.equal(signal, null)
  const idle = observe()
  assert.equal(idle.result.complete, true, JSON.stringify(idle.result))
  assert.deepEqual(idle.gateObservations.get(filename), { status: 'idle', reconciled: true })
  assert.equal(idle.revalidate(), true)
  assert.equal(fs.readFileSync(filename, 'utf8'), '4242\n')
  assert.ok(fs.existsSync(row.terminalEvidence.path))
})
