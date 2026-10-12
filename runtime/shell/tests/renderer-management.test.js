const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createRendererManagement } = require('../src/renderer-management')

function fixture(options = {}) {
  const ipc = new EventEmitter()
  const sender = {}
  const mainFrame = {}
  const sent = []
  const signal = new AbortController()
  const frames = [{ sender, mainFrame: () => mainFrame, send: (_channel, request) => sent.push(request) }]
  const control = createRendererManagement({ ipc, frames: () => frames, signal: signal.signal, timeoutMs: 20, ...options })
  const reply = result => ipc.emit('odk-renderer-control-report', { sender, senderFrame: mainFrame }, { requestId: sent.at(-1).requestId, result })
  return { ipc, sender, mainFrame, sent, signal, frames, control, reply }
}
const id = 'odk.tile.clock'
const inventory = { ok: true, scope: 'electron-renderer', plugins: [{ pluginId: id, host: 'electron-renderer' }] }
const receipt = { ok: true, scope: 'electron-renderer', pluginId: id, enabled: false, state: 'disabled' }

for (const selected of [false, true]) {
  test(`${selected ? 'selected' : 'default'} Renderer control channel preserves public requests, CLI, and restart ownership`,
    { skip: require('./not-ported').posixOnlyReason('unix-socket') }, async t => {
      const fs = require('node:fs/promises')
      const os = require('node:os')
      const path = require('node:path')
      const { promisify } = require('node:util')
      const run = promisify(require('node:child_process').execFile)
      const { createPluginHost } = require('../src/plugin-host')
      const { createMainPlugins } = require('../src/plugins/main-composition')
      const { resolveShellHost } = require('../src/platform')
      const { requestLocalControl } = require('../src/local-control-client')
      const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-rctrl-'))
      const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: path.join(root, 'state'), OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config') }
      const platform = resolveShellHost({ env })
      const endpoint = platform.endpoint('renderer-plugin-control')
      const configFile = path.join(env.OPEN_DESKOS_CONFIG_DIR, 'plugins.json')
      await fs.mkdir(env.OPEN_DESKOS_CONFIG_DIR)
      const saved = JSON.stringify({ version: 1, plugins: {} })
      await fs.writeFile(configFile, saved)
      const ipc = new EventEmitter()
      const sender = {}
      const mainFrame = {}
      let enabled = true
      let hold = false
      let nextSend
      const reply = (request, result) => ipc.emit('odk-renderer-control-report', { sender, senderFrame: mainFrame }, { requestId: request.requestId, result })
      const frame = { sender, mainFrame: () => mainFrame, send(_channel, request) {
        if (hold) { nextSend(request); return }
        if (request.command === 'inventory') reply(request, inventory)
        else {
          enabled = request.command === 'enable'
          reply(request, { ok: true, scope: 'electron-renderer', pluginId: id, enabled, state: enabled ? 'running' : 'disabled' })
        }
      } }
      const host = createPluginHost({ capabilities: { 'system.renderer-control': {
        ipc, frames: () => [frame], endpoint, stateDir: platform.stateDir, timeoutMs: 1000,
      } } })
      t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true, force: true }) })
      const pluginId = 'odk.system.renderer-control'
      const replacement = selected ? require('./fixtures/renderer-control-replacement').independentRendererControl() : null
      const plugins = createMainPlugins({ replacementPlugins: replacement ? [replacement] : [], onDefaults(defaults) {
        if (replacement) defaults.find(plugin => plugin.manifest.id === pluginId).create = () => { throw Error('default Renderer control executed') }
      } })
      const plugin = plugins.find(plugin => plugin.manifest.id === pluginId)
      if (replacement) assert.equal(plugin, replacement)
      host.register(plugin)
      await host.start()
      assert.equal(host.list()[0].manifest.version, selected ? '2.0.0' : '1.0.0')
      assert.equal(host.list()[0].state, 'running')
      assert.equal(ipc.listenerCount('odk-renderer-control-report'), 1)
      const request = command => requestLocalControl({ endpoint, request: command })
      const { v, id: requestId, ...publicInventory } = await request({ command: 'inventory' })
      assert.equal(v, 1)
      assert.ok(requestId)
      assert.deepEqual(publicInventory, inventory)
      for (const command of ['disable', 'enable']) {
        const result = JSON.parse((await run(process.execPath, [path.join(__dirname, '../scripts/open-deskos-plugin-cli.js'), command, id, '--runtime'], { env })).stdout)
        assert.equal(result.scope, 'electron-renderer')
        assert.equal(result.enabled, command === 'enable')
        assert.equal(result.state, command === 'enable' ? 'running' : 'disabled')
        assert.equal(await fs.readFile(configFile, 'utf8'), saved)
      }
      hold = true
      const arrived = new Promise(resolve => { nextSend = resolve })
      const pending = request({ command: 'inventory' }).then(value => value, () => null)
      const old = await arrived
      await host.setEnabled(pluginId, false)
      assert.notEqual((await pending)?.ok, true)
      assert.equal(ipc.listenerCount('odk-renderer-control-report'), 0)
      await assert.rejects(fs.stat(endpoint), { code: 'ENOENT' })
      await host.setEnabled(pluginId, true)
      assert.equal(ipc.listenerCount('odk-renderer-control-report'), 1)
      const resumedArrival = new Promise(resolve => { nextSend = resolve })
      const resumed = request({ command: 'inventory' })
      const current = await resumedArrival
      assert.notEqual(current.requestId, old.requestId)
      reply(old, { ...inventory, plugins: [{ pluginId: 'odk.tile.old', host: 'electron-renderer' }] })
      reply(current, inventory)
      const { v: resumedVersion, id: resumedId, ...resumedInventory } = await resumed
      assert.equal(resumedVersion, 1)
      assert.ok(resumedId)
      assert.deepEqual(resumedInventory, inventory)
      assert.equal(enabled, true)
      assert.equal(await fs.readFile(configFile, 'utf8'), saved)
      await host.stop()
      assert.equal(ipc.listenerCount('odk-renderer-control-report'), 0)
      await assert.rejects(fs.stat(endpoint), { code: 'ENOENT' })
    })

  test(`${selected ? 'selected' : 'default'} Renderer control channel rejects invalid tokens before dispatch`,
    { skip: require('./not-ported').posixOnlyReason('unix-socket') }, async t => {
      const fs = require('node:fs/promises')
      const os = require('node:os')
      const path = require('node:path')
      const { createPluginHost } = require('../src/plugin-host')
      const { requestLocalControl } = require('../src/local-control-client')
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-rctrl-auth-'))
      const endpoint = path.join(root, 'control.sock')
      const stateDir = path.join(root, 'state')
      const ipc = new EventEmitter()
      const sender = {}
      const mainFrame = {}
      let dispatches = 0
      const frame = { sender, mainFrame: () => mainFrame, send(_channel, request) {
        dispatches++
        ipc.emit('odk-renderer-control-report', { sender, senderFrame: mainFrame }, { requestId: request.requestId, result: receipt })
      } }
      const host = createPluginHost({ capabilities: { 'system.renderer-control': {
        ipc, frames: () => [frame], endpoint, stateDir, platform: 'win32',
      } } })
      t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true, force: true }) })
      host.register(selected ? require('./fixtures/renderer-control-replacement').independentRendererControl()
        : require('../src/renderer-management').createRendererControlPlugin())
      await host.start()
      const wrong = path.join(root, 'wrong')
      await fs.writeFile(wrong, 'wrong')
      const options = { endpoint, platform: 'win32', request: { command: 'disable', pluginId: id } }
      await assert.rejects(requestLocalControl({ ...options, tokenFile: wrong }), /closed/)
      assert.equal(dispatches, 0)
      const { v, id: requestId, ...result } = await requestLocalControl({ ...options, tokenFile: path.join(stateDir, 'local-channel.token') })
      assert.equal(v, 1)
      assert.ok(requestId)
      assert.deepEqual(result, receipt)
      assert.equal(dispatches, 1)
    })
}

