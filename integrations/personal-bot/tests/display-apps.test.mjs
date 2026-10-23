import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, realpath, readFile, readdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listen } from '../src/socket.mjs'
import { createDisplayRelay } from '../src/display-relay.mjs'
import { readFrames, writeFrame } from '../src/channel-frames.mjs'
import { endpoint, fixtureToken } from './helpers/private-channel.mjs'
import { createDisplayAppsBroker, originatingAppsRequest, createDisplayApplications } from '../src/display-apps.mjs'
import { loadShellModule } from '../src/plugin-composition.mjs'
const { createUserAppStore } = loadShellModule('user-app-store.js', import.meta.url)

async function until(check) {
  const deadline = Date.now() + 2000
  while (!check()) {
    if (Date.now() > deadline) assert.fail('Expected application route did not arrive')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('display text binds lifecycle to its own Shell and disconnect never redirects it', { timeout: 5000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'odk-desk-apps-'))
  const hub = endpoint(root, 'hub'), local = endpoint(root, 'local')
  let binding
  const calls = [], sockets = []
  const service = { status: { v: 1, type: 'status', state: 'idle', textInput: true }, subscribe: () => () => {},
    sendText(_text, _reply, applications) { binding = applications; return true } }
  const server = await listen(hub, service, { token: fixtureToken })
  const relay = await createDisplayRelay({ endpoint: local, stateDir: root, token: fixtureToken, alias: 'cm5-agent',
    connect() { const s = net.connect(hub); sockets.push(s); if (process.platform === 'win32') s.once('connect', () => s.write(JSON.stringify({v:1,token:fixtureToken})+'\n')); return s },
    applications: { host: { name: 'HANDHELD', platform: 'win32' }, async request(command, params) { calls.push([command, params]); return { ok: true, apps: [{ id: 'win-clock' }], boundedCatalog: 'x'.repeat(140000) } } }, reconnectMs: 10000 })
  const client = net.connect(local), frames = []
  t.after(async () => { client.destroy(); await relay.close(); await server.close(); await rm(root, { recursive: true, force: true }) })
  readFrames(client, frame => { frames.push(frame) })
  await once(client, 'connect')
  if (process.platform === 'win32') client.write(JSON.stringify({v:1,token:fixtureToken})+'\n')
  await writeFrame(client, { v: 1, type: 'status' })
  await until(() => frames.some(f => f.state === 'idle'))
  await writeFrame(client, { v: 1, type: 'text', requestId: randomUUID(), text: 'Create on this handheld' })
  await until(() => frames.some(f => f.type === 'text_receipt'))
  assert.ok(binding, 'The central owner turn must retain the originating display')
  assert.deepEqual(binding.host, { name: 'HANDHELD', platform: 'win32' })
  const result = await binding.request('list', {})
  assert.equal(result.apps[0].id, 'win-clock')
  assert.equal(result.boundedCatalog.length, 140000, 'Application receipts may exceed the legacy status frame limit')
  assert.equal(calls.length, 1)
  const bundle = { manifest: 'eA==', html: Buffer.alloc(256 * 1024, 120).toString('base64'), digest: 'a'.repeat(64) }
  await binding.request('install', { appId: 'win-clock', bundle })
  assert.deepEqual(calls[1], ['install', { appId: 'win-clock', bundle }])
  assert.equal(frames.some(f => f.type.startsWith('host_apps_')), false, 'Internal application frames must not reach renderers')
  sockets[0].destroy()
  await once(sockets[0], 'close')
  await assert.rejects(binding.request('remove', { appId: 'win-clock' }), /unavailable|unknown/i)
  assert.equal(calls.length, 2)
})

