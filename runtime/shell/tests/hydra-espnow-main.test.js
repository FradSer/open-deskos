'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { isolatedElectronArgs } = require('./helpers/electron-fixture')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const { posixOnlyReason } = require('./not-ported')

test('actual Main Hydra uses one Bridge for telemetry and confirmed synthetic HDC1 control through real preload', {
  timeout: 60000, skip: posixOnlyReason('unix-socket'),
}, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'odk-hydra-radio-')))
  const runtime = await fs.realpath(await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-hr-')))
  const profile = path.join(root, 'profile')
  const enabled = new Set(['odk.transport.remote-link', 'odk.source.device-gateway', 'odk.source.hydra',
    'odk.system.renderer-development', 'odk.system.app-manager'])
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), XDG_RUNTIME_DIR: runtime,
    ODK_HYDRA_RADIO_PROFILE: profile, ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280',
    ODK_HYDRA_MQTT_URL: 'mqtts://legacy.invalid:8883',
    ODK_DISABLED_PLUGINS: createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ODK_SHELL_TEST_MODE
  delete env.ODK_REMOTE_BRIDGE_SOCKET
  try {
    await fs.mkdir(profile, { recursive: true, mode: 0o700 })
    const result = await runCommand(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, path.join(__dirname, 'hydra-espnow-main.cjs')]),
      { env, signal: t.signal, timeout: 50000, maxBuffer: 1024 * 1024 })
    // runCommand resolves only after successful exit and child close; stdout alone is insufficient.
    const report = JSON.parse(result.stdout.trim().split('\n').pop())
    assert.equal(report.result, 'CHECKS_PASSED')
    assert.equal(report.rendererLifecycleReleased, true)
    assert.equal(report.productionMain, true)
    assert.equal(report.actualPreload, true)
    assert.equal(report.sharedBridge, true)
    assert.equal(report.physicalDevice, false)
    assert.equal(report.mqttConstructed, 0)
    assert.equal(report.widget, true)
    assert.equal(report.app, true)
    assert.equal(report.released, true)
    assert.equal(report.syntheticControl, true)
    assert.equal(report.waterCommands, 1)
    assert.equal(report.planCommands, 1)
    assert.equal(report.positiveHeartbeat, true)
    assert.equal(report.planSequenceReserved, true)
    assert.equal(report.leafInstallationHistory, true)
    assert.equal(report.opaquePlatformAbsent, true)
    assert.equal(report.usbFallback, false)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
    await fs.rm(runtime, { recursive: true, force: true })
  }
})
