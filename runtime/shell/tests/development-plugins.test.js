'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { main } = require('../scripts/odk-plugin-cli')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { createPluginHost } = require('../src/plugin-host')
const { loadDevelopmentPlugins } = require('../src/development-plugins')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-development-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const folder = path.join(root, 'plugin')
  fs.mkdirSync(folder)
  const env = { ODK_CONFIG_DIR: path.join(root, 'config') }
  const marker = path.join(root, 'executed')
  const manifest = { schemaVersion: 1, id: 'odk.test.development', name: 'Development fixture', version: '1.0.0', kind: 'service', host: 'electron-main', entry: 'entry.cjs', permissions: ['fixture'], provides: [{ interface: 'odk:test-development/v1' }] }
  const write = value => fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(value))
  write(manifest)
  fs.writeFileSync(path.join(folder, 'entry.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); exports.create = ctx => ({ ports: { 'odk:test-development/v1': ctx.capability('fixture') } })`)
  return { folder, env, marker, manifest, write }
}

test('CLI links a replacement that consumes a selected extension without executing entries', async t => {
  const provider = fixture(t)
  const replacement = fixture(t)
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const { createShellOdkData } = require('../src/odk-data')
  const { DESK_PORTS } = require('../src/plugins/desk-runtime')
  const original = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.weather')
  const port = 'odk:weather-provider/v1'
  provider.write({ ...provider.manifest, id: 'odk.test.weather-provider', permissions: [], provides: [{ interface: port }] })
  fs.writeFileSync(path.join(provider.folder, 'entry.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(provider.marker)}, 'executed');
    exports.create = () => { const source = { snapshot: () => ({ status: 'live', current: { temperature: 23 } }), refresh: async () => source.snapshot() };
      return { ports: { '${port}': source } }; };`)
  replacement.write({ ...original.manifest, entry: 'entry.cjs', permissions: ['ipc'], requires: [{ interface: port }] })
  const weatherReadings = path.resolve(__dirname, '../src/plugins/readings/weather.js')
  fs.writeFileSync(path.join(replacement.folder, 'entry.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(replacement.marker)}, 'executed');
    const { createWeatherReadings, getWeatherHealth } = require(${JSON.stringify(weatherReadings)});
    exports.create = ctx => { const source = ctx.get('${port}'); const ipc = ctx.capability('ipc');
      ipc.handle('odk-weather-status', () => source.refresh()); ctx.onCleanup(() => ipc.removeHandler('odk-weather-status'));
      return { ports: { 'odk:source/weather/v1': source, 'odk:desk-reading/weather/v1': createWeatherReadings(source),
        'odk:plugin-health/odk.source.weather/v1': { snapshot: () => getWeatherHealth(source) } } }; };`)
  assert.equal(main(['link', provider.folder, '--trust'], provider.env), 0)
  assert.equal(main(['link', replacement.folder, '--trust', '--replace', '--grant', 'ipc'], provider.env), 0)
  assert.equal(fs.existsSync(provider.marker), false)
  assert.equal(fs.existsSync(replacement.marker), false)
  const definitions = loadDevelopmentPlugins(readConfig(resolveConfigPath(provider.env)))
  const composition = createMainPlugins({ developmentPlugins: definitions.filter(plugin => !plugin.replacement), replacementPlugins: definitions.filter(plugin => plugin.replacement) })
  const handlers = new Map()
  const host = createPluginHost({ capabilities: { ipc: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    'desk.data': { create: createShellOdkData, smokeMode: true } } })
  t.after(() => host.stop())
  composition.filter(plugin => ['odk.test.weather-provider', 'odk.source.weather', 'odk.system.data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.list().find(plugin => plugin.manifest.id === 'odk.source.weather').state, 'running')
  assert.equal((await handlers.get('odk-weather-status')()).current.temperature, 23)
  assert.equal((await host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })).reading.value.temperatureC, 23)
  await host.stop()
  assert.equal(handlers.size, 0)
  const before = fs.readFileSync(resolveConfigPath(provider.env), 'utf8')
  replacement.write({ ...original.manifest, entry: 'entry.cjs', permissions: ['ipc'], requires: [{ interface: 'odk:missing/v1' }] })
  assert.equal(main(['link', replacement.folder, '--trust', '--replace', '--grant', 'ipc'], provider.env), 1)
  assert.equal(fs.readFileSync(resolveConfigPath(provider.env), 'utf8'), before)
})

test('CLI replacement repair isolates damaged links but rejects required missing providers', async t => {
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const original = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.weather')
  for (const required of [false, true]) {
    const damaged = fixture(t)
    const replacement = fixture(t)
    assert.equal(main(['link', damaged.folder, '--trust', '--grant', 'fixture'], damaged.env), 0)
    fs.unlinkSync(path.join(damaged.folder, 'manifest.json'))
    replacement.write({ ...original.manifest, entry: 'entry.cjs', permissions: [],
      requires: required ? damaged.manifest.provides : [] })
    const configPath = resolveConfigPath(damaged.env)
    const before = fs.readFileSync(configPath, 'utf8')
    const oldPreference = readConfig(configPath).plugins[damaged.manifest.id]
    const errors = []
    const previousError = console.error
    console.error = message => errors.push(message)
    let result
    try {
      result = main(['link', replacement.folder, '--trust', '--replace'], damaged.env)
    } finally {
      console.error = previousError
    }
    assert.equal(result, required ? 1 : 0)
    assert.ok(errors.some(message => message === `Development plugin unavailable: ${damaged.manifest.id}`))
    assert.ok(errors.every(message => !message.includes(damaged.folder)))
    assert.deepEqual(readConfig(configPath).plugins[damaged.manifest.id], oldPreference)
    if (required) assert.equal(fs.readFileSync(configPath, 'utf8'), before)
    else assert.equal(readConfig(configPath).plugins[original.manifest.id].development.path, fs.realpathSync(replacement.folder))
    assert.equal(fs.existsSync(path.join(damaged.folder, 'entry.cjs')), true)
    assert.equal(fs.existsSync(damaged.marker), false)
    assert.equal(fs.existsSync(replacement.marker), false)
  }
})

test('startup discovery isolates broken links without retaining their reading namespace', async t => {
  const broken = fixture(t)
  const valid = fixture(t)
  broken.write({ ...broken.manifest, id: 'odk.test', permissions: ['ungranted'] })
  valid.write({ ...valid.manifest, id: 'odk.test.child' })
  const config = { version: 1, plugins: {
    'odk.test': { development: { path: broken.folder, grants: [], trustAcknowledgedAt: new Date().toISOString() } },
    'odk.test.child': { development: { path: valid.folder, grants: ['fixture'], trustAcknowledgedAt: new Date().toISOString() } },
    'odk.test.missing': { development: { path: path.join(broken.folder, 'missing'), grants: [], trustAcknowledgedAt: new Date().toISOString() } },
  } }
  const errors = []
  const definitions = loadDevelopmentPlugins(config, { report: (id, error) => errors.push({ id, error }) })
  assert.deepEqual(errors.map(item => item.id), ['odk.test', 'odk.test.missing'])
  assert.deepEqual(definitions.map(item => item.manifest.id), ['odk.test.child'])
  assert.deepEqual(loadDevelopmentPlugins(config, { report() { throw Error('diagnostic failure') } }).map(item => item.manifest.id), ['odk.test.child'])
  assert.throws(() => loadDevelopmentPlugins(config), /grant/)
  assert.equal(fs.existsSync(broken.marker), false)
  assert.equal(fs.existsSync(valid.marker), false)
  const host = createPluginHost({ capabilities: { fixture: { value: 42 } } })
  t.after(() => host.stop())
  definitions.forEach(definition => host.register(definition))
  await host.start()
  assert.equal(host.list()[0].state, 'running')
  assert.deepEqual(host.get('odk:test-development/v1'), { value: 42 })
  assert.equal(fs.existsSync(broken.marker), false)
})

test('startup discovery preserves namespace conflict and disabled entry guards', t => {
  const parent = fixture(t)
  const child = fixture(t)
  parent.write({ ...parent.manifest, id: 'odk.test' })
  child.write({ ...child.manifest, id: 'odk.test.child' })
  const config = { version: 1, plugins: {} }
  for (const [id, directory] of [['odk.test', parent.folder], ['odk.test.child', child.folder]]) {
    config.plugins[id] = { development: { path: directory, grants: ['fixture'], trustAcknowledgedAt: new Date().toISOString() } }
  }
  const errors = []
  assert.deepEqual(loadDevelopmentPlugins(config, { report: (id, error) => errors.push({ id, error }) }).map(item => item.manifest.id), ['odk.test'])
  assert.equal(errors[0].id, 'odk.test.child')
  assert.match(errors[0].error.message, /overlap/)
  assert.throws(() => loadDevelopmentPlugins(config), /overlap/)
  fs.rmSync(parent.folder, { recursive: true })
  errors.length = 0
  assert.deepEqual(loadDevelopmentPlugins(config, { disabled: ['odk.test'], report: id => errors.push(id) }).map(item => item.manifest.id), ['odk.test.child'])
  assert.deepEqual(errors, [])
})

test('explicit link discovers a factory without executing it and preserves disabled behavior', async t => {
  const f = fixture(t)
  assert.equal(main(['link', f.folder], f.env), 1)
  assert.equal(fs.existsSync(resolveConfigPath(f.env)), false)
  assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
  assert.equal(fs.existsSync(f.marker), false)
  const { loadDevelopmentPlugins } = require('../src/development-plugins')
  const config = readConfig(resolveConfigPath(f.env))
  const definitions = loadDevelopmentPlugins(config)
  assert.equal(fs.existsSync(f.marker), false)
  const host = createPluginHost({ capabilities: { fixture: { value: 42 } } })
  definitions.forEach(definition => host.register(definition))
  await host.start()
  assert.equal(host.list()[0].state, 'running')
  assert.deepEqual(host.get('odk:test-development/v1'), { value: 42 })
  await host.stop()
  fs.rmSync(f.marker)
  assert.equal(main(['disable', f.manifest.id], f.env), 0)
  const disabled = loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env)))
  assert.deepEqual(disabled, [])
  assert.equal(fs.existsSync(f.marker), false)
})

