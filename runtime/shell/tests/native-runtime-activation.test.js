'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const { createPluginHost } = require('../src/plugin-host')
const { createPluginControl, createPluginControlPlugin } = require('../src/plugin-control')
const { createNativePluginStore } = require('../src/native-plugin-store')
const { createNativePluginManager } = require('../src/native-plugin-manager')
const { readConfig, writeConfig } = require('../src/plugin-config')
const { resolveShellHost } = require('../src/platform')
const { posixOnlyReason } = require('./not-ported')
const run = promisify(execFile)
const id = 'odk.test.activation'
const port = 'odk:test/activation/v1'
const manifest = { schemaVersion: 1, id, name: 'Activation fixture', version: '1.0.0', kind: 'service',
  host: 'electron-main', entry: 'entry.cjs', provides: [{ interface: port }], requires: [], permissions: ['fixture'] }

async function fixture(t, { channel = false, load } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-activate-'))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
    LOCALAPPDATA: path.join(root, 'state'), XDG_RUNTIME_DIR: root }
  const configPath = path.join(env.OPEN_DESKOS_CONFIG_DIR, 'plugins.json')
  const keys = crypto.generateKeyPairSync('ed25519')
  env.OPEN_DESKOS_NATIVE_KEYRING = path.join(root, 'publishers.json')
  const policy = { schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: [id], hosts: ['electron-main'],
  } } }
  await fs.writeFile(env.OPEN_DESKOS_NATIVE_KEYRING, JSON.stringify(policy))
  const platform = resolveShellHost({ env })
  const store = createNativePluginStore({ stateDir: path.join(platform.stateDir, 'plugins/native'),
    keyring: new Map([['fixture', { publicKey: keys.publicKey, identities: [id], hosts: ['electron-main'] }]]) })
  const manager = createNativePluginManager({ store, configPath })
  async function select(version, { fail = false } = {}) {
    const source = path.join(root, version)
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest, version }))
    await fs.writeFile(path.join(source, 'entry.cjs'), `exports.create = ctx => { const trace = ctx.capability('fixture'); trace.push('create:${version}');
      ctx.onCleanup(() => { trace.push('cleanup:${version}'); if (trace.failCleanup) throw Error('private retained cleanup'); });
      return { ports: { '${port}': { version: '${version}' } }, start() { ${fail ? "throw Error('private candidate failure')" : ''} } }; };`)
    const files = await Promise.all(['entry.cjs', 'manifest.json'].map(async name => ({ path: name,
      sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(source, name))).digest('hex') })))
    const payload = { schemaVersion: 1, keyId: 'fixture', replace: false, files }
    await fs.writeFile(path.join(source, 'bundle.json'), JSON.stringify({ ...payload,
      signature: crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64') }))
    if (version === '2.0.0') await manager.install(source, { trust: true, grants: ['fixture'] })
    else await manager.update(id, source, { trust: true, grants: ['fixture'] })
    return readConfig(configPath).plugins[id].native.revision
  }
  await select('2.0.0')
  const trace = []
  const signal = new AbortController()
  const host = createPluginHost({ capabilities: { fixture: trace, 'plugin.control': {
    endpoint: platform.endpoint('plugin-control'), stateDir: platform.stateDir, platform: platform.platform,
    snapshot: () => host.list(), setEnabled: (...args) => host.setEnabled(...args),
    activate: (...args) => activate(...args),
  } } })
  host.register({ manifest, create(ctx) { trace.push('create:default'); ctx.onCleanup(() => trace.push('cleanup:default'));
    if (trace.failDefault) throw Error('private default failure')
    return { ports: { [port]: { version: 'default' } } } } })
  host.register({ manifest: { schemaVersion: 1, id: 'odk.test.consumer', name: 'Consumer', version: '1.0.0',
    kind: 'service', host: 'electron-main', provides: [], requires: [{ interface: port }], permissions: [] },
    create(ctx) { trace.push(`consumer:${ctx.get(port).version}`); ctx.onCleanup(() => trace.push('cleanup:consumer')); return {} } })
  if (channel) host.register(createPluginControlPlugin())
  const { createNativeRuntimeActivator } = require('../src/native-runtime-activation')
  const defaultDefinition = host.definition(id)
  const activate = createNativeRuntimeActivator({ host, env, configPath, defaults: [defaultDefinition], ...(load ? { load } : {}) })
  const control = createPluginControl({ snapshot: () => host.list(), signal: signal.signal, activate,
    setEnabled: (...args) => host.setEnabled(...args) })
  t.after(async () => { signal.abort(); await host.stop(); await fs.rm(root, { recursive: true, force: true }) })
  await host.start()
  return { root, env, configPath, store, manager, host, control, signal, trace, select, activate, defaultDefinition }
}

const request = { command: 'activate', pluginId: id }

test('Main activation rereads signed revisions, restarts consumers, and preserves preferences', async t => {
  const f = await fixture(t)
  for (const version of ['2.0.0', '3.0.0']) {
    const revision = version === '2.0.0' ? readConfig(f.configPath).plugins[id].native.revision : await f.select(version)
    const before = await fs.readFile(f.configPath, 'utf8')
    assert.deepEqual(await f.control.dispatch(request), { ok: true, scope: 'electron-main', pluginId: id,
      revision, version, state: 'running' })
    assert.equal(f.host.get(port).version, version)
    assert.equal(await fs.readFile(f.configPath, 'utf8'), before)
    assert.equal(f.trace.at(-1), `consumer:${version}`)
  }
  assert.deepEqual(f.trace.slice(0, 7), ['create:default', 'consumer:default', 'cleanup:consumer', 'cleanup:default',
    'create:2.0.0', 'consumer:2.0.0', 'cleanup:consumer'])
})

test('activation refuses changed trust, grants, host, disabled state, policy, and bytes before release', async t => {
  for (const change of ['trust', 'grants', 'host', 'disabled', 'runtime-disabled', 'policy', 'bytes', 'missing-selection', 'environment-disabled']) {
    await t.test(change, async t => {
      const f = await fixture(t)
      const config = readConfig(f.configPath)
      const selection = config.plugins[id].native
      if (change === 'trust') selection.trustAcknowledgedAt = 'invalid'
      if (change === 'grants') selection.grants = []
      if (change === 'host') selection.host = 'electron-renderer'
      if (change === 'disabled') config.plugins[id].enabled = false
      if (change === 'missing-selection') delete config.plugins[id].native
      if (change === 'runtime-disabled') await f.host.setEnabled(id, false)
      if (change === 'environment-disabled') f.env.ODESK_DISABLED_PLUGINS = id
      if (change === 'policy') await fs.writeFile(f.env.OPEN_DESKOS_NATIVE_KEYRING, JSON.stringify({ schemaVersion: 1, publishers: {} }))
      if (change === 'bytes') await fs.writeFile((await f.store.read(selection.revision)).entry, 'throw Error("private corrupt bytes")')
      // Bypass the writer only to exercise a malformed persisted trust record.
      if (change === 'trust') await fs.writeFile(f.configPath, JSON.stringify(config))
      else writeConfig(f.configPath, config)
      const before = [...f.trace]
      assert.deepEqual(await f.control.dispatch(request), { ok: false, error: 'activation-failed' })
      assert.deepEqual(f.trace, before)
      assert.equal(f.host.get(port)?.version, change === 'runtime-disabled' ? undefined : 'default')
    })
  }
})

test('candidate failure rolls back without claiming activation or changing selection', async t => {
  const f = await fixture(t)
  await f.control.dispatch(request)
  await f.select('3.0.0', { fail: true })
  const before = await fs.readFile(f.configPath, 'utf8')
  assert.deepEqual(await f.control.dispatch(request), { ok: false, error: 'activation-failed' })
  assert.equal(f.host.get(port).version, '2.0.0')
  assert.equal(f.trace.at(-1), 'consumer:2.0.0')
  assert.equal(await fs.readFile(f.configPath, 'utf8'), before)
})

test('activation protects control authority and refuses request-supplied code or unsupported runtimes', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.control.dispatch({ command: 'activate', pluginId: 'odk.system.plugin-control' }), { ok: false, error: 'protected-plugin' })
  assert.deepEqual(await f.control.dispatch({ ...request, revision: 'a'.repeat(64) }), { ok: false, error: 'invalid-command' })
  const control = createPluginControl({ scope: 'personal-agent', snapshot: () => f.host.list(), activate: f.activate })
  assert.deepEqual(await control.dispatch(request), { ok: false, error: 'activation-unavailable' })
  f.signal.abort()
  assert.deepEqual(await f.control.dispatch(request), { ok: false, error: 'runtime-stopped' })
  assert.equal(f.host.get(port).version, 'default')
})

