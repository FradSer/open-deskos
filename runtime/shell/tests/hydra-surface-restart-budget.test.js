'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const restart = fs.readFileSync(path.join(__dirname, 'hydra-surface-restart.test.js'), 'utf8')
const fixture = fs.readFileSync(path.join(__dirname, 'hydra-surface-electron.cjs'), 'utf8')

test('Hydra revision children retain the existing CM5 rendering budget', () => {
  assert.match(fixture, /process\.platform === 'linux' && process\.arch === 'arm64' \? 150000 : 70000/)
  assert.match(restart, /const cm5 = process\.platform === 'linux' && process\.arch === 'arm64'/)
  assert.match(restart, /const childTimeout = cm5 \? 160000 : 80000/)
  assert.match(restart, /timeout: childTimeout, killSignal: 'SIGKILL'/)
})

test('Hydra revision parent covers four children and preserves other host budgets', () => {
  assert.match(restart, /timeout: 4 \* childTimeout \+ 100000/)
  assert.equal(4 * 80000 + 100000, 420000)
})
