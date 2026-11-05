'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8')

const css = () => read('src/renderer/home-desk.css')

test('the State Bar band ends where the desk begins', () => {
  const s = css()
  assert.doesNotMatch(s, /#status-bar\s*\{[^}]*height:\s*calc\(var\(--status-h\) - \d+px\)/,
    'no shorter visible band leaves a dead strip above the desk')
  assert.match(s, /#home-desk\s*\{[^}]*inset:\s*var\(--status-h\)/,
    'the desk still starts at the geometry status height')
})

test('the Agent avatar is not lifted out of its pane', () => {
  const s = css()
  assert.doesNotMatch(s, /--agent-head-lift:\s*-\d+px/, 'no negative header lift')
  assert.doesNotMatch(s, /\.agent-head\s*\{[^}]*translateY\(var\(--agent-head-lift\)\)/,
    'the header no longer moves above the pane edge')
  assert.match(s, /\.agent-identity \.agent-capsule\s*\{[^}]*border-radius:\s*var\(--agent-radius-surface\)/,
    'the framed identity capsule keeps its radius')
})

test('the Widget canvas and the Page Controller fit the right pane', () => {
  const s = css()
  assert.doesNotMatch(s, /grid-template-rows: max-content minmax\(0, 1fr\) max-content 48px/,
    'the tall fixed empty row below the Page Controller is gone')
  assert.match(s, /#page-center\s*\{[^}]*grid-row:\s*3/, 'the Page Controller keeps its own row')
})
