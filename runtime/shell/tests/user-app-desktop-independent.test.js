'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')

test('independent installed desktop passes the same behavior scenarios without default delegation', async t => {
  const env = { ...process.env, ODK_TEST_INDEPENDENT_DESKTOP: '1' }
  delete env.NODE_TEST_CONTEXT
  const result = await runCommand(process.execPath, ['--test', '--test-reporter=spec', path.join(__dirname, 'user-app-desktop.test.js')], {
    env, signal: t.signal, timeout: 10000,
  })
  assert.match(result.stdout, /pass 13\b/)
  assert.match(result.stdout, /fail 0\b/)
})