test('renderer management correlates only the selected live main frame', async () => {
  const f = fixture()
  const pending = f.control.dispatch({ command: 'disable', pluginId: id })
  const value = { requestId: f.sent[0].requestId, result: receipt }
  f.ipc.emit('odk-renderer-control-report', { sender: {}, senderFrame: f.mainFrame }, value)
  f.ipc.emit('odk-renderer-control-report', { sender: f.sender, senderFrame: {} }, value)
  f.ipc.emit('odk-renderer-control-report', { sender: f.sender, senderFrame: f.mainFrame }, { ...value, requestId: 'wrong' })
  f.reply(receipt)
  assert.deepEqual(await pending, receipt)
  f.control.close()
  assert.equal(f.ipc.listenerCount('odk-renderer-control-report'), 0)
})

test('management validates inventory and rejects private or mismatched receipts', async () => {
  const f = fixture()
  let pending = f.control.dispatch({ command: 'inventory' })
  f.reply(inventory)
  assert.deepEqual(await pending, inventory)
  for (const invalid of [{ ...receipt, enabled: true }, { ...receipt, pluginId: 'odk.tile.other' }, { ...receipt, privateError: 'private' }]) {
    pending = f.control.dispatch({ command: 'disable', pluginId: id })
    f.reply(invalid)
    assert.match((await pending).error, /operation outcome unknown/)
  }
  pending = f.control.dispatch({ command: 'inventory' })
  f.reply({ ...inventory, plugins: [inventory.plugins[0], inventory.plugins[0]] })
  assert.equal((await pending).error, 'inventory-unavailable')
  f.control.close()
})

