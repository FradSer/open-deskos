'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { runCommand, fixtureRejection } = require('./helpers/hydra-wire-lifecycle')
const { clockMainTimeouts } = require('./helpers/clock-main-timeouts')
const { posixOnlyReason } = require('./not-ported')
const { resolveShellHost } = require('../src/platform')

for (const { mode, control } of [
  ...['built-in', 'signed', 'missing-tick'].map(mode => ({ mode, control: 'default' })),
  ...['built-in', 'signed'].map(mode => ({ mode, control: 'selected' })),
  { mode: 'built-in', control: 'missing' },
  { mode: 'built-in', control: 'bridge' },
  { mode: 'built-in', control: 'missing-bridge' },
  { mode: 'calendar', control: 'default' },
]) {
  test(control === 'missing-bridge' ? 'production Clock refuses a missing selected Renderer control bridge'
    : control === 'missing' ? 'production Clock refuses a missing selected Renderer control channel'
    : mode === 'missing-tick' ? 'production Clock refuses a signed candidate without Tick ownership'
    : `production Clock ${mode} startup with ${control} control preserves authenticated replacement and recovery`,
    { timeout: clockMainTimeouts(mode).test, skip: posixOnlyReason('isolated-native-activation') }, async t => {
      const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-clock-main-'))
      const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
        XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
        XDG_RUNTIME_DIR: path.join(root, 'runtime'), ODK_WORKSPACE: path.join(root, 'workspace'),
        ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280', ODK_DISABLE_GPU: '1',
        ODK_DISABLED_PLUGINS: '', ODK_CLOCK_MAIN_ROOT: root, ODK_CLOCK_MAIN_MODE: mode, ODK_CLOCK_MAIN_CONTROL: control }
      delete env.ELECTRON_RUN_AS_NODE
      try {
        await fs.mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 })
        const keys = crypto.generateKeyPairSync('ed25519')
        const localSurfaces = mode === 'calendar'
          ? [...require('./helpers/calendar-surfaces'), ...require('./helpers/desk-tool-surfaces'), { file: 'preorder', id: 'odk.tile.preorder' }] : []
        const keyring = path.join(root, 'publishers.json')
        env.ODK_NATIVE_KEYRING = keyring
        await fs.writeFile(keyring, JSON.stringify({ schemaVersion: 1, publishers: { clock: {
          publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: ['odk.tile.clock', ...localSurfaces.map(spec => spec.id)], hosts: ['electron-renderer'],
        } } }))
        const bundles = [
          ...['2.0.0', '3.0.0'].map(version => ({ version, file: 'clock', id: 'odk.tile.clock', directory: `bundle-${version}` })),
          ...localSurfaces.map(spec => ({ ...spec, version: '2.0.0', directory: `${spec.file}-2.0.0` })),
        ]
        for (const bundle of bundles) {
          const { version, file } = bundle
          const directory = path.join(root, bundle.directory)
          await fs.cp(path.join(__dirname, `fixtures/${file}-surface-replacement`), directory, { recursive: true })
          const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json')))
          manifest.version = version
          await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
          let entry = (await fs.readFile(path.join(directory, 'entry.js'), 'utf8')).replace("version: '2.0.0'", `version: '${version}'`)
          if (mode === 'missing-tick') {
            assert.ok(entry.includes('context.onTick(date => {'))
            entry = entry.replace('context.onTick(date => {', 'void (date => {')
          }
          if (file === 'clock') {
            entry += `\nwindow.clockExecutedRevision=${JSON.stringify(version)};\n`
            entry += "if ((window.odkPlugins.get('odk.tile.clock').manifest.version || '1.0.0') === '1.0.0') window.odkPlugins.get('odk.tile.clock').lifecycle.mount = () => { throw Error('Default Clock delegation refused') };\n"
          } else entry += `\nwindow.localExecutedVersions||={};window.localExecutedVersions[${JSON.stringify(bundle.id)}]=${JSON.stringify(version)};\n`
          await fs.writeFile(path.join(directory, 'entry.js'), entry)
          const files = []
          for (const name of ['entry.js', 'manifest.json']) files.push({ path: name,
            sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex') })
          const payload = { schemaVersion: 1, keyId: 'clock', replace: true, files }
          const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
          await fs.writeFile(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload, signature }))
        }
        for (const bundle of bundles.filter(bundle => bundle.version === '2.0.0')) {
          const installed = JSON.parse((await runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'),
            'native', 'install', path.join(root, bundle.directory), '--keyring', keyring, '--trust'],
          { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal: t.signal, timeout: 10000 })).stdout)
          assert.equal(installed.effect, 'selection-only')
        }
        if (control === 'selected') {
          const factory = require('./fixtures/renderer-control-replacement').independentRendererControl
          const plugin = factory()
          const directory = path.join(root, 'control')
          await fs.mkdir(directory)
          await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ ...plugin.manifest, entry: 'entry.cjs' }))
          await fs.writeFile(path.join(directory, 'entry.cjs'), `
const {createRendererManagement}=require(${JSON.stringify(path.resolve(__dirname, '../src/renderer-management'))});
const {listenOdkData}=require(${JSON.stringify(path.resolve(__dirname, '../src/odk-data-control'))});
exports.create=(${factory.toString()})().create;
globalThis.clockSelectedControlEntry=true;
`)
          await runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'link', directory, '--trust', '--replace',
            ...plugin.manifest.permissions.flatMap(permission => ['--grant', permission])], { env, signal: t.signal, timeout: 10000 })
        }
        const launch = runCommand(require('electron'), [`--user-data-dir=${path.join(root, 'profile')}`, '--force-device-scale-factor=1',
          path.join(__dirname, 'clock-main-bootstrap.cjs')], { env, signal: t.signal, timeout: clockMainTimeouts(mode).child, maxBuffer: 1024 * 1024 })
        if (control === 'missing-bridge') await assert.rejects(launch, error => fixtureRejection(error, /Selected Renderer bridge missing/))
        else if (control === 'missing') await assert.rejects(launch, error => fixtureRejection(error, /Selected Renderer control missing/))
        else if (mode === 'missing-tick') await assert.rejects(launch, error => fixtureRejection(error, /Clock Tick subscription changed/))
        else {
          const report = JSON.parse((await launch).stdout.trim().split('\n').pop())
          assert.equal(report.productionMain, true)
          assert.equal(report.mode, mode)
          assert.equal(report.controlVersion, control === 'selected' ? '2.0.0' : '1.0.0')
          assert.equal(report.documentLoads, 1)
          assert.equal(report.primingLoads, 1)
          assert.equal(report.mainPlugins, require('../src/plugins/main-composition').createMainPlugins().length)
          assert.equal(report.themeComparisons, 12)
          assert.equal(report.tickTransitions, 8)
          assert.deepEqual(report.versions, ['2.0.0', '1.0.0', '2.0.0', '3.0.0'])
          assert.equal(report.subscriptionsReleased, true)
          assert.equal(report.handlersReleased, true)
          assert.equal(report.protocolReleased, true)
          if (control === 'bridge') assert.deepEqual(report.bridgeControlSelection,
            { version: '2.0.0', lifecycleReceipts: 2, subscriptionReleased: true })
          if (mode === 'calendar') {
            assert.deepEqual(report.calendar, { identities: require('./helpers/calendar-surfaces').map(spec => spec.id), phases: 3, dateTransitions: 12 })
            assert.deepEqual(report.deskTools, { identities: require('./helpers/desk-tool-surfaces').map(spec => spec.id), phases: 3 })
            assert.deepEqual(report.preorder, { phases: 3, countdownTransitions: 6, canvasPixels: true, softwareRaster: true })
          }
        }
        const host = resolveShellHost({ env })
        for (const channel of ['plugin-control', 'renderer-plugin-control', 'plugin-diagnostics', 'user-app-control', 'odk-data']) {
          await assert.rejects(fs.stat(host.endpoint(channel)), { code: 'ENOENT' })
        }
      } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
    })
}
