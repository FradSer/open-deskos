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
  for (const kind of ['tile', 'page', 'status', 'peek', 'app']) {
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

test('validates tile continuations and explicit desktop placement', () => {
  assert.equal(validate([
    plugin({ id: 'odk.tile.clock', kind: 'tile', interaction: 'open-app', appId: 'clock' }),
    plugin({ id: 'odk.app.clock', kind: 'app', appId: 'clock' }),
    plugin({ id: 'odk.status.connection', kind: 'status', slot: 'left' }),
  ], {
    pages: [{ id: 'home', name: 'Home', kind: 'grid', widgets: [{ id: 'odk.tile.clock', col: '1', row: '1' }] }],
  }), true)

  assert.throws(() => validate([
    plugin({ id: 'odk.tile.clock', kind: 'tile', interaction: 'open-app', appId: 'missing' }),
  ], {
    pages: [{ id: 'home', name: 'Home', kind: 'grid', widgets: [{ id: 'odk.tile.clock', col: '1', row: '1' }] }],
  }), /missing built-in App/)

  const registry = createRegistry()
  assert.throws(() => registry.register(plugin({ id: 'odk.status.connection', kind: 'status', slot: 'middle' })), /supported slot/)
  assert.throws(() => registry.register(plugin({ id: 'odk.tile.clock', kind: 'tile', interaction: 'display-only', appId: 'clock' })), /cannot declare appId/)
})