test('absent, ambiguous, and navigated frames cannot certify management', async () => {
  const f = fixture()
  f.frames.push(f.frames[0])
  assert.equal((await f.control.dispatch({ command: 'inventory' })).error, 'inventory-unavailable')
  f.frames.pop()
  const pending = f.control.dispatch({ command: 'disable', pluginId: id })
  f.frames[0].mainFrame = () => ({})
  f.reply(receipt)
  assert.match((await pending).error, /operation outcome unknown/)
  f.frames.pop()
  assert.equal((await f.control.dispatch({ command: 'inventory' })).error, 'runtime-unavailable')
  f.control.close()
})

test('timeouts, bounds, and abort report uncertainty without replay', async () => {
  const f = fixture()
  assert.match((await f.control.dispatch({ command: 'disable', pluginId: id })).error, /operation outcome unknown/)
  const requests = Array.from({ length: 32 }, () => f.control.dispatch({ command: 'inventory' }))
  assert.equal((await f.control.dispatch({ command: 'inventory' })).error, 'runtime-busy')
  f.signal.abort()
  assert.ok((await Promise.all(requests)).every(result => result.error === 'runtime-stopped'))
  const count = f.sent.length
  assert.equal((await f.control.dispatch({ command: 'inventory' })).error, 'runtime-stopped')
  assert.equal(f.sent.length, count)
  f.control.close()
})

test('invalid commands do not cross the renderer bridge', async () => {
  const f = fixture()
  assert.equal((await f.control.dispatch({ command: 'inventory', pluginId: id })).error, 'invalid-command')
  assert.equal((await f.control.dispatch({ command: 'disable', pluginId: id, enabled: true })).error, 'invalid-command')
  assert.equal(f.sent.length, 0)
  f.control.close()
})

const revision = 'a'.repeat(64)
const signedEntry = `odk-native-plugin://${'b'.repeat(32)}/entry.js`
const activation = { ok: true, scope: 'electron-renderer', pluginId: id, revision, version: '2.0.0', state: 'running' }

test('Renderer activation prepares verified selection and binds its receipt to the selected main frame', async () => {
  const f = fixture({ prepareActivation: async pluginId => {
    assert.equal(pluginId, id)
    return { revision, version: '2.0.0', entryUrl: signedEntry }
  } })
  const pending = f.control.dispatch({ command: 'activate', pluginId: id })
  await new Promise(setImmediate)
  assert.equal(f.sent[0]?.entryUrl, signedEntry)
  assert.equal(f.sent[0]?.revision, revision)
  f.reply(activation)
  assert.deepEqual(await pending, activation)
  f.control.close()
})

