'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const { createCameraSource, createCameraCaptureProvider } = require('../src/camera-source')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createPluginHost } = require('../src/plugin-host')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const run = promisify(execFile)
const cli = path.join(__dirname, '../scripts/odk-plugin-cli.js')
const directory = path.join(__dirname, 'fixtures/camera-replacement')
const sourcePort = 'odk:source/camera/v1'
const healthPort = 'odk:plugin-health/odk.source.camera/v1'
const jpeg = Buffer.concat([Buffer.from([255, 216]), Buffer.alloc(8192), Buffer.from([255, 217])])

async function fixture(t, replacement) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cparity-'))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let replacements = []
  if (replacement === 'signed') {
    const native = await require('./helpers/camera-selection').install(root, env)
    replacements = await native.load()
    assert.equal(replacements.length, 1)
    native.mutate()
  } else if (replacement) {
    await run(process.execPath, [cli, 'link', directory, '--trust', '--replace', '--grant', 'source.camera', '--grant', 'ipc'], { env })
    replacements = loadDevelopmentPlugins(readConfig(resolveConfigPath(env)))
    assert.equal(replacements.length, 1)
  }
  let clock = 1700000000000
  let present = true
  let frame = jpeg
  let calls = 0
  let captureGate
  let captureHook = () => {}
  const files = new Map()
  const options = {
    device: '/synthetic/camera', now: () => clock,
    fsImpl: {
      existsSync: () => present,
      mkdtempSync: prefix => `${prefix}fixture`,
      readFileSync: file => files.get(file),
      rmSync: () => files.clear(),
    },
    execFileImpl: async (_command, args) => {
      calls++
      captureHook()
      await captureGate
      const target = args.find(arg => arg.startsWith('--stream-to=')).slice('--stream-to='.length)
      if (frame instanceof Error) throw frame
      files.set(target, frame)
    },
  }
  const handlers = new Map()
  const host = createPluginHost({ capabilities: {
    ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); handlers.set(name, handler) }, removeHandler: name => handlers.delete(name) },
    'source.camera': { options, provider: createCameraCaptureProvider, create(configuration) {
      assert.equal(replacement, false, 'replacement must not invoke the default source factory')
      return createCameraSource(configuration)
    } },
  } })
  t.after(() => host.stop())
  host.register(createMainPlugins({ replacementPlugins: replacements }).find(plugin => plugin.manifest.id === 'odk.source.camera'))
  await host.start()
  if (replacement === 'signed') {
    assert.equal(host.get(sourcePort).fixtureRevision, '2.0.0')
    assert.equal(host.list()[0].manifest.version, '2.0.0')
  }
  return { host, handlers, env, files, options, calls: () => calls, advance: (milliseconds = 10000) => { clock += milliseconds },
    present: value => { present = value }, frame: value => { frame = value },
    holdCapture: gate => { captureGate = gate },
    onCapture: callback => { captureHook = callback },
    read: () => handlers.get('odk-camera-frame')(null), health: () => host.get(healthPort).snapshot(),
  }
}

