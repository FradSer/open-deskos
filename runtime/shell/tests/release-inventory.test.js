const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { collectReleaseInventory } = require('../scripts/lib/release-inventory')

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-inventory-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const root = path.join(directory, 'odk')
  const procRoot = path.join(directory, 'proc')
  fs.mkdirSync(path.join(root, 'releases'), { recursive: true })
  fs.mkdirSync(procRoot)
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(name), { recursive: true })
    fs.writeFileSync(name, typeof value === 'string' ? value : JSON.stringify(value))
  }
  const release = (id = 'r1') => {
    const target = path.join(root, 'releases', id)
    write(path.join(target, 'release.json'), { schemaVersion: 1, id, sourceRevision: 'a'.repeat(40), createdAt: '2026-10-24T00:00:00Z' })
    write(path.join(target, 'payload'), 'x'.repeat(8192))
    return target
  }
  const statLine = (start = 100) => `42 (worker ) name) S ${Array(18).fill('0').join(' ')} ${start} 0\n`
  const process = (target) => {
    const base = path.join(procRoot, '42')
    write(path.join(base, 'stat'), statLine())
    fs.mkdirSync(path.join(base, 'fd'))
    fs.symlinkSync(target, path.join(base, 'exe'))
    fs.symlinkSync(target, path.join(base, 'cwd'))
    fs.symlinkSync('/', path.join(base, 'root'))
    fs.mkdirSync(path.join(base, 'task/42'), { recursive: true })
    fs.mkdirSync(path.join(base, 'ns'))
    fs.symlinkSync('mnt:[1]', path.join(base, 'ns/mnt'))
    write(path.join(base, 'mountinfo'), '1 0 0:0 / / rw - fixture fixture rw\n')
    write(path.join(base, 'maps'), '')
    return base
  }
  const collect = (options = {}) => collectReleaseInventory({ root, procRoot, unitReferences: { complete: true, references: [] }, ...options })
  return { root, procRoot, write, release, process, statLine, collect, directory }
}

test('returns the complete versioned schema without writes', t => {
  const f = fixture(t); f.release()
  const before = fs.readdirSync(f.root)
  const result = f.collect({ now: () => 12345 })
  assert.equal(result.schemaVersion, 1)
  assert.equal(result.observedAt, new Date(12345).toISOString())
  assert.equal(result.complete, true)
  assert.deepEqual(result.uncertainties, [])
  assert.equal(result.releases.length, 1)
  assert.equal(result.releases[0].metadataValid, true)
  assert.equal(result.filesystems[0].complete, true)
  assert.deepEqual(fs.readdirSync(f.root), before)
  assert.deepEqual(result.ledger, { schemaVersion: 1, revision: 0, reservations: [] })
})

