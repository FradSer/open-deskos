const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createUserAppStore } = require('../src/user-app-store')
const { createUserAppControl, listenUserAppControl } = require('../src/user-app-control')
const { createPluginHost } = require('../src/plugin-host')
const { createDiagnosticsPlugin } = require('../src/plugin-diagnostics')
const { resolveShellHost } = require('../src/platform')
const { posixOnlyReason } = require('./not-ported')
const run = promisify(execFile)
const cli = path.join(__dirname, '../scripts/odk-plugin-cli.js')

async function fixture(t, verify) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-cli-manage-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: root, ODK_CONFIG_DIR: path.join(root, 'config') }
  const host = resolveShellHost({ env })
  const workspace = path.join(root, 'workspace')
  const folder = path.join(workspace, 'apps/notes')
  await fs.mkdir(folder, { recursive: true })
  async function draft(version) {
    await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'notes', name: 'Notes', version, kind: 'app' }))
    await fs.writeFile(path.join(folder, 'index.html'), `<p>${version}</p>`)
  }
  await draft('1')
  let accepted = true
  const store = createUserAppStore({ workspace, stateDir: path.join(root, 'catalog'), verify: bundle => accepted && (verify ? verify(bundle) : true) })
  const server = await listenUserAppControl({ socketPath: host.endpoint('user-app-control'), control: createUserAppControl(store) })
  t.after(() => server.close())
  const plugins = createPluginHost({ capabilities: { 'plugin.diagnostics': { endpoint: host.endpoint('plugin-diagnostics'), stateDir: host.stateDir, snapshot: () => plugins.list() } } })
  plugins.register(createDiagnosticsPlugin())
  await plugins.start()
  t.after(() => plugins.stop())
  return { store, draft, folder, root, rejectVerification: () => { accepted = false }, command: (...args) => run(process.execPath, [cli, ...args], { env }) }
}

test('CLI adds local HTML package bytes through verification and preserves prior revisions on failure', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t)
  const incoming = path.join(f.root, 'incoming')
  await fs.cp(f.folder, incoming, { recursive: true })
  const first = JSON.parse((await f.command('add', incoming)).stdout)
  assert.equal(first.ok, true)
  assert.equal((await f.store.getContent('notes')).html, '<p>1</p>')
  await fs.writeFile(path.join(incoming, 'index.html'), '<p>Imported update</p>')
  const second = JSON.parse((await f.command('add', incoming)).stdout)
  assert.notEqual(second.app.revision, first.app.revision)
  assert.equal((await f.store.rollback('notes')).app.revision, first.app.revision)
  f.rejectVerification()
  await assert.rejects(f.command('add', incoming), /verification-failed/)
  assert.equal((await f.store.list())[0].revision, first.app.revision)
  await fs.rm(incoming, { recursive: true })
  assert.equal((await f.store.getContent('notes')).html, '<p>1</p>')
  const restarted = createUserAppStore({ stateDir: path.join(f.root, 'catalog'), verify: () => true })
  assert.equal((await restarted.getContent('notes')).html, '<p>1</p>')
})

test('CLI add refuses unsafe files, native manifests, and URL sources without changing installed state', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t)
  const alias = path.join(f.root, 'alias')
  await fs.symlink(f.folder, alias)
  await assert.rejects(f.command('add', alias), /unsafe-package/)
  await fs.writeFile(path.join(f.folder, 'index.html'), 'x'.repeat(256 * 1024 + 1))
  await assert.rejects(f.command('add', f.folder), /package-too-large/)
  await f.draft('1')
  await fs.writeFile(path.join(f.folder, 'manifest.json'), 'x'.repeat(8 * 1024 + 1))
  await assert.rejects(f.command('add', f.folder), /manifest-too-large/)
  await f.draft('1')
  await fs.rm(path.join(f.folder, 'index.html'))
  await fs.symlink(path.join(f.folder, 'manifest.json'), path.join(f.folder, 'index.html'))
  await assert.rejects(f.command('add', f.folder), /unsafe-package/)
  await fs.rm(path.join(f.folder, 'index.html'))
  await f.draft('1')
  await fs.writeFile(path.join(f.folder, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'odk.native.fixture', kind: 'service', name: 'Native', version: '1.0.0', entry: 'entry.js' }))
  await assert.rejects(f.command('add', f.folder), /invalid-manifest|invalid-identifier/)
  await assert.rejects(f.command('add', 'https://example.invalid/package'), /URL installation is not available/)
  assert.deepEqual(await f.store.list(), [])
})

