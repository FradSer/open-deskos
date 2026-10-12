'use strict'

const test = require('node:test')
if (require('./not-ported').notPortedOnWindows(test, 'unix-socket')) return
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createPluginHost } = require('../src/plugin-host')
const { createDiagnosticsPlugin, requestDiagnostics } = require('../src/plugin-diagnostics')
const { resolveHostedPiSocketPath } = require('../src/odk-link-host-adapter')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { independentHostedPiDiagnosis } = require('./fixtures/hosted-pi-diagnostic-replacement')

function selectedPlugin(independent) {
  const plugin = createMainPlugins({ replacementPlugins: independent ? [independentHostedPiDiagnosis()] : [] })
    .find(plugin => plugin.manifest.id === 'odk.system.hosted-pi-diagnostics')
  assert.equal(plugin.manifest.version, independent ? '2.0.0' : '1.0.0')
  return plugin
}

for (const independent of [false, true]) {

  test(`${independent ? 'selected independent' : 'default'} Hosted Pi diagnosis reads the actual composition and preserves task requests`, { timeout: 5000 }, async t => {
    const { HOSTED_PI_RUNTIME_PORT } = require('../src/plugins/hosted-pi-diagnostics')
    const { createTaskComposition } = await import('../../../integrations/personal-bot/src/task-composition.mjs')
    const { serveTasks, requestTask } = await import('../../../integrations/personal-bot/src/task-protocol.mjs')
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-hdiag-'))
    const endpoint = path.join(directory, 'task.sock')
    const descriptor = path.join(directory, 'odk', 'hosted-pi', 'endpoint.json')
    const commands = []
    const composition = createTaskComposition({
      openChannel: (handle, disconnect) => serveTasks(endpoint, handle, disconnect),
      createService: () => ({ handle(request) { commands.push(request.command); return { version: 1, requestId: request.requestId, ok: true, tasks: [] } }, disconnect() {}, close() {} }),
      endpointFile: () => descriptor,
      publishEndpoint: async file => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify({ version: 1, socketPath: endpoint, stateDir: 'private state' })) },
      removeEndpoint: file => fs.rm(file),
    })
    const host = createPluginHost({ capabilities: {
      'system.hosted-pi-diagnostics': { endpoint: () => resolveHostedPiSocketPath({ XDG_RUNTIME_DIR: directory }) },
      'plugin.diagnostics': { endpoint: path.join(directory, 'odk-plugins', 'diagnose.sock'), stateDir: directory, snapshot: () => host.list() },
    } })
    t.after(async () => { await host.stop(); await composition.close(); await fs.rm(directory, { recursive: true, force: true }) })
    await composition.start()
    const list = await requestTask(endpoint, { version: 1, requestId: 'existing-list', command: 'list' })
    assert.deepEqual(list.tasks, [])
    host.register(selectedPlugin(independent))
    host.register(createDiagnosticsPlugin({ runtimePorts: [HOSTED_PI_RUNTIME_PORT] }))
    await host.start()
    const result = await requestDiagnostics({ endpoint: path.join(directory, 'odk-plugins', 'diagnose.sock'), pluginId: 'odk.hosted-pi.service' })
    assert.equal(result.runtimes[0].host, 'personal-agent')
    assert.equal(result.runtimes[0].instance, 'hosted-pi')
    assert.equal(result.runtimes[0].state, 'available')
    assert.equal(result.runtimes[0].plugins[0].state, 'running')
    assert.equal(JSON.stringify(result).includes('private'), false)
    assert.deepEqual(commands, ['list'])
    const execFile = require('node:util').promisify(require('node:child_process').execFile)
    const cli = await execFile(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'diagnose', 'odk.hosted-pi.service'], {
      env: { ...process.env, XDG_RUNTIME_DIR: directory, XDG_STATE_HOME: directory, ODK_CONFIG_DIR: path.join(directory, 'config') },
    })
    assert.equal(JSON.parse(cli.stdout).runtimes[0].instance, 'hosted-pi')
    assert.deepEqual(commands, ['list'])
    const port = host.get(HOSTED_PI_RUNTIME_PORT)
    await host.stop()
    assert.equal((await port.snapshot())[0].reason, 'stopped')
    assert.equal((await requestTask(endpoint, { version: 1, requestId: 'after-stop', command: 'list' })).ok, true)
  })

  test(`${independent ? 'selected independent' : 'default'} Hosted Pi diagnosis cancels pending probes and re-resolves endpoint discovery`, { timeout: 3000 }, async t => {
    const net = require('node:net')
    const { once } = require('node:events')
    const { HOSTED_PI_RUNTIME_PORT } = require('../src/plugins/hosted-pi-diagnostics')
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-hpend-'))
    const socketPath = path.join(directory, 'task.sock')
    const peers = new Set()
    const server = net.createServer(peer => { peers.add(peer); peer.on('error', () => {}); peer.on('close', () => peers.delete(peer)) })
    server.listen(socketPath)
    await once(server, 'listening')
    let endpoint = null
    const host = createPluginHost({ capabilities: { 'system.hosted-pi-diagnostics': { endpoint: () => endpoint } } })
    t.after(async () => { await host.stop(); for (const peer of peers) peer.destroy(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }) })
    host.register(selectedPlugin(independent))
    await host.start()
    const port = host.get(HOSTED_PI_RUNTIME_PORT)
    assert.equal((await port.snapshot())[0].reason, 'disconnected')
    endpoint = socketPath
    const connection = once(server, 'connection')
    const pending = port.snapshot()
    await connection
    await host.stop()
    assert.equal((await pending)[0].reason, 'stopped')
    assert.ok(server.listening)
  })

  test(`${independent ? 'selected independent' : 'default'} older Hosted Pi refuses diagnosis without changing ordinary task control`, { timeout: 3000 }, async t => {
    const { HOSTED_PI_RUNTIME_PORT } = require('../src/plugins/hosted-pi-diagnostics')
    const { serveTasks, requestTask } = await import('../../../integrations/personal-bot/src/task-protocol.mjs')
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-hold-'))
    const endpoint = path.join(directory, 'task.sock')
    const commands = []
    const channel = await serveTasks(endpoint, async request => {
      commands.push(request.command)
      return request.command === 'list'
        ? { version: 1, requestId: request.requestId, ok: true, tasks: [] }
        : { version: 1, requestId: request.requestId, ok: false, error: 'private legacy error' }
    })
    const host = createPluginHost({ capabilities: { 'system.hosted-pi-diagnostics': { endpoint } } })
    t.after(async () => { await host.stop(); await channel.close(); await fs.rm(directory, { recursive: true, force: true }) })
    host.register(selectedPlugin(independent))
    await host.start()
    const report = await host.get(HOSTED_PI_RUNTIME_PORT).snapshot()
    assert.equal(report[0].reason, 'request-refused')
    assert.equal(JSON.stringify(report).includes('private'), false)
    assert.equal((await requestTask(endpoint, { version: 1, requestId: 'legacy-list', command: 'list' })).ok, true)
    assert.deepEqual(commands, ['runtime_diagnose', 'list'])
  })
}
