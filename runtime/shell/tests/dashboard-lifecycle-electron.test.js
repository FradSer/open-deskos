'use strict'
const { isolatedElectronArgs } = require('./helpers/electron-fixture')

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')

test('Dashboard fences released callbacks in the actual Shell document', { timeout: 60000 }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-dashboard-lifecycle-'))
  const env = { ...process.env, ODK_DASHBOARD_LIFECYCLE_PROFILE: profile,
    ODK_CONFIG_DIR: path.join(profile, 'config'),
    XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state') }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const result = await runCommand(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`,
      path.join(__dirname, 'dashboard-lifecycle-electron.cjs')]),
    { env, signal: t.signal, timeout: 50000, maxBuffer: 1024 * 1024 })
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
      actualPreload: true, documentLoads: 1, scenarios: 2, selectedServices: 1, released: true,
    })
  } finally {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
