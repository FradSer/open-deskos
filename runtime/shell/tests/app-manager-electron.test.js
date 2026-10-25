'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { runCommand, fixtureRejection } = require('./helpers/hydra-wire-lifecycle')
const { isolatedElectronArgs } = require('./helpers/electron-fixture')

for (const mode of ['signed', 'development']) for (const invalid of [false, true]) {
  test(`${mode} App Manager browser ${invalid ? 'rejects omitted rollback' : 'preserves navigation and recovery'}`, { timeout: 45000 }, async t => {
    const fixture = path.join(__dirname, 'app-manager-electron.cjs')
    assert.match(await fs.readFile(fixture, 'utf8'), /ODK_APP_MANAGER_PROFILE/, 'Browser fixture requires parent-owned isolation')
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-app-manager-browser-'))
    const env = { ...process.env, ODK_APP_MANAGER_PROFILE: root, ODK_APP_MANAGER_MODE: mode,
      ODK_APP_MANAGER_INVALID: invalid ? 'rollback' : '', ODK_CONFIG_DIR: path.join(root, 'config'),
      XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
    delete env.ELECTRON_RUN_AS_NODE
    try {
      const running = runCommand(require('electron'), isolatedElectronArgs([`--user-data-dir=${root}`, fixture]),
        { env, signal: t.signal, timeout: 35000, maxBuffer: 1024 * 1024 })
      if (invalid) await assert.rejects(running,
        error => fixtureRejection(error, /App Manager recovery did not restore prior running state/))
      else {
        const result = await running
        assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
          actualPreload: true, mode, independent: true, browserPointerBack: true, browserKeyboardEscape: true,
          focusRestored: true, mountFailureRollback: true, handlersReleasedBeforeWindow: true,
        })
      }
    } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })
}