test('actual CLI activates over an isolated Main channel without changing saved selection', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t, { channel: true })
  const before = await fs.readFile(f.configPath, 'utf8')
  const cli = path.resolve(__dirname, '../scripts/open-deskos-plugin-cli.js')
  const response = JSON.parse((await run(process.execPath, [cli, 'activate', id, '--runtime'], { env: f.env, timeout: 10000 })).stdout)
  assert.equal(response.revision, readConfig(f.configPath).plugins[id].native.revision)
  assert.equal(response.version, '2.0.0')
  assert.equal(f.host.get(port).version, '2.0.0')
  await assert.rejects(run(process.execPath, [cli, 'activate', id], { env: f.env }), /activate requires/)
  assert.equal(await fs.readFile(f.configPath, 'utf8'), before)
})

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('shutdown during verified capture fences active and queued activation before release', async t => {
  const captured = deferred()
  const resume = deferred()
  let captures = 0
  const f = await fixture(t, { load: async (...args) => {
    captures++
    const definitions = await require('../src/native-plugin-loader').loadNativePlugins(...args)
    captured.resolve()
    await resume.promise
    return definitions
  } })
  const active = f.control.dispatch(request)
  const queued = f.control.dispatch(request)
  const restoration = f.control.dispatch({ command: 'restore-default', pluginId: id })
  await captured.promise
  f.signal.abort()
  await f.host.stop()
  const before = [...f.trace]
  resume.resolve()
  assert.deepEqual(await active, { ok: false, error: 'activation-failed' })
  assert.deepEqual(await queued, { ok: false, error: 'activation-failed' })
  assert.deepEqual(await restoration, { ok: false, error: 'restoration-failed' })
  assert.equal(captures, 1)
  assert.deepEqual(f.trace, before)
  assert.equal(f.host.get(port), null)
})

