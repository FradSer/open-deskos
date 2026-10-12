'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { builtinViewTimeouts } = require('./helpers/builtin-view-selection')

for (const mode of ['programmatic', 'development', 'native']) {
  test(`${mode} built-in view budget matches its bounded workload`, () => {
    assert.deepEqual(builtinViewTimeouts(mode), mode === 'native'
      ? { fixture: 60000, child: 65000, test: 90000 }
      : { fixture: 30000, child: 35000, test: 45000 })
  })
}
for (const mode of ['programmatic', 'native']) {
  test(`${mode} child watchdog uses the selected fixture budget`, () => {
    const source = fs.readFileSync(path.join(__dirname, 'builtin-view-replacement.cjs'), 'utf8')
    const statement = source.split('\n').find(line => line.startsWith('const timeout = setTimeout('))
    let delay
    vm.runInNewContext(statement, { builtinViewTimeouts, mode, native: mode === 'native', process: { env: { ODK_BUILTIN_VIEWS_MODE: mode } },
      setTimeout(_callback, milliseconds) { delay = milliseconds }, finish() {} })
    assert.equal(delay, mode === 'native' ? 60000 : 30000)
  })
}
test('parent and child process guards use the selected workload budgets', () => {
  const source = fs.readFileSync(path.join(__dirname, 'builtin-view-replacement.test.js'), 'utf8')
  assert.match(source, /timeout: builtinViewTimeouts\(mode\)\.test/)
  assert.match(source, /timeout: builtinViewTimeouts\(mode\)\.child/)
})
