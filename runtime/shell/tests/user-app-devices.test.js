'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { parseDevices, parseDeviceGrants, loadDeviceGrants, loadDeviceGrantsSync, createUserAppDevices, isActiveDeviceFrame } = require('../src/user-app-devices')
const peer = '02:11:22:33:44:55', reserved = 'f0:9e:9e:11:23:cc', revision = 'a'.repeat(32)
function fixture(options = {}) {
  let app = { id: 'sensor', revision, kind: 'app', devices: { gateway: true, read: [peer], send: [peer, reserved] } }, active = true, calls = 0
  let grants = { schemaVersion: 1, grants: [{ appId: 'sensor', revision, gateway: true, read: [peer], send: [peer, reserved] }] }
  const api = createUserAppDevices({ store: { getContent: async () => ({ ok: true, app }), withCurrentRevision: async (_id, current, admit) => app.revision === current ? admit(app) : { ok: false, error: 'revision-changed' } }, readGrants: async () => grants, readGrantsNow: () => grants,
    isActive: () => active, reservedPeers: [reserved], gateway: {
      snapshot: () => ({ status: 'live', gateway: { mac: '9c:cc:01:34:31:50', firmware: '0.1.0' }, remote: { mac: reserved, status: 'ready' }, peers: [{ mac: peer, role: 'device', status: 'live' }, { mac: reserved, role: 'remote', status: 'live' }], pmk: 'secret' }),
      action: async () => { calls++; return { ok: true, delivery: 'mac-receipt' } },
    }, ...options })
  const identity = { appId: 'sensor', revision, frameToken: 'token' }
  return { api, identity, calls: () => calls, update: value => { app = value }, app: () => app, revoke: () => { grants = { schemaVersion: 1, grants: [] } }, removeFrame: () => { active = false } }
}

test('host grant revocation while catalog admission is queued prevents sending', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-device-revoke-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const grantsFile = path.join(dir, 'device-grants.json')
  await fs.writeFile(grantsFile, JSON.stringify({ schemaVersion: 1, grants: [{ appId: 'sensor', revision, send: [peer] }] }), { mode: 0o600 })
  let admit, release, calls = 0
  const waiting = new Promise(resolve => { admit = resolve })
  const queue = new Promise(resolve => { release = resolve })
  const app = { id: 'sensor', revision, kind: 'app', devices: { send: [peer] } }
  const api = createUserAppDevices({ store: { getContent: async () => ({ ok: true, app }), withCurrentRevision: async (_id, _revision, callback) => { admit(); await queue; return callback(app) } },
    grantsFile, isActive: () => true,
    gateway: { snapshot: () => ({ status: 'live', remote: { mac: reserved } }), action: () => { calls++; return { ok: true, delivery: 'mac-receipt' } } } })
  const pending = api.send({ appId: 'sensor', revision }, peer, 'eA=='); await waiting
  await fs.writeFile(grantsFile, JSON.stringify({ schemaVersion: 1, grants: [] }), { mode: 0o600 }); release()
  assert.equal((await pending).error, 'device-not-granted'); assert.equal(calls, 0); await api.close()
})
test('device declarations are bounded requests and Widgets cannot declare sends', () => {
  assert.deepEqual(parseDevices({ gateway: true, read: [peer.toUpperCase()] }, 'widget'), { gateway: true, read: [peer], send: [] })
  for (const declaration of [{ send: [peer] }, { read: ['ff:ff:ff:ff:ff:ff'] }, { read: [peer, peer] }, { gateway: true, grant: true }]) assert.throws(() => parseDevices(declaration, 'widget'), /invalid-device/)
  assert.throws(() => parseDeviceGrants({ schemaVersion: 1, grants: [{ appId: 'sensor', revision: 'latest', read: [peer] }] }), /invalid-device/)
})
test('private grant loader fails closed for public, symlink, and malformed configuration', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-device-grants-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'device-grants.json')
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, grants: [] }), { mode: 0o600 })
  assert.deepEqual(await loadDeviceGrants(file), { schemaVersion: 1, grants: [] })
  assert.deepEqual(loadDeviceGrantsSync(file), { schemaVersion: 1, grants: [] })
  await fs.chmod(file, 0o644); await assert.rejects(loadDeviceGrants(file)); assert.throws(() => loadDeviceGrantsSync(file))
  await fs.chmod(file, 0o600); await fs.symlink(file, path.join(dir, 'link')); await assert.rejects(loadDeviceGrants(path.join(dir, 'link'))); assert.throws(() => loadDeviceGrantsSync(path.join(dir, 'link')))
})
test('reads filter state by declaration and independent exact revision grants', async () => {
  const f = fixture(); const result = await f.api.read(f.identity)
  assert.equal(result.ok, true); assert.deepEqual(result.peers.map(p => p.mac), [peer]); assert.equal(result.pmk, undefined)
  f.revoke(); assert.equal((await f.api.read(f.identity)).error, 'device-not-granted')
  assert.equal(f.calls(), 0); await f.api.close()
})
test('send is bounded, grant checked, never retried, and blocks the whole reserved peer', async () => {
  const f = fixture()
  assert.deepEqual(await f.api.send(f.identity, peer, 'eA=='), { ok: true, delivery: 'mac-receipt' })
  assert.equal((await f.api.send(f.identity, reserved, 'eA==')).error, 'reserved-peer')
  assert.equal((await f.api.send(f.identity, peer, Buffer.alloc(251).toString('base64'))).error, 'invalid-device-request')
  assert.equal(f.calls(), 1)
  f.update({ ...f.app(), kind: 'widget', devices: { read: [peer] } }); assert.equal((await f.api.send(f.identity, peer, 'eA==')).error, 'device-not-granted')
  await f.api.close()
})
test('late grants, revision, frame, and runtime changes reject successful results', async () => {
  for (const change of ['revoke', 'removeFrame', 'revision']) {
    let release
    const f = fixture({ gateway: { snapshot: () => ({ status: 'live', remote: { mac: reserved } }), action: () => new Promise(resolve => { release = resolve }) } })
    const pending = f.api.send(f.identity, peer, 'eA=='); await new Promise(resolve => setImmediate(resolve))
    if (change === 'revision') f.update({ ...f.app(), revision: 'b'.repeat(32) }); else f[change]()
    release({ ok: true, delivery: 'mac-receipt' }); assert.equal((await pending).ok, false); await f.api.close()
  }
  const f = fixture(); f.removeFrame(); assert.equal((await f.api.send(f.identity, peer, 'eA==')).error, 'frame-inactive'); assert.equal(f.calls(), 0)
  await f.api.close(); assert.equal((await f.api.read(f.identity)).error, 'runtime-stopped')
})

