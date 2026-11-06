'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')

test('the paging viewport does not leave spare height below the Widgets', () => {
  const css = read('src/renderer/home-desk.css')
  assert.match(css, /#desk-content\s*\{[^}]*grid-template-rows:\s*minmax\(0, 1fr\)\s+max-content\s+max-content/,
    'the Overview row absorbs the spare height')
  assert.match(css, /#home-summary\s*\{[^}]*min-height:\s*var\(--cell-h\)/,
    'the Overview keeps at least one Cell of height')
  assert.doesNotMatch(css, /#pages-viewport\s*\{[^}]*grid-row:\s*2[^}]*height:\s*100%/,
    'the paging viewport is not stretched past its content')
})

test('WeRead spans both rows of its 3x2 page', () => {
  const ctx = {}
  vm.runInNewContext(read('src/renderer/config/desktop_layout.js'), ctx)
  const pages = ctx.DESKTOP_LAYOUT.pages
  const reading = pages.find(p => p.id === 'reading')
  const desk = pages.find(p => p.id === 'desk')
  assert.equal(reading.gridRows, 2)
  assert.equal(reading.widgets[0].row, '1 / 3', 'WeRead fills the two Widget rows')
  assert.equal(reading.widgets[0].col, '1 / 4')
  assert.equal(reading.widgets[0].opensApp, 'weread')
  assert.equal(desk.widgets[0].row, '1', 'Hydra keeps its Desk placement')
})
