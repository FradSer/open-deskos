const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const layout = require('../src/renderer/layout')

test('resize repositions Widgets after applying the new geometry without an observer callback', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/shell.js'), 'utf8').split('function createPager(')[0]
  const properties = new Map()
  const track = {}
  let resize
  let frame
  const observed = []
  const window = { location: { search: '' }, innerWidth: 960, innerHeight: 640,
    DESKTOP_LAYOUT: { pages: [{ kind: 'grid', widgets: [{}] }] },
    addEventListener(name, callback) { assert.equal(name, 'resize'); resize = callback } }
  vm.runInNewContext(source, { window, URLSearchParams, odkLayout: layout,
    document: { documentElement: { style: { setProperty(name, value) { properties.set(name, value) } } },
      querySelectorAll() { return [] }, getElementById(id) { assert.equal(id, 'pages-track'); return track } },
    requestAnimationFrame(callback) { frame = callback; return 1 }, cancelAnimationFrame() {},
    odkComposer: { filterLayout(value) { return value }, placeGridTiles(element) {
      assert.equal(element, track)
      observed.push({ columns: properties.get('--cols'), cell: properties.get('--cell-w'), width: window.__odkGrid.width })
    } },
  })
  resize()
  assert.deepEqual(observed, [])
  frame()
  const expected = layout.compute(960, 640, 1)
  assert.deepEqual(observed, [{ columns: String(expected.cols), cell: `${expected.cellW}px`, width: 960 }])
})
