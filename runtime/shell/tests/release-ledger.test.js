const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { planRelease } = require('../scripts/lib/release-plan')
const {
  initializeFixtureLedger, inspectFixtureLedger, admitFixture, settleFixture, recoverFixture, fixtureOwner,
} = require('../scripts/lib/release-ledger')

const policy = { reserveBytes: 10, reserveInodes: 1, maxSnapshotAgeMs: 60000 }
function fixture() {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'odk-release-control-')))
  initializeFixtureLedger(directory)
  const inventory = {
    schemaVersion: 1, root: directory, observedAt: new Date().toISOString(), complete: true, uncertainties: [],
    filesystems: [{ id: 'disk', availableBytes: 100, availableInodes: 100, complete: true }],
    releases: [], pointers: { current: null, previous: null }, references: [], protections: [], locks: [], backupRoots: [],
    ledger: { schemaVersion: 1, revision: 0, reservations: [] },
  }
  return { directory, inventory }
}
function request(directory, bytes = 60) {
  return { requestId: randomUUID(), candidatePath: path.join(directory, 'releases', randomUUID()), owner: fixtureOwner(), claims: [{ filesystemId: 'disk', bytes, inodes: 2 }] }
}
function child(directory, payload) {
  const worker = spawn(process.execPath, [path.join(__dirname, 'helpers/release-ledger-worker.cjs'), directory, JSON.stringify(payload)], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let output = '', error = ''
  worker.stdout.on('data', bytes => { output += bytes })
  worker.stderr.on('data', bytes => { error += bytes })
  const messages = []
  const waiters = []
  worker.on('message', message => {
    messages.push(message)
    for (const waiter of [...waiters]) if (waiter.predicate(message)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(message) }
  })
  const exited = new Promise(resolve => worker.on('exit', (code, signal) => resolve({ code, signal, output, error })))
  return { worker, exited, wait(predicate) {
    const found = messages.find(predicate)
    if (found) return Promise.resolve(found)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Fixture worker deadline exceeded: ' + error)), 10000)
      waiters.push({ predicate, resolve: message => { clearTimeout(timer); resolve(message) } })
    })
  } }
}

test('Given a production directory When fixture initialization is requested Then it refuses before writing', () => {
  assert.throws(() => initializeFixtureLedger('/opt/odk'), /fixture/)
})