test('removing a development link preserves its source and saved preference', async t => {
  const f = fixture(t)
  assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
  assert.equal(main(['disable', f.manifest.id], f.env), 0)
  const source = fs.readFileSync(path.join(f.folder, 'entry.cjs'), 'utf8')
  assert.equal(await main(['remove', f.manifest.id], f.env), 0)
  const config = readConfig(resolveConfigPath(f.env))
  assert.deepEqual(config.plugins[f.manifest.id], { enabled: false })
  assert.equal(fs.readFileSync(path.join(f.folder, 'entry.cjs'), 'utf8'), source)
  assert.equal(fs.existsSync(f.marker), false)
  assert.equal(await main(['remove', f.manifest.id], f.env), 1)
})

test('development discovery rejects capability escalation and entry path escape before execution', t => {
  const f = fixture(t)
  assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
  const { loadDevelopmentPlugins } = require('../src/development-plugins')
  const config = readConfig(resolveConfigPath(f.env))
  f.write({ ...f.manifest, permissions: ['fixture', 'ipc'] })
  assert.throws(() => loadDevelopmentPlugins(config), /grant/)
  f.write({ ...f.manifest, entry: '../outside.cjs' })
  assert.throws(() => loadDevelopmentPlugins(config), /entry/)
  assert.equal(fs.existsSync(f.marker), false)
})

