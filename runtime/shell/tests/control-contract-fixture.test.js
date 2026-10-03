const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('desk and Console package ship one byte-identical v2 control contract', t => {
  const desk = fs.readFileSync(path.join(__dirname, 'fixtures/control-v2.json'))
  const consoleFixture = path.resolve(__dirname, '../../../../pi-packages/packages/open-deskos/fixtures/control-v2.json')
  // The Console package lives in a sibling checkout, so a standalone desk clone
  // cannot compare the two; skip there instead of failing the whole suite.
  if (!fs.existsSync(consoleFixture)) {
    t.skip('sibling pi-packages checkout is not present')
    return
  }
  assert.deepEqual(fs.readFileSync(consoleFixture), desk)
})
