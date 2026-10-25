// Pure planning only. This module deliberately has no filesystem or process imports.
const DEFAULT_POLICY = Object.freeze({ reserveBytes: 6 * 1024 ** 3, reserveInodes: 4096, maxSnapshotAgeMs: 60000 })
const ACTIVE = new Set(['preparing', 'ready', 'recovering', 'interrupted'])
const STATES = new Set([...ACTIVE, 'settled'])
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const amount = value => Number.isSafeInteger(value) && value >= 0
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value)
function absolute(value) {
  return typeof value === 'string' && value.startsWith('/') && !/[\\\x00-\x1f\x7f]/.test(value)
    && (value === '/' || value.slice(1).split('/').every(part => part && part !== '.' && part !== '..'))
}
const within = (value, root) => value === root || value.startsWith(root === '/' ? '/' : root + '/')
const overlap = (a, b) => within(a, b) || within(b, a)
const identity = value => record(value) && amount(value.dev) && Number.isSafeInteger(value.ino) && value.ino > 0
const ownerValid = value => record(value) && text(value.bootId) && Number.isSafeInteger(value.pid) && value.pid > 0
  && (amount(value.startTime) || text(value.startTime))
const sameOwner = (a, b) => a.bootId === b.bootId && a.pid === b.pid && a.startTime === b.startTime
const timestamp = value => amount(value) ? value : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && amount(Date.parse(value)) ? Date.parse(value) : NaN