test('Main composition discovers development readings and preserves its default on conflicts', () => {
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const port = 'odk:desk-reading/development/v1'
  const extension = { manifest: { schemaVersion: 1, id: 'odk.test.development', name: 'Fixture', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: port }], requires: [], permissions: [] }, create() { throw Error('preflight must not execute') } }
  const result = createMainPlugins({ developmentPlugins: [extension] })
  assert.ok(result.find(plugin => plugin.manifest.id === 'odk.system.data').manifest.requires.some(requirement => requirement.interface === port))
  const baseline = createMainPlugins().map(plugin => plugin.manifest)
  for (const manifest of [
    { ...extension.manifest, id: baseline[0].id },
    { ...extension.manifest, id: 'odk.system.plugin-diagnostics' },
    { ...extension.manifest, requires: [{ interface: 'odk:absent/v1' }] },
    { ...extension.manifest, requires: [{ interface: port }] },
    { ...extension.manifest, provides: [baseline.find(plugin => plugin.provides.length)?.provides[0]] },
  ]) {
    const errors = []
    const actual = createMainPlugins({ developmentPlugins: [{ ...extension, manifest }], report: error => errors.push(error) })
    assert.deepEqual(actual.map(plugin => plugin.manifest), baseline)
    assert.equal(errors.length, 1)
  }
})

