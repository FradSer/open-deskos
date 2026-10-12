'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const execFile = require('node:util').promisify(require('node:child_process').execFile)

test('default and signed independent Quota preserve the actual Electron page consumer', { timeout: 60000 }, async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-quota-render-'))
  const env = { ...process.env, ODK_QUOTA_PLUGIN_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    await fs.access(path.join(__dirname, 'quota-plugin-electron.cjs'))
    const result = await execFile(require('electron'), [`--user-data-dir=${profile}`,
      path.join(__dirname, 'quota-plugin-electron.cjs')], { env, timeout: 55000 })
    const report = JSON.parse(result.stdout.trim().split('\n').pop())
    assert.deepEqual(report, { ok: true, actualPreload: true, signedIndependent: true, themes: 3, sizes: 2 })
  } finally { await fs.rm(profile, { recursive: true, force: true }) }
})
