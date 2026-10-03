const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const renderer = path.join(__dirname, '../src/renderer')
const css = fs.readFileSync(path.join(renderer, 'shell.css'), 'utf8')

test('preorder countdown scales below the former compact 60px floor', () => {
  assert.match(css, /\.w-preorder \.preorder-count \{[^}]*font-size: clamp\(24px, 17cqi, 136px\)/)
  assert.match(css, /\.w-preorder \.preorder-count\.is-open \{[^}]*font-size: clamp\(24px, 17\.5cqi, 140px\)/)
})

test('Pi summary scales with the tile and compact numerals have no competing shrink override', () => {
  assert.match(css, /\.pi-widget-summary \{[^}]*font-size: max\(12px, 4cqi\)/)
  assert.doesNotMatch(css, /font-size: clamp\(48px, 24cqi, 96px\)/)
})

test('WeRead allows a readable widescreen excerpt before fitting to available height', () => {
  const source = fs.readFileSync(path.join(renderer, 'plugins/weread.js'), 'utf8')
  assert.match(source, /const MAX_TEXT_SIZE = 72/)
  assert.match(source, /if \(text.scrollHeight <= maxH\) break/)
})