test('missing root returns an incomplete sanitized snapshot', t => {
  const f = fixture(t); const r = f.collect({ root: path.join(f.directory, 'missing') })
  assert.equal(r.complete, false); assert.equal(r.releases.length, 0)
  assert.ok(r.uncertainties.length); assert.ok(r.uncertainties.every(x => typeof x === 'string' && !x.includes('ENOENT')))
})
test('refuses a symlink inventory root', t => {
  const f = fixture(t); const link = path.join(f.directory, 'link'); fs.symlinkSync(f.root, link)
  assert.equal(f.collect({ root: link }).complete, false)
})
test('collects current and previous pointers', t => {
  const f = fixture(t); const a = f.release(); const b = f.release('r2')
  fs.symlinkSync('releases/r1', path.join(f.root, 'current')); fs.symlinkSync(b, path.join(f.root, 'previous'))
  assert.deepEqual(f.collect().pointers, { current: a, previous: b })
})
test('dangling or external pointers make the snapshot incomplete', t => {
  const f = fixture(t); f.release(); fs.symlinkSync(f.directory, path.join(f.root, 'current'))
  assert.equal(f.collect().complete, false)
})
test('a release symlink is not traversed', t => {
  const f = fixture(t); fs.symlinkSync(f.directory, path.join(f.root, 'releases', 'outside'))
  const r = f.collect(); assert.equal(r.complete, false); assert.equal(r.releases.length, 0)
})
test('release metadata must identify its containing release', t => {
  const f = fixture(t); const p = f.release(); f.write(path.join(p, 'release.json'), { schemaVersion: 1, id: 'other' })
  const r = f.collect(); assert.equal(r.complete, false); assert.equal(r.releases[0].metadataValid, false)
})
test('missing metadata is not an eligible complete release', t => {
  const f = fixture(t); const p = f.release(); fs.unlinkSync(path.join(p, 'release.json'))
  assert.equal(f.collect().releases[0].complete, false)
})
test('counts inode blocks once inside a release', t => {
  const f = fixture(t); const p = f.release(); fs.linkSync(path.join(p, 'payload'), path.join(p, 'duplicate'))
  const r = f.collect().releases[0]
  const items = [p, path.join(p, 'release.json'), path.join(p, 'payload')].map(x => fs.lstatSync(x))
  assert.equal(r.allocatedBytes, items.reduce((n, s) => n + s.blocks * 512, 0))
  assert.equal(r.reclaimableBytes, r.allocatedBytes)
})
test('external hardlinks do not count as reclaimable bytes', t => {
  const f = fixture(t); const p = f.release(); fs.linkSync(path.join(p, 'payload'), path.join(f.directory, 'external'))
  const r = f.collect().releases[0]; assert.equal(r.allocatedBytes - r.reclaimableBytes, fs.statSync(path.join(p, 'payload')).blocks * 512)
})
test('links between releases are conservatively not reclaimable per release', t => {
  const f = fixture(t); const a = f.release(); const b = f.release('r2'); fs.unlinkSync(path.join(b, 'payload')); fs.linkSync(path.join(a, 'payload'), path.join(b, 'payload'))
  for (const r of f.collect().releases) assert.ok(r.reclaimableBytes < r.allocatedBytes)
})
test('tree symlinks do not include external file allocation', t => {
  const f = fixture(t); const p = f.release(); const external = path.join(f.directory, 'secret'); f.write(external, 'x'.repeat(100000)); fs.symlinkSync(external, path.join(p, 'link'))
  assert.ok(f.collect().releases[0].allocatedBytes < 100000)
})
test('reads process exe cwd fd and mapped release references', t => {
  const f = fixture(t); const p = f.release(); const proc = f.process(path.join(p, 'payload'))
  fs.symlinkSync(p, path.join(proc, 'fd', '3')); f.write(path.join(proc, 'maps'), `1000-2000 r-xp 00000000 00:00 1 ${p}/mapped file (deleted)\n`)
  const r = f.collect(); assert.equal(r.complete, true)
  assert.ok(r.references.some(x => x.kind === 'process' && x.path.endsWith('mapped file')))
  assert.ok(r.references.some(x => x.path === p))
})
test('malformed process identity blocks reclamation', t => {
  const f = fixture(t); const p = f.release(); const proc = f.process(p); f.write(path.join(proc, 'stat'), 'bad')
  assert.equal(f.collect().complete, false)
})
test('missing proc scope is unknown rather than empty', t => {
  const f = fixture(t); fs.rmdirSync(f.procRoot); assert.equal(f.collect().complete, false)
})
test('service discovery must be explicitly complete', t => {
  const f = fixture(t); f.release(); assert.equal(f.collect({ unitReferences: undefined }).complete, false)
})
test('adds explicitly collected unit paths', t => {
  const f = fixture(t); const p = f.release(); const r = f.collect({ unitReferences: { complete: true, references: [{ path: p, kind: 'unit' }] } })
  assert.equal(r.complete, true); assert.deepEqual(r.references, [{ path: p, kind: 'unit' }])
})
test('unknown unit reference formats fail closed', t => {
  const f = fixture(t); assert.equal(f.collect({ unitReferences: { complete: true, references: [{ path: '/x', kind: 'shell' }] } }).complete, false)
})
test('legacy update lock pins recovery without reading its body', t => {
  const f = fixture(t); f.release(); const lock = path.join(f.root, 'update.lock'); fs.mkdirSync(lock); f.write(path.join(lock, 'private'), 'DO-NOT-EXPORT')
  const r = f.collect(); assert.equal(r.complete, false); assert.equal(r.locks[0].recoveryPinned, true)
  assert.ok(!JSON.stringify(r).includes('DO-NOT-EXPORT')); assert.ok(r.protections.some(p => p.path === path.join(f.root, 'releases')))
})
test('legacy recovery records protect every release', t => {
  const f = fixture(t); f.release(); f.write(path.join(f.root, 'state/deployment-backups/private/record'), 'private body')
  const r = f.collect(); assert.equal(r.complete, false); assert.ok(r.backupRoots.includes(path.join(f.root, 'state/deployment-backups')))
  assert.ok(!JSON.stringify(r).includes('private body'))
})
test('accepts typed explicit pins', t => {
  const f = fixture(t); const p = f.release(); f.write(path.join(f.root, 'state/release-control/pins.json'), { schemaVersion: 1, pins: [{ path: p, reason: 'operator pin' }] })
  assert.ok(f.collect().protections.some(x => x.path === p && x.reason === 'explicit-pin'))
})
test('rejects unknown pins or relative protection paths', t => {
  const f = fixture(t); f.write(path.join(f.root, 'state/release-control/pins.json'), { schemaVersion: 1, pins: [{ path: '../releases/r1', reason: 'pin' }] })
  assert.equal(f.collect().complete, false)
})
test('loads the typed reservation ledger without owner liveness guesses', t => {
  const f = fixture(t); const p = f.release(); const ledger = { schemaVersion: 1, revision: 2, reservations: [{ id: 'l1', requestId: 'request', candidatePath: p, owner: { bootId: 'boot', pid: 900, startTime: '1' }, state: 'interrupted', claims: [{ filesystemId: 'disk', bytes: 12, inodes: 1 }] }] }
  f.write(path.join(f.root, 'state/release-control/ledger.json'), ledger); assert.deepEqual(f.collect().ledger, ledger)
})
test('malformed ledger never becomes an empty successful observation', t => {
  const f = fixture(t); f.write(path.join(f.root, 'state/release-control/ledger.json'), { schemaVersion: 9 }); assert.equal(f.collect().complete, false)
})
test('entry and depth limits fail closed', t => {
  const f = fixture(t); const p = f.release(); f.write(path.join(p, 'a/b/c/d'), 'x')
  assert.equal(f.collect({ limits: { maxEntries: 1 } }).complete, false)
  assert.equal(f.collect({ limits: { maxDepth: 1 } }).complete, false)
})
test('maps and json byte limits fail closed without leaking content', t => {
  const f = fixture(t); const p = f.release(); const proc = f.process(p); f.write(path.join(proc, 'maps'), 'PRIVATE'.repeat(20))
  const r = f.collect({ limits: { maxFileBytes: 10 } }); assert.equal(r.complete, false); assert.ok(!JSON.stringify(r).includes('PRIVATE'))
})
test('expired scan budget does not produce reclamation candidates', t => {
  const f = fixture(t); f.release(); let time = 0; assert.equal(f.collect({ now: () => time += 100, limits: { maxDurationMs: 1 } }).complete, false)
})
test('PID reuse between identity reads makes the snapshot incomplete', t => {
  const f = fixture(t); const p = f.release(); const proc = f.process(p); const original = fs.readSync; let reads = 0
  const originalOpen = fs.openSync; const statFds = new Set()
  t.mock.method(fs, 'openSync', function(file, ...args) { const fd = originalOpen.call(fs, file, ...args); if (file === path.join(proc, 'stat')) statFds.add(fd); else statFds.delete(fd); return fd })
  t.mock.method(fs, 'readSync', function(fd, buffer, ...args) {
    if (statFds.has(fd) && ++reads === 3) { const count = original.call(fs, fd, buffer, ...args); buffer.write(f.statLine(101)); return count }
    return original.call(fs, fd, buffer, ...args)
  })
  assert.equal(f.collect().complete, false)
})

