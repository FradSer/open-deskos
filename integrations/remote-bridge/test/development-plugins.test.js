'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { RemoteBridge } = require('../lib/remote-bridge')
const { RemoteBridgeHost } = require('../lib/remote-bridge-host')
const { loadBridgeReplacements, transportPlaceholder } = require('../lib/development-plugins')
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const { once } = require('node:events')
const net = require('node:net')
const cli = path.resolve(__dirname, '../lib/main.js')

async function selected(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-bridge-dev-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const entry = path.join(dir, 'entry.cjs')
  const file = path.join(dir, 'selection.json')
  const id = 'odk.remote.transport.usb-cdc'
  const manifest = { schemaVersion: 1, id, name: 'Selected USB transport', version: '2.0.0', host: 'remote-bridge', kind: 'transport',
    provides: [{ interface: `odk:remote/transport/${id}/v1` }], requires: [{ interface: 'odk:remote/listener/v1' }], permissions: [], priority: 100, transport: 'usb-cdc' }
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, replacements: [{ manifest, entry }] }))
  await fs.writeFile(entry, `const { EventEmitter } = require('node:events'); exports.create = (ctx, manifest) => {
    const transport = new EventEmitter(); transport.manifest = manifest; transport.priority = manifest.priority; transport.transport = manifest.transport;
    transport.sent = []; transport.isConnected = false;
    transport.init = async () => {}; transport.start = async () => { transport.isConnected = true; transport.emit('connected', { transport: transport.transport }) };
    transport.stop = async () => { if (transport.failStop) throw Error('cleanup failed'); transport.isConnected = false };
    transport.destroy = async () => { transport.destroyed = true }; transport.send = async record => { transport.sent.push(record) };
    return transport;
  }`)
  return { dir, entry, file, manifest }
}

for (const multiple of [false, true]) {
  test(`external transport replaces the actual ${multiple ? 'Host collection' : 'single adapter'} and owns cleanup`, async t => {
    const selection = await selected(t)
    const replacements = loadBridgeReplacements(selection.file, { trusted: true })
    const placeholder = transportPlaceholder(replacements[0])
    const options = { replacementPlugins: replacements, socketPath: path.join(selection.dir, 'bridge.sock'), logger: { error() {} } }
    const bridge = multiple ? new RemoteBridgeHost({ ...options, transports: [placeholder] }) : new RemoteBridge({ ...options, adapter: placeholder })
    t.after(() => bridge.stop())
    await bridge.start()
    const actual = multiple ? bridge.transports[0] : bridge.adapter
    assert.notEqual(actual, placeholder)
    assert.equal(actual.isConnected, true)
    assert.equal(bridge.pluginCatalog().find(item => item.manifest.id === selection.manifest.id).manifest.version, '2.0.0')
    actual.failStop = true
    await bridge.stop()
    assert.equal(actual.destroyed, undefined)
    assert.ok(bridge.pluginCatalog().some(item => item.state.startsWith('cleanup-')))
    actual.failStop = false
    await bridge.stop()
    assert.equal(actual.destroyed, true)
    await bridge.start()
    assert.notEqual(multiple ? bridge.transports[0] : bridge.adapter, actual)
  })
}

test('external selection validates without loading entries and requires native trust', async t => {
  const selection = await selected(t)
  await fs.writeFile(selection.entry, "throw Error('entry executed')")
  assert.throws(() => loadBridgeReplacements(selection.file), /trust/)
  assert.equal(loadBridgeReplacements(selection.file, { trusted: true }).length, 1)
})