test('an unavailable granted capability prevents entry execution', async t => {
  const f = fixture(t)
  assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
  const { loadDevelopmentPlugins } = require('../src/development-plugins')
  const host = createPluginHost()
  loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))).forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.list()[0].state, 'failed')
  assert.equal(fs.existsSync(f.marker), false)
  await host.stop()
})

test('invalid development reading ports fail their provider before Open DeskOS Data activation', async t => {
  const f = fixture(t)
  f.write({ ...f.manifest, provides: [{ interface: 'odk:desk-reading/development/v1' }] })
  fs.writeFileSync(path.join(f.folder, 'entry.cjs'), "exports.create = () => ({ ports: { 'odk:desk-reading/development/v1': {} } })")
  assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
  const { loadDevelopmentPlugins } = require('../src/development-plugins')
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const { createShellOdkData } = require('../src/odk-data')
  const plugins = createMainPlugins({ developmentPlugins: loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))) })
  const host = createPluginHost({ capabilities: { fixture: {}, 'desk.data': { create: createShellOdkData, smokeMode: true } } })
  plugins.filter(plugin => [f.manifest.id, 'odk.system.data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.list().find(plugin => plugin.manifest.id === f.manifest.id).state, 'failed')
  assert.equal(host.list().find(plugin => plugin.manifest.id === 'odk.system.data').state, 'running')
  await host.stop()
})

test('linked readings reach the real Open DeskOS Data registry and withdraw on disable', async t => {
  const f = fixture(t)
  const port = 'odk:desk-reading/development/v1'
  const id = `${f.manifest.id}.value`
  f.write({ ...f.manifest, provides: [{ interface: port }] })
  fs.writeFileSync(path.join(f.folder, 'entry.cjs'), `exports.create = ctx => ({ ports: { '${port}': [{ id: '${id}', label: 'Fixture', kind: 'tile', read: () => ({ state: 'live', value: ctx.capability('fixture') }) }] } })`)
  assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
  const { loadDevelopmentPlugins } = require('../src/development-plugins')
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const { DESK_PORTS } = require('../src/plugins/desk-runtime')
  const { createShellOdkData } = require('../src/odk-data')
  const plugins = createMainPlugins({ developmentPlugins: loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))) })
  const value = { measured: 42 }
  const host = createPluginHost({ capabilities: { fixture: value, 'desk.data': { create: createShellOdkData, smokeMode: true } } })
  plugins.filter(plugin => [f.manifest.id, 'odk.system.data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal((await host.get(DESK_PORTS.data).registry.read(id)).reading.value.measured, 42)
  value.measured = 43
  assert.equal((await host.get(DESK_PORTS.data).registry.read(id)).reading.value.measured, 43)
  await host.setEnabled(f.manifest.id, false)
  assert.deepEqual(await host.get(DESK_PORTS.data).registry.read(id), { ok: false, error: 'unknown-reading' })
  await host.setEnabled(f.manifest.id, true)
  assert.equal((await host.get(DESK_PORTS.data).registry.read(id)).reading.value.measured, 43)
  await host.stop()
})

