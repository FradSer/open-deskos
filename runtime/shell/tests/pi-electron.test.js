'use strict'
const { isolatedElectronArgs } = require('./helpers/electron-fixture')

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { viewTimeouts } = require('./helpers/pi-view-selection')
const timeouts = viewTimeouts()
const execFile = require('node:util').promisify(require('node:child_process').execFile)

test('default and signed independent Pi sources preserve actual rendered consumers', { timeout: timeouts.test }, async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-pi-render-'))
  const env = { ...process.env, ODK_PI_FIXTURE_PROFILE: profile }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const file = path.join(__dirname, 'pi-plugin-electron.cjs')
    await fs.access(file)
    const result = await execFile(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, file, profile]), { env, timeout: timeouts.child })
    const report = JSON.parse(result.stdout.trim().split('\n').pop())
    assert.deepEqual(report, { ok: true, actualPreload: true, signedIndependent: true, themes: 3, sizes: 2, isolatedPageMounts: 12, isolatedAppMounts: 12, actualAppManager: true })
  } finally { await fs.rm(profile, { recursive: true, force: true }) }
})

test('Pi App isolation check rejects delegation to the selected page', { timeout: timeouts.guardTest }, async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-pi-isolation-'))
  const env = { ...process.env, ODK_PI_FIXTURE_PROFILE: profile, ODK_PI_APP_DELEGATES_PAGE: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    await assert.rejects(execFile(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, path.join(__dirname, 'pi-plugin-electron.cjs'), profile]),
      { env, timeout: timeouts.guardChild }), error => {
      assert.equal(error.code, 1)
      assert.equal(error.signal, null)
      assert.equal(error.killed, false)
      assert.match(error.stderr, /Pi App must open independently of the selected page/)
      return true
    })
  } finally { await fs.rm(profile, { recursive: true, force: true }) }
})

test('captured Pi App and Page startup factories preserve actual rendered consumers', { timeout: timeouts.test }, async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-pi-captured-'))
  const env = { ...process.env, ODK_PI_FIXTURE_PROFILE: profile, ODK_PI_CAPTURED_VIEWS: '1', ODK_PI_RELEASED_VIEWS: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const result = await execFile(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, path.join(__dirname, 'pi-plugin-electron.cjs')]),
      { env, timeout: timeouts.child })
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
      ok: true, actualPreload: true, signedIndependent: true, themes: 3, sizes: 2,
      isolatedPageMounts: 12, isolatedAppMounts: 12, actualAppManager: true, capturedAppPage: true, releasedViewChecks: 24, delayedViewChecks: 48, failedReleaseChecks: 24,
    })
  } finally { await fs.rm(profile, { recursive: true, force: true }) }
})

test('Pi captured factory guard rejects fallback to the packaged Page', { timeout: timeouts.guardTest }, async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-pi-capture-guard-'))
  const env = { ...process.env, ODK_PI_FIXTURE_PROFILE: profile, ODK_PI_CAPTURED_VIEWS: '1', ODK_PI_CAPTURED_VIEWS_DEFAULT: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    await assert.rejects(execFile(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, path.join(__dirname, 'pi-plugin-electron.cjs')]),
      { env, timeout: timeouts.guardChild }), error => {
      assert.equal(error.code, 1)
      assert.equal(error.signal, null)
      assert.equal(error.killed, false)
      assert.match(error.stderr, /Captured Pi views must not call packaged mounts/)
      assert.match(error.stderr, /PI_CAPTURED_GUARD_PHASE:signed/)
      assert.doesNotMatch(error.stderr, /PI_CAPTURED_GUARD_PHASE:default/)
      return true
    })
  } finally { await fs.rm(profile, { recursive: true, force: true }) }
})

for (const mode of ['development', 'native']) {
  test(`trusted external Pi App and Page entries preserve actual rendered consumers (${mode})`, { timeout: timeouts.test }, async () => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-pi-external-'))
    const env = { ...process.env, ODK_PI_FIXTURE_PROFILE: profile, ODK_PI_EXTERNAL_VIEWS: mode, ODK_PI_RELEASED_VIEWS: '1' }
    delete env.ELECTRON_RUN_AS_NODE
    try {
      const result = await execFile(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, path.join(__dirname, 'pi-plugin-electron.cjs')]),
        { env, timeout: timeouts.child })
      assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
        ok: true, actualPreload: true, signedIndependent: true, themes: 3, sizes: 2,
        isolatedPageMounts: 12, isolatedAppMounts: 12, actualAppManager: true, capturedAppPage: true,
        externalAppPage: mode, releasedViewChecks: 24, delayedViewChecks: 48, failedReleaseChecks: 24,
      })
    } finally { await fs.rm(profile, { recursive: true, force: true }) }
  })

  test(`external Pi entry guard rejects a script that omits its Page definition (${mode})`, { timeout: timeouts.externalGuardTest }, async () => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-pi-external-guard-'))
    const env = { ...process.env, ODK_PI_FIXTURE_PROFILE: profile, ODK_PI_EXTERNAL_VIEWS: mode, ODK_PI_EXTERNAL_MISSING_PAGE: '1' }
    delete env.ELECTRON_RUN_AS_NODE
    try {
      await assert.rejects(execFile(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, path.join(__dirname, 'pi-plugin-electron.cjs')]),
        { env, timeout: timeouts.externalGuardChild }), error => {
        assert.equal(error.code, 1)
        assert.equal(error.signal, null)
        assert.equal(error.killed, false)
        assert.match(error.stderr, /Captured Pi views must not call packaged mounts/)
        assert.match(error.stderr, /PI_EXTERNAL_GUARD_PHASE:signed/)
        assert.doesNotMatch(error.stderr, /PI_EXTERNAL_GUARD_PHASE:default/)
        return true
      })
    } finally { await fs.rm(profile, { recursive: true, force: true }) }
  })
}
