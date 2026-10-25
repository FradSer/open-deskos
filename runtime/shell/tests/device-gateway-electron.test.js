'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')

test('Devices shows gateway and S3 status through actual preload across themes and compact sizes', { timeout: 60000 }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-devices-ui-'))
  const env = { ...process.env, ODK_DEVICE_GATEWAY_TEST_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ODK_DEVICE_GATEWAY_TEST_SOCKET
  delete env.ODK_DEVICE_GATEWAY_TEST_RESULT
  try {
    const result = await runCommand(require('electron'), [`--user-data-dir=${profile}`, path.join(__dirname, 'device-gateway-electron.cjs')],
      { env, signal: t.signal, timeout: 50000, maxBuffer: 1024 * 1024 })
    const report = JSON.parse(result.stdout.trim().split('\n').pop())
    assert.equal(report.result, 'PASS')
    assert.equal(report.actualPreload, true)
    assert.equal(report.actualDevice, false)
    assert.equal(report.themeSizeChecks, 16)
  } finally { await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
