'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { independentRendererDiagnostics } = require('./fixtures/renderer-diagnostics-replacement')

for (const selected of [false, true]) {
  function definition() {
    if (!selected) return require('../src/renderer-diagnostics').createRendererDiagnosticsPlugin()
    const replacement = independentRendererDiagnostics()
    const composition = createMainPlugins({ replacementPlugins: [replacement] })
    assert.equal(composition.find(plugin => plugin.manifest.id === replacement.manifest.id), replacement)
    return replacement
  }

  function fixture({ timeoutMs = 20, frameCount = 1 } = {}) {
    const { RENDERER_RUNTIME_PORT } = require('../src/renderer-diagnostics')
    const ipc = new EventEmitter()
    const sender = {}
    const mainFrame = {}
    const sent = []
    const frame = { id: 1, sender, mainFrame: () => mainFrame, send: (_channel, request) => sent.push(request) }
    const frames = Array.from({ length: frameCount }, (_, index) => ({ ...frame, id: index + 1 }))
    const host = createPluginHost({ capabilities: { 'system.renderer-diagnostics': { ipc, frames: () => frames, timeoutMs } } })
    host.register(definition())
    const manifest = { schemaVersion: 1, id: 'odk.tile.fixture', name: 'Fixture', version: '1.0.0', kind: 'surface', host: 'electron-renderer', provides: [], requires: [], permissions: [] }
    return { host, port: RENDERER_RUNTIME_PORT, ipc, sender, mainFrame, sent, manifest, frames }
  }

  test(`${selected ? 'selected' : 'default'} renderer diagnosis accepts only the requested Shell main frame and removes private error text`, async () => {
    const f = fixture()
    await f.host.start()
    const request = f.host.get(f.port).snapshot()
    const requestId = f.sent[0].requestId
    const report = { requestId, plugins: [{ manifest: f.manifest, state: 'failed', enabled: true, error: 'private text' }] }
    f.ipc.emit('odk-plugin-runtime-report', { sender: {}, senderFrame: f.mainFrame }, report)
    f.ipc.emit('odk-plugin-runtime-report', { sender: f.sender, senderFrame: {} }, report)
    f.ipc.emit('odk-plugin-runtime-report', { sender: f.sender, senderFrame: f.mainFrame }, { ...report, requestId: 'wrong' })
    f.ipc.emit('odk-plugin-runtime-report', { sender: f.sender, senderFrame: f.mainFrame }, report)
    const result = await request
    assert.equal(result[0].state, 'available')
    assert.equal(result[0].plugins[0].state, 'failed')
    assert.equal(Object.hasOwn(result[0].plugins[0], 'error'), false)
    assert.equal(f.ipc.listenerCount('odk-plugin-runtime-report'), 1)
    await f.host.stop()
    assert.equal(f.ipc.listenerCount('odk-plugin-runtime-report'), 0)
  })

  test(`${selected ? 'selected' : 'default'} renderer diagnosis times out explicitly and shutdown cancels pending probes`, async () => {
    const f = fixture()
    await f.host.start()
    const provider = f.host.get(f.port)
    assert.equal((await provider.snapshot())[0].reason, 'timeout')
    const pending = provider.snapshot()
    await f.host.stop()
    assert.equal((await pending)[0].reason, 'stopped')
    const count = f.sent.length
    assert.equal((await provider.snapshot())[0].reason, 'stopped')
    assert.equal(f.sent.length, count)
  })

  test(`${selected ? 'selected' : 'default'} renderer diagnosis rejects invalid manifests and duplicate identities`, async () => {
    const f = fixture()
    await f.host.start()
    for (const plugins of [
      [{ manifest: { ...f.manifest, host: 'electron-main' }, state: 'running', enabled: true }],
      [1, 2].map(() => ({ manifest: f.manifest, state: 'running', enabled: true })),
    ]) {
      const pending = f.host.get(f.port).snapshot()
      f.ipc.emit('odk-plugin-runtime-report', { sender: f.sender, senderFrame: f.mainFrame }, { requestId: f.sent.at(-1).requestId, plugins })
      assert.equal((await pending)[0].reason, 'invalid-report')
    }
    await f.host.stop()
  })

  test(`${selected ? 'selected' : 'default'} renderer diagnosis bounds concurrent requests and cancels every outstanding probe`, async () => {
    const f = fixture({ timeoutMs: 1000 })
    await f.host.start()
    const provider = f.host.get(f.port)
    const requests = Array.from({ length: 32 }, () => provider.snapshot())
    assert.equal(f.sent.length, 32)
    assert.equal((await provider.snapshot())[0].reason, 'busy')
    await f.host.stop()
    assert.ok((await Promise.all(requests)).every(result => result[0].reason === 'stopped'))
  })

  test(`${selected ? 'selected' : 'default'} renderer diagnosis bounds frame fanout and resolves out-of-order replies by request identity`, async () => {
    const f = fixture({ timeoutMs: 1000, frameCount: 9 })
    await f.host.start()
    const pending = f.host.get(f.port).snapshot()
    assert.equal(f.sent.length, 8)
    for (const request of [...f.sent].reverse()) {
      f.ipc.emit('odk-plugin-runtime-report', { sender: f.sender, senderFrame: f.mainFrame }, {
        requestId: request.requestId, plugins: [{ manifest: f.manifest, state: 'running', enabled: true }],
      })
    }
    const result = await pending
    assert.deepEqual(result.slice(0, 8).map(runtime => runtime.instance), Array.from({ length: 8 }, (_, index) => `frame-${index + 1}`))
    assert.ok(result.slice(0, 8).every(runtime => runtime.state === 'available'))
    assert.equal(result[8].reason, 'frame-limit')
    await f.host.stop()
  })

  test(`${selected ? 'selected' : 'default'} renderer diagnosis rejects oversized reports and handles destroyed frame getters`, async () => {
    const f = fixture()
    await f.host.start()
    let pending = f.host.get(f.port).snapshot()
    const plugins = [{ manifest: f.manifest, state: 'running', enabled: true }]
    f.ipc.emit('odk-plugin-runtime-report', { sender: f.sender, senderFrame: f.mainFrame }, {
      requestId: f.sent.at(-1).requestId, plugins, privateText: 'x'.repeat(65536),
    })
    assert.equal((await pending)[0].reason, 'invalid-report')
    f.frames[0].mainFrame = () => { throw Error('destroyed') }
    pending = f.host.get(f.port).snapshot()
    f.ipc.emit('odk-plugin-runtime-report', { sender: f.sender, senderFrame: f.mainFrame }, {
      requestId: f.sent.at(-1).requestId, plugins,
    })
    assert.equal((await pending)[0].reason, 'frame-unavailable')
    await f.host.stop()
  })

  test(`${selected ? 'selected' : 'default'} authenticated CLI selects renderer plugins and fails for unavailable runtimes`, async t => {
    const fs = require('node:fs')
    const os = require('node:os')
    const path = require('node:path')
    const { promisify } = require('node:util')
    const { execFile } = require('node:child_process')
    const { createDiagnosticsPlugin } = require('../src/plugin-diagnostics')
    const { RENDERER_RUNTIME_PORT } = require('../src/renderer-diagnostics')
    const { resolveShellHost } = require('../src/platform')
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-rcli-'))
    t.after(() => fs.rmSync(root, { recursive: true, force: true }))
    const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: root, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config') }
    const shell = resolveShellHost({ env })
    const ipc = new EventEmitter()
    const sender = {}
    const senderFrame = {}
    let available = true
    let state = 'failed'
    const manifest = { schemaVersion: 1, id: 'odk.tile.fixture', name: 'Fixture', version: '1.0.0', kind: 'surface', host: 'electron-renderer' }
    const frame = { id: 1, sender, mainFrame: () => senderFrame, send: (_channel, request) => {
      ipc.emit('odk-plugin-runtime-report', { sender, senderFrame }, { requestId: request.requestId, plugins: [{ manifest, state, enabled: state !== 'disabled', error: 'private error' }] })
    } }
    const host = createPluginHost({ capabilities: {
      'system.renderer-diagnostics': { ipc, frames: () => available ? [frame] : [] },
      'plugin.diagnostics': { endpoint: shell.endpoint('plugin-diagnostics'), stateDir: shell.stateDir, platform: shell.platform, snapshot: () => host.list() },
    } })
    t.after(() => host.stop())
    host.register(createDiagnosticsPlugin({ runtimePorts: [RENDERER_RUNTIME_PORT] }))
    host.register(definition())
    await host.start()
    const run = promisify(execFile)
    const cli = path.resolve(__dirname, '../scripts/open-deskos-plugin-cli.js')
    await assert.rejects(run(process.execPath, [cli, 'diagnose', manifest.id], { env }), error => {
      assert.equal(error.code, 1)
      const result = JSON.parse(error.stdout)
      assert.equal(result.runtimes[0].plugins[0].state, 'failed')
      assert.equal(error.stdout.includes('private error'), false)
      return true
    })
    state = 'disabled'
    assert.equal(JSON.parse((await run(process.execPath, [cli, 'diagnose', manifest.id], { env })).stdout).runtimes[0].plugins[0].state, 'disabled')
    available = false
    await assert.rejects(run(process.execPath, [cli, 'diagnose'], { env }), error => {
      assert.equal(JSON.parse(error.stdout).runtimes[0].reason, 'no-frame')
      return true
    })
    assert.equal(JSON.parse((await run(process.execPath, [cli, 'diagnose', 'odk.system.plugin-diagnostics'], { env })).stdout).plugins[0].state, 'running')
    await host.stop()
  })

  test(`${selected ? 'selected' : 'default'} diagnosis restart preserves the frame and cancels the retained provider`, async t => {
    const f = fixture({ timeoutMs: 1000 })
    t.after(() => f.host.stop())
    const id = 'odk.system.renderer-diagnostics'
    await f.host.start()
    assert.equal(f.host.list()[0].manifest.version, selected ? '2.0.0' : '1.0.0')
    const previous = f.host.get(f.port)
    const pending = previous.snapshot()
    await f.host.setEnabled(id, false)
    assert.equal((await pending)[0].reason, 'stopped')
    assert.equal(f.ipc.listenerCount('odk-plugin-runtime-report'), 0)
    const sent = f.sent.length
    assert.equal((await previous.snapshot())[0].reason, 'stopped')
    assert.equal(f.sent.length, sent)
    await f.host.setEnabled(id, true)
    const current = f.host.get(f.port)
    assert.notEqual(current, previous)
    assert.equal(f.ipc.listenerCount('odk-plugin-runtime-report'), 1)
    const resumed = current.snapshot()
    const report = requestId => ({ requestId, plugins: [{ manifest: f.manifest, state: 'running', enabled: true }] })
    const event = { sender: f.sender, senderFrame: f.mainFrame }
    f.ipc.emit('odk-plugin-runtime-report', event, report(f.sent[0].requestId))
    f.ipc.emit('odk-plugin-runtime-report', event, report(f.sent.at(-1).requestId))
    assert.equal((await resumed)[0].state, 'available')
    assert.equal(f.frames[0].sender, f.sender)
    await f.host.stop()
    assert.equal(f.ipc.listenerCount('odk-plugin-runtime-report'), 0)
  })

  test(`${selected ? 'selected' : 'default'} diagnosis preserves missing frame and send failure reports`, async t => {
    const f = fixture({ frameCount: 0 })
    t.after(() => f.host.stop())
    await f.host.start()
    assert.equal((await f.host.get(f.port).snapshot())[0].reason, 'no-frame')
    f.frames.push({ id: 7, send() { throw Error('Private frame failure') } })
    const result = await f.host.get(f.port).snapshot()
    assert.deepEqual(result, [{ host: 'electron-renderer', instance: 'frame-7', state: 'unavailable', reason: 'send-failed', plugins: [] }])
  })
}

