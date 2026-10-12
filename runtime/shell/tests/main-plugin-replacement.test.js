'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createPluginHost } = require('../src/plugin-host')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { createShellOdkData } = require('../src/odk-data')

function weatherReplacement() {
  const original = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.weather')
  const instances = []
  return {
    instances,
    plugin: { manifest: { ...original.manifest, version: '2.0.0' },
      create(context) {
        const source = {
          snapshot: () => ({ status: 'live', current: { temperature: 21 }, updatedAt: 1700000000000 }),
          refresh: async () => source.snapshot(),
        }
        instances.push(source)
        return original.create({ ...context, capability: name => name === 'source.weather'
          ? { create: () => source, options: {} } : context.capability(name) })
      },
    },
  }
}

test('a replacement can depend on an extension in the complete validated graph', () => {
  const port = 'odk:replacement-provider/v1'
  const replacement = weatherReplacement().plugin
  const selected = { ...replacement, manifest: { ...replacement.manifest, requires: [{ interface: port }] } }
  const extension = { manifest: { schemaVersion: 1, id: 'odk.test.provider', name: 'Provider', version: '1.0.0', kind: 'service', host: 'electron-main',
    provides: [{ interface: port }], requires: [], permissions: [] }, create() { throw Error('validation must not execute') } }
  const composition = createMainPlugins({ replacementPlugins: [selected], developmentPlugins: [extension] })
  assert.equal(composition.find(plugin => plugin.manifest.id === selected.manifest.id), selected)
  assert.equal(composition.find(plugin => plugin.manifest.id === extension.manifest.id), extension)
  assert.throws(() => createMainPlugins({ replacementPlugins: [selected] }), /missing required port/)
  assert.throws(() => createMainPlugins({ replacementPlugins: [selected], developmentPlugins: [{ ...extension,
    manifest: { ...extension.manifest, requires: [{ interface: DATA_PORTS.weather }] } }], report() {} }), /missing required port/)
  assert.throws(() => createMainPlugins({ replacementPlugins: [selected], developmentPlugins: [extension, extension], report() {} }), /missing required port/)
})

test('trusted replacement supplies IPC and Open DeskOS Data through one source instance', async () => {
  const replacement = weatherReplacement()
  const handlers = new Map()
  const host = createPluginHost({ capabilities: {
    ipc: { handle: (name, callback) => handlers.set(name, callback), removeHandler: name => handlers.delete(name) },
    'desk.data': { create: createShellOdkData, smokeMode: true },
    'source.weather': { create() { throw Error('original source factory must not run') }, options: {} },
  } })
  const composition = createMainPlugins({ replacementPlugins: [replacement.plugin] })
  assert.equal(composition.find(plugin => plugin.manifest.id === 'odk.source.weather'), replacement.plugin)
  assert.equal(composition.filter(plugin => plugin.manifest.id === 'odk.source.weather').length, 1)
  composition.forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.get(DATA_PORTS.weather), replacement.instances[0])
  assert.equal((await handlers.get('odk-weather-status')(null, {})).current.temperature, 21)
  const data = host.get(DESK_PORTS.data)
  const reading = await data.control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })
  assert.equal(reading.reading.value.temperatureC, 21)
  assert.equal(data.registry.list().some(reading => reading.id === 'odk.tile.weather'), true)
  await host.setEnabled('odk.source.weather', false)
  assert.equal(handlers.has('odk-weather-status'), false)
  assert.equal(host.get(DESK_PORTS.data).registry.list().some(reading => reading.id === 'odk.tile.weather'), false)
  await host.setEnabled('odk.source.weather', true)
  assert.notEqual(host.get(DATA_PORTS.weather), replacement.instances[0])
  assert.equal(host.get(DATA_PORTS.weather), replacement.instances[1])
  assert.equal(host.get(DESK_PORTS.data).registry.list().some(reading => reading.id === 'odk.tile.weather'), true)
  await host.stop()
  assert.equal(handlers.size, 0)
})

