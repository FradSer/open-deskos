'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createPluginHost } = require('../src/plugin-host')
const { createPluginControl } = require('../src/plugin-control')
const { requestLocalControl } = require('../src/local-control-client')
const { resolveShellHost } = require('../src/platform')
const { posixOnlyReason } = require('./not-ported')
const run = promisify(execFile)
const id = 'odk.test.managed'
const { selectedPluginControl } = require('./fixtures/plugin-control-replacement')

test('runtime control applies lifecycle and refuses invalid targets without private errors', async () => {
  let failed = false
  let starts = 0
  const host = createPluginHost()
  host.register({ manifest: { schemaVersion: 1, id, name: 'Managed fixture', version: '1.0.0', kind: 'service',
    host: 'electron-main', provides: [], requires: [], permissions: [] },
    create: () => ({ start() { starts++ }, stop() { if (failed) throw Error('private fixture secret') } }) })
  await host.start()
  const control = createPluginControl({ snapshot: () => host.list(), setEnabled: (...args) => host.setEnabled(...args) })
  assert.deepEqual(await control.dispatch({ command: 'disable', pluginId: 'odk.system.plugin-control' }), { ok: false, error: 'protected-plugin' })
  assert.deepEqual(await control.dispatch({ command: 'disable', pluginId: 'odk.unknown' }), { ok: false, error: 'unknown-plugin' })
  assert.deepEqual(await control.dispatch({ command: 'disable', pluginId: id, enabled: true }), { ok: false, error: 'invalid-command' })
  assert.deepEqual(await control.dispatch({ command: 'diagnose', pluginId: id }), { ok: false, error: 'invalid-command' })
  assert.deepEqual(await control.dispatch({ command: 'disable', pluginId: id }), { ok: true, scope: 'electron-main', pluginId: id, enabled: false, state: 'disabled' })
  assert.equal(starts, 1)
  assert.equal((await control.dispatch({ command: 'enable', pluginId: id })).state, 'running')
  assert.equal(starts, 2)
  failed = true
  assert.deepEqual(await control.dispatch({ command: 'disable', pluginId: id }), { ok: false, error: 'lifecycle-failed' })
  assert.deepEqual(await control.dispatch({ command: 'enable', pluginId: id }), { ok: false, error: 'lifecycle-failed' })
  failed = false
  assert.equal((await control.dispatch({ command: 'enable', pluginId: id })).ok, true)
  await host.stop()
})

for (const selected of [false, true]) {
  test(`${selected ? 'selected' : 'default'} CLI runtime management uses the isolated channel and preserves preferences`, { skip: posixOnlyReason('unix-socket') }, async t => {
    const { createPluginControlPlugin } = require('../src/plugin-control')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-plugin-control-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: path.join(root, 'state'), ODK_CONFIG_DIR: path.join(root, 'config') }
    await fs.mkdir(env.ODK_CONFIG_DIR)
    const file = path.join(env.ODK_CONFIG_DIR, 'plugins.json')
    const bytes = JSON.stringify({ version: 1, plugins: { [id]: { enabled: true } } })
    await fs.writeFile(file, bytes)
    const platform = resolveShellHost({ env })
    const host = createPluginHost({ capabilities: { 'plugin.control': { endpoint: platform.endpoint('plugin-control'),
      stateDir: platform.stateDir, snapshot: () => host.list(), setEnabled: (...args) => host.setEnabled(...args) } } })
    t.after(() => host.stop())
    host.register(selected ? selectedPluginControl() : createPluginControlPlugin())
    host.register({ manifest: { schemaVersion: 1, id, name: 'Managed fixture', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [] }, create: () => ({}) })
    await host.start()
    assert.equal(host.list().find(plugin => plugin.manifest.id === 'odk.system.plugin-control').manifest.version, selected ? '2.0.0' : '1.0.0')
    const inventory = await requestLocalControl({ endpoint: platform.endpoint('plugin-control'), request: { command: 'inventory' } })
    assert.deepEqual(inventory.plugins, host.list().map(plugin => ({ pluginId: plugin.manifest.id, host: plugin.manifest.host })))
    const cli = path.join(__dirname, '../scripts/odk-plugin-cli.js')
    for (const command of ['disable', 'enable']) {
      const result = await run(process.execPath, [cli, command, id, '--runtime'], { env })
      const response = JSON.parse(result.stdout)
      assert.equal(response.scope, 'electron-main')
      assert.equal(response.state, command === 'enable' ? 'running' : 'disabled')
      assert.equal(await fs.readFile(file, 'utf8'), bytes)
    }
    await assert.rejects(run(process.execPath, [cli, 'disable', 'odk.system.plugin-control', '--runtime'], { env }), /protected-plugin/)
    await assert.rejects(run(process.execPath, [cli, 'disable', id, '--unexpected'], { env }), /invalid|accepts/)
    assert.equal(await fs.readFile(file, 'utf8'), bytes)
  })
}

test('actual CLI routes a Main plugin from declared ownership rather than its resident prefix', { skip: posixOnlyReason('unix-socket') }, async t => {
  const { createPluginControlPlugin } = require('../src/plugin-control')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-route-'))
  const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: root, ODK_CONFIG_DIR: path.join(root, 'config') }
  const platform = resolveShellHost({ env })
  const target = 'odk.personal-bot.extension-fixture'
  const host = createPluginHost({ capabilities: { 'plugin.control': {
    endpoint: platform.endpoint('plugin-control'), stateDir: platform.stateDir,
    snapshot: () => host.list(), setEnabled: (...args) => host.setEnabled(...args),
  } } })
  t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true, force: true }) })
  host.register(createPluginControlPlugin())
  host.register({ manifest: { schemaVersion: 1, id: target, name: 'Routing fixture', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [] }, create: () => ({}) })
  await host.start()
  const result = await run(process.execPath, [path.join(__dirname, '../scripts/odk-plugin-cli.js'), 'disable', target, '--runtime'], { env })
  assert.equal(JSON.parse(result.stdout).scope, 'electron-main')
  assert.equal(host.list().find(plugin => plugin.manifest.id === target).state, 'disabled')
})

