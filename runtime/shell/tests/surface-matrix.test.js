'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { MATRIX_ENV, REPRESENTATIVE, FULL, mode, representative, select } = require('./helpers/surface-matrix')
const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8')
const root = path.resolve(__dirname, '..')
const gate = path.join(root, 'scripts', 'test-matrix.cjs')
const revisions = ['hydra-surface-restart.test.js', 'weather-surface-restart.test.js', 'weread-surface-restart.test.js']
const fixtures = ['hydra-surface-electron.cjs', 'weather-plugin-electron.cjs', 'weread-plugin-electron.cjs']

const combinations = [['instrument', 619], ['pixel', 1103], ['border-beam', 480]]

test('the matrix helper keeps every combination by default', () => {
  assert.equal(representative({}), false)
  assert.deepEqual(select(combinations, {}), combinations)
})

test('the matrix helper selects one representative combination when requested', () => {
  const env = { [MATRIX_ENV]: REPRESENTATIVE }
  assert.equal(representative(env), true)
  assert.deepEqual(select(combinations, env), [['instrument', 619]])
})

test('the matrix helper leaves the source list unchanged', () => {
  const source = ['instrument', 'pixel', 'border-beam']
  const selected = select(source, { [MATRIX_ENV]: REPRESENTATIVE })
  assert.deepEqual(source, ['instrument', 'pixel', 'border-beam'])
  assert.equal(selected.length, 1)
  assert.notStrictEqual(selected, source)
})

test('the matrix helper handles an empty list', () => {
  assert.deepEqual(select([], {}), [])
  assert.deepEqual(select([], { [MATRIX_ENV]: REPRESENTATIVE }), [])
})

for (const file of fixtures) {
  test(`${file} selects its rendering matrix through the shared helper`, () => {
    const source = read(file)
    assert.match(source, /require\(['"]\.\/helpers\/surface-matrix['"]\)/)
    assert.match(source, /\bselect\(/)
  })
}

test('the matrix mode keeps the full matrix by default', () => {
  assert.equal(mode({}), FULL)
  assert.equal(mode({ [MATRIX_ENV]: FULL }), FULL)
  assert.equal(mode({ [MATRIX_ENV]: REPRESENTATIVE }), REPRESENTATIVE)
})

test('an explicit full matrix selects every combination', () => {
  assert.deepEqual(select(combinations, { [MATRIX_ENV]: FULL }), combinations)
})

test('revision acceptance forwards the requested matrix mode', () => {
  for (const file of revisions) assert.match(read(file), /process\.env\[MATRIX_ENV\] \|\| REPRESENTATIVE/, file)
})

test('revision acceptance restores the original counts for a full matrix', () => {
  assert.match(read('hydra-surface-restart.test.js'), /const comparisons = full \? 13 \* 3 \* 8 : 1/)
  assert.match(read('weather-surface-restart.test.js'), /'1920x1280', '1920x1080'/)
  assert.match(read('weread-surface-restart.test.js'), /full \? 15 : 1/)
})

test('the matrix gate lists six tests in full mode', () => {
  const listed = JSON.parse(execFileSync(process.execPath, [gate, '--list'], { cwd: root, encoding: 'utf8' }))
  assert.equal(listed.mode, FULL)
  assert.equal(listed.concurrency, 2)
  assert.equal(listed.files.length, 6)
  for (const file of [...revisions, 'hydra-surface-electron.test.js', 'weather-surface-electron.test.js', 'weread-surface-electron.test.js']) {
    assert.ok(listed.files.some(entry => entry.endsWith(file)), file)
  }
})

const workflowFile = path.join(root, '..', '..', '.github', 'workflows', 'nightly-matrix.yml')

function assertMatrixGate(scripts, io, file) {
  assert.match(scripts['test:matrix'], /node scripts\/test-matrix\.cjs/)
  assert.match(scripts.test, /--test-concurrency=2 tests\/\*\.test\.js/)
  if (!io.existsSync(file)) return
  const workflow = io.readFileSync(file, 'utf8')
  assert.match(workflow, /schedule:/)
  assert.match(workflow, /cron:/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /pnpm test:matrix/)
  assert.match(workflow, /pnpm styles/)
  assert.match(workflow, /find .*node_modules.*chrome-sandbox/)
  assert.match(workflow, /chmod 4755/)
  assert.match(workflow, /chown root/)
  assert.doesNotMatch(workflow, /--no-sandbox/)
}

test('the package and workflow run the matrix gate', () => {
  assertMatrixGate(require('../package.json').scripts, fs, workflowFile)
})

test('a sealed release keeps the matrix gate without repository-only files', () => {
  const releaseFs = { existsSync: () => false, readFileSync: () => { throw Error('sealed release must not read the workflow') } }
  assert.doesNotThrow(() => assertMatrixGate(require('../package.json').scripts, releaseFs, '/opt/odk/.github/workflows/nightly-matrix.yml'))
})
