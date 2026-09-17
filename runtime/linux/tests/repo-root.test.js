const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { findRepositoryRoot } = require('./helpers/repo-root')

function makeTree(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-deskos-repo-root-'))
  for (const file of layout) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, '', 'utf8')
  }
  return root
}

test('resolves a development checkout root from a nested start', () => {
  const root = makeTree([
    'runtime/linux/package.json',
    'runtime/linux/tests/helpers/repo-root.js',
    'peripherals/esp32-p4-camera/README.md',
  ])
  try {
    const start = path.join(root, 'runtime', 'linux', 'tests', 'helpers')
    assert.equal(findRepositoryRoot(start), root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('resolves a sealed device release root from its tests directory', () => {
  const root = makeTree([
    'package.json',
    'scripts/cm5-install.sh',
    'tests/p4-camera-uvc.test.js',
    'peripherals/esp32-p4-camera/tests/features/p4-camera.feature',
    'runtime/linux/scripts/p4-camera-acceptance.sh',
  ])
  try {
    const start = path.join(root, 'tests')
    assert.equal(findRepositoryRoot(start), root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('fails closed instead of resolving an ambient directory without sealed sources', () => {
  const root = makeTree(['package.json', 'scripts/cm5-install.sh'])
  try {
    assert.throws(() => findRepositoryRoot(path.join(root, 'tests')), /repository root not found/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
