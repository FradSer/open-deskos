const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const renderer = path.join(__dirname, '../src/renderer')
const css = fs.readFileSync(path.join(renderer, 'shell.css'), 'utf8')


test('Pi summary scales with the tile and compact numerals have no competing shrink override', () => {
  assert.match(css, /\.pi-widget-summary \{[^}]*font-size: clamp\(14px, 5cqi, 20px\)/)
  assert.doesNotMatch(css, /font-size: clamp\(48px, 24cqi, 96px\)/)
})

test('WeRead allows a readable widescreen excerpt before fitting to available height', () => {
  const source = fs.readFileSync(path.join(renderer, 'plugins/weread/typography.js'), 'utf8')
  assert.match(source, /frame.clientWidth >= 800 && frame.clientHeight >= 800 \? 96 : 72/)
  assert.match(source, /size > 14 && text.scrollHeight > height/)
})