test('serialized activation captures each current selection and uses immutable verified bytes', async t => {
  const captured = deferred()
  const resume = deferred()
  let captures = 0
  const f = await fixture(t, { load: async (...args) => {
    const definitions = await require('../src/native-plugin-loader').loadNativePlugins(...args)
    if (++captures === 1) { captured.resolve(); await resume.promise }
    return definitions
  } })
  const firstRevision = readConfig(f.configPath).plugins[id].native.revision
  const first = f.activate(id, { signal: f.signal.signal })
  await captured.promise
  const nextRevision = await f.select('3.0.0')
  await fs.writeFile((await f.store.read(firstRevision)).entry, 'throw Error("changed after capture")')
  const second = f.activate(id, { signal: f.signal.signal })
  resume.resolve()
  assert.deepEqual(await first, { revision: firstRevision, version: '2.0.0', state: 'running' })
  assert.deepEqual(await second, { revision: nextRevision, version: '3.0.0', state: 'running' })
  assert.equal(captures, 2)
  assert.deepEqual(f.trace.filter(value => value.startsWith('consumer:')), ['consumer:default', 'consumer:2.0.0', 'consumer:3.0.0'])
})

test('activation rejects incorrect channel authentication before signed capture or mutation', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t)
  const { listenDeskData } = require('../src/desk-data-control')
  const { requestLocalControl } = require('../src/local-control-client')
  const endpoint = path.join(f.root, 'token.sock')
  const stateDir = path.join(f.root, 'token-state')
  const server = await listenDeskData({ endpoint, stateDir, platform: 'win32', control: f.control })
  t.after(() => server.close())
  const wrong = path.join(f.root, 'wrong-token')
  await fs.writeFile(wrong, 'wrong')
  const options = { endpoint, platform: 'win32', label: 'activation fixture', request }
  const before = [...f.trace]
  await assert.rejects(requestLocalControl({ ...options, tokenFile: wrong }), /closed/)
  assert.deepEqual(f.trace, before)
  const response = await requestLocalControl({ ...options, tokenFile: path.join(stateDir, 'local-channel.token') })
  assert.equal(response.version, '2.0.0')
  assert.equal(f.host.get(port).version, '2.0.0')
})

test('capture respects concurrent disable and can recover after enable', async t => {
  const captured = deferred()
  const resume = deferred()
  let captures = 0
  const f = await fixture(t, { load: async (...args) => {
    const definitions = await require('../src/native-plugin-loader').loadNativePlugins(...args)
    if (++captures === 1) { captured.resolve(); await resume.promise }
    return definitions
  } })
  const operation = f.control.dispatch(request)
  await captured.promise
  assert.equal((await f.control.dispatch({ command: 'disable', pluginId: id })).ok, true)
  const before = [...f.trace]
  resume.resolve()
  assert.deepEqual(await operation, { ok: false, error: 'activation-failed' })
  assert.deepEqual(f.trace, before)
  assert.equal(f.host.get(port), null)
  assert.equal((await f.control.dispatch({ command: 'enable', pluginId: id })).ok, true)
  assert.equal(f.host.get(port).version, 'default')
  assert.equal((await f.control.dispatch(request)).version, '2.0.0')
})