test('failed or interrupted Renderer preparation never sends a command or exposes private failures', async () => {
  let release
  const f = fixture({ prepareActivation: () => new Promise(resolve => { release = resolve }) })
  const pending = f.control.dispatch({ command: 'activate', pluginId: id })
  await new Promise(setImmediate)
  f.signal.abort()
  release({ revision, version: '2.0.0', entryUrl: signedEntry })
  assert.match((await pending).error, /runtime-stopped/)
  await new Promise(setImmediate)
  assert.equal(f.sent.length, 0)
  f.control.close()
  const failed = fixture({ prepareActivation: async () => { throw Error('private publisher failure') } })
  assert.deepEqual(await failed.control.dispatch({ command: 'activate', pluginId: id }), { ok: false, error: 'activation-failed' })
  assert.equal(failed.sent.length, 0)
  failed.control.close()
})

test('Renderer preparation refuses concurrent captures and late sends after timeout or navigation', async () => {
  for (const navigation of [false, true]) {
    let release
    let captureSignal
    const f = fixture({ prepareActivation: (_id, options) => {
      captureSignal = options.signal
      return new Promise(resolve => { release = resolve })
    } })
    const pending = f.control.dispatch({ command: 'activate', pluginId: id })
    await new Promise(setImmediate)
    assert.equal((await f.control.dispatch({ command: 'activate', pluginId: id })).error, 'runtime-busy')
    if (navigation) {
      f.frames[0].mainFrame = () => ({})
      release({ revision, version: '2.0.0', entryUrl: signedEntry })
    }
    assert.match((await pending).error, /operation outcome unknown/)
    assert.equal(captureSignal.aborted, true)
    if (!navigation) release({ revision, version: '2.0.0', entryUrl: signedEntry })
    await new Promise(setImmediate)
    assert.equal(f.sent.length, 0)
    f.control.close()
  }
})

test('Renderer activation rejects mismatched revision, version, state, and private receipt fields', async () => {
  const f = fixture({ prepareActivation: async () => ({ revision, version: '2.0.0', entryUrl: signedEntry }) })
  for (const invalid of [{ ...activation, revision: 'c'.repeat(64) }, { ...activation, version: '1.0.0' },
    { ...activation, state: 'failed' }, { ...activation, privateError: 'private' }]) {
    const pending = f.control.dispatch({ command: 'activate', pluginId: id })
    await new Promise(setImmediate)
    f.reply(invalid)
    assert.match((await pending).error, /operation outcome unknown/)
    assert.equal((await f.control.dispatch({ command: 'restore-default', pluginId: id })).error, 'runtime-busy')
    f.reply(activation)
    await new Promise(setImmediate)
  }
  assert.equal((await f.control.dispatch({ command: 'activate', pluginId: id, entryUrl: signedEntry })).error, 'invalid-command')
  f.control.close()
})

test('Renderer management restores defaults without preparing a signed selection and validates its receipt', async () => {
  const f = fixture({ prepareActivation() { throw Error('restoration must not read external selections') } })
  const restored = { ok: true, scope: 'electron-renderer', pluginId: id, implementation: 'built-in', version: '1.0.0', state: 'running' }
  const pending = f.control.dispatch({ command: 'restore-default', pluginId: id })
  assert.equal(f.sent[0]?.command, 'restore-default')
  f.reply(restored)
  assert.deepEqual(await pending, restored)
  await new Promise(setImmediate)
  const invalid = f.control.dispatch({ command: 'restore-default', pluginId: id })
  f.reply({ ...restored, revision })
  assert.match((await invalid).error, /operation outcome unknown/)
  f.control.close()
})

