const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')

test('Shell and resident Agent load the same system workspace environment', () => {
  const installer = fs.readFileSync('scripts/cm5-install.sh', 'utf8')
  const voice = fs.readFileSync('../../integrations/voice-agent/systemd/open-deskos-voice-agent.service', 'utf8')
  assert.ok(installer.includes('EnvironmentFile=-%h/.config/open-deskos/runtime.env'))
  assert.ok(voice.includes('EnvironmentFile=-%h/.config/open-deskos/runtime.env'))
  assert.ok(voice.includes('EnvironmentFile=-%h/.config/open-deskos/voice-agent.env'))
})
