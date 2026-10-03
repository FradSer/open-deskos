const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { main, readConfig, resolveConfigPath, validateManifest } = require('../scripts/open-deskos-plugin-cli')

test('CLI validate checks manifest schema version 1', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cli-test-'))
  const validPath = path.join(tmpDir, 'manifest.json')
  fs.writeFileSync(validPath, JSON.stringify({
    schemaVersion: 1,
    id: 'odk.test.plugin',
    kind: 'service',
  }))

  const manifest = validateManifest(validPath)
  assert.equal(manifest.id, 'odk.test.plugin')

  const invalidPath = path.join(tmpDir, 'invalid.json')
  fs.writeFileSync(invalidPath, JSON.stringify({ schemaVersion: 2, id: 'test' }))
  assert.throws(() => validateManifest(invalidPath), /schemaVersion must be 1/)
})

test('CLI enables and disables plugins in config', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-cli-cfg-'))
  process.env.OPEN_DESKOS_CONFIG_DIR = tmpDir

  assert.equal(main(['enable', 'odk.test.clock']), 0)
  const config1 = readConfig(resolveConfigPath())
  assert.equal(config1.plugins['odk.test.clock'].enabled, true)

  assert.equal(main(['disable', 'odk.test.clock']), 0)
  const config2 = readConfig(resolveConfigPath())
  assert.equal(config2.plugins['odk.test.clock'].enabled, false)
})