for (const selected of [false, true]) {
  test(`${selected ? 'selected' : 'default'} token-gated runtime control refuses incorrect authentication before mutation`, { skip: posixOnlyReason('unix-socket') }, async t => {
    const { createPluginControlPlugin } = require('../src/plugin-control')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-control-token-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    const endpoint = path.join(root, 'control.sock')
    const stateDir = path.join(root, 'state')
    let mutations = 0
    let enabled = true
    const host = createPluginHost({ capabilities: { 'plugin.control': {
      endpoint, stateDir, platform: 'win32',
      snapshot: () => [{ manifest: { id }, state: enabled ? 'running' : 'disabled' }],
      setEnabled: (_id, value) => { mutations++; enabled = value },
    } } })
    t.after(() => host.stop())
    host.register(selected ? selectedPluginControl() : createPluginControlPlugin())
    await host.start()
    const wrong = path.join(root, 'wrong')
    await fs.writeFile(wrong, 'wrong')
    const options = { endpoint, platform: 'win32', label: 'fixture control', request: { command: 'disable', pluginId: id } }
    await assert.rejects(requestLocalControl({ ...options, tokenFile: wrong }), /closed/)
    assert.equal(mutations, 0)
    assert.equal((await requestLocalControl({ ...options, tokenFile: path.join(stateDir, 'local-channel.token') })).state, 'disabled')
    assert.equal(mutations, 1)
  })
}

for (const selected of [false, true]) {
  test(`${selected ? 'selected' : 'default'} management restart releases only its listener`, { skip: posixOnlyReason('unix-socket') }, async t => {
    const { createPluginControlPlugin } = require('../src/plugin-control')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-mgr-'))
    const endpoint = path.join(root, 'control.sock')
    const management = 'odk.system.plugin-control'
    const signals = []
    const managed = {}
    const port = 'odk:test-managed/v1'
    let host
    host = createPluginHost({ capabilities: { 'plugin.control': {
      endpoint, stateDir: path.join(root, 'state'),
      snapshot: () => host.list(), setEnabled: (...args) => host.setEnabled(...args),
    } } })
    t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true, force: true }) })
    const definition = selected ? selectedPluginControl() : createPluginControlPlugin()
    const create = definition.create
    host.register({ ...definition, create(ctx) { signals.push(ctx.signal); return create(ctx) } })
    host.register({ manifest: { schemaVersion: 1, id, name: 'Managed fixture', version: '1.0.0', kind: 'service',
      host: 'electron-main', provides: [{ interface: port }] }, create: () => ({ ports: { [port]: managed } }) })
    const request = () => requestLocalControl({ endpoint, request: { command: 'inventory' } })
    await host.start()
    assert.equal((await request()).ok, true)
    assert.equal(host.get(port), managed)
    await host.setEnabled(management, false)
    assert.equal(signals[0].aborted, true)
    await assert.rejects(fs.stat(endpoint), { code: 'ENOENT' })
    await assert.rejects(request())
    assert.equal(host.get(port), managed)
    assert.equal(host.list().find(plugin => plugin.manifest.id === id).state, 'running')
    await host.setEnabled(management, true)
    assert.equal(signals.length, 2)
    assert.notEqual(signals[0], signals[1])
    assert.equal(signals[1].aborted, false)
    assert.equal((await request()).ok, true)
    assert.equal(host.get(port), managed)
    await host.stop()
    assert.equal(signals[1].aborted, true)
    await assert.rejects(fs.stat(endpoint), { code: 'ENOENT' })
  })
}

test('cancelled control and failed lifecycle calls do not publish a successful receipt', async () => {
  let calls = 0
  const controller = new AbortController()
  controller.abort()
  const control = createPluginControl({ signal: controller.signal, snapshot: () => [{ manifest: { id }, state: 'running' }],
    setEnabled: () => { calls++ } })
  assert.equal((await control.dispatch({ command: 'disable', pluginId: id })).error, 'runtime-stopped')
  assert.equal(calls, 0)
  const failing = createPluginControl({ snapshot: () => [{ manifest: { id }, state: 'running' }],
    setEnabled: () => { throw Error('private fixture failure') } })
  assert.deepEqual(await failing.dispatch({ command: 'disable', pluginId: id }), { ok: false, error: 'lifecycle-failed' })
})

test('malformed failure receipts remain uncertain without replay', { skip: posixOnlyReason('unix-socket') }, async t => {
  const { listenOdkData } = require('../src/odk-data-control')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-control-receipt-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  for (const error of [undefined, { garbage: true }, '']) {
    const endpoint = path.join(root, 'control.sock')
    let calls = 0
    const server = await listenOdkData({ endpoint, control: { async dispatch() { calls++; return { ok: false, error } } } })
    try {
      await assert.rejects(requestLocalControl({ endpoint, label: 'fixture control', request: { command: 'disable', pluginId: id } }), /invalid.*operation outcome unknown/)
      assert.equal(calls, 1)
    } finally { await server.close() }
  }
})
