const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { findRepositoryRoot } = require('./helpers/repo-root')
const { integrationPath, integrationURL } = require('./helpers/repo-root')

function makeTree(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-repo-root-'))
  for (const file of layout) {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, '', 'utf8')
  }
  return root
}

test('resolves a development checkout root from a nested start', () => {
  const root = makeTree([
    'runtime/shell/package.json',
    'runtime/shell/tests/helpers/repo-root.js',
    'peripherals/esp32-p4-camera/README.md',
  ])
  try {
    const start = path.join(root, 'runtime', 'shell', 'tests', 'helpers')
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
    'runtime/shell/scripts/p4-camera-acceptance.sh',
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

for (const sealed of [false, true]) test(`integration paths stay inside the ${sealed ? 'sealed release' : 'checkout'}`, () => {
  const root = makeTree([
    sealed ? 'scripts/cm5-install.sh' : 'runtime/shell/package.json',
    'peripherals/esp32-p4-camera/README.md',
    'integrations/personal-bot/src/service.mjs',
  ])
  try {
    const start = path.join(root, ...(sealed ? ['tests'] : ['runtime', 'shell', 'tests']))
    const expected = path.join(root, 'integrations', 'personal-bot', 'src', 'service.mjs')
    assert.equal(integrationPath('personal-bot/src/service.mjs', start), expected)
    assert.equal(integrationURL('personal-bot/src/service.mjs', start), require('node:url').pathToFileURL(expected).href)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