test('uncertain dispatched replacement stays exclusive until its authenticated completion arrives', async () => {
  const f = fixture({ prepareActivation: async () => ({ revision, version: '2.0.0', entryUrl: signedEntry }) })
  try {
    const pending = f.control.dispatch({ command: 'activate', pluginId: id })
    await new Promise(setImmediate)
    const requestId = f.sent[0].requestId
    assert.match((await pending).error, /operation outcome unknown/)
    await new Promise(setImmediate)
    assert.equal((await f.control.dispatch({ command: 'restore-default', pluginId: id })).error, 'runtime-busy')
    const report = { requestId, result: activation }
    f.ipc.emit('odk-renderer-control-report', { sender: {}, senderFrame: f.mainFrame }, report)
    f.ipc.emit('odk-renderer-control-report', { sender: f.sender, senderFrame: {} }, report)
    f.ipc.emit('odk-renderer-control-report', { sender: f.sender, senderFrame: f.mainFrame }, { ...report, result: { ...activation, revision: 'c'.repeat(64) } })
    assert.equal((await f.control.dispatch({ command: 'activate', pluginId: id })).error, 'runtime-busy')
    f.ipc.emit('odk-renderer-control-report', { sender: f.sender, senderFrame: f.mainFrame }, report)
    const next = f.control.dispatch({ command: 'restore-default', pluginId: id })
    f.reply({ ok: false, error: 'restoration-failed' })
    assert.equal((await next).error, 'restoration-failed')
    const held = f.control.dispatch({ command: 'restore-default', pluginId: id })
    f.ipc.emit('odk-renderer-control-report', { sender: f.sender, senderFrame: f.mainFrame }, report)
    assert.equal((await f.control.dispatch({ command: 'restore-default', pluginId: id })).error, 'runtime-busy')
    f.reply({ ok: false, error: 'restoration-failed' })
    assert.equal((await held).error, 'restoration-failed')
  } finally { f.control.close() }
})

test('timed out preparation remains exclusive until its loader settles without dispatch', async () => {
  let release
  const f = fixture({ prepareActivation: () => new Promise(resolve => { release = resolve }) })
  try {
    const pending = f.control.dispatch({ command: 'activate', pluginId: id })
    await new Promise(setImmediate)
    assert.match((await pending).error, /operation outcome unknown/)
    assert.equal((await f.control.dispatch({ command: 'restore-default', pluginId: id })).error, 'runtime-busy')
    release({ revision, version: '2.0.0', entryUrl: signedEntry })
    await new Promise(setImmediate)
    assert.equal(f.sent.length, 0)
    const next = f.control.dispatch({ command: 'restore-default', pluginId: id })
    f.reply({ ok: false, error: 'restoration-failed' })
    assert.equal((await next).error, 'restoration-failed')
  } finally { f.control.close() }
})

test('uncertain restoration retains frame authority and ignores completion after navigation or shutdown', async () => {
  const f = fixture()
  try {
    const pending = f.control.dispatch({ command: 'restore-default', pluginId: id })
    const requestId = f.sent[0].requestId
    assert.match((await pending).error, /operation outcome unknown/)
    const nextFrame = {}
    f.frames[0].mainFrame = () => nextFrame
    const result = { ok: true, scope: 'electron-renderer', pluginId: id, implementation: 'built-in', version: '1.0.0', state: 'running' }
    f.ipc.emit('odk-renderer-control-report', { sender: f.sender, senderFrame: f.mainFrame }, { requestId, result })
    f.ipc.emit('odk-renderer-control-report', { sender: f.sender, senderFrame: nextFrame }, { requestId, result })
    assert.equal((await f.control.dispatch({ command: 'restore-default', pluginId: id })).error, 'runtime-busy')
    f.signal.abort()
    f.frames[0].mainFrame = () => f.mainFrame
    f.ipc.emit('odk-renderer-control-report', { sender: f.sender, senderFrame: f.mainFrame }, { requestId, result })
    assert.equal((await f.control.dispatch({ command: 'restore-default', pluginId: id })).error, 'runtime-stopped')
  } finally { f.control.close() }
})

test('a send that exposes an implementation command before throwing retains uncertain ownership', async () => {
  const f = fixture()
  f.frames[0].send = (_channel, request) => { f.sent.push(request); throw Error('send outcome unknown') }
  try {
    const result = await f.control.dispatch({ command: 'restore-default', pluginId: id })
    assert.match(result.error, /operation outcome unknown/)
    assert.equal((await f.control.dispatch({ command: 'restore-default', pluginId: id })).error, 'runtime-busy')
    f.reply({ ok: false, error: 'restoration-failed' })
    f.frames[0].send = (_channel, request) => f.sent.push(request)
    const next = f.control.dispatch({ command: 'restore-default', pluginId: id })
    f.reply({ ok: false, error: 'restoration-failed' })
    assert.equal((await next).error, 'restoration-failed')
  } finally { f.control.close() }
})
