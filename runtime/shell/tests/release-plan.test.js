const test = require('node:test')
const assert = require('node:assert/strict')
const { planRelease } = require('../scripts/lib/release-plan')
const NOW = 100000
const owner = { bootId: 'boot-1', pid: 123, startTime: '456' }
const claims = (bytes = 50, inodes = 3, filesystemId = 'root') => [{ filesystemId, bytes, inodes }]
const request = (extra = {}) => ({ requestId: 'new-request', candidatePath: '/opt/odk/releases/new', owner, claims: claims(), ...extra })
const release = (id, ino) => ({ id, path: '/opt/odk/releases/' + id, identity: { dev: 1, ino }, allocatedBytes: 100, reclaimableBytes: 90, metadataValid: true, complete: true })
function inventory() {
  return { schemaVersion: 1, root: '/opt/odk', observedAt: NOW, complete: true, uncertainties: [],
    filesystems: [{ id: 'root', availableBytes: 1000, availableInodes: 100, complete: true }],
    releases: [release('a', 11), release('b', 12), release('c', 13)], pointers: { current: '/opt/odk/releases/a', previous: null },
    references: [], protections: [], locks: [], backupRoots: ['/opt/odk/state/backups'],
    ledger: { schemaVersion: 1, revision: 0, reservations: [] } }
}
const plan = (input, next = null, policy = {}) => planRelease({ inventory: input, request: next, policy: { reserveBytes: 10, reserveInodes: 2, ...policy }, now: NOW })
const blocked = result => { assert.equal(result.admission.decision, 'deny'); assert.equal(result.gc.decision, 'blocked'); assert.deepEqual(result.gc.candidates, []) }

