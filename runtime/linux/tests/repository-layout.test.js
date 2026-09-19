const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..')
const FEATURE = path.join(__dirname, 'features', 'repository-layout.feature')
const GIT_AGENT_CONFIG = path.join(REPOSITORY_ROOT, '.git-agent', 'config.yml')
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

if (!exists('.git')) {
  test('deployed runtime does not require repository topology metadata', () => {
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'package.json')), true)
    assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', 'main.js')), true)
  })
} else {
  test('separates the active CM5 runtime, required peripherals, experiments, and preserved P4+C6 research', () => {
    for (const directory of [
      'runtime/linux',
      'peripherals/esp32-s3-remote',
      'peripherals/esp32-p4-camera',
      'integrations/remote-bridge',
      'experiments/cm5-s31-gateway',
      'research/esp32-p4-c6-deskos/firmware',
      'research/esp32-p4-c6-deskos/apple',
      'research/esp32-p4-c6-deskos/docs',
    ]) {
      assert.ok(exists(directory), `missing ${directory}`)
    }
    for (const legacyPath of OBSOLETE_PATHS) {
      assert.equal(exists(legacyPath), false, `obsolete path remains: ${legacyPath}`)
    }
  })

  test('git-agent uses concise scopes aligned with the current topology', () => {
    const config = fs.readFileSync(GIT_AGENT_CONFIG, 'utf8')
    const names = [...config.matchAll(/^    - name: (.+)$/gm)].map((match) => match[1])
    assert.match(fs.readFileSync(FEATURE, 'utf8'), /uses concise scopes for CM5, hardware, link, vision, S31, P4, and Mac work/)
    assert.deepEqual(names, ['cm5', 'hw', 'link', 'vision', 's31', 'p4', 'mac'])
    assert.doesNotMatch(config, /^    - name: (?:app|firmware|experiments)$/m)
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
}

// Test harnesses run on the desk the operator is using, so none of them may
// activate a window. A guard here is what keeps the boundary once the harnesses
// themselves are hidden: a bash-level rule matches command text and cannot see
// a harness flipping `show` back on.
test('no test harness activates a window', () => {
  const harnesses = fs.readdirSync(__dirname).filter((name) => name.endsWith('.cjs'))
  assert.ok(harnesses.length > 0, 'expected Electron harnesses in tests/')
  const visible = []
  for (const name of harnesses) {
    const source = fs.readFileSync(path.join(__dirname, name), 'utf8')
    for (const match of source.matchAll(/new BrowserWindow\(\{([\s\S]*?)\}\)/g)) {
      const options = match[1]
      if (!/(^|[,\s])show:\s*false/.test(options)) {
        visible.push(`${name}: ${options.split('\n')[0].trim().slice(0, 60)}`)
      }
    }
  }
  assert.deepEqual(visible, [], `these harnesses could activate a window: ${visible.join(' | ')}`)
})
