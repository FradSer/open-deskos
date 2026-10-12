'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const { RemoteBridge } = require('../lib/remote-bridge')
const { RemoteBridgeHost } = require('../lib/remote-bridge-host')
const { MockTransport } = require('./mock-transport')
const run = promisify(execFile)
const cli = path.resolve(__dirname, '../../../runtime/shell/scripts/open-deskos-plugin-cli.js')

test('Bridge control endpoint agrees with the logical host mapping', () => {
  const { resolveBridgeControlEndpoint } = require('../lib/plugin-runtime')
  const { resolveShellHost } = require('../../../runtime/shell/src/platform')
  for (const platform of ['linux', 'darwin', 'win32']) {
    const host = resolveShellHost({ platform, env: { XDG_RUNTIME_DIR: '/fixture' } })
    assert.equal(resolveBridgeControlEndpoint(host.endpoint('remote-bridge')), host.endpoint('remote-plugin-control'))
  }
})

for (const multiple of [false, true]) test(`${multiple ? 'transport host' : 'single bridge'} serves unified runtime control without stopping independent resources`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-bridge-control-'))
  const env = { ...process.env, XDG_RUNTIME_DIR: root, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config') }
  const transport = new MockTransport({ id: 'odk.remote.transport.fixture', transport: 'usb-cdc', priority: 100 })
  const independent = new MockTransport({ id: 'odk.remote.transport.other', transport: 'wireless', priority: 50 })
  const options = { socketPath: path.join(root, 'open-deskos-remote', 'bridge.sock'), logger: { error() {} } }
  const bridge = multiple ? new RemoteBridgeHost({ ...options, transports: [transport, independent] }) : new RemoteBridge({ ...options, adapter: transport })
  let fail = false
  const stop = transport.stop.bind(transport)
  transport.stop = async () => { if (fail) throw Error('private stop failure'); await stop() }
  t.after(async () => { fail = false; await bridge.stop(); await fs.rm(root, { recursive: true, force: true }) })
  await bridge.start()
  const command = (operation, id) => run(process.execPath, [cli, operation, id, '--runtime'], { env })
  for (const operation of ['disable', 'enable']) {
    const result = JSON.parse((await command(operation, transport.manifest.id)).stdout)
    assert.equal(result.scope, 'remote-bridge')
    assert.equal(result.state, operation === 'enable' ? 'running' : 'disabled')
    assert.equal(transport.started, operation === 'enable')
    assert.equal(transport.listenerCount('message'), operation === 'enable' ? 1 : 0)
    assert.equal(bridge.server.listening, true)
    if (multiple) assert.equal(independent.started, true)
    assert.equal(bridge.latestShellState, null)
  }
  for (const id of ['odk.remote.listener', 'odk.remote.control', 'odk.remote.transport.unknown']) {
    await assert.rejects(command('disable', id), /unknown-plugin|protected-plugin/)
  }
  fail = true
  await assert.rejects(command('disable', transport.manifest.id), error => {
    assert.match(error.stderr, /lifecycle-failed/)
    assert.equal(error.stderr.includes('private stop failure'), false)
    return true
  })
  assert.equal(bridge.server.listening, true)
  fail = false
  await command('enable', transport.manifest.id)
  assert.equal(transport.started, true)
  await assert.rejects(fs.access(path.join(env.OPEN_DESKOS_CONFIG_DIR, 'plugins.json')), /ENOENT/)
  await bridge.stop()
  await assert.rejects(fs.access(options.socketPath + '.control'), /ENOENT/)
})
