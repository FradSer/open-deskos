'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const { resolveStartupDisabled } = require('../src/plugin-config')
const { createBridgePluginRuntime, loadPluginConfig } = require('../../../integrations/remote-bridge/lib/plugin-runtime')
const run = promisify(execFile)
const cli = path.resolve(__dirname, '../scripts/open-deskos-plugin-cli.js')
const botEntry = path.resolve(__dirname, '../../../integrations/personal-bot/src/main.mjs')
const taskEntry = path.resolve(__dirname, '../../../integrations/personal-bot/src/task-daemon.mjs')
const bridgeEntry = path.resolve(__dirname, '../../../integrations/remote-bridge/lib/main.js')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-runtime-pref-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: root, ODESK_DISABLED_PLUGINS: '', ODESK_PROACTIVE_CONFIG: '' }
  return { env, root,
    change: (command, id) => run(process.execPath, [cli, command, id], { env }),
    inspect: async entry => JSON.parse((await run(process.execPath, [entry, '--plugins', 'list'], { env })).stdout),
  }
}

for (const [id, entry] of [
  ['odk.personal-bot.home', botEntry], ['odk.hosted-pi.endpoint', taskEntry], ['odk.remote.transport.usb-cdc', bridgeEntry],
]) {
  test(`common CLI preferences reach the actual ${id} startup inspection`, async t => {
    const f = await fixture(t)
    await f.change('disable', id)
    const selected = report => report.plugins.find(plugin => plugin.manifest.id === id)
    assert.equal(selected(await f.inspect(entry)).enabled, false)
    await f.change('enable', id)
    assert.equal(selected(await f.inspect(entry)).enabled, true)
    f.env.ODESK_DISABLED_PLUGINS = id
    assert.equal(selected(await f.inspect(entry)).enabled, false)
    f.env.ODESK_DISABLED_PLUGINS = ''
    await fs.writeFile(path.join(f.root, 'plugins.json'), '{invalid')
    const result = await run(process.execPath, [entry, '--plugins', 'list'], { env: f.env })
    assert.equal(selected(JSON.parse(result.stdout)).enabled, true)
    assert.match(result.stderr, /plugin configuration unavailable/)
  })
}

test('shared resident disables block Agent and dependent factories while preserving the channel', async t => {
  const { createPersonalBotComposition } = await import('../../../integrations/personal-bot/src/plugin-composition.mjs')
  const f = await fixture(t)
  const id = 'odk.personal-bot.runtime'
  await f.change('disable', id)
  let calls = 0
  const create = () => createPersonalBotComposition({ disabled: resolveStartupDisabled(f.env),
    createService: () => ({ close() {} }), openChannel: () => ({ close() {} }),
    initialize: () => { calls++; return { agent: { abort() {}, close() {} } } },
    createHome: () => { calls++; return { start() {}, close() {} } },
  })
  const disabled = create()
  t.after(() => disabled.stop())
  const catalog = await disabled.start()
  assert.equal(calls, 0)
  assert.equal(catalog.find(plugin => plugin.manifest.id === id).state, 'disabled')
  assert.equal(catalog.find(plugin => plugin.manifest.id === 'odk.personal-bot.home').state, 'blocked')
  assert.equal(catalog.find(plugin => plugin.manifest.id === 'odk.personal-bot.channel').state, 'running')
  await f.change('enable', id)
  assert.equal(disabled.catalog().find(plugin => plugin.manifest.id === id).state, 'disabled', 'preferences apply at next startup')
  await disabled.stop()
  const enabled = create()
  t.after(() => enabled.stop())
  assert.equal((await enabled.start()).every(plugin => plugin.state === 'running'), true)
  assert.equal(calls, 2)
})

test('shared Hosted Pi disables retain listener diagnosis without constructing task services or publishing endpoints', async t => {
  const { createTaskComposition } = await import('../../../integrations/personal-bot/src/task-composition.mjs')
  const f = await fixture(t)
  await f.change('disable', 'odk.hosted-pi.service')
  let calls = 0
  const create = () => createTaskComposition({ disabled: resolveStartupDisabled(f.env),
    openChannel: () => ({ close() {} }), createService: () => { calls++; return { handle() {}, disconnect() {}, close() {} } },
    endpointFile: () => '/fixture/endpoint.json', publishEndpoint: () => { calls++ }, removeEndpoint: async () => {},
  })
  const disabled = create()
  t.after(() => disabled.close())
  const catalog = await disabled.start()
  assert.equal(calls, 0)
  assert.equal(catalog.find(plugin => plugin.manifest.id === 'odk.hosted-pi.listener').state, 'running')
  assert.equal(catalog.find(plugin => plugin.manifest.id === 'odk.hosted-pi.service').state, 'disabled')
  assert.equal(catalog.find(plugin => plugin.manifest.id === 'odk.hosted-pi.endpoint').state, 'blocked')
  await disabled.close()
  await f.change('enable', 'odk.hosted-pi.service')
  const enabled = create()
  t.after(() => enabled.close())
  assert.equal((await enabled.start()).every(plugin => plugin.state === 'running'), true)
  assert.equal(calls, 2)
})

