const { test } = require('node:test')
const assert = require('node:assert/strict')

test('density fixes its default theme and waits for the chosen font before measuring', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'widget-density.cjs'), 'utf8')
  assert.match(source, /const fixtureTheme = resolveDensityTheme\(process.argv\)/)
  assert.ok(source.indexOf('await document.fonts.ready', source.indexOf('if (fixtureTheme)')) > source.indexOf('if (fixtureTheme)'))
})


test('density accepts every installed theme and rejects unknown themes', () => {
  const { resolveDensityTheme } = require('./helpers/widget-density')
  assert.equal(resolveDensityTheme([]), 'instrument')
  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
    assert.equal(resolveDensityTheme([`--theme=${theme}`]), theme)
  }
  assert.equal(resolveDensityTheme(['--theme=pixel', '--date-theme=liquid-glass']), 'liquid-glass')
  assert.throws(() => resolveDensityTheme(['--theme=missing']), /Invalid fixture theme/)
})