test('invalid reading declarations retain lifecycle cleanup and isolate asynchronous failures', async t => {
  const cases = [
    { port: 'odk:desk-reading/development/v1', value: '[]', start: "this.ports['odk:desk-reading/development/v1'] = {}" },
    { port: 'odk:desk-reading/development/v1', value: "[{ id: 'odk.tile.weather', label: 'Fixture', kind: 'tile', read() {} }]" },
    { port: 'odk:desk-reading/development/v1', value: "[{ id: 'odk.test.development.value', label: '', kind: 'tile', read() {} }]" },
    { port: 'odk:desk-reading/development/v1', value: "Array.from({ length: 2 }, () => ({ id: 'odk.test.development.value', label: 'Fixture', kind: 'tile', read() {} }))" },
    { port: 'odk:desk-service-readings/development/v1', value: "{ readings: () => Promise.reject(Error('fixture')) }" },
    { port: 'odk:desk-reading/development/v1', value: "[{ id: 'odk.test.development.value', label: 'Fixture', kind: 'package' }]" },
    { port: 'odk:desk-service-readings/development/v1', value: "{ readings: () => [{ id: 'odk.test.development.value', label: 'Fixture', kind: 'tile', read() {} }] }" },
  ]
  for (const candidate of cases) {
    const f = fixture(t)
    f.write({ ...f.manifest, provides: [{ interface: candidate.port }] })
    fs.writeFileSync(path.join(f.folder, 'entry.cjs'), `exports.create = ctx => { const owner = ctx.capability('fixture'); ctx.onCleanup(() => { owner.cleanup++ }); return { ports: { '${candidate.port}': ${candidate.value} }, start() { ${candidate.start || ''} }, stop() { owner.stop++ }, destroy() { owner.destroy++ } } }`)
    assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
    const owner = { cleanup: 0, stop: 0, destroy: 0 }
    const host = createPluginHost({ capabilities: { fixture: owner } })
    const { loadDevelopmentPlugins } = require('../src/development-plugins')
    loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))).forEach(plugin => host.register(plugin))
    await host.start()
    assert.equal(host.list()[0].state, 'failed')
    assert.deepEqual(owner, { cleanup: 1, stop: 1, destroy: 1 })
    await host.stop()
  }
})

test('parent development namespaces cannot claim built-in readings or overlap another plugin', async t => {
  const f = fixture(t)
  f.write({ ...f.manifest, id: 'odk.tile', provides: [{ interface: 'odk:desk-reading/development/v1' }] })
  fs.writeFileSync(path.join(f.folder, 'entry.cjs'), "exports.create = () => ({ ports: { 'odk:desk-reading/development/v1': [{ id: 'odk.tile.weather', label: 'Fixture', kind: 'tile', read() {} }] } })")
  assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
  const { loadDevelopmentPlugins } = require('../src/development-plugins')
  const host = createPluginHost({ capabilities: { fixture: {} } })
  loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))).forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.list()[0].state, 'failed')
  await host.stop()
  const other = fixture(t)
  const config = { version: 1, plugins: {} }
  for (const [id, folder] of [['odk.test', f.folder], ['odk.test.child', other.folder]]) {
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ ...f.manifest, id }))
    config.plugins[id] = { development: { path: folder, grants: ['fixture'], trustAcknowledgedAt: new Date().toISOString() } }
  }
  assert.throws(() => loadDevelopmentPlugins(config), /namespaces overlap/)
})

