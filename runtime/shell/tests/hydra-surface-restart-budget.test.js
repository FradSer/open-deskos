'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { hydraSurfaceTimeouts } = require('./helpers/hydra-surface-selection')

const restart = fs.readFileSync(path.join(__dirname, 'hydra-surface-restart.test.js'), 'utf8')
const fixture = fs.readFileSync(path.join(__dirname, 'hydra-surface-electron.cjs'), 'utf8')

test('Hydra revision children retain the existing CM5 rendering budget', () => {
  assert.match(fixture, /hydraSurfaceTimeouts\(runtimeSurface\)\.fixture/)
  assert.deepEqual(hydraSurfaceTimeouts(false, 'linux', 'arm64'), { fixture: 150000, child: 160000, test: 180000 })
  assert.match(restart, /const cm5 = process\.platform === 'linux' && process\.arch === 'arm64'/)
  assert.match(restart, /const childTimeout = cm5 \? 160000 : 80000/)
  assert.match(restart, /timeout: childTimeout, killSignal: 'SIGKILL'/)
})

test('CM5 runtime surface budget covers the additional restored phase without changing other hosts', () => {
  assert.deepEqual(hydraSurfaceTimeouts(true, 'linux', 'arm64'), { fixture: 225000, child: 235000, test: 255000 })
  for (const runtime of [true, false]) {
    assert.deepEqual(hydraSurfaceTimeouts(runtime, 'darwin', 'arm64'), { fixture: 70000, child: 80000, test: 90000 })
    assert.deepEqual(hydraSurfaceTimeouts(runtime, 'linux', 'x64'), { fixture: 70000, child: 80000, test: 90000 })
  }
  const parent = fs.readFileSync(path.join(__dirname, 'hydra-surface-electron.test.js'), 'utf8')
  assert.match(parent, /hydraSurfaceTimeouts\(mode\.startsWith\('runtime-'\)\)\.test/)
  assert.match(parent, /hydraSurfaceTimeouts\(runtime\)\.child/)
})

test('Hydra revision parent covers four children and preserves other host budgets', () => {
  assert.match(restart, /timeout: 4 \* childTimeout \+ 100000/)
  assert.equal(4 * 80000 + 100000, 420000)
})

test('only independent CM5 modes use two bounded workers', () => {
  const parent = fs.readFileSync(path.join(__dirname, 'hydra-surface-electron.test.js'), 'utf8')
  const declaration = parent.match(/const surfaceConcurrency = (.*)/)?.[1]
  assert.ok(declaration, 'the worker limit must be explicit')
  const evaluate = (platform, arch) => require('node:vm').runInNewContext(declaration, { process: { platform, arch } })
  assert.equal(evaluate('linux', 'arm64'), 2)
  assert.equal(evaluate('darwin', 'arm64'), 1)
  assert.equal(evaluate('linux', 'x64'), 1)
  assert.match(parent, /test.describe\([^\n]+\{ concurrency: surfaceConcurrency \}/)
  assert.doesNotMatch(restart, /concurrency/)
})