const restoreRequest = { command: 'restore-default', pluginId: id }

test('default restoration rebuilds consumers without publisher access or saved-selection writes', async t => {
  const f = await fixture(t)
  await f.control.dispatch(request)
  await fs.writeFile(f.env.OPEN_DESKOS_NATIVE_KEYRING, 'invalid policy')
  const before = await fs.readFile(f.configPath, 'utf8')
  assert.deepEqual(await f.control.dispatch(restoreRequest), { ok: true, scope: 'electron-main', pluginId: id,
    implementation: 'built-in', version: '1.0.0', state: 'running' })
  assert.equal(f.host.get(port).version, 'default')
  assert.equal(f.trace.at(-1), 'consumer:default')
  assert.equal(await fs.readFile(f.configPath, 'utf8'), before)
  assert.equal(await fs.readFile(f.env.OPEN_DESKOS_NATIVE_KEYRING, 'utf8'), 'invalid policy')
})

test('restoration retries retained cleanup before constructing the default', async t => {
  const f = await fixture(t)
  await f.control.dispatch(request)
  f.trace.failCleanup = true
  const defaults = f.trace.filter(value => value === 'create:default').length
  assert.deepEqual(await f.control.dispatch(restoreRequest), { ok: false, error: 'restoration-failed' })
  assert.equal(f.trace.filter(value => value === 'create:default').length, defaults)
  f.trace.failCleanup = false
  assert.equal((await f.control.dispatch(restoreRequest)).ok, true)
  assert.equal(f.host.get(port).version, 'default')
  assert.equal(f.trace.filter(value => value === 'create:default').length, defaults + 1)
})

test('restoration rejects absent defaults and protected or disabled identities without release', async t => {
  const f = await fixture(t)
  assert.deepEqual(await f.control.dispatch({ command: 'restore-default', pluginId: 'odk.system.plugin-control' }), { ok: false, error: 'protected-plugin' })
  assert.deepEqual(await f.control.dispatch({ ...restoreRequest, source: 'built-in' }), { ok: false, error: 'invalid-command' })
  const before = [...f.trace]
  assert.deepEqual(await f.control.dispatch({ command: 'restore-default', pluginId: 'odk.test.consumer' }), { ok: false, error: 'restoration-failed' })
  assert.deepEqual(f.trace, before)
  await f.host.setEnabled(id, false)
  assert.deepEqual(await f.control.dispatch(restoreRequest), { ok: false, error: 'restoration-failed' })
})

test('actual CLI restores the default and preserves the signed selection', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t, { channel: true })
  await f.control.dispatch(request)
  const before = await fs.readFile(f.configPath, 'utf8')
  const cli = path.resolve(__dirname, '../scripts/open-deskos-plugin-cli.js')
  await fs.writeFile(f.configPath, 'malformed saved selection')
  const response = JSON.parse((await run(process.execPath, [cli, 'restore-default', id, '--runtime'], { env: f.env, timeout: 10000 })).stdout)
  assert.equal(response.implementation, 'built-in')
  assert.equal(response.version, '1.0.0')
  assert.equal(response.revision, undefined)
  assert.equal(f.host.get(port).version, 'default')
  assert.equal(await fs.readFile(f.configPath, 'utf8'), 'malformed saved selection')
  await fs.writeFile(f.configPath, before)
  await assert.rejects(run(process.execPath, [cli, 'restore-default', id], { env: f.env }), /restore-default requires/)
})

test('default startup failure restores the independent factory and reports failure', async t => {
  const f = await fixture(t)
  await f.control.dispatch(request)
  f.trace.failDefault = true
  assert.deepEqual(await f.control.dispatch(restoreRequest), { ok: false, error: 'restoration-failed' })
  assert.equal(f.host.get(port).version, '2.0.0')
  assert.equal(f.trace.at(-1), 'consumer:2.0.0')
  f.trace.failDefault = false
  assert.equal((await f.control.dispatch(restoreRequest)).version, '1.0.0')
})

test('built-in restoration snapshots its host-owned factory and manifest', async t => {
  const f = await fixture(t)
  await f.control.dispatch(request)
  f.defaultDefinition.manifest.version = '9.0.0'
  f.defaultDefinition.create = () => { throw Error('mutated factory must not run') }
  assert.equal((await f.control.dispatch(restoreRequest)).version, '1.0.0')
  assert.equal(f.host.get(port).version, 'default')
})