test('dynamic service declarations preserve the last valid reading after invalid or async updates', async t => {
  const f = fixture(t)
  const port = 'odk:desk-service-readings/development/v1'
  const id = `${f.manifest.id}.value`
  f.write({ ...f.manifest, provides: [{ interface: port }] })
  fs.writeFileSync(path.join(f.folder, 'entry.cjs'), `exports.create = () => { let calls = 0; return { ports: { '${port}': { readings() { calls++; if (calls === 4) return Promise.reject(Error('fixture')); return [{ id: '${id}', label: 'Fixture', kind: calls === 3 ? 'tile' : 'service', read: () => ({ state: 'live', value: { calls } }) }] } } } } }`)
  assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
  const { loadDevelopmentPlugins } = require('../src/development-plugins')
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const { DESK_PORTS } = require('../src/plugins/desk-runtime')
  const { createShellOdkData } = require('../src/odk-data')
  const plugins = createMainPlugins({ developmentPlugins: loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))) })
  const host = createPluginHost({ capabilities: { fixture: {}, 'desk.data': { create: createShellOdkData, smokeMode: true } } })
  plugins.filter(plugin => [f.manifest.id, 'odk.system.data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.list().find(plugin => plugin.manifest.id === 'odk.system.data').state, 'running')
  const data = host.get(DESK_PORTS.data)
  assert.equal(host.list().find(plugin => plugin.manifest.id === f.manifest.id).state, 'running', JSON.stringify(host.list()))
  assert.equal((await data.registry.read(id)).ok, true)
  data.syncServices()
  assert.equal((await data.registry.read(id)).ok, true)
  data.syncServices()
  assert.equal((await data.registry.read(id)).reading.value.calls, 5)
  await host.stop()
})

test('frozen service ports keep their lifecycle receiver and publish through a wrapper', async t => {
  const f = fixture(t)
  const port = 'odk:desk-service-readings/development/v1'
  f.write({ ...f.manifest, provides: [{ interface: port }] })
  fs.writeFileSync(path.join(f.folder, 'entry.cjs'), `exports.create = ctx => { const owner = ctx.capability('fixture'); const provider = Object.freeze({ readings() { if (this !== provider) throw Error('receiver'); return [] }, refresh() { if (this !== provider) throw Error('receiver'); owner.refresh++ } }); const instance = Object.freeze({ ports: Object.freeze({ '${port}': provider }), stop() { if (this !== instance) throw Error('receiver'); owner.stop++ }, destroy() { if (this !== instance) throw Error('receiver'); owner.destroy++ } }); return instance }`)
  assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
  const owner = { refresh: 0, stop: 0, destroy: 0 }
  const host = createPluginHost({ capabilities: { fixture: owner } })
  const { loadDevelopmentPlugins } = require('../src/development-plugins')
  loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))).forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.list()[0].state, 'running')
  await host.get(port).refresh()
  await host.stop()
  assert.deepEqual(owner, { refresh: 1, stop: 1, destroy: 1 })
})