test('Given a complete snapshot When planning Then results are dry-run only and input is unchanged', () => {
  const input = inventory(), before = structuredClone(input)
  const result = plan(input, request())
  assert.equal(result.schemaVersion, 1); assert.equal(result.dryRun, true); assert.equal(result.executionAvailable, false)
  assert.equal(result.admission.decision, 'admit'); assert.equal(result.gc.decision, 'planned')
  assert.deepEqual(result.gc.candidates.map(x => x.id), ['b', 'c'])
  assert.deepEqual(input, before)
  assert.equal(plan(input).admission.decision, 'not_requested')
})
test('Given process file references and backups When planning Then their containing release stays protected', () => {
  const input = inventory()
  input.references.push({ path: '/opt/odk/releases/b/src/main.js', kind: 'service' })
  input.backupRoots.push('/opt/odk/releases/c/private-backup')
  const result = plan(input)
  assert.deepEqual(result.gc.candidates, [])
  assert.deepEqual(result.gc.protected.map(x => x.id), ['a', 'b', 'c'])
})
test('Given a preparing reservation When planning a concurrent request Then claims count before the reserve without GC credit', () => {
  const input = inventory()
  input.ledger.reservations.push({ id: 'lease-1', requestId: 'prior', candidatePath: '/opt/odk/releases/b', owner, state: 'preparing', claims: claims(950, 98) })
  const result = plan(input, request())
  assert.equal(result.admission.decision, 'deny')
  assert.equal(result.admission.filesystems[0].reservedBytes, 950)
  assert.equal(result.admission.filesystems[0].reservedInodes, 98)
  assert.ok(result.gc.protected.find(x => x.id === 'b'))
  assert.equal(result.gc.candidates.some(x => x.id === 'b'), false)
})
test('Given recovery records or a retained lock When planning Then neither admission nor reclamation proceeds', () => {
  for (const mode of ['lock', 'recovering', 'interrupted', 'protection']) {
    const input = inventory()
    if (mode === 'lock') input.locks.push({ path: '/opt/odk/state/update.lock', identity: { dev: 1, ino: 20 }, recoveryPinned: true })
    else if (mode === 'protection') input.protections.push({ path: '/opt/odk/releases/b', reason: 'legacy recovery unknown' })
    else input.ledger.reservations.push({ id: 'lease-1', requestId: 'prior', candidatePath: '/opt/odk/releases/b', owner, state: mode, claims: claims() })
    const result = plan(input, request()); blocked(result); assert.equal(result.recovery.required, true)
  }
})
function reconciled(input = inventory()) {
  input.closeouts = { schemaVersion: 1, complete: true, transactions: [
    { transactionId: 'old-stage', candidatePath: '/opt/odk/releases/b', disposition: 'abandoned', closedAt: new Date(NOW - 1).toISOString() },
  ], unresolved: [] }
  input.locks.push({ path: '/opt/odk/state/update.lock', identity: { dev: 1, ino: 20 },
    recoveryPinned: false, status: 'idle', reconciled: true })
  return input
}
test('Given complete closeout and an observed idle gate When planning Then the gate stays visible without blocking', () => {
  const input = reconciled(), before = structuredClone(input)
  const result = plan(input, request())
  assert.equal(result.admission.decision, 'admit')
  assert.equal(result.gc.decision, 'planned')
  assert.deepEqual(result.gc.candidates.map(x => x.id), ['b', 'c'])
  assert.equal(result.recovery.required, false)
  assert.equal(result.recovery.locks[0].status, 'idle')
  assert.equal(result.recovery.locks[0].reconciled, true)
  assert.deepEqual(input, before)
})
test('Given incomplete inconsistent or malformed closeout observations When planning Then an idle label never authorizes reclamation', () => {
  const mutations = [
    x => { delete x.closeouts },
    x => { x.closeouts.complete = false },
    x => { x.closeouts.unresolved.push({ transactionId: 'pending', reason: 'unknown' }) },
    x => { x.closeouts.schemaVersion = 99 },
    x => { x.closeouts.transactions[0].candidatePath = '/outside/releases/b' },
    x => { x.closeouts.transactions[0].closedAt = NOW + 1 },
    x => { x.closeouts.transactions[0].disposition = 'failed-or-unknown' },
    x => { x.closeouts.transactions.push({ ...x.closeouts.transactions[0] }) },
    x => { x.locks[0].reconciled = false },
    x => { x.locks[0].recoveryPinned = true },
    x => { x.locks[0].status = 'active' },
    x => { x.locks[0].status = 'unknown' },
    x => { delete x.locks[0].status },
    x => { x.locks[0].path = '/outside/update.lock' },
  ]
  for (const change of mutations) {
    const input = reconciled(); change(input); blocked(plan(input, request()))
  }
})
test('Given closed history When an independent owner still protects the same release Then closeout cannot override it', () => {
  for (const mode of ['previous', 'process', 'unit', 'pin', 'backup', 'lease', 'recovery']) {
    const input = reconciled()
    if (mode === 'previous') input.pointers.previous = '/opt/odk/releases/b'
    if (mode === 'process' || mode === 'unit') input.references.push({ path: '/opt/odk/releases/b/src/main.js', kind: mode })
    if (mode === 'pin') input.protections.push({ path: '/opt/odk/releases/b', reason: 'manual preservation' })
    if (mode === 'backup') input.backupRoots.push('/opt/odk/releases/b/retained-backup')
    if (mode === 'lease') input.ledger.reservations.push({ id: 'lease-1', requestId: 'prior', candidatePath: '/opt/odk/releases/b', owner, state: 'ready', claims: claims() })
    if (mode === 'recovery') input.protections.push({ path: '/opt/odk/releases/b', reason: 'another recovery transaction' })
    const result = plan(input)
    assert.ok(result.gc.protected.find(x => x.id === 'b'), mode)
    assert.equal(result.gc.candidates.some(x => x.id === 'b'), false, mode)
  }
})
test('Given a gate or ancestor pin When an idle gate is reported Then the planner still requires recovery', () => {
  for (const path of ['/opt/odk/state', '/opt/odk/state/update.lock', '/opt/odk/state/update.lock/retained']) {
    const input = reconciled()
    input.protections.push({ path, reason: 'explicit-pin' })
    const result = plan(input)
    blocked(result)
    assert.equal(result.recovery.required, true)
    assert.ok(result.recovery.reasons.includes('recovery_pinned_lock'))
  }
})
test('Given settled reservations When planning Then their validated historical claims do not consume capacity', () => {
  const input = inventory()
  input.ledger.reservations.push({ id: 'lease-1', requestId: 'prior', candidatePath: '/opt/odk/releases/b', owner, state: 'settled', claims: claims(999, 99) })
  assert.equal(plan(input, request()).admission.decision, 'admit')
  input.ledger.reservations[0].claims[0].bytes = -1
  blocked(plan(input, request()))
})
test('Given invalid or incomplete observations When planning Then fail closed with no candidates', () => {
  const changes = [
    x => { delete x.filesystems[0].availableInodes }, x => { x.filesystems[0].availableBytes = -1 },
    x => { x.filesystems[0].availableBytes = Infinity }, x => { x.filesystems[0].availableInodes = 1.5 },
    x => { x.filesystems.push({ ...x.filesystems[0] }) }, x => { x.releases[1].identity.ino = null },
    x => { x.releases[1].metadataValid = false }, x => { x.releases[1].complete = false },
    x => { x.releases[1].path = '/opt/other/b' }, x => { x.releases[1].path = '/opt/odk/releases/../b' },
    x => { x.releases.push({ ...x.releases[1] }) }, x => { x.complete = false },
    x => { x.uncertainties.push('unreadable process') }, x => { x.observedAt = NOW - 60001 },
    x => { x.observedAt = NOW + 1 }, x => { x.unitReferences = { complete: false, references: [] } },
    x => { delete x.backupRoots }, x => { x.pointers.current = '/opt/odk/releases/missing' },
  ]
  for (const change of changes) { const input = inventory(); change(input); blocked(plan(input, request())) }
  blocked(planRelease({ inventory: null }))
})
test('Given malformed requests and claims When planning Then negative missing duplicate and overflow claims are refused', () => {
  for (const next of [request({ candidatePath: '/opt/odk/releases-evil/new' }), request({ owner: {} }),
    request({ claims: [] }), request({ claims: claims(-1) }), request({ claims: [{ filesystemId: 'root', bytes: 1 }] }),
    request({ claims: claims(1, 1, 'unknown') }), request({ claims: [...claims(), ...claims()] })]) blocked(plan(inventory(), next))
  const input = inventory()
  for (let i = 0; i < 2; i++) input.ledger.reservations.push({ id: 'lease-' + i, requestId: 'prior-' + i, candidatePath: '/opt/odk/releases/lease-' + i, owner, state: 'preparing', claims: claims(Number.MAX_SAFE_INTEGER, 1) })
  blocked(plan(input, request()))
})
test('Given multiple storage pools When planning Then each pool satisfies both byte and inode reserves', () => {
  const input = inventory();input.filesystems.push({ id: 'other', availableBytes: 1000, availableInodes: 4, complete: true })
  assert.equal(plan(input, request({ claims: [...claims(), ...claims(1, 3, 'other')] })).admission.decision, 'deny')
  const result = plan(input, request({ claims: [...claims(), ...claims(1, 2, 'other')] }))
  assert.equal(result.admission.decision, 'admit'); assert.equal(result.admission.filesystems.length, 2)
})
test('Given a repeated request identity When its active claim is unchanged Then capacity is not charged twice', () => {
  const input = inventory(), next = request({ claims: claims(600, 60) })
  input.ledger.reservations.push({ id: 'lease-1', ...next, state: 'ready' })
  assert.equal(plan(input, next).admission.decision, 'admit')
  blocked(plan(input, request({ goal: 'ignored', claims: claims(601, 60) })))
})
test('Given an existing or protected candidate target When a new lease is requested Then publication is refused', () => {
  for (const mode of ['existing', 'unprotected', 'previous', 'reference', 'unit', 'backup', 'pin']) {
    const input = inventory(), next = request()
    if (mode === 'existing') next.candidatePath = '/opt/odk/releases/a'
    if (mode === 'unprotected') next.candidatePath = '/opt/odk/releases/c'
    if (mode === 'previous') { input.pointers.previous = '/opt/odk/releases/c'; next.candidatePath = input.pointers.previous }
    if (mode === 'reference') input.references.push({ path: next.candidatePath + '/src/main.js', kind: 'process' })
    if (mode === 'unit') input.unitReferences = { complete: true, references: [{ path: next.candidatePath, kind: 'unit' }] }
    if (mode === 'backup') input.backupRoots.push(next.candidatePath + '/retained')
    if (mode === 'pin') input.protections.push({ path: '/opt/odk/releases', reason: 'manual preservation' })
    blocked(plan(input, next))
  }
})
test('Given default policy When capacity exactly covers peak and reserves Then both bytes and inodes are admitted', () => {
  const input = inventory()
  input.filesystems[0].availableBytes = 6 * 1024 ** 3 + 50
  input.filesystems[0].availableInodes = 4096 + 3
  const result = planRelease({ inventory: input, request: request(), now: NOW })
  assert.equal(result.admission.decision, 'admit')
  assert.equal(result.admission.filesystems[0].remainingBytes, 0)
  assert.equal(result.admission.filesystems[0].remainingInodes, 0)
})
test('Given ISO time or strict age limits When snapshots are evaluated Then freshness is explicit', () => {
  const input = inventory(); input.observedAt = new Date(NOW).toISOString()
  assert.equal(plan(input, request(), { maxSnapshotAgeMs: 0 }).admission.decision, 'admit')
  blocked(planRelease({ inventory: input, request: request(), policy: { maxSnapshotAgeMs: 0 }, now: NOW + 1 }))
  blocked(plan(input, request(), { reserveBytes: -1 }))
})
test('Given a low-capacity but valid snapshot without a request Then no admission was requested', () => {
  const input = inventory(); input.filesystems[0].availableBytes = 0
  const result = plan(input)
  assert.equal(result.admission.decision, 'not_requested')
  assert.equal(result.gc.decision, 'planned')
})

test('Given a settled request identity When retried Then no released lease is readmitted', () => {
  const input = inventory(), next = request()
  input.ledger.reservations.push({ id: 'lease-1', ...next, state: 'settled' })
  blocked(plan(input, next))
})

test('Given an invalid clock value When planning Then validation denies without coercion', () => {
  blocked(planRelease({ inventory: inventory(), request: request(), now: Symbol('invalid') }))
})