test('JSON null is invalid rather than an absent ledger or pins file', t => {
  const f = fixture(t)
  for (const name of ['ledger', 'pins']) {
    f.write(path.join(f.root, `state/release-control/${name}.json`), 'null')
    assert.equal(f.collect().complete, false)
  }
})
test('unknown ledger fields cannot export arbitrary private bodies', t => {
  const f = fixture(t); f.write(path.join(f.root, 'state/release-control/ledger.json'), { schemaVersion: 1, revision: 0, reservations: [], privateBody: 'NOT-EXPORTED' })
  const r = f.collect(); assert.equal(r.complete, false); assert.ok(!JSON.stringify(r).includes('NOT-EXPORTED'))
})
test('refuses symlinked control documents and ancestors', t => {
  const f = fixture(t); const external = path.join(f.directory, 'private'); f.write(external, 'NOT-EXPORTED')
  fs.mkdirSync(path.join(f.root, 'state/release-control'), { recursive: true }); fs.symlinkSync(external, path.join(f.root, 'state/release-control/ledger.json'))
  assert.equal(f.collect().complete, false)
  fs.rmSync(path.join(f.root, 'state/release-control'), { recursive: true }); fs.symlinkSync(f.directory, path.join(f.root, 'state/release-control'))
  assert.equal(f.collect().complete, false)
})
test('process permission errors are sanitized and fail closed', t => {
  const f = fixture(t); const p = f.release(); const proc = f.process(p); const original = fs.openSync
  t.mock.method(fs, 'openSync', function(file, ...args) { if (file === path.join(proc, 'maps')) { const e = Error('SECRET ERROR DETAIL'); e.code = 'EACCES'; throw e } return original.call(fs, file, ...args) })
  const r = f.collect(); assert.equal(r.complete, false); assert.ok(!JSON.stringify(r).includes('SECRET ERROR DETAIL'))
})
test('pointer replacement during the scan is detected', t => {
  const f = fixture(t); const a = f.release(); const b = f.release('r2'); const pointer = path.join(f.root, 'current'); fs.symlinkSync(a, pointer)
  const originalRead = fs.readSync; let changed = false
  t.mock.method(fs, 'readSync', function(...args) { if (!changed) { changed = true; fs.unlinkSync(pointer); fs.symlinkSync(b, pointer) } return originalRead.call(fs, ...args) })
  const r = f.collect(); assert.equal(r.complete, false); assert.ok(r.uncertainties.includes('pointer-changed-during-scan'))
})
test('unit symlink aliases resolve to their actual release target', t => {
  const f = fixture(t); const p = f.release(); const alias = path.join(f.directory, 'unit-alias'); fs.symlinkSync(p, alias)
  const r = f.collect({ unitReferences: { complete: true, references: [{ path: alias, kind: 'unit' }] } })
  assert.equal(r.complete, true); assert.ok(r.references.some(ref => ref.path === p))
})
test('process count fd count and directory limits fail closed', t => {
  const f = fixture(t); const p = f.release(); const proc = f.process(p); fs.symlinkSync(p, path.join(proc, 'fd', '1')); fs.symlinkSync(p, path.join(proc, 'fd', '2'))
  assert.equal(f.collect({ limits: { maxFds: 1 } }).complete, false)
  assert.equal(f.collect({ limits: { maxDirectoryEntries: 1 } }).complete, false)
  fs.cpSync(proc, path.join(f.procRoot, '43'), { recursive: true, dereference: false })
  assert.equal(f.collect({ limits: { maxProcesses: 1 } }).complete, false)
})
test('invalid limits and clocks do not throw', t => {
  const f = fixture(t)
  for (const options of [{ limits: { maxEntries: 0 } }, { limits: { unknown: 3 } }, { now: () => 1e100 }, { now: () => { throw Error('SECRET') } }]) {
    const r = f.collect(options); assert.equal(r.complete, false); assert.ok(!JSON.stringify(r).includes('SECRET'))
  }
})
test('filesystem measurement failure cannot invent available capacity', t => {
  const f = fixture(t); t.mock.method(fs, 'statfsSync', () => { throw Error('PRIVATE') })
  const r = f.collect(); assert.equal(r.complete, false); assert.deepEqual(r.filesystems, [])
})

