const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createUserAppStore } = require('../src/user-app-store')

const roots = []
test.after(async () => { await Promise.all(roots.map(root => fs.rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odesk-svc-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace')
  const stateDir = path.join(root, 'state')
  await fs.mkdir(path.join(workspace, 'apps'), { recursive: true })
  return { workspace, stateDir }
}
async function draftService(workspace, id, service) {
  const dir = path.join(workspace, 'apps', id)
  await fs.mkdir(dir, { recursive: true })
  const manifest = { id, name: id, version: '1', kind: 'widget', schemaVersion: 1 }
  if (service !== undefined) manifest.service = service
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(dir, 'index.html'), '<p>one</p>')
}
const validService = () => ({
  id: 'futu-poller',
  exec: 'service/poller.py',
  version: '1',
  secrets: ['futu-trade-password'],
  egress: [{ host: '10.10.0.195', port: 11111 }],
  socket: 'futu-poller.sock',
})

test('rejects a service exec entry outside the package', async () => {
  const f = await fixture()
  const store = createUserAppStore({ ...f, verify: () => true })
  await draftService(f.workspace, 'evil', { ...validService(), exec: '/bin/poller' })
  assert.equal((await store.install('evil')).error, 'invalid-manifest')
  await draftService(f.workspace, 'evil', { ...validService(), exec: '../escape.py' })
  assert.equal((await store.install('evil')).error, 'invalid-manifest')
})

test('rejects a service without a version, with an empty allowlist, or smuggling a secret value', async () => {
  const f = await fixture()
  const store = createUserAppStore({ ...f, verify: () => true })
  await draftService(f.workspace, 'bad', { ...validService(), version: '' })
  assert.equal((await store.install('bad')).error, 'invalid-manifest')
  await draftService(f.workspace, 'bad', { ...validService(), egress: [] })
  assert.equal((await store.install('bad')).error, 'invalid-manifest')
  await draftService(f.workspace, 'bad', { ...validService(), secrets: ['futu-trade-password', 'sk-live-abc123!'] })
  assert.equal((await store.install('bad')).error, 'invalid-manifest')
  await draftService(f.workspace, 'bad', { ...validService(), token: 'smuggled' })
  assert.equal((await store.install('bad')).error, 'invalid-manifest')
})

test('a failed service candidate leaves the installed revision untouched', async () => {
  const f = await fixture()
  const store = createUserAppStore({ ...f, verify: () => true })
  await draftService(f.workspace, 'futu', validService())
  assert.equal((await store.install('futu')).ok, true)
  await draftService(f.workspace, 'futu', { ...validService(), exec: '/bin/evil' })
  assert.equal((await store.update('futu')).error, 'invalid-manifest')
  const current = await store.getContent('futu')
  assert.deepEqual(current.app.service, validService())
})

test('installs a valid service declaration and carries it on the revision', async () => {
  const f = await fixture()
  const store = createUserAppStore({ ...f, verify: () => true })
  await draftService(f.workspace, 'futu', validService())
  const installed = await store.install('futu')
  assert.equal(installed.ok, true)
  assert.deepEqual(installed.app.service, validService())
})