test('Given two processes and capacity for one publication When both reserve Then only one commits', async () => {
  const { directory, inventory } = fixture()
  const payloads = [request(directory), request(directory)].map(value => ({ inventory, policy, request: value, expectedRevision: 0 }))
  const workers = payloads.map(payload => child(directory, payload))
  try {
    await Promise.all(workers.map(worker => worker.wait(message => message.ready)))
    workers.forEach(worker => worker.worker.send('go'))
    const outcomes = await Promise.all(workers.map(worker => worker.wait(message => message.result)))
    await Promise.all(workers.map(worker => worker.exited))
    assert.equal(outcomes.filter(outcome => outcome.result.ok).length, 1)
    const state = inspectFixtureLedger(directory)
    assert.equal(state.ledger.reservations.length, 1)
    assert.equal(state.ledger.reservations[0].claims[0].bytes, 60)
    const denied = await admitFixture({ directory, inventory, policy, request: request(directory), expectedRevision: state.ledger.revision })
    assert.equal(denied.ok, false)
    assert.equal(inspectFixtureLedger(directory).ledger.reservations.length, 1)
  } finally { workers.forEach(worker => worker.worker.kill()); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('Given one admitted request When its identity is repeated Then its reservation is not counted twice', async () => {
  const { directory, inventory } = fixture()
  try {
    const value = request(directory)
    const first = await admitFixture({ directory, inventory, policy, request: value, expectedRevision: 0 })
    assert.equal(first.ok, true)
    const repeated = await admitFixture({ directory, inventory, policy, request: value, expectedRevision: 0 })
    assert.equal(repeated.ok, true)
    assert.equal(repeated.duplicate, true)
    assert.equal(inspectFixtureLedger(directory).ledger.revision, 1)
    const conflicting = await admitFixture({ directory, inventory, policy, request: { ...value, claims: [{ filesystemId: 'disk', bytes: 1, inodes: 2 }] }, expectedRevision: 1 })
    assert.equal(conflicting.ok, false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

for (const checkpoint of ['locked', 'temp_fsynced', 'renamed', 'dir_fsynced']) {
  test(`Given admission stops at ${checkpoint} When explicit recovery runs Then uncertain capacity remains reserved`, async () => {
    const { directory, inventory } = fixture()
    const worker = child(directory, { inventory, policy, request: request(directory), expectedRevision: 0, pauseAt: checkpoint })
    try {
      await worker.wait(message => message.ready); worker.worker.send('go')
      await worker.wait(message => message.checkpoint === checkpoint)
      worker.worker.kill('SIGKILL'); assert.equal((await worker.exited).signal, 'SIGKILL')
      const before = inspectFixtureLedger(directory)
      assert.ok(before.lock)
      const blockedGc = planRelease({ inventory: { ...inventory, ledger: before.ledger, locks: [{ path: path.join(directory, 'transaction.lock'), identity: before.lock.identity, recoveryPinned: true }] }, policy })
      assert.equal(blockedGc.gc.decision, 'blocked')
      assert.deepEqual(blockedGc.gc.candidates, [])
      const blocked = await admitFixture({ directory, inventory, policy, request: request(directory), expectedRevision: before.ledger.revision })
      assert.equal(blocked.ok, false)
      const recovered = await recoverFixture({ directory, expectedLock: before.lock, expectedRevision: before.ledger.revision })
      assert.equal(recovered.ok, true)
      const after = inspectFixtureLedger(directory)
      assert.equal(after.lock, null)
      assert.equal(after.ledger.reservations.length, 1)
      assert.equal(after.ledger.reservations[0].state, 'interrupted')
      assert.equal(after.ledger.reservations[0].claims[0].bytes, 60)
      const denied = await admitFixture({ directory, inventory, policy, request: request(directory), expectedRevision: after.ledger.revision })
      assert.equal(denied.ok, false)
    } finally { worker.worker.kill(); fs.rmSync(directory, { recursive: true, force: true }) }
  })
}

test('Given a live owner When recovery is requested Then the lock cannot be reclaimed', async () => {
  const { directory, inventory } = fixture()
  const worker = child(directory, { inventory, policy, request: request(directory), expectedRevision: 0, pauseAt: 'locked' })
  try {
    await worker.wait(message => message.ready); worker.worker.send('go')
    await worker.wait(message => message.checkpoint === 'locked')
    const state = inspectFixtureLedger(directory)
    assert.equal((await recoverFixture({ directory, expectedLock: state.lock, expectedRevision: 0 })).ok, false)
    assert.ok(inspectFixtureLedger(directory).lock)
  } finally { worker.worker.kill('SIGKILL'); await worker.exited; fs.rmSync(directory, { recursive: true, force: true }) }
})

test('Given an admitted lease When settlement has the wrong revision or nonce Then its capacity stays protected', async () => {
  const { directory, inventory } = fixture()
  try {
    const original = request(directory)
    const admitted = await admitFixture({ directory, inventory, policy, request: original, expectedRevision: 0 })
    assert.equal(admitted.ok, true)
    assert.equal((await settleFixture({ directory, reservationId: admitted.reservation.id, expectedRevision: 0, nonce: admitted.reservation.nonce })).ok, false)
    assert.equal((await settleFixture({ directory, reservationId: admitted.reservation.id, expectedRevision: 1, nonce: 'wrong' })).ok, false)
    assert.equal(inspectFixtureLedger(directory).ledger.reservations[0].state, 'preparing')
    const settled = await settleFixture({ directory, reservationId: admitted.reservation.id, expectedRevision: 1, nonce: admitted.reservation.nonce, confirmation: 'confirmed_no_pending_work' })
    assert.equal(settled.ok, true)
    assert.equal(inspectFixtureLedger(directory).ledger.reservations[0].state, 'settled')
    const repeated = await admitFixture({ directory, inventory, policy, request: original, expectedRevision: 2 })
    assert.equal(repeated.ok, false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('Given a crashed committed reservation pin When recovery is requested Then both reservation and gate stay unchanged', async () => {
  const { directory, inventory } = fixture()
  const worker = child(directory, { inventory, policy, request: request(directory), expectedRevision: 0, pauseAt: 'renamed' })
  try {
    await worker.wait(message => message.ready); worker.worker.send('go')
    await worker.wait(message => message.checkpoint === 'renamed')
    worker.worker.kill('SIGKILL'); await worker.exited
    const before = inspectFixtureLedger(directory)
    fs.writeFileSync(path.join(directory, 'recovery-pins.json'), JSON.stringify({ schemaVersion: 1, lockNonces: [], reservationIds: [before.ledger.reservations[0].id] }), { mode: 0o600 })
    const recovered = await recoverFixture({ directory, expectedLock: before.lock, expectedRevision: before.ledger.revision })
    assert.equal(recovered.ok, false)
    assert.deepEqual(inspectFixtureLedger(directory).ledger, before.ledger)
    assert.deepEqual(inspectFixtureLedger(directory).lock, before.lock)
  } finally { worker.worker.kill(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('Given a stale lock observation When its inode is replaced Then recovery does not remove the replacement', async () => {
  const { directory, inventory } = fixture()
  const worker = child(directory, { inventory, policy, request: request(directory), expectedRevision: 0, pauseAt: 'locked' })
  try {
    await worker.wait(message => message.ready); worker.worker.send('go')
    await worker.wait(message => message.checkpoint === 'locked')
    worker.worker.kill('SIGKILL'); await worker.exited
    const before = inspectFixtureLedger(directory), filename = path.join(directory, 'transaction.lock')
    fs.renameSync(filename, path.join(directory, 'preserved-original.lock'))
    fs.writeFileSync(filename, JSON.stringify(before.lock.record), { mode: 0o600 })
    assert.equal((await recoverFixture({ directory, expectedLock: before.lock, expectedRevision: 0 })).ok, false)
    assert.ok(fs.existsSync(filename))
    assert.equal(inspectFixtureLedger(directory).ledger.revision, 0)
  } finally { worker.worker.kill(); fs.rmSync(directory, { recursive: true, force: true }) }
})

test('Given a lease naming an exited owner When its admission writer is alive Then recovery cannot take its gate', async () => {
  const { directory, inventory } = fixture()
  const exited = child(directory, { inventory, policy, request: request(directory), expectedRevision: 0, pauseAt: 'locked' })
  let worker
  try {
    await exited.wait(message => message.ready); exited.worker.kill('SIGKILL'); await exited.exited
    const value = request(directory)
    value.owner.pid = exited.worker.pid
    worker = child(directory, { inventory, policy, request: value, preserveLeaseOwner: true, expectedRevision: 0, pauseAt: 'locked' })
    await worker.wait(message => message.ready); worker.worker.send('go')
    await worker.wait(message => message.checkpoint === 'locked')
    const snapshot = inspectFixtureLedger(directory)
    assert.equal(snapshot.lock.record.owner.pid, worker.worker.pid)
    assert.notEqual(snapshot.lock.record.owner.pid, value.owner.pid)
    assert.equal((await recoverFixture({ directory, expectedLock: snapshot.lock, expectedRevision: 0 })).ok, false)
  } finally { if (worker) { worker.worker.kill('SIGKILL'); await worker.exited }; exited.worker.kill(); fs.rmSync(directory, { recursive: true, force: true }) }
})

for (const checkpoint of ['temp_fsynced', 'renamed']) {
  test(`Given settlement stops at ${checkpoint} When recovery runs Then capacity is retained as interrupted`, async () => {
    const { directory, inventory } = fixture()
    let worker
    try {
      const admitted = await admitFixture({ directory, inventory, policy, request: request(directory), expectedRevision: 0 })
      worker = child(directory, { operation: 'settle', reservationId: admitted.reservation.id, nonce: admitted.reservation.nonce, expectedRevision: 1, confirmation: 'confirmed_no_pending_work', pauseAt: checkpoint })
      await worker.wait(message => message.ready); worker.worker.send('go')
      await worker.wait(message => message.checkpoint === checkpoint)
      worker.worker.kill('SIGKILL'); await worker.exited
      const before = inspectFixtureLedger(directory)
      assert.equal((await recoverFixture({ directory, expectedLock: before.lock, expectedRevision: before.ledger.revision })).ok, true)
      const after = inspectFixtureLedger(directory)
      assert.equal(after.ledger.reservations[0].state, 'interrupted')
      assert.equal(after.ledger.reservations[0].claims[0].bytes, 60)
      assert.equal(after.lock, null)
    } finally { if (worker) worker.worker.kill(); fs.rmSync(directory, { recursive: true, force: true }) }
  })
}

test('Given a commit fails after rename When admission returns Then it reports uncertainty and preserves its gate', async () => {
  const { directory, inventory } = fixture()
  const worker = child(directory, { inventory, policy, request: request(directory), expectedRevision: 0, failAt: 'renamed' })
  try {
    await worker.wait(message => message.ready); worker.worker.send('go')
    const { result } = await worker.wait(message => message.result); await worker.exited
    assert.equal(result.ok, false)
    assert.equal(result.recoveryRequired, true)
    const before = inspectFixtureLedger(directory)
    assert.ok(before.lock)
    assert.equal(before.ledger.reservations.length, 1)
    assert.equal((await recoverFixture({ directory, expectedLock: before.lock, expectedRevision: before.ledger.revision })).ok, true)
    assert.equal(inspectFixtureLedger(directory).ledger.reservations[0].state, 'interrupted')
  } finally { worker.worker.kill(); fs.rmSync(directory, { recursive: true, force: true }) }
})