test('import verifies exact draft bytes locally and updates the same application identity', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-import-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'source'), stateDir = join(root, 'display'), installed = join(root, 'installed')
  await mkdir(join(workspace, 'apps', 'win-clock'), { recursive: true })
  await mkdir(stateDir, { mode: 0o700 })
  const verified = []
  const store = createUserAppStore({ stateDir: installed, workspace: '/unconfigured-local-workspace',
    verify: async bundle => { verified.push(bundle); return { ok: true } } })
  const local = createDisplayApplications({ stateDir, request: async (command, params) => {
    assert.equal(command, 'add')
    assert.notEqual(params.sourcePath, join(workspace, 'apps', 'win-clock'))
    const result = await store.addFromPath(params.sourcePath, params.placement)
    return result
  } })
  const binding = { request: (command, params) => local.request(command, params) }
  const manifest = { schemaVersion: 1, id: 'win-clock', name: 'Windows Clock', version: '1', kind: 'app' }
  async function draft(version) {
    manifest.version = version
    await writeFile(join(workspace, 'apps', 'win-clock', 'manifest.json'), JSON.stringify(manifest))
    await writeFile(join(workspace, 'apps', 'win-clock', 'index.html'), '<!doctype html><html><body><h1>UTC ' + version + '</h1></body></html>')
  }
  await draft('1')
  const first = await originatingAppsRequest(binding, 'install', { appId: 'win-clock' }, workspace)
  assert.equal(first.ok, true)
  await draft('2')
  const second = await originatingAppsRequest(binding, 'install', { appId: 'win-clock' }, workspace)
  assert.equal(second.app.version, '2')
  assert.notEqual(second.app.revision, first.app.revision)
  assert.equal((await store.list()).length, 1)
  assert.equal(verified.length, 2)
  assert.match(verified[1].htmlBytes.toString(), /UTC 2/)
  assert.deepEqual(await readdir(join(stateDir, 'application-imports')), [])
  const bundles = []
  await originatingAppsRequest({ request: async (_command, params) => { bundles.push(params.bundle) } }, 'install', { appId: 'win-clock' }, workspace)
  const corrupt = { ...bundles[0], html: Buffer.from('changed').toString('base64') }
  await assert.rejects(local.request('install', { appId: 'win-clock', bundle: corrupt }), /identity mismatch/)
  assert.equal((await store.list())[0].revision, second.app.revision)
  await writeFile(join(workspace, 'apps', 'win-clock', 'manifest.json'), JSON.stringify({ ...manifest, id: 'foreign-app' }))
  await assert.rejects(originatingAppsRequest(binding, 'install', { appId: 'win-clock' }, workspace), /identity mismatch/)
  await assert.rejects(originatingAppsRequest(binding, 'install', { appId: '../foreign' }, workspace), /workspace unavailable/)
  await t.test('source symlinks are rejected', { skip: process.platform === 'win32' ? 'Requires POSIX symlink creation; Windows bundle identity checks run above' : false }, async () => {
    await rm(join(workspace, 'apps', 'win-clock', 'index.html'))
    await symlink(join(workspace, 'apps', 'win-clock', 'manifest.json'), join(workspace, 'apps', 'win-clock', 'index.html'))
    await assert.rejects(originatingAppsRequest(binding, 'install', { appId: 'win-clock' }, workspace), /unsafe-file/)
  })
  assert.equal(await readFile(join(workspace, 'apps', 'win-clock', 'manifest.json'), 'utf8'), JSON.stringify({ ...manifest, id: 'foreign-app' }))
})

test('correlation, cancellation and deadlines never transfer mutation authority', async () => {
  const sent = []
  const broker = createDisplayAppsBroker({ send: async frame => { sent.push(frame) }, timeoutMs: 20 })
  await broker.handle({ v: 1, type: 'host_apps_hello', host: { name: 'WIN', platform: 'win32' } })
  const pending = broker.binding.request('remove', { appId: 'win-clock' })
  await new Promise(resolve => setImmediate(resolve))
  await broker.handle({ v: 1, type: 'host_apps_response', requestId: randomUUID(), result: { ok: true } })
  const timer = setTimeout(() => {}, 100)
  try { await assert.rejects(pending, /unknown; do not retry/) } finally { clearTimeout(timer) }
  assert.equal(sent.filter(f => f.type === 'host_apps_request').length, 1)
  await broker.handle({ v: 1, type: 'host_apps_response', requestId: sent[1].requestId, result: { ok: true } })
  const controller = new AbortController()
  const aborted = broker.binding.request('install', { appId: 'win-clock' }, controller.signal)
  controller.abort()
  await assert.rejects(aborted, /unknown/)
  broker.close()
  await assert.rejects(broker.binding.request('list'), /unavailable/)
})
