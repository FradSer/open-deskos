const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..')
const FEATURE = path.join(__dirname, 'features', 'repository-layout.feature')
const OBSOLETE_PATHS = ['firmware/linux', 'firmware/open-deskos', 'app/apple', 'docs/open-deskos']

function exists(relativePath) {
  return fs.existsSync(path.join(REPOSITORY_ROOT, relativePath))
}

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(entryPath)
    return entry.name.endsWith('.md') ? [entryPath] : []
  })
}

test('separates the active CM5 runtime, required peripherals, experiments, and preserved P4+C6 research', () => {
  for (const directory of [
    'runtime/linux',
    'peripherals/esp32-s3-remote',
    'peripherals/esp32-p4-camera',
    'integrations/remote-bridge',
    'experiments/vision/face-agent',
    'research/esp32-p4-c6-deskos/firmware',
    'research/esp32-p4-c6-deskos/apple',
    'research/esp32-p4-c6-deskos/docs',
    'research/esp32-p4-c6-deskos/apple',
  ]) {
    assert.ok(exists(directory), `missing ${directory}`)
  }

  for (const legacyPath of OBSOLETE_PATHS) {
    assert.equal(exists(legacyPath), false, `obsolete path remains: ${legacyPath}`)
  }
})

test('active product documentation does not direct contributors to obsolete paths', () => {
  assert.match(fs.readFileSync(FEATURE, 'utf8'), /does not direct the contributor to firmware\/linux/)
  const files = [
    path.join(REPOSITORY_ROOT, 'README.md'),
    path.join(REPOSITORY_ROOT, 'README.zh-CN.md'),
    path.join(REPOSITORY_ROOT, 'PRODUCT.md'),
    path.join(REPOSITORY_ROOT, 'DESIGN.md'),
    path.join(REPOSITORY_ROOT, 'AGENTS.md'),
    ...markdownFiles(path.join(REPOSITORY_ROOT, 'runtime')),
    ...markdownFiles(path.join(REPOSITORY_ROOT, 'peripherals')),
    ...markdownFiles(path.join(REPOSITORY_ROOT, 'integrations')),
    ...markdownFiles(path.join(REPOSITORY_ROOT, 'experiments')),
  ]
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8')
    for (const obsoletePath of OBSOLETE_PATHS) {
      assert.equal(content.includes(obsoletePath), false, `${path.relative(REPOSITORY_ROOT, file)} references ${obsoletePath}`)
    }
  }
})
