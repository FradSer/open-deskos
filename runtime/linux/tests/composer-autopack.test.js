const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const registrySource = fs.readFileSync('src/renderer/core/registry.js', 'utf8')
const composerSource = fs.readFileSync('src/renderer/core/composer.js', 'utf8')

function setupComposer(plugins) {
  const fakeDoc = {
    createElement(tag) {
      return {
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
    },
  }
  const root = {
    document: fakeDoc,
    window: null,
  }
  root.window = root
  const context = vm.createContext({ window: root, globalThis: root, document: fakeDoc })
  vm.runInContext(registrySource, context)
  for (const p of plugins) root.odkPlugins.register(p)
  vm.runInContext(composerSource, context)
  return { root, fakeDoc }
}

const lifecycle = {
  install() {}, enable() {}, mount() {}, start() {}, pause() {}, resume() {},
  stop() {}, unmount() {}, disable() {}, uninstall() {},
}

test('auto-packs unassigned widget declaring manifest contributions into available grid cell', () => {
  const plugins = [
    {
      id: 'odk.tile.existing',
      manifest: { schemaVersion: 1 },
      kind: 'tile',
      interaction: 'display-only',
      lifecycle,
    },
    {
      id: 'odk.tile.auto',
      manifest: {
        schemaVersion: 1,
        contributions: { slot: 'home.grid', preferredSpan: '1x1' },
      },
      kind: 'tile',
      interaction: 'display-only',
      lifecycle,
    },
  ]

  const { root, fakeDoc } = setupComposer(plugins)
  const track = fakeDoc.createElement('div')
  const uiCtx = { emitIntent() {}, onTick() {} }

  const layout = {
    pages: [
      {
        id: 'home',
        name: 'Home',
        kind: 'grid',
        widgets: [
          { id: 'odk.tile.existing', col: '1', row: '1' },
        ],
      },
    ],
  }

  root.odkComposer.build(layout, track, uiCtx)

  const homePage = track.children[0]
  const grid = homePage.children[0]

  // There should be 2 widgets: existing and auto-packed
  assert.equal(grid.children.length, 2)
  const existingTile = grid.children[0]
  const autoTile = grid.children[1]

  assert.equal(existingTile.dataset.widget, 'odk.tile.existing')
  assert.equal(existingTile.style.gridColumn, '1')
  assert.equal(existingTile.style.gridRow, '1')

  assert.equal(autoTile.dataset.widget, 'odk.tile.auto')
  assert.ok(autoTile.style.gridColumn)
  assert.ok(autoTile.style.gridRow)
  // Auto tile must not collide with col 1, row 1
  assert.notEqual(`${autoTile.style.gridColumn}:${autoTile.style.gridRow}`, '1:1')
})

test('respects explicit grid placement over manifest contributions', () => {
  const plugins = [
    {
      id: 'odk.tile.custom',
      manifest: {
        schemaVersion: 1,
        contributions: { slot: 'home.grid', preferredSpan: '1x1' },
      },
      kind: 'tile',
      interaction: 'display-only',
      lifecycle,
    },
  ]

  const { root, fakeDoc } = setupComposer(plugins)
  const track = fakeDoc.createElement('div')
  const uiCtx = { emitIntent() {}, onTick() {} }

  const layout = {
    pages: [
      {
        id: 'home',
        name: 'Home',
        kind: 'grid',
        widgets: [
          { id: 'odk.tile.custom', col: '3', row: '2' },
        ],
      },
    ],
  }

  root.odkComposer.build(layout, track, uiCtx)

  const grid = track.children[0].children[0]
  assert.equal(grid.children.length, 1)
  const tile = grid.children[0]
  assert.equal(tile.style.gridColumn, '3')
  assert.equal(tile.style.gridRow, '2')
})