test('invalid replacements fail before factory execution', () => {
  const replacement = weatherReplacement().plugin
  let executions = 0
  const plugin = { ...replacement, create() { executions++; throw Error('must not execute') } }
  for (const manifest of [
    { ...plugin.manifest, id: 'odk.unknown.replacement' },
    { ...plugin.manifest, host: 'electron-renderer' },
    { ...plugin.manifest, kind: 'surface' },
    { ...plugin.manifest, provides: [] },
    { ...plugin.manifest, requires: [{ interface: 'odk:absent/v1' }] },
    { ...plugin.manifest, requires: [{ interface: DATA_PORTS.weather }] },
  ]) assert.throws(() => createMainPlugins({ replacementPlugins: [{ ...plugin, manifest }] }))
  assert.throws(() => createMainPlugins({ replacementPlugins: [plugin, plugin] }))
  assert.equal(executions, 0)
})

test('development fallback retains explicitly selected replacements', () => {
  const replacement = weatherReplacement().plugin
  const errors = []
  const composition = createMainPlugins({ replacementPlugins: [replacement], developmentPlugins: [replacement], report: error => errors.push(error) })
  assert.equal(composition.find(plugin => plugin.manifest.id === replacement.manifest.id), replacement)
  assert.equal(errors.length, 1)
  assert.equal(composition.length, createMainPlugins().length)
})


test('every built-in Main component accepts an implementation with its existing port contract', () => {
  const baseline = createMainPlugins()
  const replacements = baseline.map(plugin => ({ ...plugin, manifest: { ...plugin.manifest, version: '2.0.0' } }))
  const composition = createMainPlugins({ replacementPlugins: replacements })
  assert.equal(composition.length, baseline.length)
  for (const replacement of replacements) {
    assert.equal(composition.find(plugin => plugin.manifest.id === replacement.manifest.id), replacement)
  }
  assert.deepEqual(createMainPlugins().map(plugin => plugin.manifest), baseline.map(plugin => plugin.manifest))
})


test('legacy Camera replacements retain the previous source port contract', () => {
  const original = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.camera')
  const legacy = { ...original, manifest: { ...original.manifest, provides: [{ interface: DATA_PORTS.camera }] } }
  assert.equal(createMainPlugins({ replacementPlugins: [legacy] }).find(plugin => plugin.manifest.id === legacy.manifest.id), legacy)
  assert.throws(() => createMainPlugins({ replacementPlugins: [{ ...legacy, manifest: { ...legacy.manifest, provides: [] } }] }), /contract/)
  assert.throws(() => createMainPlugins({ replacementPlugins: [{ ...legacy, manifest: { ...legacy.manifest, provides: [...legacy.manifest.provides, { interface: 'odk:unrelated/v1' }] } }] }), /contract/)
})


test('replacement metadata cannot authorize an unrelated port set', () => {
  const original = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.camera')
  const manifest = { ...original.manifest, provides: [{ interface: 'odk:forged/v1' }], compatibleProvides: [['odk:forged/v1']] }
  assert.throws(() => createMainPlugins({ replacementPlugins: [{ ...original, manifest }] }), /contract/)
})

