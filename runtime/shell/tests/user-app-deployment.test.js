const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { findRepositoryRoot } = require('./helpers/repo-root')

test('Shell and resident Agent load the same system workspace environment', () => {
  const installer = fs.readFileSync('scripts/cm5-install.sh', 'utf8')
  const voice = fs.readFileSync(path.join(findRepositoryRoot(__dirname), 'integrations', 'personal-agent', 'systemd', 'odk-personal-agent.service'), 'utf8')
  assert.ok(installer.includes('EnvironmentFile=-%h/.config/odk/runtime.env'))
  assert.ok(voice.includes('EnvironmentFile=-%h/.config/odk/runtime.env'))
  assert.ok(voice.includes('EnvironmentFile=-%h/.config/odk/perosnal-agent.env'))
})
