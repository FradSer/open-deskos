'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')

test('the Agent pane clips scrolling content without a flat fill', () => {
  const css = read('src/renderer/home-desk.css')
  const rule = /#personal-agent \{([^}]*)\}/.exec(css)
  assert.ok(rule, 'the pane rule exists')
  assert.match(rule[1], /overflow:\s*hidden/, 'scrolling Widgets are clipped')
  assert.match(rule[1], /z-index:\s*[1-9]/, 'the pane owns its stacking layer')
  assert.match(rule[1], /position:\s*relative/, 'the stacking layer is local')
  assert.doesNotMatch(rule[1], /background:\s*var\(--odk-bg\)/, 'no flat solid fill')
  assert.match(rule[1], /border-right:\s*1px solid/, 'the separating border stays')
})

test('the State Bar band ends where the desk begins', () => {
  const css = read('src/renderer/home-desk.css')
  assert.doesNotMatch(css, /#status-bar\s*\{[^}]*height:\s*calc\(var\(--status-h\) - \d+px\)/,
    'no shorter band leaves a dead strip above the desk')
  assert.match(css, /#home-desk\s*\{[^}]*inset:\s*var\(--status-h\)/,
    'the desk starts at the geometry status height')
  const layout = read('src/renderer/layout.js')
  assert.match(layout, /Math\.max\(56, Math\.min\(88, Math\.floor\(height \* 0\.06\)\)\)/,
    'the widescreen State Bar band is shorter than before')
})
