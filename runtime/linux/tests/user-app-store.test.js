const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createUserAppStore } = require('../src/user-app-store')

const roots = []
test.after(async () => { await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odesk-store-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace')
  const stateDir = path.join(root, 'state')
  await fs.mkdir(path.join(workspace, 'apps'), { recursive: true })
  return { root, workspace, stateDir }
}
async function draft(workspace, id, version, html = `<p>${version}</p>`) {
  const dir = path.join(workspace, 'apps', id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ id, name: id, version, kind: 'app', schemaVersion: 1 }))
  await fs.writeFile(path.join(dir, 'index.html'), html)
}

test('installs immutable content, updates, restarts, rolls back, and removes without user data loss', async () => {
  const f = await fixture(); await draft(f.workspace, 'notes', '1', '<p>one</p>')
  const store = createUserAppStore({ workspace: f.workspace, stateDir: f.stateDir, verify: () => true })
  const first = await store.install('notes'); assert.equal(first.ok, true)
  const oldRevision = first.app.revision
  await draft(f.workspace, 'notes', '2', '<p>two</p>')
  const second = await store.update('notes'); assert.equal(second.ok, true); assert.notEqual(second.app.revision, oldRevision)
  const restarted = createUserAppStore({ workspace: f.workspace, stateDir: f.stateDir, verify: () => true })
  assert.equal((await restarted.getContent('notes')).html, '<p>two</p>')
  assert.equal((await restarted.rollback('notes')).ok, true)
  assert.equal((await restarted.getContent('notes')).html, '<p>one</p>')
  assert.equal((await restarted.remove('notes')).ok, true)
  assert.equal((await restarted.list()).length, 0)
  assert.equal(await fs.readFile(path.join(f.workspace, 'apps/notes/index.html'), 'utf8'), '<p>two</p>')
})

test('failed verification preserves active revision and verifier cannot mutate bytes', async () => {
  const f = await fixture(); await draft(f.workspace, 'x', '1', '<p>one</p>')
  let reject = false
  const verify = ({ manifest, html, manifestBytes, htmlBytes }) => { manifest.version = 'mutated'; manifestBytes[0] = 0; htmlBytes[0] = 0; return !reject && html === '<p>one</p>' }
  const store = createUserAppStore({ workspace: f.workspace, stateDir: f.stateDir, verify })
  await store.install('x'); await draft(f.workspace, 'x', '2', '<p>two</p>'); reject = true
  assert.deepEqual(await store.update('x'), { ok: false, error: 'verification-failed' })
  assert.equal((await store.getContent('x')).html, '<p>one</p>')
  const restarted = createUserAppStore({ workspace: f.workspace, stateDir: f.stateDir, verify: () => true })
  assert.equal((await restarted.getContent('x')).html, '<p>one</p>')
})

test('rejects unconfigured, unsafe, malformed, symlink, and oversized packages', async () => {
  const f = await fixture(); const store = createUserAppStore({ workspace: f.workspace, stateDir: f.stateDir, verify: () => true })
  assert.deepEqual(await store.install('x'), { ok: false, error: 'package-not-found' })
  assert.deepEqual(await store.install('../x'), { ok: false, error: 'invalid-identifier' })
  await fs.symlink('/tmp', path.join(f.workspace, 'apps', 'link')); assert.equal((await store.install('link')).error, 'unsafe-package')
  await draft(f.workspace, 'bad', '1'); await fs.writeFile(path.join(f.workspace, 'apps/bad/manifest.json'), '{'); assert.equal((await store.install('bad')).error, 'invalid-manifest')
  await draft(f.workspace, 'huge', '1', 'x'.repeat(2 * 1024 * 1024 + 1)); assert.equal((await store.install('huge')).error, 'package-too-large')
  const unconfigured = createUserAppStore({ workspace: path.join(f.root, 'missing'), stateDir: f.stateDir })
  assert.deepEqual(await unconfigured.install('x'), { ok: false, error: 'workspace-not-configured' })
})