test('actual Electron diagnosis preserves selected consumers and rejects missing selection',
  { timeout: 60000, skip: require('./not-ported').posixOnlyReason('unix-socket') }, async t => {
    const fs = require('node:fs/promises')
    const os = require('node:os')
    const path = require('node:path')
    const { runCommand } = require('./helpers/hydra-wire-lifecycle')
    const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-renderer-probe-'))
    t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
    let baseline
    for (const mode of ['default', 'selected', 'missing']) {
      const directory = path.join(root, mode)
      await fs.mkdir(directory)
      const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(directory, 'config'),
        XDG_STATE_HOME: path.join(directory, 'state'), LOCALAPPDATA: path.join(directory, 'state'),
        XDG_RUNTIME_DIR: path.join(directory, 'runtime'), ODESK_WORKSPACE: path.join(directory, 'workspace'),
        ODK_DIAGNOSIS_EXPECTED_VERSION: mode === 'default' ? '1.0.0' : '2.0.0' }
      delete env.ELECTRON_RUN_AS_NODE
      const running = runCommand(require('electron'), [path.join(__dirname, 'renderer-diagnosis-electron.cjs'),
        '--diagnosis-selection-proof', ...(mode === 'selected' ? ['--selected-diagnosis'] : [])],
      { env, signal: t.signal, timeout: 15000, maxBuffer: 1024 * 1024 })
      if (mode === 'missing') await assert.rejects(running, /selected Renderer diagnosis is missing/)
      else {
        const report = JSON.parse((await running).stdout.trim().split('\n').pop())
        assert.equal(report.diagnosisSelection.version, env.ODK_DIAGNOSIS_EXPECTED_VERSION)
        assert.equal(report.diagnosisSelection.listenerReleased, true)
        assert.equal(report.diagnosisSelection.endpointReleased, true)
        if (baseline) assert.deepEqual(report.diagnosisSelection.consumer, baseline)
        else baseline = report.diagnosisSelection.consumer
      }
    }
  })