test('CLI local installation uses the real Electron verifier and rejects broken HTML', { skip: posixOnlyReason('unix-socket') }, async t => {
  const { createUserAppVerifier } = require('../src/user-app-verifier')
  const { createVerifierObserver } = require('./helpers/verifier-observation')
  const observer = createVerifierObserver()
  t.after(() => observer.close())
  const verifier = createUserAppVerifier({ electronPath: require('electron'), spawnProcess: observer.spawnProcess })
  const verdicts = []
  const f = await fixture(t, async bundle => {
    const result = await verifier.verify(bundle)
    observer.recordVerdict(result)
    verdicts.push(result.ok)
    return result
  })
  let phase = 'install'
  try {
    const first = JSON.parse((await f.command('add', f.folder)).stdout)
    assert.equal(first.ok, true)
    phase = 'update'
    await f.draft('2')
    const second = JSON.parse((await f.command('update', 'notes')).stdout)
    assert.notEqual(second.app.revision, first.app.revision)
    phase = 'rollback'
    const restored = JSON.parse((await f.command('rollback', 'notes')).stdout)
    assert.equal(restored.app.revision, first.app.revision)
    assert.equal((await f.store.getContent('notes')).html, '<p>1</p>')
    phase = 'controlled rejection'
    await fs.writeFile(path.join(f.folder, 'index.html'), '<body><p>Broken</p><script>throw new Error("fixture")</script></body>')
    await assert.rejects(f.command('add', f.folder), /verification-failed/)
    assert.equal((await f.store.list())[0].revision, first.app.revision)
    await observer.close()
    assert.deepEqual(verdicts, [true, true, true, false])
    const records = observer.snapshot()
    assert.equal(records.length, 4)
    for (const [index, record] of records.entries()) {
      assert.equal(record.closed, true)
      assert.equal(record.events.some(event => event.event === 'spawned'), true)
      assert.equal(record.events.some(event => ['file-result', 'stdout-result'].includes(event.event) && event.ok === (index !== 3)), true)
      assert.equal(record.events.find(event => event.event === 'close').code, index === 3 ? 1 : 0)
      assert.equal(record.events.find(event => event.event === 'verdict').outcome, index === 3 ? 'rejected' : 'accepted')
    }
  } catch (error) {
    error.message += `\nVerifier process observation: ${JSON.stringify({ phase, records: observer.snapshot() })}`
    throw error
  }
})

test('CLI lists real host and package state, updates verified revisions, and removes installed content', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t)
  const initial = await f.store.install('notes')
  const list = JSON.parse((await f.command('list')).stdout)
  assert.equal(list.scope, 'electron-main-and-installed-packages')
  assert.equal(list.plugins[0].state, 'running')
  assert.equal(list.apps[0].revision, initial.app.revision)
  await f.draft('2')
  const update = JSON.parse((await f.command('update', 'notes')).stdout)
  assert.equal(update.ok, true)
  assert.notEqual(update.app.revision, initial.app.revision)
  assert.equal((await f.store.getContent('notes')).html, '<p>2</p>')
  assert.equal((await f.store.rollback('notes')).app.revision, initial.app.revision)
  assert.equal(JSON.parse((await f.command('remove', 'notes')).stdout).ok, true)
  assert.deepEqual(await f.store.list(), [])
})

test('CLI propagates failed verification and refuses update as installation', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t)
  await assert.rejects(f.command('update', 'notes'), /not-found/)
  assert.deepEqual(await f.store.list(), [])
  const initial = await f.store.install('notes')
  await f.draft('2')
  f.rejectVerification()
  await assert.rejects(f.command('update', 'notes'), /verification-failed/)
  assert.equal((await f.store.list())[0].revision, initial.app.revision)
  await assert.rejects(f.command('remove', 'missing'), /not-found/)
  await assert.rejects(f.command('remove', 'odk.system.clock'), /development plugin is not linked/)
})

test('CLI rollback restores retained verified bytes without the draft and survives restart', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t)
  const first = await f.store.install('notes')
  await f.draft('2')
  const second = JSON.parse((await f.command('update', 'notes')).stdout)
  await fs.rm(f.folder, { recursive: true })
  const restored = JSON.parse((await f.command('rollback', 'notes')).stdout)
  assert.equal(restored.ok, true)
  assert.equal(restored.app.revision, first.app.revision)
  assert.equal((await f.store.getContent('notes')).html, '<p>1</p>')
  const restarted = createUserAppStore({ stateDir: path.join(f.root, 'catalog'), verify: () => true })
  assert.equal((await restarted.getContent('notes')).html, '<p>1</p>')
  const toggled = JSON.parse((await f.command('rollback', 'notes')).stdout)
  assert.equal(toggled.app.revision, second.app.revision)
  assert.equal((await f.store.getContent('notes')).html, '<p>2</p>')
})

