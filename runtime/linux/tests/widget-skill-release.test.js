const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const runtime = path.resolve(__dirname, '..')
const sourceRoot = fs.existsSync(path.join(runtime, 'release.json'))
  ? runtime
  : path.resolve(runtime, '..', '..')

test('packaged Widget skill checks pass without a repository-level skill tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-skill-release-'))
  try {
    const release = path.join(root, 'releases', 'candidate')
    fs.mkdirSync(path.join(release, 'tests', 'features'), { recursive: true })
    fs.writeFileSync(path.join(release, 'release.json'), JSON.stringify({ id: 'candidate', schemaVersion: 1 }))
    fs.cpSync(path.join(sourceRoot, '.agents', 'skills', 'open-deskos-widget'),
      path.join(release, '.agents', 'skills', 'open-deskos-widget'), { recursive: true })
    fs.copyFileSync(path.join(__dirname, 'open-deskos-widget-skill.test.js'),
      path.join(release, 'tests', 'open-deskos-widget-skill.test.js'))
    fs.copyFileSync(path.join(__dirname, 'features', 'open-deskos-widget-skill.feature'),
      path.join(release, 'tests', 'features', 'open-deskos-widget-skill.feature'))
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, ['--test', 'tests/open-deskos-widget-skill.test.js'], {
      cwd: release, env, encoding: 'utf8', timeout: 30000,
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
