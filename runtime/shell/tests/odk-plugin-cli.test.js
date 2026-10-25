const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { main, readConfig, resolveConfigPath, validateManifest } = require('../scripts/odk-plugin-cli')

test('CLI validate checks manifest schema version 1', t => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cli-test-'))
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
  const validPath = path.join(tmpDir, 'manifest.json')
  fs.writeFileSync(validPath, JSON.stringify({
    schemaVersion: 1,
    id: 'odk.test.plugin',
    kind: 'service',
    host: 'electron-main',
    name: 'Test plugin',
    version: '1.0.0',
  }))

  const manifest = validateManifest(validPath)
  assert.equal(manifest.id, 'odk.test.plugin')

  const invalidPath = path.join(tmpDir, 'invalid.json')
  fs.writeFileSync(invalidPath, JSON.stringify({ schemaVersion: 2, id: 'test' }))
  assert.throws(() => validateManifest(invalidPath), /schema.*1/)
})

test('CLI rejects declarations rejected by the Host', t => {
  const { createPluginHost } = require('../src/plugin-host')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cli-manifest-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const target = path.join(root, 'manifest.json')
  const base = { schemaVersion: 1, id: 'odk.test.plugin', kind: 'service', host: 'electron-main', name: 'Test', version: '1.0.0' }
  const invalid = [
    { id: '../outside' }, { kind: 'widget' }, { host: 'unknown' }, { name: '' }, { version: 'latest' },
    { provides: {} }, { provides: [{ interface: 'invalid' }] },
    { provides: [{ interface: 'odk:test/v1', optional: true }] },
    { provides: [{ interface: 'odk:test/v1' }, { interface: 'odk:test/v1' }] },
    { requires: [{ interface: 'odk:test/v1', optional: 'true' }] },
    { requires: [{ interface: 'odk:test/v1', unknown: true }] },
    { permissions: ['ipc', 'ipc'] }, { permissions: ['../files'] }, { permissions: {} },
  ]
  for (const changes of invalid) {
    const manifest = { ...base, ...changes }
    fs.writeFileSync(target, JSON.stringify(manifest))
    let expected
    try { createPluginHost().register({ manifest, create() { return {} } }) } catch (error) { expected = error.message }
    assert.ok(expected, JSON.stringify(changes))
    assert.throws(() => validateManifest(target), error => error.message === expected, JSON.stringify(changes))
  }
})