for (const replacement of [false, true, 'signed']) {
  const label = replacement === 'signed' ? 'signed independent' : replacement ? 'linked independent' : 'default'
  test(`${label} Camera stop retains every active capture`, async t => {
    const f = await fixture(t, replacement)
    const releases = []
    const source = f.host.get(sourcePort)
    const reads = []
    for (let index = 0; index < 2; index++) {
      f.holdCapture(new Promise(resolve => { releases.push(resolve) }))
      reads.push(f.read())
      f.advance()
    }
    assert.equal(f.calls(), 2)
    let stopped = false
    const shutdown = source.stop().then(() => { stopped = true })
    try {
      releases[0]()
      assert.equal((await reads[0]).status, 'unavailable')
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(stopped, false, 'One completed capture cannot release a still-owned sibling')
    } finally { releases.forEach(release => release()) }
    assert.equal((await reads[1]).status, 'unavailable')
    await shutdown
    assert.equal(source.snapshot().frame, null)
    assert.equal(f.health().state, 'failed')
  })
  test(`${label} Camera retains a capture during provider reentrant stop`, async t => {
    const f = await fixture(t, replacement)
    let release
    f.holdCapture(new Promise(resolve => { release = resolve }))
    const source = f.host.get(sourcePort)
    let stopped = false
    let shutdown
    f.onCapture(() => { shutdown = source.stop().then(() => { stopped = true }) })
    const pending = f.read()
    try {
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(stopped, false, 'Provider reentry must observe capture ownership before acquisition')
    } finally { release() }
    assert.equal((await pending).status, 'unavailable')
    await shutdown
  })
  test(`${label} Camera disable drains captures and suppresses late frames`, async t => {
    const f = await fixture(t, replacement)
    let release
    const gate = new Promise(resolve => { release = resolve })
    f.holdCapture(gate)
    const source = f.host.get(sourcePort)
    const pending = f.read()
    assert.equal(f.calls(), 1)
    let stopped = false
    const shutdown = f.host.setEnabled('odk.source.camera', false).then(() => { stopped = true })
    try {
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(stopped, false, 'Disable must wait for the actual capture completion')
      assert.equal((await source.refresh()).status, 'unavailable')
      assert.equal(f.calls(), 1, 'Stopped source must not start another capture')
    } finally { release() }
    assert.equal((await pending).status, 'unavailable')
    await shutdown
    assert.equal(source.snapshot().frame, null)
    assert.equal(f.handlers.size, 0)
    assert.equal(f.files.size, 0)
    f.holdCapture(undefined)
    await f.host.setEnabled('odk.source.camera', true)
    assert.notEqual(f.host.get(sourcePort), source)
    assert.equal((await f.read()).status, 'live')
  })
  test(`${label} Camera preserves frame, cache, health, and enable contracts`, async t => {
    const f = await fixture(t, replacement)
    assert.equal(f.health().state, 'failed')
    assert.equal(f.calls(), 0)
    const live = await f.read()
    assert.deepEqual(live, { status: 'live', frame: `data:image/jpeg;base64,${jpeg.toString('base64')}`, capturedAt: 1700000000000, width: 1280, height: 720 })
    assert.equal(f.health().state, 'healthy')
    assert.deepEqual(f.health(), { state: 'healthy', reason: 'cached-frame', updatedAt: live.capturedAt })
    assert.equal(f.calls(), 1, 'health must not capture another frame')
    assert.deepEqual(await f.read(), live)
    assert.equal(f.calls(), 1)
    assert.equal(f.files.size, 0)
    f.advance(9999)
    assert.deepEqual(await f.read(), live)
    assert.equal(f.calls(), 1)
    f.advance(1)
    assert.equal((await f.read()).capturedAt, 1700000010000)
    assert.equal(f.calls(), 2)
    for (const invalid of [new Error('synthetic provider failed'), Buffer.alloc(8192), Buffer.from([255, 216]), Buffer.alloc(524289)]) {
      f.advance()
      f.frame(invalid)
      assert.deepEqual(await f.read(), { status: 'unavailable', frame: null, capturedAt: null, width: 1280, height: 720 })
      assert.equal(f.health().state, 'failed')
      assert.equal(f.files.size, 0)
    }
    f.advance()
    f.frame(jpeg)
    assert.equal((await f.read()).status, 'live')
    f.present(false)
    const count = f.calls()
    assert.equal((await f.read()).status, 'unavailable')
    assert.equal(f.calls(), count)
    const source = f.host.get(sourcePort)
    await f.host.setEnabled('odk.source.camera', false)
    assert.equal(f.handlers.size, 0)
    assert.equal(f.host.get(sourcePort), null)
    f.present(true)
    await f.host.setEnabled('odk.source.camera', true)
    assert.notEqual(f.host.get(sourcePort), source)
    assert.equal(f.host.get(sourcePort).snapshot().status, 'unavailable')
    assert.equal(f.handlers.size, 1)
    await f.host.stop()
    assert.equal(f.handlers.size, 0)
  })
}

test('removing the Camera replacement link restores the default selection', async t => {
  const f = await fixture(t, true)
  const entry = path.join(directory, 'entry.cjs')
  const before = fs.readFileSync(entry)
  await f.host.stop()
  await run(process.execPath, [cli, 'remove', 'odk.source.camera'], { env: f.env })
  assert.deepEqual(loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))), [])
  assert.deepEqual(fs.readFileSync(entry), before)
  let creates = 0
  const handlers = new Map()
  const restored = createPluginHost({ capabilities: {
    ipc: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    'source.camera': { options: f.options, create(options) { creates++; return createCameraSource(options) } },
  } })
  t.after(() => restored.stop())
  const selected = createMainPlugins({ replacementPlugins: loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))) })
    .find(plugin => plugin.manifest.id === 'odk.source.camera')
  assert.equal(selected.manifest.version, '1.0.0')
  restored.register(selected)
  await restored.start()
  assert.equal(creates, 1)
  assert.equal((await handlers.get('odk-camera-frame')(null)).status, 'live')
  await restored.stop()
  assert.equal(handlers.size, 0)
})