test('fails closed on altered persisted entries after restart and enforces catalog limit', async () => {
  const f = await fixture(); const store = createUserAppStore({ workspace: f.workspace, stateDir: f.stateDir, verify: () => true })
  for (let i = 0; i < 32; i++) { const id = `app-${i}`; await draft(f.workspace, id, '1'); assert.equal((await store.install(id)).ok, true) }
  await draft(f.workspace, 'overflow', '1'); assert.deepEqual(await store.install('overflow'), { ok: false, error: 'catalog-limit' })
  const catalog = JSON.parse(await fs.readFile(path.join(f.stateDir, 'user-apps.json')))
  catalog[0].revision = '../escape'; catalog[1].digest = 'altered'
  await fs.writeFile(path.join(f.stateDir, 'user-apps.json'), JSON.stringify(catalog))
  const restarted = createUserAppStore({ workspace: f.workspace, stateDir: f.stateDir })
  await assert.rejects(() => restarted.list(), /catalog-corrupt/)
  assert.deepEqual(await restarted.install('app-0'), { ok: false, error: 'catalog-corrupt' })
})

test('retains two revisions and removal works without the draft checkout', async () => {
  const f = await fixture()
  const store = createUserAppStore({ ...f, verify: () => true })
  for (const version of ['1', '2', '3']) {
    await draft(f.workspace, 'notes', version)
    assert.equal((await store.install('notes')).ok, true)
  }
  assert.equal((await fs.readdir(path.join(f.stateDir, 'apps/notes/revisions'))).length, 2)
  await fs.rm(f.workspace, { recursive: true })
  assert.equal((await store.list()).length, 1)
  assert.equal((await store.remove('notes')).ok, true)
  assert.equal((await fs.readdir(path.join(f.stateDir, 'apps/notes/revisions'))).length, 0)
})

test('storage symlink cannot redirect snapshot writes', async () => {
  const f = await fixture()
  await draft(f.workspace, 'notes', '1')
  await fs.mkdir(f.stateDir)
  const outside = path.join(f.root, 'outside')
  await fs.mkdir(outside)
  await fs.symlink(outside, path.join(f.stateDir, 'apps'))
  const result = await createUserAppStore({ ...f, verify: () => true }).install('notes')
  assert.equal(result.ok, false)
  assert.deepEqual(await fs.readdir(outside), [])
})

test('failed atomic catalog persistence preserves the prior revision', async () => {
  const f = await fixture()
  await draft(f.workspace, 'notes', '1')
  const store = createUserAppStore({ ...f, verify: () => true })
  const first = await store.install('notes')
  const catalogPath = path.join(f.stateDir, 'user-apps.json')
  const original = await fs.readFile(catalogPath)
  await draft(f.workspace, 'notes', '2')
  const interrupted = createUserAppStore({ ...f, verify: async () => {
    await fs.unlink(catalogPath)
    await fs.mkdir(catalogPath)
    return true
  } })
  assert.equal((await interrupted.install('notes')).ok, false)
  await fs.rmdir(catalogPath)
  await fs.writeFile(catalogPath, original)
  assert.equal((await store.list())[0].revision, first.app.revision)
  assert.deepEqual(await fs.readdir(path.join(f.stateDir, 'apps/notes/revisions')), [first.app.revision])
})

test('serializes concurrent installs without losing catalog entries', async () => {
  const f = await fixture(); const ids = ['a', 'b', 'c', 'd']
  await Promise.all(ids.map((id) => draft(f.workspace, id, '1')))
  const store = createUserAppStore({ workspace: f.workspace, stateDir: f.stateDir, verify: () => true })
  const results = await Promise.all(ids.map((id) => store.install(id)))
  assert.equal(results.every((r) => r.ok), true)
  assert.deepEqual((await store.list()).map((a) => a.id).sort(), ids)
})