test('a new release appearing after enumeration invalidates the snapshot', t => {
  const f = fixture(t); f.release(); const original = fs.readSync; let changed = false
  t.mock.method(fs, 'readSync', function(...args) { if (!changed) { changed = true; f.release('late') } return original.call(fs, ...args) })
  const r = f.collect(); assert.equal(r.complete, false); assert.ok(r.uncertainties.includes('control-state-changed-during-scan'))
})
test('a late deployment gate invalidates the snapshot', t => {
  const f = fixture(t); f.release(); const original = fs.readSync; let changed = false
  t.mock.method(fs, 'readSync', function(...args) { if (!changed) { changed = true; fs.mkdirSync(path.join(f.root, 'update.lock')) } return original.call(fs, ...args) })
  const r = f.collect(); assert.equal(r.complete, false); assert.ok(r.protections.some(p => p.reason === 'incomplete-observation'))
})
test('new processes appearing during the scan invalidate coverage', t => {
  const f = fixture(t); const p = f.release(); const proc = f.process(p); let changed = false
  const originalOpen = fs.openSync
  t.mock.method(fs, 'openSync', function(file, ...args) { if (!changed && file === path.join(proc, 'stat')) { changed = true; fs.cpSync(proc, path.join(f.procRoot, '43'), { recursive: true, dereference: false }) } return originalOpen.call(fs, file, ...args) })
  assert.equal(f.collect().complete, false)
})

