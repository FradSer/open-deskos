const { test } = require('node:test')
const assert = require('node:assert/strict')

test('density fixes its default theme and waits for the chosen font before measuring', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'widget-density.cjs'), 'utf8')
  assert.match(source, /value\('--theme'\) \|\| 'instrument'/)
  assert.ok(source.indexOf('await document.fonts.ready', source.indexOf('if (fixtureTheme)')) > source.indexOf('if (fixtureTheme)'))
})
