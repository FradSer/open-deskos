'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { plan, concurrencyFor } = require('../scripts/test-tiers.cjs')

const root = path.resolve(__dirname, '..')
const runner = path.join(root, 'scripts', 'test-tiers.cjs')
const testsDir = path.join(root, 'tests')

const listTier = tier => JSON.parse(execFileSync(process.execPath,
  [runner, tier, '--list'], { cwd: root, encoding: 'utf8' }))
const names = files => files.map(file => path.basename(file)).sort()

test('both tiers partition the complete Node contract suite', () => {
  const fast = listTier('fast')
  const acceptance = listTier('acceptance')
  const expected = fs.readdirSync(testsDir)
    .filter(file => file.endsWith('.test.js'))
    .map(file => path.join(testsDir, file))
    .sort()
  const combined = [...fast.files, ...acceptance.files].sort()
  assert.deepEqual(combined, expected)
  assert.equal(new Set(combined).size, combined.length)
})

test('the measured Electron acceptance files stay out of the fast tier', () => {
  const fast = names(listTier('fast').files)
  const acceptance = names(listTier('acceptance').files)
  for (const file of ['hydra-surface-restart.test.js', 'weather-surface-restart.test.js', 'weread-surface-restart.test.js']) {
    assert.equal(fast.includes(file), false, `${file} must not run in the fast tier`)
    assert.equal(acceptance.includes(file), true, `${file} must run in the acceptance tier`)
  }
  assert.equal(fast.includes('briefing-store.test.js'), true)
})

test('the fast tier uses more workers than the acceptance tier', () => {
  const fast = listTier('fast')
  const acceptance = listTier('acceptance')
  assert.equal(acceptance.concurrency, 2)
  assert.ok(fast.concurrency > 2)
  assert.ok(fast.files.length > 0)
  assert.ok(acceptance.files.length > 0)
})

test('a new Electron test file joins the acceptance tier', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-test-tier-'))
  try {
    fs.writeFileSync(path.join(dir, 'contract.test.js'), "const { test } = require('node:test')\ntest('a', () => {})\n")
    fs.copyFileSync(path.join(testsDir, 'hydra-surface-electron.test.js'), path.join(dir, 'gui.test.js'))
    assert.deepEqual(names(plan('fast', dir).files), ['contract.test.js'])
    assert.deepEqual(names(plan('acceptance', dir).files), ['gui.test.js'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the package exposes both tier commands and keeps the complete suite', () => {
  const { scripts } = require('../package.json')
  assert.match(scripts['test:fast'], /node scripts\/test-tiers\.cjs fast/)
  assert.match(scripts['test:acceptance'], /node scripts\/test-tiers\.cjs acceptance/)
  assert.match(scripts.test, /--test-concurrency=2 tests\/\*\.test\.js/)
})

test('the reference host keeps a conservative fast tier', () => {
  assert.deepEqual(concurrencyFor('linux', 'arm64', {}), { fast: 4, acceptance: 2 })
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64']]) {
    assert.deepEqual(concurrencyFor(platform, arch, {}), { fast: 8, acceptance: 2 })
  }
})

test('an explicit fast-tier concurrency override takes precedence', () => {
  assert.deepEqual(concurrencyFor('linux', 'arm64', { ODK_TEST_FAST_CONCURRENCY: '6' }), { fast: 6, acceptance: 2 })
  assert.deepEqual(concurrencyFor('darwin', 'arm64', { ODK_TEST_FAST_CONCURRENCY: '3' }), { fast: 3, acceptance: 2 })
})

test('an invalid fast-tier concurrency override keeps the host default', () => {
  for (const value of ['zero', '-1', '0', '']) {
    assert.deepEqual(concurrencyFor('linux', 'arm64', { ODK_TEST_FAST_CONCURRENCY: value }), { fast: 4, acceptance: 2 })
  }
})
