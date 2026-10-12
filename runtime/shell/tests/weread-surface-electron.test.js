'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { surfaceTimeouts } = require('./helpers/weread-selection')
const { install } = require('./helpers/weread-selection')
const { prepare } = require('./helpers/weread-surface-selection')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')

for (const mode of ['development', 'native']) test(`${mode} independent WeRead surface preserves actual preload rendered and decoded cover consumers`, { timeout: surfaceTimeouts().test }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weread-surface-'))
  const env = { ...process.env, ODK_WEREAD_FIXTURE_PROFILE: profile, ODK_WEREAD_SURFACE_REPLACEMENT: '1', ODK_WEREAD_SURFACE_NATIVE: mode === 'native' ? '1' : '0',
    OPEN_DESKOS_CONFIG_DIR: path.join(profile, 'config'), XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state') }
  try {
    await install(profile, env, { signal: t.signal })
    const directory = path.join(profile, 'surface')
    await fs.cp(path.join(__dirname, 'fixtures/weread-surface-replacement'), directory, { recursive: true })
    await fs.appendFile(path.join(directory, 'entry.js'), "\nwindow.odkPlugins.get('odk.tile.weread').lifecycle.mount = () => { throw Error('Default WeRead mount refused in independent surface acceptance') }\n")
    if (mode === 'native') {
      const native = await prepare(profile, env, directory, { signal: t.signal })
      env.ODK_WEREAD_SURFACE_KEYRING = native.keyring
    } else await runCommand(process.execPath, [path.resolve(__dirname, '../scripts/open-deskos-plugin-cli.js'), 'link', directory, '--trust', '--replace'],
      { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal: t.signal, timeout: 10000 })
    delete env.ELECTRON_RUN_AS_NODE
    const result = await runCommand(require('electron'), [`--user-data-dir=${profile}`, path.join(__dirname, 'weread-plugin-electron.cjs')],
      { env, signal: t.signal, timeout: surfaceTimeouts().child, maxBuffer: 1024 * 1024 })
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
      ok: true, actualPreload: true, signedIndependent: true, themes: 3, sizes: 5, decodedCovers: true,
      independentSurface: true, developmentLoaded: mode === 'development',
      ...(mode === 'native' ? { signedSurface: true, capturedSurfaceIntegrity: true, assetLeaseReleased: true } : {}),
    })
  } finally { await fs.rm(profile, { recursive: true, force: true }) }
})
