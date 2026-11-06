'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'shell.css'), 'utf8')

const dashColors = css.slice(css.indexOf('.dash-change[data-direction="up"]'), css.indexOf('.dash-state[data-level="healthy"]') + 200)

test('Overview state colors use the shared Widget accent tokens', () => {
  assert.match(dashColors, /--odk-accent-green/, 'healthy states use the Widget green')
  assert.match(dashColors, /--odk-accent-red/, 'critical states use the Widget red')
  assert.doesNotMatch(dashColors, /--odk-status-(healthy|critical|warning|info)/,
    'no separate mixed status palette remains for Overview values')
})

test('Overview source icons keep their restrained category colors', () => {
  const icons = css.slice(css.indexOf('.dash-icon {'), css.indexOf('.dash-temperature'))
  assert.match(icons, /data-kind="weather"/, 'weather keeps its own category')
  assert.match(icons, /data-kind="portfolio"/, 'portfolio keeps its own category')
  assert.match(icons, /--odk-accent-red/, 'icon categories derive from the shared accents')
  assert.match(icons, /--odk-accent-green/, 'icon categories derive from the shared accents')
})
