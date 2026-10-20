'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const execute = require('node:util').promisify(require('node:child_process').execFile)
const { runCommand } = require('./helpers/hydra-wire-lifecycle')

const cm5 = process.platform === 'linux' && process.arch === 'arm64'

for (const mode of ['development', 'native', 'runtime-development', 'runtime-native', 'runtime-development-scale-override']) test(`${mode} trusted independent Hydra surface preserves actual preload and rendered consumers`, { timeout: cm5 ? 180000 : 90000 }, async t => {
  const runtime = mode.startsWith('runtime-')
  const native = mode.endsWith('native')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-hydra-surface-'))
  const env = { ...process.env, ODK_HYDRA_SURFACE_PROFILE: root, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'), ODK_HYDRA_SURFACE_NATIVE: native ? '1' : '0', ODK_HYDRA_SURFACE_RUNTIME: runtime ? '1' : '0' }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    await fs.access(path.join(__dirname, 'hydra-surface-electron.cjs'))
    const directory = path.join(root, 'selection')
    await fs.cp(path.join(__dirname, 'fixtures/hydra-surface-replacement'), directory, { recursive: true })
    await fs.appendFile(path.join(directory, 'entry.js'), "\nwindow.odkPlugins.get('odk.tile.hydra').lifecycle.mount = () => { throw Error('Default Hydra mount refused in independent surface acceptance') }\n")
    if (native) {
      const prepared = await require('./helpers/hydra-surface-selection').prepare(root, env, directory, { signal: t.signal })
      env.ODK_NATIVE_KEYRING = prepared.keyring
    } else await runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'link', directory, '--trust', '--replace'],
      { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal: t.signal, timeout: 10000 })
    const operation = execute(require('electron'), [`--user-data-dir=${root}`,
      ...(mode === 'runtime-development-scale-override' ? ['--force-device-scale-factor=2'] : []),
      '--force-device-scale-factor=1', path.join(__dirname, 'hydra-surface-electron.cjs')],
      { env, signal: t.signal, timeout: cm5 ? 160000 : 80000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
    const closed = new Promise(resolve => operation.child.once('close', resolve))
    try {
      const result = await operation
      const report = JSON.parse(result.stdout.trim().split('\n').pop())
      assert.equal(report.pid, operation.child.pid)
      assert.deepEqual({ ...report, pid: undefined }, { ok: true, actualPreload: true, developmentLoaded: !native,
        ...(native ? { signedSurface: true, capturedSurfaceIntegrity: true, assetLeaseReleased: true } : {}),
        independentSurface: true, themes: 3, cells: 12, states: 8, comparisons: runtime ? 576 : 288, discoveryReleased: true,
        ...(runtime ? { runtimeSurface: true, documentLoads: 1, restoredDefault: true, retainedDesktop: true, defaultDelegationRefused: true } : {}), pid: undefined })
    } finally { await closed }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