test('device admission verifies the actual active child frame and trusted Shell root', () => {
  const { pathToFileURL } = require('node:url')
  const child = { url: `odk-user-app://app/sensor/${revision}?token=token` }
  const mainFrame = { url: pathToFileURL(path.join(__dirname, '../src/renderer/index.html')).href, framesInSubtree: [child] }
  const sender = { mainFrame }, event = { sender, senderFrame: mainFrame }, windows = [{ webContents: sender }]
  const identity = { appId: 'sensor', revision, frameToken: 'token' }
  assert.equal(isActiveDeviceFrame(event, identity, windows), true)
  assert.equal(isActiveDeviceFrame({ ...event, senderFrame: child }, identity, windows), false)
  assert.equal(isActiveDeviceFrame(event, { ...identity, frameToken: 'forged' }, windows), false)
  child.detached = true; assert.equal(isActiveDeviceFrame(event, identity, windows), false)
  child.detached = false; mainFrame.framesInSubtree = []; assert.equal(isActiveDeviceFrame(event, identity, windows), false)
})

test('served SDK bounds pending work, binds replies, and closes without replay', async () => {
  const vm = require('node:vm')
  const { buildUserAppDocument } = require('../src/user-app-content')
  const listeners = new Map(), posted = []
  const parent = { postMessage: data => posted.push(data) }
  const document = { documentElement: { dataset: {}, style: { setProperty() {} } }, readyState: 'complete' }
  const scope = { document, parent, addEventListener: (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn) } }
  const script = buildUserAppDocument('<body>Devices</body>', { token: 'token' }).match(/<script>([\s\S]*?)<\/script>/)[1]
  vm.runInNewContext(script, { window: scope, document, parent, setTimeout, clearTimeout, AbortController })
  const read = scope.odkPackageDevices.read()
  const message = posted.find(data => data.type === 'odk-user-app-device')
  assert.equal(message.request.type, 'read'); assert.equal(message.appId, undefined)
  for (const fn of listeners.get('message')) fn({ source: {}, data: { type: 'odk-user-app-device-result', token: 'token', requestId: message.requestId, result: { ok: true } } })
  for (const fn of listeners.get('message')) fn({ source: parent, data: { type: 'odk-user-app-device-result', token: 'token', requestId: message.requestId, result: { ok: true } } })
  assert.equal((await read).ok, true)
  const requests = Array.from({ length: 8 }, () => scope.odkPackageDevices.read())
  assert.equal((await scope.odkPackageDevices.read()).error, 'device-busy')
  for (const fn of listeners.get('pagehide')) fn()
  assert.ok((await Promise.all(requests)).every(result => result.error === 'frame-closed'))
  assert.equal((await scope.odkPackageDevices.send(peer, 'eA==')).error, 'frame-closed')
})

