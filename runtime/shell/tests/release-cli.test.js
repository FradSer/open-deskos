const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')

const scripts = path.join(__dirname, '..', 'scripts')
function digestTree(directory) {
  const rows = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(dir, entry.name), stat = fs.lstatSync(name)
      rows.push([path.relative(directory, name), stat.mode, stat.ino, stat.nlink, stat.mtimeMs, entry.isSymbolicLink() ? fs.readlinkSync(name) : entry.isFile() ? createHash('sha256').update(fs.readFileSync(name)).digest('hex') : null])
      if (entry.isDirectory()) walk(name)
    }
  }
  walk(directory)
  return JSON.stringify(rows)
}
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-release-cli-'))
  const root = path.join(directory, 'runtime')
  fs.mkdirSync(path.join(root, 'releases', 'stable'), { recursive: true })
  fs.mkdirSync(path.join(root, 'state', 'deployment-backups', 'preserved'), { recursive: true })
  fs.writeFileSync(path.join(root, 'state', 'deployment-backups', 'preserved', 'backup.tar'), 'PRESERVE')
  fs.symlinkSync(path.join(root, 'releases', 'stable'), path.join(root, 'current'))
  const inventory = {
    schemaVersion: 1, root, observedAt: new Date().toISOString(), complete: true, uncertainties: [],
    filesystems: [{ id: 'disk', availableBytes: 100, availableInodes: 100, complete: true }],
    releases: [{ id: 'stable', path: path.join(root, 'releases/stable'), identity: { dev: 1, ino: 1 }, allocatedBytes: 10, reclaimableBytes: 10, metadataValid: true, complete: true }],
    pointers: { current: path.join(root, 'releases/stable'), previous: null }, references: [], protections: [], locks: [], backupRoots: [path.join(root, 'state/deployment-backups')], ledger: { schemaVersion: 1, revision: 0, reservations: [] },
  }
  const snapshot = path.join(directory, 'snapshot.json'), request = path.join(directory, 'request.json')
  fs.writeFileSync(snapshot, JSON.stringify(inventory))
  fs.writeFileSync(request, JSON.stringify({ requestId: 'cli-test', candidatePath: path.join(root, 'releases/new'), owner: { bootId: 'fixture', pid: process.pid, startTime: '1' }, claims: [{ filesystemId: 'disk', bytes: 60, inodes: 2 }] }))
  const bin = path.join(directory, 'bin')
  fs.mkdirSync(bin)
  for (const name of ['ssh', 'rsync', 'sudo', 'apt-get', 'systemctl', 'runuser', 'curl', 'wget']) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\necho BLOCKED_EXTERNAL_COMMAND >&2\nexit 97\n', { mode: 0o700 })
  }
  return { directory, root, snapshot, request, env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } }
}
const entries = [
  ['node', 'cm5-release.js'], ['node', 'update-runtime.js'],
  ['bash', 'cm5-stage-release.sh'], ['bash', 'cm5-install.sh'],
]
for (const [binary, entry] of entries) {
  test(`Given ${entry} When --dry-run is requested Then files and backups stay unchanged`, () => {
    const fixtureRoot = fixture()
    try {
      const before = digestTree(fixtureRoot.directory)
      const result = spawnSync(binary === 'node' ? process.execPath : binary, [path.join(scripts, entry), '--dry-run', '--snapshot', fixtureRoot.snapshot, '--request', fixtureRoot.request, '--reserve-bytes', '10', '--reserve-inodes', '1'], { env: fixtureRoot.env, encoding: 'utf8', timeout: 10000 })
      assert.equal(result.status, 0, result.stderr)
      const report = JSON.parse(result.stdout)
      assert.equal(report.dryRun, true)
      assert.equal(report.executionAvailable, false)
      assert.equal(report.reservationCreated, false)
      assert.equal(report.admission.decision, 'admit')
      assert.equal(digestTree(fixtureRoot.directory), before)
      for (const badArguments of [['--dry-run', '--apply'], ['--apply'], ['--settle'], ['--reconcile']]) {
        const invalid = spawnSync(binary === 'node' ? process.execPath : binary, [path.join(scripts, entry), ...badArguments], { env: fixtureRoot.env, encoding: 'utf8', timeout: 10000 })
        assert.notEqual(invalid.status, 0)
        assert.equal(JSON.parse(invalid.stdout).error, 'invalid_arguments')
      }
      assert.equal(digestTree(fixtureRoot.directory), before)
    } finally { fs.rmSync(fixtureRoot.directory, { recursive: true, force: true }) }
  })
}