test('Given a process chroot at a candidate When exe cwd fd and maps point elsewhere Then its root still protects the release', t => {
  const f = fixture(t), release = f.release(), outside = path.join(f.directory, 'outside')
  f.write(outside, 'outside')
  const base = f.process(outside)
  fs.unlinkSync(path.join(base, 'root')); fs.symlinkSync(release, path.join(base, 'root'))
  const r = f.collect()
  assert.equal(r.complete, false)
  assert.ok(r.references.some(ref => ref.path === release && ref.kind.startsWith('process')))
})

function device(stat) {
  const dev = BigInt(stat.dev)
  return { major: ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n), minor: (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n) }
}

test('Given a nonleader with private cwd When its leader has no candidate paths Then the task reference still protects the release', t => {
  const f = fixture(t), release = f.release(), outside = path.join(f.directory, 'outside')
  f.write(outside, 'outside'); const base = f.process(outside), thread = path.join(base, 'task/43')
  f.write(path.join(thread, 'stat'), `43 (private-fs) S ${Array(18).fill('0').join(' ')} 333 0\n`)
  fs.symlinkSync(outside, path.join(thread, 'exe')); fs.symlinkSync(release, path.join(thread, 'cwd')); fs.symlinkSync('/', path.join(thread, 'root'))
  fs.mkdirSync(path.join(thread, 'fd')); f.write(path.join(thread, 'maps'), '')
  fs.mkdirSync(path.join(thread, 'ns')); fs.symlinkSync('mnt:[1]', path.join(thread, 'ns/mnt'))
  const r = f.collect(); assert.equal(r.complete, true, JSON.stringify(r.uncertainties))
  assert.ok(r.references.some(ref => ref.path === release && ref.kind === 'process'))
})

test('Given an open descriptor whose namespace path is not visible on the host When its magiclink inode matches Then the release is protected', t => {
  const f = fixture(t), release = f.release(), outside = path.join(f.directory, 'outside')
  f.write(outside, 'outside'); const base = f.process(outside), fd = path.join(base, 'fd/3')
  fs.symlinkSync('/not-visible-in-host', fd)
  const original = fs.statSync
  t.mock.method(fs, 'statSync', (filename, ...args) => original(filename === fd ? path.join(release, 'payload') : filename, ...args))
  const r = f.collect(); assert.equal(r.complete, true)
  assert.ok(r.references.some(ref => ref.path === release && ref.kind === 'process'))
})

test('Given a mapping with an invisible path When kernel major minor and inode match Then lookup uses the inode catalog', t => {
  const f = fixture(t), release = f.release(), outside = path.join(f.directory, 'outside')
  f.write(outside, 'outside'); const base = f.process(outside), s = fs.statSync(path.join(release, 'payload')), d = device(s)
  f.write(path.join(base, 'maps'), `1000-2000 r-xp 00000000 ${d.major.toString(16)}:${d.minor.toString(16)} ${s.ino} /invisible-mapping (deleted)\n`)
  const r = f.collect(); assert.equal(r.complete, true)
  assert.ok(r.references.some(ref => ref.path === release && ref.kind === 'process'))
})

test('Given a bind mount without a candidate pathname When its namespace mountpoint inode matches Then the release remains protected', t => {
  const f = fixture(t), release = f.release(), outside = path.join(f.directory, 'outside')
  f.write(outside, 'outside'); const base = f.process(outside), s = fs.statSync(release), d = device(s)
  f.write(path.join(base, 'mountinfo'), `2 1 ${d.major}:${d.minor} /alias-origin /retained-bind rw - fixture fixture rw\n`)
  const probe = path.join(base, 'root') + '/retained-bind', original = fs.statSync
  t.mock.method(fs, 'statSync', (filename, ...args) => original(filename === probe ? release : filename, ...args))
  const r = f.collect(); assert.equal(r.complete, true, JSON.stringify(r.uncertainties))
  assert.ok(r.references.some(ref => ref.path === release && ref.kind === 'mount'))
})

test('Given an ordinary process root When it has no candidate inode or path references Then it does not protect every release', t => {
  const f = fixture(t), release = f.release(), outside = path.join(f.directory, 'outside')
  f.write(outside, 'outside'); f.process(outside)
  const r = f.collect(); assert.equal(r.complete, true)
  assert.equal(r.references.some(ref => ref.path === release), false)
})

