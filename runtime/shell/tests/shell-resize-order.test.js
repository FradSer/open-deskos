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
  const pane = { clientWidth: 528, clientHeight: 420 }
  const content = { clientHeight: 552 }
  let grids = []
  let resize
  let frame
  const observed = []
  const window = { location: { search: '' }, innerWidth: 960, innerHeight: 640,
    DESKTOP_LAYOUT: { pages: [{ kind: 'grid', widgets: [{}] }] },
    addEventListener(name, callback) { assert.equal(name, 'resize'); resize = callback } }
  vm.runInNewContext(source, { window, URLSearchParams, odkLayout: layout,
    document: { documentElement: { dataset: {}, style: { setProperty(name, value) { properties.set(name, value) } } },
      querySelectorAll() { return grids }, getElementById(id) { if (id === 'pages-viewport') return pane; if (id === 'desk-content') return content; assert.equal(id, 'pages-track'); return track } },
    requestAnimationFrame(callback) { frame = callback; return 1 }, cancelAnimationFrame() {},
    odkComposer: { filterLayout(value) { return value }, placeGridTiles(element) {
      assert.equal(element, track)
      observed.push({ columns: properties.get('--cols'), cell: properties.get('--cell-w'), width: window.__odkGrid.width })
    } },
  })
  resize()
  assert.deepEqual(observed, [])
  frame()
  const expected = layout.computeDesk(960, 640, 608, 420, 1, 552)
  assert.deepEqual(observed, [{ columns: String(expected.cols), cell: `${expected.cellW}px`, width: 960 }])
  window.innerWidth = 1920
  window.innerHeight = 1280
  content.clientHeight = 1184
  grids = [{ children: [{ dataset: { minCell: '217' } }], closest() { return { offsetWidth: 528, clientWidth: 518 } } }]
  resize()
  frame()
  assert.deepEqual(observed[1], { columns: '3', cell: '357px', width: 1920 })
  assert.equal(properties.get('--desk-pane-w'), '1177px', 'pane includes 32 pixel side margins and measured scroll rail')
})
