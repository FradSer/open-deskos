'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')

for (const mode of ['development', 'native']) test(`${mode} Camera browser replacement preserves decoded frames, themes, and built-in recovery without navigation`, { timeout: 60000 }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-camera-surface-'))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(profile, 'config'),
    XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state'),
    ODK_CAMERA_SURFACE_PROFILE: profile, ODK_CAMERA_SURFACE_NATIVE: mode === 'native' ? '1' : '0' }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const directory = path.join(profile, 'surface')
    await fs.cp(path.join(__dirname, 'fixtures/camera-surface-replacement'), directory, { recursive: true })
    if (mode === 'native') {
      const native = await require('./helpers/camera-surface-selection').prepare(profile, env, directory, { signal: t.signal })
      env.ODK_NATIVE_KEYRING = native.keyring
    } else await runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'),
      'link', directory, '--trust', '--replace'], { env, signal: t.signal, timeout: 10000 })
    const result = await runCommand(require('electron'), [`--user-data-dir=${profile}`, '--force-device-scale-factor=1',
      path.join(__dirname, 'camera-surface-electron.cjs')], { env, signal: t.signal, timeout: 50000, maxBuffer: 1024 * 1024 })
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
      actualPreload: true, developmentLoaded: mode === 'development',
      ...(mode === 'native' ? { signedSurface: true, capturedIntegrity: true, assetLeaseReleased: true } : {}), documentLoads: 1, themes: 3, sizes: 3,
      states: 4, comparisons: 72, decodedRegions: true, restored: true, discoveryReleased: true, selectedServiceOnRemount: true,
      density: { themes: 3, viewports: 5, states: 2, measurements: 90, comparisons: 60, violations: 0 },
    })
  } finally { await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