test('operational CLI inspects selected declarations without executing entries', async t => {
  const selection = await selected(t)
  await fs.writeFile(selection.entry, "throw Error('entry executed')")
  const run = promisify(execFile)
  const env = { ...process.env, ODK_CONFIG_DIR: selection.dir, ODK_DISABLED_PLUGINS: '' }
  const { stdout } = await run(process.execPath, [cli, '--plugin-selection', selection.file, '--trust-plugins', '--plugins', 'validate'], { env })
  const report = JSON.parse(stdout)
  assert.equal(report.validated, true)
  assert.equal(report.plugins.find(item => item.manifest.id === selection.manifest.id).manifest.version, '2.0.0')
  assert.ok(report.plugins.every(item => item.state === 'registered'))
  await assert.rejects(run(process.execPath, [cli, '--plugin-selection', selection.file, '--plugins', 'list'], { env }), /trust/)
})

test('operational CLI starts external USB, serves diagnosis, and releases resources on termination', { timeout: 10000 }, async t => {
  const selection = await selected(t)
  const cleanup = path.join(selection.dir, 'cleanup.txt')
  const retainedState = path.join(selection.dir, 'state.json')
  const source = await fs.readFile(selection.entry, 'utf8')
  await fs.writeFile(selection.entry, source.replace("transport.emit('connected', { transport: transport.transport })", "transport.emit('connected', { transport: transport.transport }); process.stdout.write('READY\\n')")
    .replace('transport.isConnected = false };', `transport.isConnected = false; require('node:fs').appendFileSync(${JSON.stringify(cleanup)}, 'stop\\n') };`)
    .replace('transport.destroyed = true', `transport.destroyed = true; require('node:fs').appendFileSync(${JSON.stringify(cleanup)}, 'destroy\\n')`)
    .replace('transport.sent.push(record)', `transport.sent.push(record); require('node:fs').writeFileSync(${JSON.stringify(retainedState)}, JSON.stringify(record)); transport.emit('message', { v: 1, type: 'input', input: 'back' })`))
  const child = spawn(process.execPath, ['--unhandled-rejections=strict', cli, '--plugin-selection', selection.file, '--trust-plugins'], {
    env: { ...process.env, XDG_RUNTIME_DIR: selection.dir, ODK_CONFIG_DIR: selection.dir, ODK_DISABLED_PLUGINS: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  const exited = once(child, 'exit')
  await new Promise((resolve, reject) => {
    let output = ''
    child.stdout.on('data', chunk => { output += chunk; if (output.includes('READY\n')) resolve() })
    child.once('exit', code => reject(Error(`startup exited ${code}: ${errors}`)))
    child.once('error', reject)
  })
  const socket = net.createConnection(path.join(selection.dir, 'odk-remote', 'bridge.sock'))
  t.after(() => socket.destroy())
  await once(socket, 'connect')
  const report = await new Promise((resolve, reject) => {
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk
      const lines = buffer.split('\n'); buffer = lines.pop()
      for (const line of lines) {
        const record = JSON.parse(line)
        if (record.type === 'runtime_diagnosis') resolve(record)
      }
    })
    socket.once('error', reject)
    socket.write(JSON.stringify({ v: 1, type: 'runtime_diagnose', requestId: '12345678-1234-1234-1234-123456789abc' }) + '\n')
  })
  assert.equal(report.runtime.plugins.find(item => item.manifest.id === selection.manifest.id).manifest.version, '2.0.0')
  const input = new Promise((resolve, reject) => {
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk
      const lines = buffer.split('\n'); buffer = lines.pop()
      for (const line of lines) {
        const record = JSON.parse(line)
        if (record.type === 'input') resolve(record)
      }
    })
    socket.once('error', reject)
  })
  const state = { v: 1, type: 'state', name: 'Selected transport', page: 1, pages: 1, canPrev: false, canNext: false }
  socket.write(JSON.stringify(state) + '\n')
  assert.deepEqual(await input, { v: 1, type: 'input', input: 'back' })
  assert.deepEqual(JSON.parse(await fs.readFile(retainedState, 'utf8')), { ...state, link: 'wired' })
  socket.destroy()
  child.kill('SIGTERM')
  assert.deepEqual(await exited, [0, null], errors)
  assert.equal(await fs.readFile(cleanup, 'utf8'), 'stop\ndestroy\n')
  await assert.rejects(fs.stat(path.join(selection.dir, 'odk-remote', 'bridge.sock')), { code: 'ENOENT' })
})

