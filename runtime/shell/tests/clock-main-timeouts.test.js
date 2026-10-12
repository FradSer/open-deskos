const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { clockMainTimeouts } = require('./helpers/clock-main-timeouts')

test('native combined Clock comparison has a bounded workload budget', () => {
  assert.deepEqual(clockMainTimeouts('calendar', 'linux', 'arm64'), { fixture: 60000, child: 65000, test: 90000 })
})

test('other Clock modes and hosts retain their existing deadlines', () => {
  for (const [mode, platform, arch] of [['calendar', 'darwin', 'arm64'], ['calendar', 'linux', 'x64'],
    ['built-in', 'linux', 'arm64'], ['signed', 'linux', 'arm64'], ['missing-tick', 'linux', 'arm64']]) {
    assert.deepEqual(clockMainTimeouts(mode, platform, arch), { fixture: 40000, child: 45000, test: 60000 })
  }
})

test('Clock fixture, child watchdog, and parent test use the same budget', () => {
  const fixture = fs.readFileSync(path.join(__dirname, 'clock-main-bootstrap.cjs'), 'utf8')
  const parent = fs.readFileSync(path.join(__dirname, 'clock-main-bootstrap.test.js'), 'utf8')
  assert.match(fixture, /clockMainTimeouts\(mode\)\.fixture/)
  assert.match(parent, /timeout: clockMainTimeouts\(mode\)\.child/)
  assert.match(parent, /timeout: clockMainTimeouts\(mode\)\.test/)
})