test('dynamic service identities cannot collide with another reading port', async t => {
  for (const service of [false, true]) {
    const f = fixture(t)
    const first = `odk:desk-${service ? 'service-' : ''}reading${service ? 's' : ''}/first/v1`
    const second = 'odk:desk-service-readings/second/v1'
    const fixed = `[{ id: '${f.manifest.id}.value', label: 'Fixed', kind: '${service ? 'service' : 'tile'}', read: () => ({ state: 'live', value: { measured: 1 } }) }]`
    f.write({ ...f.manifest, provides: [{ interface: first }, { interface: second }] })
    fs.writeFileSync(path.join(f.folder, 'entry.cjs'), `exports.create = () => { let calls = 0; return { ports: { '${first}': ${service ? `{ readings: () => ${fixed} }` : fixed}, '${second}': { readings() { calls++; return [{ id: '${f.manifest.id}.' + (calls >= 3 ? 'value' : 'service'), label: 'Dynamic', kind: 'service', read: () => ({ state: 'live', value: { measured: 2 } }) }] } } } } }`)
    assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
    const { loadDevelopmentPlugins } = require('../src/development-plugins')
    const { createMainPlugins } = require('../src/plugins/main-composition')
    const { DESK_PORTS } = require('../src/plugins/desk-runtime')
    const { createShellOdkData } = require('../src/odk-data')
    const plugins = createMainPlugins({ developmentPlugins: loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))) })
    const host = createPluginHost({ capabilities: { fixture: {}, 'desk.data': { create: createShellOdkData, smokeMode: true } } })
    plugins.filter(plugin => [f.manifest.id, 'odk.system.data'].includes(plugin.manifest.id)).forEach(plugin => host.register(plugin))
    await host.start()
    assert.equal(host.list().find(plugin => plugin.manifest.id === 'odk.system.data').state, 'running')
    assert.equal(host.list().find(plugin => plugin.manifest.id === f.manifest.id).state, 'running', JSON.stringify(host.list()))
    const data = host.get(DESK_PORTS.data)
    const reading = await data.registry.read(`${f.manifest.id}.service`)
    assert.equal(reading.ok, true, JSON.stringify(data.registry.list()))
    assert.equal(reading.reading.value.measured, 2)
    await host.stop()
  }
})


test('explicit development replacement preserves built-in reading identities and removal restores the default', async t => {
  const f = fixture(t)
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const { createShellOdkData } = require('../src/odk-data')
  const { DATA_PORTS } = require('../src/plugins/data-sources')
  const { DESK_PORTS } = require('../src/plugins/desk-runtime')
  const baseline = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.weather')
  f.write({ ...baseline.manifest, entry: 'entry.cjs' })
  fs.writeFileSync(path.join(f.folder, 'entry.cjs'), `
    require('node:fs').writeFileSync(${JSON.stringify(f.marker)}, 'executed');
    exports.create = ctx => {
      const source = { snapshot: () => ({ status: 'live', current: { temperature: 23 } }), refresh: async () => source.snapshot() };
      const original = require(${JSON.stringify(path.resolve('src/plugins/data-sources.js'))}).createDataSourcePlugins().find(plugin => plugin.manifest.id === 'odk.source.weather');
      return original.create({ ...ctx, capability: name => name === 'source.weather' ? { create: () => source, options: {} } : ctx.capability(name) });
    };
  `)
  const args = ['link', f.folder, '--trust', '--grant', 'source.weather', '--grant', 'ipc']
  assert.equal(main(args, f.env), 1, 'built-in identity requires explicit replacement')
  assert.equal(main([...args, '--replace'], f.env), 0)
  assert.equal(fs.existsSync(f.marker), false)
  assert.equal(main(['disable', baseline.manifest.id], f.env), 0)
  assert.deepEqual(loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))), [])
  assert.equal(fs.existsSync(f.marker), false)
  assert.equal(main(['enable', baseline.manifest.id], f.env), 0)
  const definitions = loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env)))
  assert.equal(definitions[0].replacement, true)
  const composition = createMainPlugins({ replacementPlugins: definitions })
  const handlers = new Map()
  const host = createPluginHost({ capabilities: {
    ipc: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    'source.weather': {}, 'desk.data': { create: createShellOdkData, smokeMode: true },
  } })
  composition.forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.get(DATA_PORTS.weather).snapshot().current.temperature, 23)
  assert.equal((await handlers.get('odk-weather-status')(null, {})).current.temperature, 23)
  const reading = await host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })
  assert.equal(reading.reading.value.temperatureC, 23)
  await host.stop()
  fs.rmSync(f.marker)
  assert.equal(await main(['remove', baseline.manifest.id], f.env), 0)
  assert.deepEqual(loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))), [])
  assert.equal(createMainPlugins().find(plugin => plugin.manifest.id === baseline.manifest.id).manifest.version, baseline.manifest.version)
  assert.equal(fs.existsSync(f.marker), false)
})

