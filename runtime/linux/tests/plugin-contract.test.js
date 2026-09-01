const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const registrySource = fs.readFileSync('src/renderer/core/registry.js', 'utf8')
const composerSource = fs.readFileSync('src/renderer/core/composer.js', 'utf8')

function registryWith(definitions) {
  const root = {}
  const context = vm.createContext({ window: root, globalThis: root })
  vm.runInContext(registrySource, context)
  for (const def of definitions) root.odkPlugins.register(def)
  return root.odkPlugins
}

function validate(definitions, layout) {
  const root = { odkPlugins: registryWith(definitions) }
  const context = vm.createContext({ window: root, globalThis: root })
  vm.runInContext(composerSource, context)
  return root.odkComposer.validate(layout)
}

function invalidRegistry(definition) {
  assert.throws(() => registryWith([definition]), /Open DeskOS identity|unsupported kind|supported slot|cannot declare appId/)
}

const lifecycle = {
  install() {}, enable() {}, mount() {}, start() {}, pause() {}, resume() {},
  stop() {}, unmount() {}, disable() {}, uninstall() {},
}

function plugin(def) {
  return { manifest: { schemaVersion: 1 }, lifecycle, ...def }
}

test('accepts a locally packaged layout with a valid tile-to-App continuation', () => {
  assert.equal(validate([
    plugin({ id: 'odk.tile.clock', kind: 'tile', interaction: 'open-app', appId: 'clock' }),
    plugin({ id: 'odk.app.clock', kind: 'app', appId: 'clock' }),
    plugin({ id: 'odk.status.connection', kind: 'status', slot: 'left' }),
  ], {
    pages: [{ id: 'home', name: 'Home', kind: 'grid', widgets: [{ id: 'odk.tile.clock', col: '1', row: '1' }] }],
  }), true)
})

test('rejects invalid plugin identity, kind, lifecycle, status slot, and continuation', () => {
  invalidRegistry(plugin({ id: 'clock', kind: 'tile' }))
  invalidRegistry(plugin({ id: 'odk.tile.clock', kind: 'overlay' }))
  invalidRegistry(plugin({ id: 'odk.tile.clock', kind: 'tile', interaction: 'display-only', appId: 'clock' }))
  invalidRegistry(plugin({ id: 'odk.status.connection', kind: 'status', slot: 'middle' }))

  assert.throws(() => validate([
    plugin({ id: 'odk.tile.clock', kind: 'tile', interaction: 'open-app', appId: 'missing' }),
  ], {
    pages: [{ id: 'home', name: 'Home', kind: 'grid', widgets: [{ id: 'odk.tile.clock', col: '1', row: '1' }] }],
  }), /missing built-in App/)
})

test('rejects mismatched page plugin kinds, invalid grid placement, and duplicate layout references', () => {
  const page = plugin({ id: 'odk.page.today', kind: 'page' })
  const tile = plugin({ id: 'odk.tile.clock', kind: 'tile' })

  assert.throws(() => validate([tile], {
    pages: [{ id: 'today', name: 'Today', kind: 'page', plugin: 'odk.tile.clock' }],
  }), /must reference a page plugin/)

  assert.throws(() => validate([page, tile], {
    pages: [{
      id: 'home', name: 'Home', kind: 'grid', widgets: [
        { id: 'odk.tile.clock', col: 'not-a-grid-line', row: '1' },
      ],
    }],
  }), /invalid grid placement/)

  assert.throws(() => validate([tile], {
    pages: [{
      id: 'home', name: 'Home', kind: 'grid', widgets: [
        { id: 'odk.tile.clock', col: '1', row: '1' },
        { id: 'odk.tile.clock', col: '2', row: '1' },
      ],
    }],
  }), /appears more than once/)
})