test('Given a retained mount namespace descriptor without a visible member When collected Then coverage stays unknown', t => {
  const f = fixture(t), outside = path.join(f.directory, 'outside')
  f.release(); f.write(outside, 'outside'); const base = f.process(outside), fd = path.join(base, 'fd/3')
  fs.symlinkSync('mnt:[9999]', fd)
  const original = fs.statSync
  t.mock.method(fs, 'statSync', (filename, ...args) => original(filename === fd ? outside : filename, ...args))
  const r = f.collect(); assert.equal(r.complete, false)
  assert.ok(r.uncertainties.includes('mount-namespace-observation-incomplete'))
})

test('Given a persistent nsfs mount without a visible namespace task When collected Then no namespace is silently skipped', t => {
  const f = fixture(t), outside = path.join(f.directory, 'outside')
  f.release(); f.write(outside, 'outside'); const base = f.process(outside)
  f.write(path.join(base, 'mountinfo'), '2 1 0:0 mnt:[9999] /held-namespace rw - nsfs nsfs rw\n')
  assert.equal(f.collect().complete, false)
})

test('Given an unreadable process root When all other metadata is readable Then it cannot imply absence of references', t => {
  const f = fixture(t), outside = path.join(f.directory, 'outside')
  f.release(); f.write(outside, 'outside'); const base = f.process(outside), original = fs.statSync
  t.mock.method(fs, 'statSync', (filename, ...args) => { if (filename === path.join(base, 'root')) { const e = Error('PRIVATE-ROOT-ERROR'); e.code = 'EACCES'; throw e }; return original(filename, ...args) })
  const r = f.collect(); assert.equal(r.complete, false)
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE-ROOT-ERROR/)
})

test('Given unchanged task and descriptor identities When maps gain a candidate mapping Then the snapshot is revoked', t => {
  const f = fixture(t), release = f.release(), outside = path.join(f.directory, 'outside')
  f.write(outside, 'outside'); const base = f.process(outside), s = fs.statSync(path.join(release, 'payload')), d = device(s), original = fs.openSync
  let changed = false
  t.mock.method(fs, 'openSync', (filename, ...args) => {
    if (!changed && filename === path.join(base, 'mountinfo')) {
      changed = true
      f.write(path.join(base, 'maps'), `1000-2000 r-xp 00000000 ${d.major.toString(16)}:${d.minor.toString(16)} ${s.ino} /invisible-mapping\n`)
    }
    return original(filename, ...args)
  })
  assert.equal(f.collect().complete, false)
})

test('Given a candidate filesystem mount hidden under another mount When its point is inspected Then the hidden inode stays unknown', t => {
  const f = fixture(t), release = f.release(), outside = path.join(f.directory, 'outside')
  f.write(outside, 'outside'); const base = f.process(outside), d = device(fs.statSync(release)), original = fs.statSync
  f.write(path.join(base, 'mountinfo'), `2 1 ${d.major}:${d.minor} /hidden-origin /shadowed rw - fixture fixture rw\n3 1 0:0 /other /shadowed rw - other other rw\n`)
  const probe = path.join(base, 'root') + '/shadowed'
  t.mock.method(fs, 'statSync', (filename, ...args) => original(filename === probe ? outside : filename, ...args))
  const r = f.collect(); assert.equal(r.complete, false)
  assert.ok(r.uncertainties.includes('mount-namespace-observation-incomplete'))
})

test('Given a bind alias of the releases boundary When its mount root has no lexical candidate path Then every child release remains protected', t => {
  const f = fixture(t), release = f.release(), releaseRoot = path.dirname(release), outside = path.join(f.directory, 'outside')
  f.write(outside, 'outside'); const base = f.process(outside), d = device(fs.statSync(releaseRoot)), original = fs.statSync
  f.write(path.join(base, 'mountinfo'), `2 1 ${d.major}:${d.minor} /alias-origin /boundary-bind rw - fixture fixture rw\n`)
  const probe = path.join(base, 'root') + '/boundary-bind'
  t.mock.method(fs, 'statSync', (filename, ...args) => original(filename === probe ? releaseRoot : filename, ...args))
  const r = f.collect(); assert.equal(r.complete, true)
  assert.ok(r.references.some(ref => ref.path === releaseRoot && ref.kind === 'mount'))
})