test('reserved identity absence blocks send and timeout does not replay', async () => {
  const absent = fixture({ gateway: { snapshot: () => ({ status: 'live' }), action: () => assert.fail('unknown Remote identity') } })
  assert.equal((await absent.api.send(absent.identity, peer, 'eA==')).error, 'device-unavailable'); await absent.api.close()
  let calls = 0
  const f = fixture({ timeoutMs: 10, gateway: { snapshot: () => ({ status: 'live', remote: { mac: reserved } }), action: () => { calls++; return new Promise(() => {}) } } })
  assert.equal((await f.api.send(f.identity, peer, 'eA==')).error, 'delivery-unknown'); assert.equal(calls, 1); await f.api.close()
})

test('revision replacement during private grant loading prevents transmission', async () => {
  let release
  const f = fixture({ readGrants: () => new Promise(resolve => { release = resolve }) })
  const pending = f.api.send(f.identity, peer, 'eA=='); await new Promise(resolve => setImmediate(resolve))
  f.update({ ...f.app(), revision: 'b'.repeat(32) })
  release({ schemaVersion: 1, grants: [{ appId: 'sensor', revision, send: [peer] }] })
  assert.equal((await pending).error, 'revision-changed'); assert.equal(f.calls(), 0); await f.api.close()
})

test('frame removal at the authorization microtask boundary prevents dispatch', async () => {
  let active = true, checks = 0
  const f = fixture({ isActive: () => {
    if (++checks === 2) queueMicrotask(() => { active = false })
    return active
  } })
  assert.equal((await f.api.send(f.identity, peer, 'eA==')).error, 'frame-inactive')
  assert.equal(f.calls(), 0); await f.api.close()
})

test('catalog update queued before device admission refuses the old revision without sending', async t => {
  const { createUserAppStore } = require('../src/user-app-store')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-device-admit-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const draft = path.join(dir, 'workspace/apps/sensor'); await fs.mkdir(draft, { recursive: true })
  const manifest = { schemaVersion: 1, id: 'sensor', name: 'Sensor', kind: 'app', version: '1', devices: { send: [peer] } }
  await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify(manifest)); await fs.writeFile(path.join(draft, 'index.html'), '<p>Sensor</p>')
  const store = createUserAppStore({ workspace: path.join(dir, 'workspace'), stateDir: path.join(dir, 'state'), verify: () => true })
  const installed = await store.install('sensor'); assert.equal(installed.ok, true)
  await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify({ ...manifest, version: '2' }))
  let update, calls = 0
  const api = createUserAppDevices({ store, isActive: () => true,
    readGrants: async () => ({ schemaVersion: 1, grants: [{ appId: 'sensor', revision: installed.app.revision, send: [peer] }] }),
    readGrantsNow: () => ({ schemaVersion: 1, grants: [{ appId: 'sensor', revision: installed.app.revision, send: [peer] }] }),
    gateway: { snapshot: () => { update ||= store.update('sensor'); return { status: 'live', remote: { mac: reserved } } }, action: () => { calls++; return { ok: true, delivery: 'mac-receipt' } } } })
  const result = await api.send({ appId: 'sensor', revision: installed.app.revision }, peer, 'eA==')
  assert.equal((await update).ok, true); assert.equal(result.error, 'revision-changed'); assert.equal(calls, 0); await api.close()
})

test('an admitted send releases the catalog queue and a later update fences its reply', async t => {
  const { createUserAppStore } = require('../src/user-app-store')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-device-reply-')); t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const draft = path.join(dir, 'workspace/apps/sensor'); await fs.mkdir(draft, { recursive: true })
  const manifest = { schemaVersion: 1, id: 'sensor', name: 'Sensor', kind: 'app', version: '1', devices: { send: [peer] } }
  await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify(manifest)); await fs.writeFile(path.join(draft, 'index.html'), '<p>Sensor</p>')
  const store = createUserAppStore({ workspace: path.join(dir, 'workspace'), stateDir: path.join(dir, 'state'), verify: () => true })
  const installed = await store.install('sensor'); assert.equal(installed.ok, true)
  let release, admitted
  const started = new Promise(resolve => { admitted = resolve })
  const api = createUserAppDevices({ store, isActive: () => true,
    readGrants: async () => ({ schemaVersion: 1, grants: [{ appId: 'sensor', revision: installed.app.revision, send: [peer] }] }),
    readGrantsNow: () => ({ schemaVersion: 1, grants: [{ appId: 'sensor', revision: installed.app.revision, send: [peer] }] }),
    gateway: { snapshot: () => ({ status: 'live', remote: { mac: reserved } }), action: () => { admitted(); return new Promise(resolve => { release = resolve }) } } })
  const pending = api.send({ appId: 'sensor', revision: installed.app.revision }, peer, 'eA=='); await started
  await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify({ ...manifest, version: '2' }))
  const updated = await store.update('sensor'); assert.equal(updated.ok, true)
  release({ ok: true, delivery: 'mac-receipt' }); assert.equal((await pending).error, 'revision-changed'); await api.close()
})