test('shared Remote transport disables prevent resource startup while retaining its listener', async t => {
  const f = await fixture(t)
  const id = 'odk.remote.transport.usb-cdc'
  await f.change('disable', id)
  let starts = 0
  const transport = { manifest: { id }, on() {}, off() {}, start() { starts++ }, stop() {} }
  const create = () => createBridgePluginRuntime({ disabled: resolveStartupDisabled(f.env), transports: [transport],
    open() {}, close() {}, handlers: {}, logger: { error() {} },
  })
  const disabled = create()
  t.after(() => disabled.host.stop())
  const catalog = await disabled.host.start()
  assert.equal(starts, 0)
  assert.equal(catalog.find(plugin => plugin.manifest.id === id).state, 'disabled')
  assert.equal(catalog.find(plugin => plugin.manifest.id === 'odk.remote.listener').state, 'running')
  await disabled.host.stop()
  await f.change('enable', id)
  const enabled = create()
  t.after(() => enabled.host.stop())
  assert.equal((await enabled.host.start()).every(plugin => plugin.state === 'running'), true)
  assert.equal(starts, 1)
})

test('runtime preference adapters load the same configuration contract in a flattened release', async t => {
  const { loadPersonalBotPluginConfig } = await import('../../../integrations/personal-bot/src/plugin-composition.mjs')
  const f = await fixture(t)
  const release = path.join(f.root, 'release')
  const source = path.join(release, 'src')
  await fs.mkdir(source, { recursive: true })
  await fs.copyFile(path.resolve(__dirname, '../src/plugin-config.js'), path.join(source, 'plugin-config.js'))
  await f.change('disable', 'odk.hosted-pi.endpoint')
  const botBase = pathToFileURL(path.join(release, 'integrations/personal-bot/src/plugin-composition.mjs')).href
  const bridgeBase = path.join(release, 'integrations/remote-bridge/lib')
  for (const adapter of [loadPersonalBotPluginConfig(botBase), loadPluginConfig(bridgeBase)]) {
    assert.deepEqual(adapter.resolveStartupDisabled(f.env), ['odk.hosted-pi.endpoint'])
    assert.equal(adapter.resolveConfigPath(f.env), path.join(f.root, 'plugins.json'))
  }
})

test('common startup disables prevent selected native replacement entries from executing', async t => {
  const { createPersonalBotComposition, personalBotManifest } = await import('../../../integrations/personal-bot/src/plugin-composition.mjs')
  const { createTaskComposition, hostedPiManifest } = await import('../../../integrations/personal-bot/src/task-composition.mjs')
  const { loadPersonalBotReplacements, loadHostedPiReplacements } = await import('../../../integrations/personal-bot/src/development-plugins.mjs')
  const { loadBridgeReplacements, transportPlaceholder } = require('../../../integrations/remote-bridge/lib/development-plugins')
  const f = await fixture(t)
  const entry = path.join(f.root, 'must-not-execute.cjs')
  await fs.writeFile(entry, "throw Error('disabled native entry executed')")
  const selected = async (manifest, load) => {
    await f.change('disable', manifest.id)
    const file = path.join(f.root, `${manifest.id}.json`)
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, replacements: [{ manifest, entry }] }))
    return load(file, { trusted: true })
  }
  const residentReplacement = await selected(personalBotManifest('runtime'), loadPersonalBotReplacements)
  const taskReplacement = await selected(hostedPiManifest('service'), loadHostedPiReplacements)
  const id = 'odk.remote.transport.usb-cdc'
  const bridgeReplacement = await selected({ schemaVersion: 1, id, name: 'Disabled USB', version: '2.0.0', host: 'remote-bridge', kind: 'transport',
    provides: [{ interface: `odk:remote/transport/${id}/v1` }], requires: [{ interface: 'odk:remote/listener/v1' }],
    permissions: [], priority: 100, transport: 'usb-cdc',
  }, loadBridgeReplacements)
  const disabled = resolveStartupDisabled(f.env)
  const unavailable = () => { throw Error('disabled default factory executed') }
  const resident = createPersonalBotComposition({ disabled, replacementPlugins: residentReplacement,
    createService: () => ({ close() {} }), openChannel: () => ({ close() {} }), initialize: unavailable, createHome: unavailable,
  })
  t.after(() => resident.stop())
  const task = createTaskComposition({ disabled, replacementPlugins: taskReplacement,
    openChannel: () => ({ close() {} }), createService: unavailable, endpointFile: unavailable,
    publishEndpoint: unavailable, removeEndpoint: unavailable,
  })
  t.after(() => task.close())
  const bridge = createBridgePluginRuntime({ disabled, replacementPlugins: bridgeReplacement,
    transports: bridgeReplacement.map(transportPlaceholder), open() {}, close() {}, handlers: {}, logger: { error() {} },
  })
  t.after(() => bridge.host.stop())
  for (const catalog of [await resident.start(), await task.start(), await bridge.host.start()]) {
    assert.equal(catalog.some(plugin => ['failed', 'cleanup-failed'].includes(plugin.state)), false)
    assert.equal(catalog.some(plugin => plugin.state === 'disabled'), true)
  }
})
