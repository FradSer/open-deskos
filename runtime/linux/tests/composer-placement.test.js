// The composer's own placement, at the seam the Shell uses it. The pure decisions
// are covered in grid-placement.test.js; this covers that the composer asks them of
// the geometry the layout model has actually produced, and re-asks when the cell
// changes.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const RENDERER_DIR = path.join(__dirname, '..', 'src', 'renderer')

function element(dataset = {}) {
  const node = {
    dataset: { ...dataset },
    style: {},
    className: '',
    children: [],
    parentElement: null,
    append(child) { child.parentElement = node; node.children.push(child); return child },
    replaceChildren() { node.children = [] },
    // The composer finds a tile on a grid by its widget id, so the double looks at
    // its own children rather than answering nothing.
    querySelectorAll: (selector) => (selector || '').includes('data-widget')
      ? node.children.filter(child => Object.keys(child.dataset).some(key => key === 'widget'))
      : [],
    querySelector: (selector) => {
      if (!selector) return null
      const match = /data-widget="([^"]+)"/.exec(selector)
      if (!match) return null
      return node.children.find(child => child.dataset.widget === match[1]) || null
    },
    setAttribute() {},
    addEventListener() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, bottom: 0 }),
  }
  return node
}

function buildShell({ columns, rows, cell, minCell }) {
  const plugins = new Map()
  const register = (plugin) => plugins.set(plugin.id, plugin)
  const root = {
    odkPlugins: {
      register,
      get: (id) => plugins.get(id),
      activate: (plugin, el) => { plugin.mount(el, {}); return true },
    },
    odkPlatform: {},
    getComputedStyle: () => ({
      getPropertyValue: (name) => ({
        '--cell-w': `${cell}px`,
        '--cell-h': `${cell}px`,
        '--cols': String(columns),
        '--rows': String(rows),
      })[name] || '',
    }),
  }
  const context = vm.createContext({ window: root, globalThis: root, document: { createElement: element }, setTimeout, ResizeObserver: undefined })
  for (const file of ['core/registry.js', 'core/grid-placement.js', 'core/composer.js']) {
    vm.runInContext(fs.readFileSync(path.join(RENDERER_DIR, file), 'utf8'), context)
  }
  // The composer reads the declared layout from the page, so the fixture is the
  // shell's own global rather than an argument.
  root.DESKTOP_LAYOUT = {
    pages: [{
      id: 'home', name: 'Home', kind: 'grid', surface: 'display',
      widgets: [{ id: 'odk.tile.wide', col: '2 / 4', row: '2 / 4' }],
    }],
  }
  const tile = { id: 'odk.tile.wide', kind: 'tile', manifest: { schemaVersion: 1, minCell }, app: 'Wide', state: 'Ready', mount() {} }
  root.odkPlugins.register(tile)
  const track = element()
  // The composer finds a page's grid by selector when it re-places tiles, so the
  // double answers the one query it makes.
  track.querySelector = (selector) => (selector.includes('.widget-grid') ? track.children[0]?.children[0] || null : null)
  root.odkComposer.build(root.DESKTOP_LAYOUT, track, { onTick: () => () => {} })
  const grid = track.children[0].children[0]
  return { root, track, tile: grid.children[0] }
}

test('a declared span is placed when the grid can satisfy the page and the cell reaches the floor', () => {
  const { tile } = buildShell({ columns: 5, rows: 3, cell: 186, minCell: 186 })
  assert.equal(tile.dataset.span, 'kept')
  assert.equal(tile.style.gridColumn, '2 / 4')
  assert.equal(tile.style.gridRow, '2 / 4')
})

test('a page the grid cannot carry is left as single cells rather than implicit tracks', () => {
  const { tile } = buildShell({ columns: 2, rows: 5, cell: 282, minCell: 186 })
  assert.equal(tile.dataset.span, 'dropped')
  assert.equal(tile.style.gridColumn, '')
  assert.equal(tile.style.gridRow, '')
})

test('a span whose cell falls below the instrument\'s declared floor is refused', () => {
  // A 2x2 span of a 90px cell is a 180px cell, which is under the 200px the
  // instrument declared it reads at.
  const { tile } = buildShell({ columns: 5, rows: 3, cell: 90, minCell: 200 })
  assert.equal(tile.dataset.span, 'dropped')
  // The same span on a 100px cell is a 200px cell, which meets it exactly.
  const roomy = buildShell({ columns: 5, rows: 3, cell: 100, minCell: 200 })
  assert.equal(roomy.tile.dataset.span, 'kept')
})

test('the declared floor is published on the tile so the geometry gates can hold it', () => {
  const { tile } = buildShell({ columns: 5, rows: 3, cell: 186, minCell: 217 })
  assert.equal(tile.dataset.minCell, '217')
})

test('a panel that changes its cell re-decides the spans that are already on screen', () => {
  const { root, track, tile } = buildShell({ columns: 5, rows: 3, cell: 186, minCell: 186 })
  assert.equal(tile.dataset.span, 'kept')
  // The same page, a grid that can no longer carry it: the tile already on screen
  // has to be re-placed, not only tiles built later.
  root.getComputedStyle = () => ({
    getPropertyValue: (name) => ({ '--cell-w': '282px', '--cell-h': '282px', '--cols': '2', '--rows': '5' })[name] || '',
  })
  root.odkComposer.placeGridTiles(track)
  assert.equal(tile.dataset.span, 'dropped')
  assert.equal(tile.style.gridColumn, '')
})
