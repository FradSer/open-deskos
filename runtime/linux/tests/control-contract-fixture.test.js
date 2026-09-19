const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

test('desk and Console package ship one byte-identical v2 control contract', () => {
  const desk = fs.readFileSync(path.join(__dirname, 'fixtures/control-v2.json'))
  const consoleFixture = path.resolve(__dirname, '../../../../pi-packages/packages/open-deskos/fixtures/control-v2.json')
  assert.equal(fs.existsSync(consoleFixture), true, 'the sibling Console fixture must exist in the development workspace')
  assert.deepEqual(fs.readFileSync(consoleFixture), desk)
})