test('manifest validation is pure and returns the Host normalized declaration without loading entry code', async t => {
  const { validatePluginManifest, createPluginHost } = require('../src/plugin-host')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cli-pure-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const entry = path.join(root, 'entry.js')
  const marker = path.join(root, 'executed')
  fs.writeFileSync(entry, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`)
  const original = { schemaVersion: 1, id: 'odk.test.plugin', kind: 'service', host: 'electron-main', name: 'Test', version: '1.0.0', entry,
    requires: [{ interface: 'odk:missing/v1' }], permissions: ['ipc'] }
  const file = path.join(root, 'manifest.json')
  fs.writeFileSync(file, JSON.stringify(original))
  const normalized = validateManifest(file)
  assert.deepEqual(normalized, validatePluginManifest(original))
  const host = createPluginHost()
  host.register({ manifest: original, create() { throw Error('must not execute') } })
  assert.deepEqual(host.list()[0].manifest, normalized)
  normalized.permissions.push('files')
  assert.deepEqual(original.permissions, ['ipc'])
  assert.equal(Object.hasOwn(original, 'provides'), false)
  assert.equal(fs.existsSync(marker), false)
  await assert.rejects(host.start(), /missing required port/)
  await host.stop()
  const ungranted = createPluginHost()
  ungranted.register({ manifest: { ...original, requires: [] }, create() { throw Error('must not execute') } })
  await ungranted.start()
  assert.equal(ungranted.list()[0].state, 'failed')
  assert.match(ungranted.list()[0].error, /missing capability ipc/)
  await ungranted.stop()
})

test('browser and Node exports validate the same manifest without loading a Node module', () => {
  const vm = require('node:vm')
  const { validatePluginManifest } = require('../src/plugin-host')
  const window = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/plugin-host.js'), 'utf8'), { window, structuredClone })
  const manifest = { schemaVersion: 1, id: 'odk.test.renderer', kind: 'surface', host: 'electron-renderer', name: 'Renderer', version: '1.0.0',
    requires: [{ interface: 'odk:optional/v1', optional: true }] }
  assert.deepEqual(JSON.parse(JSON.stringify(window.odkPluginHost.validatePluginManifest(manifest))), validatePluginManifest(manifest))
  assert.throws(() => window.odkPluginHost.validatePluginManifest({ ...manifest, permissions: ['../files'] }), /invalid plugin permissions/)
  assert.throws(() => window.odkPluginHost.createPluginHost().register({ manifest }), /requires a factory/)
})

test('CLI enables and disables plugins in config', t => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cli-cfg-'))
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))
  const env = { ODK_CONFIG_DIR: tmpDir }

  assert.equal(main(['enable', 'odk.test.clock'], env), 0)
  const config1 = readConfig(resolveConfigPath(env))
  assert.equal(config1.plugins['odk.test.clock'].enabled, true)

  assert.equal(main(['disable', 'odk.test.clock'], env), 0)
  const config2 = readConfig(resolveConfigPath(env))
  assert.equal(config2.plugins['odk.test.clock'].enabled, false)
})

// Exercise the actual unified entry with only an owned, harmless runner.
function serviceFixture(t, { layout = 0, missing = false, real = false, fail = false, code = 0, output = '{"services":[]}', hold = false } = {}) {
  const { EventEmitter } = require('node:events'), { createRequire } = require('node:module'), vm = require('node:vm')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-service-cli-'))
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }))
  const directory = path.join(temp, 'repo/runtime/shell/scripts')
  const launchers = ['../../../integrations/service-runtime/service_runtime.py', '../integrations/service-runtime/service_runtime.py', '../../integrations/service-runtime/service_runtime.py'].map(p => path.resolve(directory, p))
  if (!missing) {
    fs.mkdirSync(path.dirname(launchers[layout]), { recursive: true })
    fs.writeFileSync(launchers[layout], `console.log(JSON.stringify({args:process.argv.slice(2),unsafe:Object.keys(process.env).filter(key=>key.startsWith('PYTHON')||key.startsWith('UV_')||key.startsWith('DYLD_')||['LD_PRELOAD','LD_LIBRARY_PATH','VIRTUAL_ENV','NODE_OPTIONS'].includes(key))}))`)
  }
  const config = path.join(temp, 'not-a-config-directory'); fs.writeFileSync(config, 'Must not read plugin config')
  const filename = path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), local = createRequire(filename)
  const logs = [], errors = [], runs = [], kills = [], timers = [], cleared = []
  const owner = Object.assign(new EventEmitter(), { platform: process.platform, argv: [], env: {}, kill(pid, signal) { kills.push([pid, signal]) } })
  let child
  const spawn = (executable, args, options) => {
    runs.push({ executable, args, options })
    if (real) return (child = require('node:child_process').spawn(executable, args, options))
    if (fail) throw Error('PRIVATE_SPAWN_DIAGNOSTIC')
    child = Object.assign(new EventEmitter(), { pid: 424242, stdout: Object.assign(new EventEmitter(), { setEncoding() {} }), stderr: new EventEmitter(), kill(signal) { kills.push([this.pid, signal]) } })
    if (!hold) queueMicrotask(() => { child.stdout.emit('data', output); child.stderr.emit('data', 'PRIVATE_PROVIDER_STDERR'); child.emit('close', code) })
    return child
  }
  const module = { exports: {} }
  function requireFixture(name) { return name === 'node:child_process' ? { spawn } : local(name) }
  requireFixture.main = {}
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, require: requireFixture, __dirname: directory, process: owner, Buffer,
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => errors.push(a.join(' ')) },
    setTimeout(callback, delay) { const timer = { callback, delay, unref() { return this } }; timers.push(timer); return timer },
    clearTimeout(timer) { cleared.push(timer) },
  }, { filename })
  const env = { PATH: process.env.PATH, ODK_CONFIG_DIR: config, ODK_SERVICE_RUNTIME_PYTHON: process.execPath, PYTHONPATH: 'PRIVATE_OVERRIDE', UV_PROJECT: 'PRIVATE_OVERRIDE', DYLD_INSERT_LIBRARIES: 'PRIVATE_OVERRIDE', LD_PRELOAD: 'PRIVATE_OVERRIDE', LD_LIBRARY_PATH: 'PRIVATE_OVERRIDE', VIRTUAL_ENV: 'PRIVATE_OVERRIDE', NODE_OPTIONS: '--invalid-private-option' }
  return { main: args => module.exports.main(args, env), launchers, logs, errors, runs, kills, timers, cleared, owner, get child() { return child } }
}

test('unified service commands work before plugin config reads in all three source/release layouts', async t => {
  for (let layout = 0; layout < 3; layout++) {
    const f = serviceFixture(t, { layout })
    assert.equal(await f.main(['service', '--state-dir', '/fixture/state', 'list']), 0)
    assert.equal(f.runs.length, 1)
    assert.equal(f.runs[0].args[0], f.launchers[layout])
    assert.deepEqual(Array.from(f.runs[0].args.slice(1)), ['--state-dir', '/fixture/state', 'list'])
    assert.equal(f.logs.at(-1), '{"services":[]}')
  }
})

test('service preserves exact argv, suppresses interpreter injection and uses no command shell', async t => {
  const f = serviceFixture(t), args = ['service', 'install', '/fixture/package with spaces', '--config', '/fixture/private bindings.json', '--trust']
  assert.equal(await f.main(args), 0)
  const r = f.runs[0]
  assert.equal(r.executable, process.execPath)
  assert.deepEqual(Array.from(r.args.slice(1)), args.slice(1))
  assert.equal(r.options.shell, false)
  assert.deepEqual(Array.from(r.options.stdio), ['ignore', 'pipe', 'pipe'])
  for (const key of ['PYTHONPATH','UV_PROJECT','DYLD_INSERT_LIBRARIES','LD_PRELOAD','LD_LIBRARY_PATH','VIRTUAL_ENV','NODE_OPTIONS']) assert.equal(Object.hasOwn(r.options.env, key), false, key)
  assert.equal(r.options.env.PATH, process.env.PATH)
})

test('absent optional manager fails before spawning or reading startup configuration', async t => {
  const f = serviceFixture(t, { missing: true })
  assert.equal(await f.main(['service', 'list']), 1)
  assert.equal(f.runs.length, 0)
  assert.match(f.errors.join('\n'), /Service runtime is unavailable/)
})

test('service spawn and process failure never disclose private output or diagnostics', async t => {
  for (const setup of [{ fail: true }, { code: 9, output: 'PRIVATE_PROVIDER_OUTPUT' }]) {
    const f = serviceFixture(t, setup)
    assert.equal(await f.main(['service', 'inspect', 'odk.fixture.service']), setup.code || 1)
    assert.equal(f.logs.length, 0)
    assert.doesNotMatch(f.errors.join('\n'), /PRIVATE_/)
    assert.match(f.errors.join('\n'), /Service command failed/)
    assert.equal(f.owner.listenerCount('SIGTERM'), 0)
    assert.equal(f.owner.listenerCount('SIGINT'), 0)
  }
})

test('oversized service output fails closed and requests bounded owned-runner cleanup', async t => {
  const f = serviceFixture(t, { output: 'x'.repeat(1024 * 1024 + 1) })
  assert.equal(await f.main(['service', 'list']), 1)
  assert.equal(f.logs.length, 0)
  assert.equal(f.kills[0][1], 'SIGTERM')
  assert.equal(f.timers[0].delay, 310000)
  assert.ok(f.cleared.includes(f.timers[0]))
})

test('foreground service cancellation forwards signals and waits for owned runner closure', async t => {
  const f = serviceFixture(t, { hold: true })
  let finished = false
  const operation = f.main(['service', 'run', 'odk.fixture.service']).then(code => { finished = true; return code })
  assert.equal(f.runs.length, 1)
  f.owner.emit('SIGTERM'); f.owner.emit('SIGINT')
  assert.equal(finished, false)
  const pid = process.platform === 'win32' ? 424242 : -424242
  assert.deepEqual(f.kills, [[pid, 'SIGTERM'], [pid, 'SIGINT']])
  assert.equal(f.timers.length, 1)
  assert.equal(f.timers[0].delay, 310000)
  f.timers[0].callback(); assert.deepEqual(f.kills.at(-1), [pid, 'SIGKILL'])
  f.child.emit('close', null)
  assert.equal(await operation, 1)
  assert.equal(f.owner.listenerCount('SIGTERM'), 0)
  assert.equal(f.owner.listenerCount('SIGINT'), 0)
})

test('actual service CLI starts an isolated harmless interpreter child with exact argv and clean overrides', async t => {
  const f = serviceFixture(t, { real: true })
  assert.equal(await f.main(['service', '--state-dir', '/fixture/state', 'list']), 0)
  const result = JSON.parse(f.logs.at(-1))
  assert.deepEqual(result.args, ['--state-dir', '/fixture/state', 'list'])
  assert.deepEqual(result.unsafe, [])
  assert.equal(f.owner.listenerCount('SIGTERM'), 0)
  assert.equal(f.owner.listenerCount('SIGINT'), 0)
})