test('selection rejects changes to transport ports, authority, and USB policy before entry execution', async t => {
  const selection = await selected(t)
  const changes = [
    manifest => { manifest.host = 'electron-main' },
    manifest => { manifest.kind = 'service' },
    manifest => { manifest.permissions = ['network'] },
    manifest => { manifest.provides[0].interface = 'odk:remote/other/v1' },
    manifest => { manifest.requires[0].optional = true },
    manifest => { manifest.priority = 50 },
    manifest => { manifest.transport = 'wireless' },
  ]
  for (const change of changes) {
    const manifest = structuredClone(selection.manifest)
    change(manifest)
    await fs.writeFile(selection.file, JSON.stringify({ schemaVersion: 1, replacements: [{ manifest, entry: selection.entry }] }))
    assert.throws(() => loadBridgeReplacements(selection.file, { trusted: true }), /contract|policy/)
  }
  const definition = { manifest: selection.manifest, entry: selection.entry }
  await fs.writeFile(selection.file, JSON.stringify({ schemaVersion: 1, replacements: [definition, definition] }))
  assert.throws(() => loadBridgeReplacements(selection.file, { trusted: true }), /duplicate/)
})

test('CLI preserves default USB and composes additional selected transport declarations', async t => {
  const { startupSelection, composeTransports } = require('../lib/main')
  const defaultAdapter = { manifest: { id: 'odk.remote.transport.usb-cdc' } }
  let created = 0
  const defaultFactory = () => { created++; return defaultAdapter }
  assert.deepEqual(composeTransports(startupSelection([]).replacementPlugins, defaultFactory), [defaultAdapter])
  const selection = await selected(t)
  const replacements = loadBridgeReplacements(selection.file, { trusted: true })
  assert.equal(composeTransports(replacements, defaultFactory)[0].manifest.version, '2.0.0')
  assert.equal(created, 1)
  replacements[0].manifest.id = 'odk.remote.transport.fixture'
  replacements[0].manifest.priority = 50
  replacements[0].manifest.transport = 'wireless'
  const collection = composeTransports(replacements, defaultFactory)
  assert.equal(collection.length, 2)
  assert.equal(collection[1], defaultAdapter)
  assert.throws(() => startupSelection(['--trust-plugins']), /selection/)
  assert.throws(() => startupSelection(['--plugins', 'unknown']), /inspection/)
  assert.throws(() => startupSelection(['--plugins=']), /inspection/)
  assert.throws(() => startupSelection(['--plugin-selection=']), /selection/)
})

test('single bridge rejects malformed external resources even when their cleanup fails', async t => {
  const selection = await selected(t)
  const source = await fs.readFile(selection.entry, 'utf8')
  await fs.writeFile(selection.entry, source.replace('return transport;', 'transport.send = null; transport.failStop = true; return transport;'))
  const replacements = loadBridgeReplacements(selection.file, { trusted: true })
  const bridge = new RemoteBridge({ adapter: transportPlaceholder(replacements[0]), replacementPlugins: replacements,
    socketPath: path.join(selection.dir, 'bridge.sock'), logger: { error() {} } })
  t.after(async () => {
    const entry = require(selection.entry)
    // The rejected allocation belongs to the factory and remains available for cleanup retry.
    entry.resource.failStop = false
    await bridge.stop()
  })
  await fs.writeFile(selection.entry, (await fs.readFile(selection.entry, 'utf8')).replace('return transport;', 'exports.resource = transport; return transport;'))
  await assert.rejects(bridge.start(), /cleanup failed/)
  assert.equal(bridge.pluginCatalog().find(item => item.manifest.id === selection.manifest.id).state, 'cleanup-failed')
})
