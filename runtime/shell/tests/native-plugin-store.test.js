'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { createNativePluginStore } = require('../src/native-plugin-store')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-native-store-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const source = path.join(root, 'source')
  const stateDir = path.join(root, 'state')
  await fs.mkdir(source)
  const keys = crypto.generateKeyPairSync('ed25519')
  const keyring = new Map([['fixture', { publicKey: keys.publicKey, identities: ['odk.test.native'], hosts: ['electron-main'] }]])
  const manifest = { schemaVersion: 1, id: 'odk.test.native', name: 'Native fixture', version: '1.0.0',
    host: 'electron-main', kind: 'service', entry: 'entry.cjs', provides: [], requires: [], permissions: [] }
  const marker = path.join(root, 'executed')
  await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(source, 'entry.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); exports.create = () => ({})`)
  async function sign(files = ['entry.cjs', 'manifest.json'], overrides = {}) {
    const inventory = []
    for (const file of files) inventory.push({ path: file, sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(source, file))).digest('hex') })
    const payload = { schemaVersion: 1, keyId: 'fixture', replace: false, files: inventory, ...overrides }
    const signature = crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64')
    await fs.writeFile(path.join(source, 'bundle.json'), JSON.stringify({ ...payload, signature }))
  }
  await sign()
  return { root, source, stateDir, manifest, keyring, sign, marker, store: createNativePluginStore({ stateDir, keyring }) }
}

test('signed native staging snapshots exact bytes without executing entries or changing sources', async t => {
  const f = await fixture(t)
  const result = await f.store.stage(f.source)
  assert.match(result.revision, /^[a-f0-9]{64}$/)
  assert.equal(result.manifest.id, f.manifest.id)
  await assert.rejects(fs.stat(f.marker), { code: 'ENOENT' })
  const pinned = await f.store.read(result.revision)
  assert.equal(await fs.readFile(pinned.entry, 'utf8'), await fs.readFile(path.join(f.source, 'entry.cjs'), 'utf8'))
  await fs.writeFile(path.join(f.source, 'entry.cjs'), 'changed source')
  assert.notEqual(await fs.readFile((await f.store.read(result.revision)).entry, 'utf8'), 'changed source')
})

test('native verification refuses altered bytes, unknown keys, unauthorized owners, and missing inventory', async t => {
  const f = await fixture(t)
  await fs.writeFile(path.join(f.source, 'entry.cjs'), 'altered')
  await assert.rejects(f.store.stage(f.source), /hash/)
  await f.sign()
  await assert.rejects(createNativePluginStore({ stateDir: f.stateDir, keyring: new Map() }).stage(f.source), /publisher/)
  const denied = new Map([['fixture', { ...f.keyring.get('fixture'), identities: ['odk.other.native'] }]])
  await assert.rejects(createNativePluginStore({ stateDir: f.stateDir, keyring: denied }).stage(f.source), /identity/)
  await f.sign(['manifest.json'])
  await assert.rejects(f.store.stage(f.source), /inventory/)
})

test('native verification rejects bad signatures, unsafe paths, links, unlisted assets and case collisions', async t => {
  const f = await fixture(t)
  const original = JSON.parse(await fs.readFile(path.join(f.source, 'bundle.json'), 'utf8'))
  await fs.writeFile(path.join(f.source, 'bundle.json'), JSON.stringify({ ...original, signature: Buffer.alloc(64).toString('base64') }))
  await assert.rejects(f.store.stage(f.source), /signature/)
  await f.sign(undefined, { files: [{ path: '../escape.cjs', sha256: 'a'.repeat(64) }] })
  await assert.rejects(f.store.stage(f.source), /path/)
  await f.sign()
  await fs.writeFile(path.join(f.source, 'unlisted.txt'), 'extra')
  await assert.rejects(f.store.stage(f.source), /inventory/)
  await fs.rm(path.join(f.source, 'unlisted.txt'))
  await fs.mkdir(path.join(f.source, 'unsigned-directory'))
  await assert.rejects(f.store.stage(f.source), /inventory/)
  await fs.rmdir(path.join(f.source, 'unsigned-directory'))
  await fs.symlink('entry.cjs', path.join(f.source, 'linked.cjs'))
  await assert.rejects(f.store.stage(f.source), /link|unsafe/)
  await fs.rm(path.join(f.source, 'linked.cjs'))
  await f.sign(undefined, { files: [original.files[0], { ...original.files[0], path: 'ENTRY.cjs' }, original.files[1]] })
  await assert.rejects(f.store.stage(f.source), /path/)
  await f.sign(undefined, { files: [{ path: 'Assets/one.js', sha256: 'a'.repeat(64) },
    { path: 'assets/two.js', sha256: 'a'.repeat(64) }, ...original.files] })
  await assert.rejects(f.store.stage(f.source), /path case collision/)
})

