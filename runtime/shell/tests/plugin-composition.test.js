const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const registrySource = fs.readFileSync('src/renderer/core/registry.js', 'utf8')
const composerSource = fs.readFileSync('src/renderer/core/composer.js', 'utf8')

function createRegistry() {
  const root = {}
  vm.runInContext(registrySource, vm.createContext({ window: root, globalThis: root }))
  return root.odkPlugins
}

function plugin(def) {
  return {
    manifest: { schemaVersion: 1 },
    mount() {},
    ...def,
  }
}

function validate(definitions, layout) {
  const root = { odkPlugins: createRegistry() }
  for (const definition of definitions) root.odkPlugins.register(definition)
  vm.runInContext(composerSource, vm.createContext({ window: root, globalThis: root }))
  return root.odkComposer.validate(layout)
}

test('accepts the fixed built-in plugin kinds and rejects speculative extensions', () => {
  const registry = createRegistry()
  for (const kind of ['tile', 'page', 'status', 'app']) {
    registry.register(plugin({
      id: `odk.${kind}.sample`,
      kind,
      ...(kind === 'status' ? { slot: 'left' } : {}),
      ...(kind === 'tile' ? { interaction: 'display-only' } : {}),
      ...(kind === 'app' ? { appId: 'sample' } : {}),
    }))
  }

  assert.throws(
    () => registry.register(plugin({ id: 'odk.service.sample', kind: 'service' })),
    /supported kind/,
  )
  assert.throws(
    () => registry.register({ id: 'odk.tile.unversioned', kind: 'tile', mount() {} }),
    /schema version 1/,
  )
})

test('keeps display widgets separate from interactive App surfaces', () => {
  assert.equal(validate([
    plugin({ id: 'odk.tile.clock', kind: 'tile', interaction: 'display-only' }),
    plugin({ id: 'odk.page.pi', kind: 'page', surface: 'app' }),
    plugin({ id: 'odk.status.connection', kind: 'status', slot: 'left' }),
  ], {
    pages: [
      { id: 'home', name: 'Home', kind: 'grid', surface: 'display', widgets: [{ id: 'odk.tile.clock', col: '1', row: '1' }] },
      { id: 'pi', name: 'Pi Sessions', kind: 'page', surface: 'app', plugin: 'odk.page.pi' },
    ],
  }), true)

  assert.throws(() => validate([
    plugin({ id: 'odk.tile.clock', kind: 'tile', interaction: 'open-app', appId: 'clock' }),
  ], {
    pages: [{ id: 'home', name: 'Home', kind: 'grid', surface: 'display', widgets: [{ id: 'odk.tile.clock', col: '1', row: '1' }] }],
  }), /must be display-only/)

  assert.throws(() => validate([
    plugin({ id: 'odk.page.pi', kind: 'page', surface: 'display' }),
  ], {
    pages: [{ id: 'pi', name: 'Pi Sessions', kind: 'page', surface: 'app', plugin: 'odk.page.pi' }],
  }), /surface does not match/)

  const registry = createRegistry()
  assert.throws(() => registry.register(plugin({ id: 'odk.status.connection', kind: 'status', slot: 'middle' })), /supported slot/)
  assert.throws(() => registry.register(plugin({ id: 'odk.tile.clock', kind: 'tile', interaction: 'display-only', appId: 'clock' })), /cannot declare an App continuation/)
})