test('a running legacy Camera replacement reports undeclared health through diagnosis', async t => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { requestDiagnostics } = require('../src/plugin-diagnostics')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cdiag-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\odk-cdiag-${process.pid}-${path.basename(root)}` : path.join(root, 'diag.sock')
  const stateDir = path.join(root, 'state')
  const tokenFile = path.join(stateDir, 'local-channel.token')
  const original = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.camera')
  const manifest = { ...original.manifest, provides: [{ interface: DATA_PORTS.camera }], permissions: [] }
  delete manifest.compatibleProvides
  let starts = 0
  const legacy = { manifest, create() {
    starts++
    return { ports: { [DATA_PORTS.camera]: { snapshot() { throw Error('undeclared health must not read the source') } } } }
  } }
  const composition = createMainPlugins({ replacementPlugins: [legacy] })
  const host = createPluginHost({ capabilities: { 'plugin.diagnostics': {
    endpoint, stateDir, platform: process.platform, snapshot: () => host.list(),
  } } })
  t.after(() => host.stop())
  composition.filter(plugin => [manifest.id, 'odk.system.plugin-diagnostics'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
  await host.start()
  const result = await requestDiagnostics({ endpoint, tokenFile, platform: process.platform, pluginId: manifest.id })
  assert.equal(starts, 1)
  assert.equal(result.plugins[0].state, 'running')
  assert.deepEqual(result.plugins[0].health, { state: 'unknown', reason: 'not-declared' })
  await host.stop()
})

test('default capture retains dynamic extension contracts without capturing replacement factories', () => {
  const extension = { manifest: { schemaVersion: 1, id: 'odk.test.reading-extension', name: 'Reading extension', version: '1.0.0',
    kind: 'service', host: 'electron-main', provides: [{ interface: 'odk:desk-reading/extension/v1' }], requires: [], permissions: [] },
    create() { throw Error('composition must not construct extensions') } }
  const selected = weatherReplacement().plugin
  let defaults
  const plugins = createMainPlugins({ developmentPlugins: [extension], replacementPlugins: [selected],
    onDefaults: definitions => { defaults = definitions } })
  assert.equal(plugins.find(plugin => plugin.manifest.id === selected.manifest.id), selected)
  assert.notEqual(defaults.find(plugin => plugin.manifest.id === selected.manifest.id).create, selected.create)
  assert.equal(defaults.some(plugin => plugin.manifest.id === extension.manifest.id), false)
  const selectedData = plugins.find(plugin => plugin.manifest.id === 'odk.system.data')
  const defaultData = defaults.find(plugin => plugin.manifest.id === selectedData.manifest.id)
  assert.deepEqual(defaultData.manifest, selectedData.manifest)
  assert.equal(defaultData.manifest.requires.some(port => port.interface === 'odk:desk-reading/extension/v1'), true)
})

test('restoration selects actual Camera default after a supported legacy startup contract', async () => {
  const { createNativeRuntimeActivator } = require('../src/native-runtime-activation')
  const camera = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.camera')
  const legacy = { manifest: { ...camera.manifest, provides: [{ interface: DATA_PORTS.camera }], permissions: [] },
    create: () => ({ ports: { [DATA_PORTS.camera]: { legacy: true } } }) }
  let defaults
  const selected = createMainPlugins({ replacementPlugins: [legacy], onDefaults: definitions => { defaults = definitions } })
  const handlers = new Map()
  const source = { refresh: async () => {}, snapshot: () => ({ status: 'unavailable' }), stop() {} }
  const host = createPluginHost({ capabilities: { 'source.camera': { create: () => source, options: {} },
    ipc: { handle: (id, fn) => handlers.set(id, fn), removeHandler: id => handlers.delete(id) } } })
  host.register(selected.find(plugin => plugin.manifest.id === camera.manifest.id))
  await host.start()
  const activate = createNativeRuntimeActivator({ host, defaults })
  await activate(camera.manifest.id, { restoreDefault: true })
  assert.equal(host.get(DATA_PORTS.camera), source)
  assert.equal(typeof host.get('odk:plugin-health/odk.source.camera/v1').snapshot, 'function')
  assert.equal(handlers.has('odk-camera-frame'), true)
  await host.stop()
  assert.equal(handlers.size, 0)
})

test('restoration selects actual Weather default after a startup replacement adds dependencies', async () => {
  const { createNativeRuntimeActivator } = require('../src/native-runtime-activation')
  const dependency = 'odk:replacement-provider/v1'
  const replacement = weatherReplacement().plugin
  replacement.manifest.requires = [{ interface: dependency }]
  const extension = { manifest: { schemaVersion: 1, id: 'odk.test.provider', name: 'Provider', version: '1.0.0', kind: 'service', host: 'electron-main',
    provides: [{ interface: dependency }], requires: [], permissions: [] }, create: () => ({ ports: { [dependency]: {} } }) }
  let defaults
  const selected = createMainPlugins({ replacementPlugins: [replacement], developmentPlugins: [extension], onDefaults: definitions => { defaults = definitions } })
  const source = { refresh: async () => {}, snapshot: () => ({ status: 'unconfigured' }), stop() {} }
  const host = createPluginHost({ capabilities: { 'source.weather': { create: () => source, options: {} }, ipc: { handle() {}, removeHandler() {} } } })
  selected.filter(plugin => [replacement.manifest.id, extension.manifest.id].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
  await host.start()
  assert.notEqual(host.get(DATA_PORTS.weather), source)
  await createNativeRuntimeActivator({ host, defaults })(replacement.manifest.id, { restoreDefault: true })
  assert.equal(host.get(DATA_PORTS.weather), source)
  assert.deepEqual(host.definition(replacement.manifest.id).manifest.requires, [])
  assert.equal(host.list().find(plugin => plugin.manifest.id === extension.manifest.id).state, 'running')
  await host.stop()
})