test('Given an absent runtime When default planning runs Then no directory or gate is created', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-release-cli-'))
  try {
    const root = path.join(directory, 'missing')
    const result = spawnSync(process.execPath, [path.join(scripts, 'cm5-release.js'), '--root', root], { encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.gc.decision, 'blocked')
    assert.equal(fs.existsSync(root), false)
    assert.deepEqual(fs.readdirSync(directory), [])
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('Given a reconciled idle gate snapshot When every dry-run entry runs Then closeout is reported without filesystem changes', () => {
  const value = fixture()
  try {
    const inventory = JSON.parse(fs.readFileSync(value.snapshot))
    inventory.closeouts = { schemaVersion: 1, complete: true, transactions: [{ transactionId: 'closed-stage',
      candidatePath: inventory.releases[0].path, disposition: 'abandoned', closedAt: inventory.observedAt }], unresolved: [] }
    inventory.locks.push({ path: path.join(value.root, 'state/update.lock'), identity: { dev: 1, ino: 20 },
      status: 'idle', reconciled: true, recoveryPinned: false })
    fs.writeFileSync(value.snapshot, JSON.stringify(inventory))
    const before = digestTree(value.directory)
    for (const [binary, entry] of entries) {
      const result = spawnSync(binary === 'node' ? process.execPath : binary,
        [path.join(scripts, entry), '--dry-run', '--snapshot', value.snapshot, '--request', value.request,
          '--reserve-bytes', '10', '--reserve-inodes', '1'], { env: value.env, encoding: 'utf8', timeout: 10000 })
      assert.equal(result.status, 0, result.stderr)
      const report = JSON.parse(result.stdout)
      assert.equal(report.admission.decision, 'admit')
      assert.equal(report.recovery.required, false)
      assert.equal(report.recovery.closeouts.transactions[0].transactionId, 'closed-stage')
      assert.equal(report.recovery.locks[0].status, 'idle')
      assert.equal(report.executionAvailable, false)
      assert.equal(report.reservationCreated, false)
    }
    assert.equal(digestTree(value.directory), before)
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }) }
})

test('Given untrusted closeout details When planning rejects them Then private fields are not printed', () => {
  const value = fixture()
  try {
    const original = JSON.parse(fs.readFileSync(value.snapshot))
    for (const extra of [
      { closeouts: { schemaVersion: 1, complete: false, transactions: [], unresolved: [{ reason: 'PRIVATE-CLOSEOUT-CANARY' }] } },
      { locks: [{ path: path.join(value.root, 'state/update.lock'), identity: { dev: 1, ino: 20 }, recoveryPinned: true,
        status: { privateBody: 'PRIVATE-CLOSEOUT-CANARY' }, reconciled: { privateBody: 'PRIVATE-CLOSEOUT-CANARY' } }] },
    ]) {
      fs.writeFileSync(value.snapshot, JSON.stringify({ ...original, ...extra }))
      const result = spawnSync(process.execPath, [path.join(scripts, 'cm5-release.js'), '--snapshot', value.snapshot],
        { env: value.env, encoding: 'utf8', timeout: 10000 })
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-CLOSEOUT-CANARY/)
      assert.equal(JSON.parse(result.stdout).gc.decision, 'blocked')
    }
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }) }
})

test('Given an external backup observation When live collection runs Then reachable releases remain protected without writes', () => {
  const value = fixture()
  try {
    fs.writeFileSync(path.join(value.root, 'releases/stable/release.json'), JSON.stringify({ schemaVersion: 1,
      id: 'stable', sourceRevision: 'a'.repeat(40), createdAt: '2026-10-24T00:00:00Z' }))
    const units = path.join(value.directory, 'units.json'), backups = path.join(value.directory, 'backups.json')
    fs.writeFileSync(units, JSON.stringify({ complete: true, references: [] }))
    fs.writeFileSync(backups, JSON.stringify({ schemaVersion: 1, complete: true, observedAt: new Date().toISOString(),
      roots: [path.join(value.directory, 'archive')], references: [{ path: path.join(value.root, 'releases/stable'), kind: 'backup' }] }))
    const before = digestTree(value.directory)
    const result = spawnSync(process.execPath, [path.join(scripts, 'cm5-release.js'), '--root', value.root,
      '--unit-snapshot', units, '--backup-snapshot', backups], { env: value.env, encoding: 'utf8', timeout: 10000 })
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.ok(report.gc.protected.find(x => x.id === 'stable').reasons.includes('reference:backup'))
    assert.equal(report.executionAvailable, false)
    assert.equal(report.reservationCreated, false)
    assert.equal(digestTree(value.directory), before)
    const conflicting = spawnSync(process.execPath, [path.join(scripts, 'cm5-release.js'), '--snapshot', value.snapshot,
      '--backup-snapshot', backups], { env: value.env, encoding: 'utf8', timeout: 10000 })
    assert.equal(conflicting.status, 64)
    assert.equal(JSON.parse(conflicting.stdout).error, 'invalid_input')
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }) }
})

test('Given a snapshot root mismatch or malformed JSON When planning runs Then no raw content is printed', () => {
  const value = fixture()
  try {
    const mismatch = spawnSync(process.execPath, [path.join(scripts, 'cm5-release.js'), '--snapshot', value.snapshot, '--root', '/different'], { encoding: 'utf8', timeout: 10000 })
    assert.notEqual(mismatch.status, 0)
    fs.writeFileSync(value.snapshot, 'PRIVATE-FIXTURE-CANARY invalid JSON')
    const invalid = spawnSync(process.execPath, [path.join(scripts, 'cm5-release.js'), '--snapshot', value.snapshot], { encoding: 'utf8', timeout: 10000 })
    assert.notEqual(invalid.status, 0)
    assert.doesNotMatch(invalid.stdout + invalid.stderr, /PRIVATE-FIXTURE-CANARY/)
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }) }
})

test('Given untrusted observation objects When planning runs Then unknown bodies are never echoed', () => {
  const value = fixture()
  try {
    const original = JSON.parse(fs.readFileSync(value.snapshot))
    for (const patch of [{ root: { privateBody: 'PRIVATE-OBSERVATION-CANARY' } }, { observedAt: { privateBody: 'PRIVATE-OBSERVATION-CANARY' } }, { uncertainties: ['PRIVATE-OBSERVATION-CANARY'] }]) {
      fs.writeFileSync(value.snapshot, JSON.stringify({ ...original, ...patch }))
      const result = spawnSync(process.execPath, [path.join(scripts, 'cm5-release.js'), '--snapshot', value.snapshot], { encoding: 'utf8', timeout: 10000 })
      assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-OBSERVATION-CANARY/)
      assert.equal(JSON.parse(result.stdout).executionAvailable, false)
    }
  } finally { fs.rmSync(value.directory, { recursive: true, force: true }) }
})