test('CLI rollback preserves current revision when history or verification is unavailable', { skip: posixOnlyReason('unix-socket') }, async t => {
  const f = await fixture(t)
  const first = await f.store.install('notes')
  await assert.rejects(f.command('rollback', 'notes'), /no-rollback/)
  assert.equal((await f.store.list())[0].revision, first.app.revision)
  await f.draft('2')
  const second = JSON.parse((await f.command('update', 'notes')).stdout)
  f.rejectVerification()
  await assert.rejects(f.command('rollback', 'notes'), /verification-failed/)
  assert.equal((await f.store.list())[0].revision, second.app.revision)
  assert.equal((await f.store.getContent('notes')).html, '<p>2</p>')
  await assert.rejects(f.command('rollback', 'missing'), /not-found/)
  for (const args of [[], ['odk.system.clock'], ['notes', 'extra']]) {
    await assert.rejects(f.command('rollback', ...args), /requires an installed Widget\/App identifier/)
  }
  assert.equal((await f.store.list())[0].revision, second.app.revision)
})

test('CLI unavailable and unsupported operations exit with failure', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-cli-unavailable-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const env = { ...process.env, XDG_RUNTIME_DIR: root, ODK_CONFIG_DIR: root }
  for (const args of [['add', '/tmp/package'], ['link', '/tmp/package'], ['update'], ['remove', 'notes'], ['list'], ['unknown']]) {
    await assert.rejects(run(process.execPath, [cli, ...args], { env }), error => error.code === 1 && !error.stdout.includes('executed successfully'))
  }
})

const { requestLocalControl } = require('../src/local-control-client')
const net = require('node:net')

test('application update and rollback mutations use the existing token gate', { skip: posixOnlyReason('unix-socket') }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-cli-token-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const endpoint = path.join(root, 'control.sock')
  const tokenFile = path.join(root, 'token')
  await fs.writeFile(tokenFile, 'fixture-token')
  let calls = 0
  // Token authentication on Unix is a fixture, not Windows pipe acceptance.
  const server = await listenUserAppControl({ socketPath: endpoint, platform: 'win32', channelToken: 'fixture-token',
    control: createUserAppControl({ updateInstalled: async () => { calls++; return { ok: true } }, rollback: async () => { calls++; return { ok: true } } }) })
  t.after(() => server.close())
  const options = { endpoint, platform: 'win32', tokenFile, request: { command: 'update', appId: 'notes' }, label: 'application control' }
  for (const command of ['update', 'rollback']) {
    const before = calls
    options.request.command = command
    await fs.writeFile(tokenFile, 'wrong-token')
    await assert.rejects(requestLocalControl(options), /closed|failed/)
    assert.equal(calls, before)
    await fs.writeFile(tokenFile, 'fixture-token')
    assert.equal((await requestLocalControl(options)).ok, true)
    assert.equal(calls, before + 1)
  }
})

test('control client rejects invalid, oversized, lost and delayed responses without replay', { skip: posixOnlyReason('unix-socket') }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-cli-wire-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const cases = [
    () => 'invalid-json\n',
    request => JSON.stringify({ v: 1, id: 'wrong', ok: true }) + '\n',
    request => JSON.stringify({ v: 1, id: request.id, ok: 'true' }) + '\n',
    () => 'x'.repeat(257),
    () => null,
    () => undefined,
    request => JSON.stringify({ v: 1, id: request.id, ok: false, error: 'verification-failed' }) + '\n',
  ]
  for (const [index, reply] of cases.entries()) {
    const endpoint = path.join(root, `${index}.sock`)
    let calls = 0
    const sockets = new Set()
    const server = net.createServer(socket => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {})
      let pending = ''
      socket.on('data', chunk => {
        pending += chunk
        if (!pending.includes('\n')) return
        calls++
        const response = reply(JSON.parse(pending.trim()))
        if (response === null) socket.end()
        else if (response !== undefined) socket.end(response)
      })
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve) })
    try {
      await assert.rejects(requestLocalControl({ endpoint, label: 'application control', request: { command: 'remove', appId: 'notes' }, maxResponseBytes: 256, timeoutMs: 200 }), error => {
        if (index === cases.length - 1) assert.equal(error.message, 'verification-failed')
        else assert.match(error.message, /operation outcome unknown/)
        return true
      })
      assert.equal(calls, 1)
    } finally {
      for (const socket of sockets) socket.destroy()
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }
})