/** Validate one immutable snapshot and compute a non-executable admission/reclamation plan. */
function planRelease({ inventory, request = null, policy = {}, now = Date.now() } = {}) {
  const failures = new Set(), admissionReasons = new Set(), recoveryReasons = new Set()
  const invalid = reason => failures.add(reason)
  const recovery = reason => { recoveryReasons.add(reason); failures.add(reason) }
  const configured = { ...DEFAULT_POLICY }
  if (!record(policy) || Object.keys(policy).some(key => !Object.hasOwn(DEFAULT_POLICY, key))) invalid('invalid_policy')
  else for (const key of Object.keys(DEFAULT_POLICY)) {
    if (Object.hasOwn(policy, key)) {
      if (!amount(policy[key])) invalid('invalid_policy')
      else configured[key] = policy[key]
    }
  }
  if (!amount(now)) invalid('invalid_now')
  const checkedNow = amount(now) ? now : 0
  const input = record(inventory) ? inventory : {}
  if (!record(inventory) || input.schemaVersion !== 1 || !absolute(input.root) || input.root === '/') invalid('invalid_inventory')
  const root = absolute(input.root) && input.root !== '/' ? input.root : '/invalid-planner-root'
  const releaseRoot = root + '/releases'
  const releasePath = path => absolute(path) && within(path, releaseRoot) && path !== releaseRoot && !path.slice(releaseRoot.length + 1).includes('/')
  const observedAt = timestamp(input.observedAt)
  if (!amount(observedAt) || observedAt > checkedNow) invalid('invalid_observation_time')
  else if (checkedNow - observedAt > configured.maxSnapshotAgeMs) invalid('snapshot_stale')
  if (input.complete !== true) invalid('snapshot_incomplete')
  if (!Array.isArray(input.uncertainties)) invalid('invalid_uncertainties')
  else if (input.uncertainties.length) invalid('observation_uncertain')
  const arrays = {}
  for (const name of ['filesystems', 'releases', 'references', 'protections', 'locks', 'backupRoots']) {
    if (!Array.isArray(input[name])) { invalid('invalid_' + name); arrays[name] = [] }
    else arrays[name] = input[name]
  }
  const pools = new Map()
  if (!arrays.filesystems.length) invalid('missing_filesystems')
  for (const pool of arrays.filesystems) {
    if (!record(pool) || !identifier(pool.id) || !amount(pool.availableBytes) || !amount(pool.availableInodes) || pool.complete !== true || pools.has(pool.id)) { invalid('invalid_filesystem'); continue }
    pools.set(pool.id, { filesystemId: pool.id, availableBytes: pool.availableBytes, availableInodes: pool.availableInodes, reservedBytes: 0, reservedInodes: 0, requestedBytes: 0, requestedInodes: 0 })
  }
  const releases = [], ids = new Set(), paths = new Set(), identities = new Set()
  for (const entry of arrays.releases) {
    if (!record(entry) || !identifier(entry.id) || !releasePath(entry.path) || entry.path !== releaseRoot + '/' + entry.id
      || !identity(entry.identity) || !amount(entry.allocatedBytes) || !amount(entry.reclaimableBytes) || entry.reclaimableBytes > entry.allocatedBytes
      || entry.metadataValid !== true || entry.complete !== true || ids.has(entry.id) || paths.has(entry.path)) { invalid('invalid_release'); continue }
    const key = entry.identity.dev + ':' + entry.identity.ino
    if (identities.has(key)) { invalid('duplicate_release_identity'); continue }
    ids.add(entry.id); paths.add(entry.path); identities.add(key)
    releases.push({ id: entry.id, path: entry.path, identity: { dev: entry.identity.dev, ino: entry.identity.ino }, estimatedBytes: entry.reclaimableBytes })
  }
  const protections = []
  const protect = (path, reason) => protections.push({ path, reason })
  if (!record(input.pointers) || !Object.hasOwn(input.pointers, 'current') || !Object.hasOwn(input.pointers, 'previous')) invalid('invalid_pointers')
  else for (const key of ['current', 'previous']) {
    const path = input.pointers[key]
    if (path === null) continue
    if (!absolute(path) || !releases.some(entry => within(path, entry.path))) { invalid('unresolved_' + key); continue }
    protect(path, key)
  }
  const references = [...arrays.references]
  if (Object.hasOwn(input, 'unitReferences')) {
    if (!record(input.unitReferences) || input.unitReferences.complete !== true || !Array.isArray(input.unitReferences.references)) invalid('unit_references_incomplete')
    else references.push(...input.unitReferences.references)
  }
  for (const ref of references) {
    if (!record(ref) || !absolute(ref.path) || !text(ref.kind)) { invalid('invalid_reference'); continue }
    protect(ref.path, 'reference:' + ref.kind)
  }
  for (const pin of arrays.protections) {
    if (!record(pin) || !absolute(pin.path) || !text(pin.reason)) { invalid('invalid_protection'); continue }
    protect(pin.path, 'protection:' + pin.reason)
    if (/recover|unknown|unresolved|interrupted|uncommitted/i.test(pin.reason)) recovery('recovery_protection_present')
  }
  for (const path of arrays.backupRoots) {
    if (!absolute(path)) { invalid('invalid_backup_root'); continue }
    protect(path, 'backup_root')
  }
  let closeoutsComplete = false
  const closedTransactions = []
  if (Object.hasOwn(input, 'closeouts')) {
    const closeouts = input.closeouts
    let valid = record(closeouts) && closeouts.schemaVersion === 1 && typeof closeouts.complete === 'boolean'
      && Array.isArray(closeouts.transactions) && Array.isArray(closeouts.unresolved)
    const seen = new Set()
    if (valid) for (const entry of closeouts.transactions) {
      if (!record(entry) || !identifier(entry.transactionId) || seen.has(entry.transactionId) || !releasePath(entry.candidatePath)
        || !['committed', 'rolled-back', 'abandoned'].includes(entry.disposition)
        || !amount(timestamp(entry.closedAt)) || timestamp(entry.closedAt) > observedAt) { valid = false; break }
      seen.add(entry.transactionId)
      closedTransactions.push({ transactionId: entry.transactionId, candidatePath: entry.candidatePath,
        disposition: entry.disposition, closedAt: entry.closedAt })
    }
    if (!valid) invalid('invalid_closeout_observation')
    else if (closeouts.complete !== true || closeouts.unresolved.length) recovery('closeout_observation_incomplete')
    else closeoutsComplete = true
  }
  const locks = []
  for (const lock of arrays.locks) {
    if (!record(lock) || !absolute(lock.path) || !identity(lock.identity) || typeof lock.recoveryPinned !== 'boolean') { invalid('invalid_lock'); continue }
    const extended = Object.hasOwn(lock, 'status') || Object.hasOwn(lock, 'reconciled')
    const validObservation = extended && ['idle', 'active', 'unknown'].includes(lock.status) && typeof lock.reconciled === 'boolean'
    if (extended && !validObservation) invalid('invalid_lock_observation')
    const pinned = arrays.protections.some(pin => record(pin) && absolute(pin.path) && overlap(pin.path, lock.path))
    const idle = validObservation && lock.status === 'idle' && lock.reconciled === true && lock.recoveryPinned === false
      && !pinned && closeoutsComplete && [root + '/update.lock', root + '/state/update.lock', root + '/state/release-control/update.lock'].includes(lock.path)
    locks.push({ path: lock.path, identity: { dev: lock.identity.dev, ino: lock.identity.ino }, recoveryPinned: lock.recoveryPinned || pinned,
      ...(validObservation ? { status: lock.status, reconciled: lock.reconciled && !pinned } : {}) })
    if (!idle) recovery('deployment_lock_present')
    if (lock.recoveryPinned || pinned) recovery('recovery_pinned_lock')
    protect(lock.path, 'deployment_lock')
  }
  function claimsValid(claims) {
    if (!Array.isArray(claims) || !claims.length) { invalid('missing_claims'); return false }
    let valid = true
    const seen = new Set()
    for (const claim of claims) {
      if (!record(claim) || !identifier(claim.filesystemId) || !pools.has(claim.filesystemId) || !amount(claim.bytes) || !amount(claim.inodes) || seen.has(claim.filesystemId)) { invalid('invalid_claim'); valid = false }
      else seen.add(claim.filesystemId)
    }
    return valid
  }
  function addClaims(claims, prefix) {
    for (const claim of claims) {
      const pool = pools.get(claim.filesystemId)
      for (const [name, value] of [['Bytes', claim.bytes], ['Inodes', claim.inodes]]) {
        const key = prefix + name
        const sum = pool[key] + value
        if (!amount(sum)) invalid('claim_sum_overflow')
        else pool[key] = sum
      }
    }
  }
  const ledger = record(input.ledger) ? input.ledger : {}
  if (ledger.schemaVersion !== 1 || !amount(ledger.revision) || !Array.isArray(ledger.reservations)) invalid('invalid_ledger')
  const reservations = [], reservationIds = new Set(), requestIds = new Set(), candidatePaths = new Set()
  for (const entry of Array.isArray(ledger.reservations) ? ledger.reservations : []) {
    const validClaims = claimsValid(entry?.claims)
    if (!record(entry) || !identifier(entry.id) || !identifier(entry.requestId) || !releasePath(entry.candidatePath) || !ownerValid(entry.owner) || !STATES.has(entry.state)
      || reservationIds.has(entry.id) || requestIds.has(entry.requestId) || candidatePaths.has(entry.candidatePath) || !validClaims) { invalid('invalid_reservation'); continue }
    reservationIds.add(entry.id); requestIds.add(entry.requestId); candidatePaths.add(entry.candidatePath)
    reservations.push(entry)
    if (ACTIVE.has(entry.state)) {
      protect(entry.candidatePath, 'reservation:' + entry.state)
      addClaims(entry.claims, 'reserved')
      if (['recovering', 'interrupted'].includes(entry.state)) recovery('reservation_requires_recovery')
    }
  }
  if (request !== null) {
    const validClaims = claimsValid(request?.claims)
    if (!record(request) || !identifier(request.requestId) || !releasePath(request.candidatePath) || !ownerValid(request.owner) || !validClaims) invalid('invalid_request')
    else {
      const previous = reservations.find(entry => entry.requestId === request.requestId)
      const normalized = claims => JSON.stringify(claims.map(c => ({ filesystemId: c.filesystemId, bytes: c.bytes, inodes: c.inodes })).sort((a, b) => a.filesystemId.localeCompare(b.filesystemId)))
      if (previous) {
        if (!ACTIVE.has(previous.state)) invalid('request_already_settled')
        else if (previous.candidatePath !== request.candidatePath || !sameOwner(previous.owner, request.owner) || normalized(previous.claims) !== normalized(request.claims)) invalid('request_identity_conflict')
        else admissionReasons.add('existing_reservation')
      } else {
        if (reservations.some(entry => ACTIVE.has(entry.state) && entry.candidatePath === request.candidatePath)) invalid('candidate_already_reserved')
        if (paths.has(request.candidatePath)) invalid('candidate_already_exists')
        if (protections.some(pin => overlap(pin.path, request.candidatePath))) invalid('candidate_protection_conflict')
        addClaims(request.claims, 'requested')
      }
    }
  }
  const filesystems = []
  for (const pool of pools.values()) {
    const bytes = pool.reservedBytes + pool.requestedBytes + configured.reserveBytes
    const inodes = pool.reservedInodes + pool.requestedInodes + configured.reserveInodes
    if (!amount(bytes) || !amount(inodes)) invalid('capacity_sum_overflow')
    const sufficient = amount(bytes) && amount(inodes) && pool.availableBytes >= bytes && pool.availableInodes >= inodes
    if (!sufficient) admissionReasons.add('insufficient_capacity:' + pool.filesystemId)
    filesystems.push({ ...pool, reserveBytes: configured.reserveBytes, reserveInodes: configured.reserveInodes,
      remainingBytes: amount(bytes) ? pool.availableBytes - bytes : null, remainingInodes: amount(inodes) ? pool.availableInodes - inodes : null, sufficient })
  }
  const protectedEntries = [], candidates = []
  for (const entry of releases) {
    const reasons = [...new Set(protections.filter(pin => overlap(pin.path, entry.path)).map(pin => pin.reason))]
    if (reasons.length) protectedEntries.push({ id: entry.id, path: entry.path, reasons })
    else candidates.push(entry)
  }
  // A live reservation protects its not-yet-collected candidate as well.
  for (const entry of reservations.filter(entry => ACTIVE.has(entry.state) && !paths.has(entry.candidatePath))) {
    protectedEntries.push({ id: entry.candidatePath.slice(releaseRoot.length + 1), path: entry.candidatePath, reasons: ['reservation:' + entry.state] })
  }
  const safetyReasons = [...failures]
  const decision = safetyReasons.length ? 'deny' : request === null ? 'not_requested'
    : [...admissionReasons].some(reason => reason.startsWith('insufficient_capacity:')) ? 'deny' : 'admit'
  return { schemaVersion: 1, dryRun: true, executionAvailable: false,
    admission: { decision, reasons: [...new Set([...safetyReasons, ...admissionReasons])], filesystems },
    gc: { decision: safetyReasons.length ? 'blocked' : 'planned', protected: protectedEntries, candidates: safetyReasons.length ? [] : candidates, reasons: safetyReasons },
    recovery: { required: recoveryReasons.size > 0, reasons: [...recoveryReasons], locks,
      closeouts: { complete: closeoutsComplete, transactions: closeoutsComplete ? closedTransactions : [] },
      reservations: reservations.filter(entry => ['recovering', 'interrupted'].includes(entry.state)).map(entry => ({ id: entry.id, candidatePath: entry.candidatePath, state: entry.state })) } }
}

module.exports = { planRelease }
