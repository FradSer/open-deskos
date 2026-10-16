'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { surfaceTimeouts } = require('./helpers/weread-selection')
const execFile = require('node:util').promisify(require('node:child_process').execFile)

test('default and signed independent WeRead preserve the actual rendered Widget', { timeout: surfaceTimeouts().test }, async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weread-render-'))
  const env = { ...process.env, ODK_WEREAD_FIXTURE_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const file = path.join(__dirname, 'weread-plugin-electron.cjs')
    await fs.access(file)
    const result = await execFile(require('electron'), [`--user-data-dir=${profile}`, file], { env, timeout: surfaceTimeouts().child })
    const report = JSON.parse(result.stdout.trim().split('\n').pop())
    assert.deepEqual(report, { ok: true, actualPreload: true, signedIndependent: true, themes: 3, sizes: 5, decodedCovers: true })
  } finally { await fs.rm(profile, { recursive: true, force: true }) }
})
