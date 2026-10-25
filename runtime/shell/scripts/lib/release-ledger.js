const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash, randomUUID } = require('node:crypto')
const { planRelease } = require('./release-plan')

// This adapter exercises durable transactions only inside disposable test roots.
// The production planning CLI never imports it or exposes its mutation methods.
const LIMIT = 1024 * 1024
const START = randomUUID()
const FILES = { marker: 'fixture-only.json', ledger: 'ledger.json', lock: 'transaction.lock', recovery: 'recovery.lock', pins: 'recovery-pins.json' }
function failure(code) { const error = Error(code); error.code = code; return error }
function fixtureOwner() { return { bootId: 'fixture-only', pid: process.pid, startTime: START } }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
function digest(value) { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex') }
function integer(value) { return Number.isSafeInteger(value) && value >= 0 }
function ownerValid(owner) { return owner && typeof owner.bootId === 'string' && owner.bootId.length > 0 && Number.isSafeInteger(owner.pid) && owner.pid > 0 && ((typeof owner.startTime === 'string' && owner.startTime.length > 0) || integer(owner.startTime)) }
function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0))
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
function boundary(directory, marker = true) {
  const temporary = fs.realpathSync(os.tmpdir())
  const actual = fs.realpathSync(directory)
  const stat = fs.lstatSync(directory)
  if (stat.isSymbolicLink() || !stat.isDirectory() || !actual.startsWith(temporary + path.sep) || !path.basename(actual).startsWith('odk-release-control-') || (typeof process.getuid === 'function' && stat.uid !== process.getuid()) || (stat.mode & 0o077)) throw failure('fixture_boundary_required')
  if (marker) {
    const record = readJson(path.join(actual, FILES.marker))
    if (record.schemaVersion !== 1 || record.fixtureOnly !== true || record.directory !== actual || typeof record.nonce !== 'string') throw failure('fixture_marker_invalid')
  }
  return actual
}
function readDocument(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > LIMIT || (stat.mode & 0o077) || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) throw failure('fixture_file_invalid')
    const chunks = []
    let total = 0
    for (;;) {
      const chunk = Buffer.alloc(65536), size = fs.readSync(fd, chunk, 0, chunk.length, null)
      if (!size) break
      total += size
      if (total > LIMIT) throw failure('fixture_file_invalid')
      chunks.push(chunk.subarray(0, size))
    }
    const after = fs.fstatSync(fd), named = fs.lstatSync(filename)
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || named.dev !== stat.dev || named.ino !== stat.ino || named.isSymbolicLink()) throw failure('transaction_identity_changed')
    return { record: JSON.parse(Buffer.concat(chunks).toString('utf8')), identity: { dev: stat.dev, ino: stat.ino } }
  } finally { fs.closeSync(fd) }
}
function readJson(filename) { return readDocument(filename).record }
function writeNew(filename, record) {
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600)
  try {
    const serialized = JSON.stringify(record) + '\n'
    if (Buffer.byteLength(serialized) > LIMIT) throw failure('fixture_file_invalid')
    fs.writeFileSync(fd, serialized); fs.fsyncSync(fd)
    const stat = fs.fstatSync(fd)
    return { dev: stat.dev, ino: stat.ino }
  } finally { fs.closeSync(fd) }
}
function initializeFixtureLedger(directory) {
  let actual
  try { actual = boundary(directory, false) } catch { throw failure('fixture_boundary_required') }
  if (fs.readdirSync(actual).length) throw failure('fixture_directory_not_empty')
  writeNew(path.join(actual, FILES.marker), { schemaVersion: 1, fixtureOnly: true, directory: actual, nonce: randomUUID() })
  writeNew(path.join(actual, FILES.ledger), { schemaVersion: 1, revision: 0, reservations: [] })
  syncDirectory(actual)
}
function readLedger(directory) {
  const ledger = readJson(path.join(directory, FILES.ledger))
  if (ledger.schemaVersion !== 1 || !integer(ledger.revision) || !Array.isArray(ledger.reservations) || ledger.reservations.length > 1000) throw failure('ledger_invalid')
  const ids = new Set(), requests = new Set()
  for (const row of ledger.reservations) {
    if (!row || typeof row.id !== 'string' || typeof row.requestId !== 'string' || typeof row.nonce !== 'string' || ids.has(row.id) || requests.has(row.requestId) || !['preparing', 'ready', 'recovering', 'interrupted', 'settled'].includes(row.state) || !ownerValid(row.owner) || !Array.isArray(row.claims) || !row.claims.length || typeof row.fingerprint !== 'string') throw failure('ledger_invalid')
    ids.add(row.id); requests.add(row.requestId)
    const pools = new Set()
    for (const claim of row.claims) {
      if (typeof claim.filesystemId !== 'string' || pools.has(claim.filesystemId) || !integer(claim.bytes) || !integer(claim.inodes)) throw failure('ledger_invalid')
      pools.add(claim.filesystemId)
    }
    if (!path.isAbsolute(row.candidatePath) || path.normalize(row.candidatePath) !== row.candidatePath) throw failure('ledger_invalid')
  }
  return ledger
}
function readLock(directory, name = FILES.lock) {
  const filename = path.join(directory, name)
  try {
    const { record, identity } = readDocument(filename)
    if (record.schemaVersion !== 1 || typeof record.nonce !== 'string' || !ownerValid(record.owner) || !integer(record.baseRevision) || !['admit', 'settle', 'recover'].includes(record.operation)) throw failure('transaction_lock_invalid')
    return { identity, sha256: digest(record), record }
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
function sameLock(directory, expected, name = FILES.lock) {
  const current = readLock(directory, name)
  return current && current.identity.dev === expected.identity.dev && current.identity.ino === expected.identity.ino && current.sha256 === expected.sha256 && current.record.nonce === expected.record.nonce
}
function pinned(directory, lock, reservationId) {
  let pins
  try { pins = readJson(path.join(directory, FILES.pins)) } catch (error) { if (error.code === 'ENOENT') return false; throw error }
  if (pins.schemaVersion !== 1 || !Array.isArray(pins.lockNonces) || !Array.isArray(pins.reservationIds) || [...pins.lockNonces, ...pins.reservationIds].some(value => typeof value !== 'string')) throw failure('recovery_pins_invalid')
  return (lock && pins.lockNonces.includes(lock.record.nonce)) || (reservationId && pins.reservationIds.includes(reservationId))
}
function inspectFixtureLedger(directory) {
  const actual = boundary(directory)
  return { ledger: readLedger(actual), lock: readLock(actual), recoveryLock: readLock(actual, FILES.recovery) }
}
function requestValid(request, directory) {
  if (!request || typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128 || !ownerValid(request.owner) || !Array.isArray(request.claims) || !request.claims.length || request.claims.length > 16 || typeof request.candidatePath !== 'string' || path.normalize(request.candidatePath) !== request.candidatePath || !request.candidatePath.startsWith(path.join(directory, 'releases') + path.sep)) throw failure('request_invalid')
  const pools = new Set()
  for (const claim of request.claims) {
    if (!claim || typeof claim.filesystemId !== 'string' || !claim.filesystemId || claim.filesystemId.length > 128 || pools.has(claim.filesystemId) || !integer(claim.bytes) || !integer(claim.inodes)) throw failure('request_invalid')
    pools.add(claim.filesystemId)
  }
}
async function commit(directory, ledger, lock, checkpoint = async () => {}, temporaryNonce = lock.record.nonce) {
  const filename = path.join(directory, `.ledger-${temporaryNonce}.tmp`)
  if (!sameLock(directory, lock)) throw failure('transaction_identity_changed')
  writeNew(filename, ledger)
  await checkpoint('temp_fsynced')
  if (!sameLock(directory, lock)) throw failure('transaction_identity_changed')
  fs.renameSync(filename, path.join(directory, FILES.ledger))
  await checkpoint('renamed')
  syncDirectory(directory)
  await checkpoint('dir_fsynced')
  if (!sameLock(directory, lock)) throw failure('transaction_identity_changed')
}
function releaseOwnLock(directory, lock, name = FILES.lock) {
  if (!sameLock(directory, lock, name)) throw failure('transaction_identity_changed')
  fs.unlinkSync(path.join(directory, name))
  syncDirectory(directory)
}
async function transaction(directory, record, work, checkpoint) {
  const actual = boundary(directory)
  if (fs.existsSync(path.join(actual, FILES.recovery))) return { ok: false, code: 'recovery_required' }
  let created
  try { created = writeNew(path.join(actual, FILES.lock), record); syncDirectory(actual) }
  catch (error) { if (error.code === 'EEXIST') return { ok: false, code: 'transaction_locked' }; throw error }
  try {
    const lock = readLock(actual)
    if (!lock || lock.identity.dev !== created.dev || lock.identity.ino !== created.ino || lock.record.nonce !== record.nonce || lock.sha256 !== digest(record)) throw failure('transaction_identity_changed')
    if (fs.existsSync(path.join(actual, FILES.recovery))) throw failure('recovery_required')
    await checkpoint?.('locked')
    const result = await work(actual, lock)
    releaseOwnLock(actual, lock)
    return result
  } catch (error) {
    // A failed write or changed identity leaves the gate for explicit reconciliation.
    return { ok: false, code: error.code ?? 'transaction_uncertain', recoveryRequired: true }
  }
}
async function admitFixture({ directory, request, inventory, policy, expectedRevision, checkpoint } = {}) {
  const actual = boundary(directory)
  requestValid(request, actual)
  if (!integer(expectedRevision) || inventory?.root !== actual) throw failure('request_invalid')
  const fingerprint = digest(request)
  const record = { schemaVersion: 1, operation: 'admit', nonce: randomUUID(), owner: fixtureOwner(), baseRevision: expectedRevision, request, fingerprint }
  return transaction(actual, record, async (root, lock) => {
    const ledger = readLedger(root)
    const duplicate = ledger.reservations.find(row => row.requestId === request.requestId)
    if (duplicate && duplicate.fingerprint !== fingerprint) return { ok: false, code: 'request_conflict' }
    if (!duplicate && ledger.revision !== expectedRevision) return { ok: false, code: 'revision_conflict' }
    const plan = planRelease({ inventory: { ...inventory, ledger }, request, policy })
    if (plan.admission.decision !== 'admit') return { ok: false, code: 'admission_denied', admission: plan.admission }
    if (duplicate) {
      if (pinned(root, null, duplicate.id)) return { ok: false, code: 'recovery_pinned' }
      return { ok: true, duplicate: true, reservation: duplicate, revision: ledger.revision }
    }
    const reservation = { ...request, id: randomUUID(), nonce: randomUUID(), state: 'preparing', fingerprint }
    const next = { schemaVersion: 1, revision: ledger.revision + 1, reservations: [...ledger.reservations, reservation] }
    await commit(root, next, lock, checkpoint)
    return { ok: true, reservation, revision: next.revision }
  }, checkpoint)
}
async function settleFixture({ directory, reservationId, nonce, expectedRevision, confirmation, checkpoint } = {}) {
  if (!integer(expectedRevision)) throw failure('request_invalid')
  const record = { schemaVersion: 1, operation: 'settle', nonce: randomUUID(), owner: fixtureOwner(), baseRevision: expectedRevision, reservationId }
  return transaction(directory, record, async (root, lock) => {
    const ledger = readLedger(root)
    const reservation = ledger.reservations.find(row => row.id === reservationId)
    if (ledger.revision !== expectedRevision || !reservation || reservation.nonce !== nonce || confirmation !== 'confirmed_no_pending_work') return { ok: false, code: 'settlement_conflict' }
    if (pinned(root, null, reservationId)) return { ok: false, code: 'recovery_pinned' }
    const next = { ...ledger, revision: ledger.revision + 1, reservations: ledger.reservations.map(row => row === reservation ? { ...row, state: 'settled' } : row) }
    await commit(root, next, lock, checkpoint)
    return { ok: true, revision: next.revision }
  }, checkpoint)
}
function ownerDefinitelyExited(owner) {
  try { process.kill(owner.pid, 0); return false } catch (error) { return error.code === 'ESRCH' }
}
async function recoverFixture({ directory, expectedLock, expectedRevision } = {}) {
  const actual = boundary(directory)
  if (!integer(expectedRevision) || !expectedLock?.record?.nonce) return { ok: false, code: 'recovery_identity_required' }
  const recoveryRecord = { schemaVersion: 1, operation: 'recover', nonce: randomUUID(), owner: fixtureOwner(), baseRevision: expectedRevision }
  try { writeNew(path.join(actual, FILES.recovery), recoveryRecord); syncDirectory(actual) }
  catch (error) { if (error.code === 'EEXIST') return { ok: false, code: 'recovery_locked' }; throw error }
  const recoveryLock = readLock(actual, FILES.recovery)
  let uncertain = false
  try {
    if (!sameLock(actual, expectedLock)) return { ok: false, code: 'transaction_identity_changed' }
    if (!ownerDefinitelyExited(expectedLock.record.owner)) return { ok: false, code: 'owner_live_or_unknown' }
    if (pinned(actual, expectedLock)) return { ok: false, code: 'recovery_pinned' }
    const ledger = readLedger(actual)
    if (ledger.revision !== expectedRevision) return { ok: false, code: 'revision_conflict' }
    const pending = expectedLock.record
    let next = ledger
    if (pending.operation === 'admit') {
      requestValid(pending.request, actual)
      if (digest(pending.request) !== pending.fingerprint) return { ok: false, code: 'transaction_identity_changed' }
      const existing = ledger.reservations.find(row => row.requestId === pending.request.requestId)
      if (existing && pinned(actual, expectedLock, existing.id)) return { ok: false, code: 'recovery_pinned' }
      if (existing && existing.fingerprint !== pending.fingerprint) return { ok: false, code: 'request_conflict' }
      if ((!existing && ledger.revision !== pending.baseRevision) || (existing && ledger.revision !== pending.baseRevision + 1)) return { ok: false, code: 'unrecognized_commit' }
      const interrupted = existing ? { ...existing, state: 'interrupted' } : { ...pending.request, id: randomUUID(), nonce: randomUUID(), state: 'interrupted', fingerprint: pending.fingerprint }
      next = { ...ledger, revision: ledger.revision + 1, reservations: existing ? ledger.reservations.map(row => row === existing ? interrupted : row) : [...ledger.reservations, interrupted] }
    } else if (pending.operation === 'settle') {
      // Interrupted settlement never proves that external work was reconciled.
      const row = ledger.reservations.find(value => value.id === pending.reservationId)
      if (row && pinned(actual, expectedLock, row.id)) return { ok: false, code: 'recovery_pinned' }
      if (!row || ![pending.baseRevision, pending.baseRevision + 1].includes(ledger.revision)) return { ok: false, code: 'unrecognized_commit' }
      next = { ...ledger, revision: ledger.revision + 1, reservations: ledger.reservations.map(value => value === row ? { ...value, state: 'interrupted' } : value) }
    } else return { ok: false, code: 'unrecognized_commit' }
    uncertain = true
    await commit(actual, next, expectedLock, undefined, recoveryLock.record.nonce)
    releaseOwnLock(actual, expectedLock)
    uncertain = false
    return { ok: true, revision: next.revision, preservedReservations: next.reservations.length }
  } catch (error) { return { ok: false, code: error.code ?? 'recovery_uncertain' } }
  finally { if (!uncertain) releaseOwnLock(actual, recoveryLock, FILES.recovery) }
}

module.exports = { initializeFixtureLedger, inspectFixtureLedger, admitFixture, settleFixture, recoverFixture, fixtureOwner }
