'use strict'
const { isolatedElectronArgs } = require('./helpers/electron-fixture')

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const { posixOnlyReason } = require('./not-ported')
const { resolveShellHost } = require('../src/platform')

for (const mode of ['built-in', 'signed', 'missing-briefing']) {
  test(mode === 'missing-briefing' ? 'production Dashboard refuses a signed candidate without briefing ownership'
    : `production Dashboard ${mode} startup preserves authenticated replacement and recovery`,
    { timeout: 60000, skip: posixOnlyReason('isolated-native-activation') }, async t => {
      const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-dashboard-main-'))
      const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
        XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
        XDG_RUNTIME_DIR: path.join(root, 'runtime'), ODK_WORKSPACE: path.join(root, 'workspace'),
        ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280', ODK_DISABLE_GPU: '1',
        ODK_DISABLED_PLUGINS: '', ODK_DASHBOARD_MAIN_ROOT: root, ODK_DASHBOARD_MAIN_MODE: mode }
      delete env.ELECTRON_RUN_AS_NODE
      try {
        await fs.mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 })
        const keys = crypto.generateKeyPairSync('ed25519')
        const keyring = path.join(root, 'publishers.json')
        env.ODK_NATIVE_KEYRING = keyring
        await fs.writeFile(keyring, JSON.stringify({ schemaVersion: 1, publishers: { dashboard: {
          publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: ['odk.page.dashboard'], hosts: ['electron-renderer'],
        } } }))
        for (const version of ['2.0.0', '3.0.0']) {
          const directory = path.join(root, `bundle-${version}`)
          await fs.cp(path.join(__dirname, 'fixtures/dashboard-surface-replacement'), directory, { recursive: true })
          const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json')))
          manifest.version = version
          await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest))
          let entry = (await fs.readFile(path.join(directory, 'entry.js'), 'utf8')).replace("version: '2.0.0'", `version: '${version}'`)
          if (mode === 'missing-briefing') {
            assert.ok(entry.includes('context.trackCleanup(context.homeBriefing.subscribe(update))'))
            entry = entry.replace('context.trackCleanup(context.homeBriefing.subscribe(update))', 'context.trackCleanup(void update)')
          }
          entry += `\nwindow.dashboardExecutedRevision=${JSON.stringify(version)};\n`
          entry += "if ((window.odkPlugins.get('odk.page.dashboard').manifest.version || '1.0.0') === '1.0.0') window.odkPlugins.get('odk.page.dashboard').lifecycle.mount = () => { throw Error('Default Dashboard delegation refused') };\n"
          await fs.writeFile(path.join(directory, 'entry.js'), entry)
          const files = []
          for (const name of ['entry.js', 'manifest.json']) files.push({ path: name,
            sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex') })
          const payload = { schemaVersion: 1, keyId: 'dashboard', replace: true, files }
          const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
          await fs.writeFile(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload, signature }))
        }
        const installed = JSON.parse((await runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'),
          'native', 'install', path.join(root, 'bundle-2.0.0'), '--keyring', keyring, '--trust'],
        { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal: t.signal, timeout: 10000 })).stdout)
        assert.equal(installed.effect, 'selection-only')
        const launch = runCommand(require('electron'), isolatedElectronArgs([`--user-data-dir=${path.join(root, 'profile')}`, '--force-device-scale-factor=1',
          path.join(__dirname, 'dashboard-main-bootstrap.cjs')]), { env, signal: t.signal, timeout: 45000, maxBuffer: 1024 * 1024 })
        if (mode === 'missing-briefing') await assert.rejects(launch, /Dashboard briefing subscription changed/)
        else {
          const report = JSON.parse((await launch).stdout.trim().split('\n').pop())
          assert.equal(report.productionMain, true)
          assert.equal(report.mode, mode)
          assert.equal(report.documentLoads, 1)
          assert.equal(report.primingLoads, 1)
          assert.equal(report.mainPlugins, require('../src/plugins/main-composition').createMainPlugins().length)
          assert.equal(report.themeComparisons, 12)
          assert.equal(report.tickTransitions, 8)
          assert.equal(report.frameComparisons, 120)
          assert.deepEqual(report.versions, ['2.0.0', '1.0.0', '2.0.0', '3.0.0'])
          assert.equal(report.subscriptionsReleased, true)
          assert.equal(report.handlersReleased, true)
          assert.equal(report.protocolReleased, true)
        }
        const host = resolveShellHost({ env })
        for (const channel of ['plugin-control', 'renderer-plugin-control', 'plugin-diagnostics', 'user-app-control', 'odk-data']) {
          await assert.rejects(fs.stat(host.endpoint(channel)), { code: 'ENOENT' })
        }
      } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
    })
}
