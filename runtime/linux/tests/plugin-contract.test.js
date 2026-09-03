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

test('distinguishes interactive and display-only tiles with semantic classes and attributes', () => {
  const fakeDoc = {
    createElement(tag) {
      const el = {
        tagName: tag.toUpperCase(),
        className: '',
        dataset: {},
        style: {},
        listeners: {},
        children: [],
        attributes: {},
        setAttribute(k, v) { this.attributes[k] = v },
        getAttribute(k) { return this.attributes[k] },
        addEventListener(event, fn) { this.listeners[event] = fn },
        append(child) { this.children.push(child) },
        replaceChildren() { this.children = [] },
        querySelector() { return null },
        querySelectorAll() { return [] },
      }
      return el
    },
  }
  const root = {
    document: fakeDoc,
    odkPlugins: registryWith([
      plugin({ id: 'odk.tile.clock', kind: 'tile', interaction: 'open-app', appId: 'clock', app: 'Clock', state: 'Available' }),
      plugin({ id: 'odk.tile.year', kind: 'tile', interaction: 'display-only', app: 'Year', state: 'Live' }),
      plugin({ id: 'odk.app.clock', kind: 'app', appId: 'clock' }),
    ]),
  }
  const context = vm.createContext({ window: root, globalThis: root, document: fakeDoc })
  vm.runInContext(composerSource, context)

  const track = fakeDoc.createElement('div')
  let emitted = null
  const uiCtx = {
    emitIntent(intent) { emitted = intent },
    onTick() {},
  }

  root.odkComposer.build({
    pages: [{
      id: 'home', name: 'Home', kind: 'grid', widgets: [
        { id: 'odk.tile.clock', col: '1', row: '1' },
        { id: 'odk.tile.year', col: '2', row: '1' },
      ],
    }],
  }, track, uiCtx)

  const grid = track.children[0].children[0]
  const clockTile = grid.children[0]
  const yearTile = grid.children[1]

  assert.equal(clockTile.tagName, 'BUTTON')
  assert.equal(clockTile.type, 'button')
  assert.ok(clockTile.className.includes('widget-interactive'))
  assert.equal(clockTile.dataset.interaction, 'open-app')

  assert.equal(yearTile.tagName, 'DIV')
  assert.equal(yearTile.type, undefined)
  assert.ok(yearTile.className.includes('widget-display-only'))
  assert.equal(yearTile.dataset.interaction, 'display-only')

  clockTile.listeners.click()
  assert.equal(emitted.type, 'open-app')
  assert.equal(emitted.appId, 'clock')
  assert.equal(emitted.widgetId, 'odk.tile.clock')
  assert.equal(emitted.route, 'today')
})