test('stored corruption is rejected on every read and failed staging preserves earlier revisions', async t => {
  const f = await fixture(t)
  const first = await f.store.stage(f.source)
  await f.store.stage(f.source)
  await fs.writeFile(path.join(f.source, 'entry.cjs'), 'unsigned update')
  await assert.rejects(f.store.stage(f.source), /hash/)
  assert.equal((await f.store.read(first.revision)).manifest.version, '1.0.0')
  const pinned = await f.store.read(first.revision)
  await fs.writeFile(pinned.entry, 'corrupt stored file')
  await assert.rejects(f.store.read(first.revision), /hash/)
  await assert.rejects(f.store.read('../escape'), /revision/)
})

test('concurrent native stores publish one complete revision and key revocation blocks later reads', async t => {
  const f = await fixture(t)
  const other = createNativePluginStore({ stateDir: f.stateDir, keyring: f.keyring })
  const results = await Promise.all([f.store.stage(f.source), other.stage(f.source)])
  assert.equal(results[0].revision, results[1].revision)
  assert.deepEqual(await fs.readdir(path.join(f.stateDir, 'revisions')), [results[0].revision])
  assert.equal((await other.read(results[0].revision)).manifest.id, f.manifest.id)
  f.keyring.delete('fixture')
  await assert.rejects(f.store.read(results[0].revision), /publisher/)
})

test('renderer native snapshots retain signed CSS and declared entry without executing either', async t => {
  const f = await fixture(t)
  const manifest = { ...f.manifest, id: 'odk.tile.clock', host: 'electron-renderer', kind: 'surface', surfaceKind: 'tile',
    entry: 'entry.js', css: 'assets/clock.css', provides: [{ interface: 'odk:surface/odk.tile.clock/v1' }] }
  f.keyring.set('fixture', { ...f.keyring.get('fixture'), identities: [manifest.id], hosts: [manifest.host] })
  await fs.writeFile(path.join(f.source, 'manifest.json'), JSON.stringify(manifest))
  await fs.rename(path.join(f.source, 'entry.cjs'), path.join(f.source, 'entry.js'))
  await fs.mkdir(path.join(f.source, 'assets'))
  await fs.writeFile(path.join(f.source, 'assets/clock.css'), '.clock { color: white; }')
  await f.sign(['assets/clock.css', 'entry.js', 'manifest.json'], { replace: true })
  const result = await f.store.stage(f.source)
  const pinned = await f.store.read(result.revision)
  assert.equal(pinned.replacement, true)
  assert.equal(await fs.readFile(pinned.css, 'utf8'), '.clock { color: white; }')
  await assert.rejects(fs.stat(f.marker), { code: 'ENOENT' })
})

test('native package limits and root links are rejected before publication', async t => {
  const f = await fixture(t)
  const alias = path.join(f.root, 'source-alias')
  await fs.symlink(f.source, alias)
  await assert.rejects(f.store.stage(alias), /unsafe/)
  await fs.writeFile(path.join(f.source, 'entry.cjs'), Buffer.alloc(4 * 1024 * 1024 + 1))
  await f.sign()
  await assert.rejects(f.store.stage(f.source), /large/)
  await fs.writeFile(path.join(f.source, 'entry.cjs'), 'small')
  await f.sign(undefined, { files: Array.from({ length: 65 }, (_, index) => ({ path: `file${index}`, sha256: 'a'.repeat(64) })) })
  await assert.rejects(f.store.stage(f.source), /bundle/)
  await assert.rejects(fs.stat(path.join(f.stateDir, 'revisions')), { code: 'ENOENT' })
})

test('a manifest changed between signature verification and declaration validation is rejected', async t => {
  const f = await fixture(t)
  const first = await f.store.stage(f.source)
  const pinned = await f.store.read(first.revision)
  const syncFs = require('node:fs')
  const original = syncFs.realpathSync
  try {
    syncFs.realpathSync = function (file, ...args) {
      const resolved = original.call(this, file, ...args)
      if (resolved === pinned.root) syncFs.writeFileSync(path.join(pinned.root, 'manifest.json'),
        JSON.stringify({ ...f.manifest, id: 'odk.unauthorized.native' }))
      return resolved
    }
    await assert.rejects(f.store.read(first.revision), /manifest changed/)
  } finally { syncFs.realpathSync = original }
})

test('a linked destination root is rejected before writing outside the store', async t => {
  const f = await fixture(t)
  const outside = path.join(f.root, 'outside')
  await fs.mkdir(outside)
  await fs.symlink(outside, f.stateDir)
  await assert.rejects(f.store.stage(f.source), /unsafe/)
  assert.deepEqual(await fs.readdir(outside), [])
})