test('replacement declarations cannot change built-in ports or steal another source reading', async t => {
  const f = fixture(t)
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const baseline = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.source.weather')
  const manifest = { ...baseline.manifest, entry: 'entry.cjs', permissions: [] }
  f.write(manifest)
  assert.equal(main(['link', f.folder, '--trust', '--replace'], f.env), 0)
  const config = readConfig(resolveConfigPath(f.env))
  f.write({ ...manifest, provides: [] })
  assert.throws(() => loadDevelopmentPlugins(config), /contract/)
  assert.equal(fs.existsSync(f.marker), false)
  f.write(manifest)
  fs.writeFileSync(path.join(f.folder, 'entry.cjs'), `exports.create = () => ({ ports: {
    'odk:source/weather/v1': {},
    'odk:desk-reading/weather/v1': [{ id: 'odk.tile.hydra', label: 'Invalid claim', kind: 'tile', read: () => ({ state: 'live', value: 1 }) }],
    'odk:plugin-health/odk.source.weather/v1': { snapshot: () => ({ state: 'healthy' }) }
  } })`)
  const host = createPluginHost()
  loadDevelopmentPlugins(config).forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.list()[0].state, 'failed')
  await host.stop()
  const unrelated = fixture(t)
  assert.equal(main(['link', unrelated.folder, '--trust', '--grant', 'fixture', '--replace'], unrelated.env), 1)
})


test('linked Futu replacement retains catalog service identities through dynamic readings', async t => {
  const f = fixture(t)
  const { createMainPlugins } = require('../src/plugins/main-composition')
  const { DESK_PORTS } = require('../src/plugins/desk-runtime')
  const original = createMainPlugins().find(plugin => plugin.manifest.id === 'odk.service.futu')
  f.write({ ...original.manifest, entry: 'entry.cjs', permissions: [] })
  fs.writeFileSync(path.join(f.folder, 'entry.cjs'), `exports.create = () => ({ ports: {
    'odk:service/futu/v1': {},
    'odk:desk-service-readings/futu/v1': { readings: () => [{ id: 'futu-poller', label: 'Holdings', kind: 'service', read: () => ({ state: 'unavailable', value: null }) }] },
    'odk:plugin-health/odk.service.futu/v1': { snapshot: () => ({ state: 'degraded' }) }
  } })`)
  assert.equal(main(['link', f.folder, '--trust', '--replace'], f.env), 0)
  const definitions = loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env)))
  const composed = createPluginHost()
  composed.register({ manifest: { schemaVersion: 1, id: 'odk.test.catalog', name: 'Catalog fixture', version: '1.0.0', kind: 'service', host: 'electron-main', provides: [{ interface: DESK_PORTS.catalog }] }, create: () => ({ ports: { [DESK_PORTS.catalog]: {} } }) })
  definitions.forEach(plugin => composed.register(plugin))
  await composed.start()
  assert.equal(composed.list().find(plugin => plugin.manifest.id === original.manifest.id).state, 'running')
  assert.equal(composed.get(DESK_PORTS.futuReadings).readings()[0].id, 'futu-poller')
  await composed.stop()
})


test('saved replacement flags require boolean values before module discovery', t => {
  const f = fixture(t)
  assert.equal(main(['link', f.folder, '--trust', '--grant', 'fixture'], f.env), 0)
  const configPath = resolveConfigPath(f.env)
  const config = readConfig(configPath)
  for (const replace of ['true', 1, null, {}]) {
    config.plugins[f.manifest.id].development.replace = replace
    fs.writeFileSync(configPath, JSON.stringify(config))
    assert.throws(() => readConfig(configPath), /invalid development/)
    assert.equal(fs.existsSync(f.marker), false)
  }
})
