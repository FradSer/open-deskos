'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { surfaceTimeouts } = require('./helpers/weather-selection')
const { prepare } = require('./helpers/weather-surface-selection')
const { install: prepareSource } = require('./helpers/weather-selection')
const run = require('node:util').promisify(require('node:child_process').execFile)

for (const mode of ['development', 'native']) test(`${mode} independent Weather surface loads through trusted discovery and preserves rendered source consumers`, { timeout: surfaceTimeouts().test }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weather-surface-render-'))
  const env = { ...process.env, ODK_WEATHER_FIXTURE_PROFILE: profile, ODK_WEATHER_SURFACE_REPLACEMENT: '1', ODK_WEATHER_SURFACE_NATIVE: mode === 'native' ? '1' : '0' }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    Object.assign(env, { ODK_CONFIG_DIR: path.join(profile, 'config'), XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state') })
    await prepareSource(profile, env, { signal: t.signal })
    const directory = path.join(profile, 'surface-selection')
    await fs.cp(path.join(__dirname, 'fixtures/weather-surface-replacement'), directory, { recursive: true })
    await fs.appendFile(path.join(directory, 'entry.js'), "\nwindow.odkPlugins.get('odk.tile.weather').lifecycle.mount = () => { throw Error('Default Weather mount refused in independent surface acceptance') }\n")
    if (mode === 'native') {
      const prepared = await prepare(profile, env, directory, { signal: t.signal })
      env.ODK_WEATHER_SURFACE_KEYRING = prepared.keyring
    } else {
      await require('./helpers/hydra-wire-lifecycle').runCommand(process.execPath,
        [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'link', directory, '--trust', '--replace'],
        { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal: t.signal, timeout: 10000 })
    }
    const operation = run(require('electron'), [`--user-data-dir=${profile}`, path.join(__dirname, 'weather-plugin-electron.cjs')], {
      env, timeout: surfaceTimeouts().child, killSignal: 'SIGKILL', signal: t.signal, maxBuffer: 1024 * 1024,
    })
    const closed = new Promise(resolve => operation.child.once('close', resolve))
    try {
      const result = await operation
      assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
        ok: true, actualPreload: true, signedIndependent: true, themes: 3, sizes: 5, states: 6,
        independentSurface: true, developmentLoaded: mode === 'development',
        ...(mode === 'native' ? { signedSurface: true, capturedSurfaceIntegrity: true, assetLeaseReleased: true } : {}),
      })
    } finally { await closed }
  } finally { await fs.rm(profile, { recursive: true, force: true }) }
})
