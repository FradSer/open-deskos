'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const execute = require('node:util').promisify(require('node:child_process').execFile)
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createAppearancePlugins } = require('../src/renderer/core/appearance-plugins')
const { posixOnlyReason } = require('./not-ported')
const { resolveShellHost } = require('../src/platform')
const appearanceChildTimeout = process.platform === 'linux' && process.arch === 'arm64' ? 100000 : 55000
const appearanceTestTimeout = process.platform === 'linux' && process.arch === 'arm64' ? 110000 : 65000

for (const { emptyStartup, rejectPackage } of [{ emptyStartup: false, rejectPackage: false },
  { emptyStartup: true, rejectPackage: false }, { emptyStartup: false, rejectPackage: true }]) {
  test(`production Main Appearance activation preserves installed App context (${emptyStartup ? 'empty' : 'signed'} startup${rejectPackage ? ', rejected package' : ''})`,
    { timeout: appearanceTestTimeout, skip: posixOnlyReason('isolated-native-activation') }, async t => {
      const fixture = path.join(__dirname, 'appearance-main-bootstrap.cjs')
      await fs.access(fixture)
      const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-am-'))
      const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
        LOCALAPPDATA: path.join(root, 'state'), XDG_RUNTIME_DIR: path.join(root, 'runtime'), ODK_WORKSPACE: path.join(root, 'workspace'),
        ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280', ODK_DISABLE_GPU: '1',
        ODK_APPEARANCE_PROFILE: path.join(root, 'profile'), ODK_APPEARANCE_EMPTY: emptyStartup ? '1' : '0',
        ODK_APPEARANCE_REJECT_PACKAGE: rejectPackage ? '1' : '0' }
      const enabled = new Set(['odk.system.renderer-development', 'odk.system.renderer-control', 'odk.system.package-catalog',
        'odk.system.user-apps', 'odk.system.data', 'odk.system.app-manager'])
      env.ODK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
      delete env.ELECTRON_RUN_AS_NODE
      try {
        await fs.mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 })
        const keys = crypto.generateKeyPairSync('ed25519')
        const original = createAppearancePlugins().find(plugin => plugin.manifest.id === 'odk.theme.pixel')
        env.ODK_NATIVE_KEYRING = path.join(root, 'publishers.json')
        await fs.writeFile(env.ODK_NATIVE_KEYRING, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
          publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }), identities: [original.manifest.id], hosts: [original.manifest.host],
        } } }))
        for (const version of ['2.0.0', '3.0.0']) {
          const bundle = path.join(root, version)
          await fs.mkdir(bundle)
          await fs.writeFile(path.join(bundle, 'manifest.json'), JSON.stringify({ ...original.manifest, version, entry: 'entry.js',
            appearance: { theme: 'pixel', name: 'Pixel', css: 'themes/pixel.css', tokens: {}, faces: ['zpix'], extra: 'image-rendering:pixelated;' } }))
          await fs.writeFile(path.join(bundle, 'entry.js'), `(() => {
            const appearance = ${JSON.stringify(original.appearance)};
            window.__appearanceExecutions = (window.__appearanceExecutions || 0) + 1;
            window.odkAppearanceNative.define({ id: 'odk.theme.pixel', appearance,
              create(ctx) {
                window.__appearanceTrace ||= [];
                window.__appearanceTrace.push('create:${version}');
                ctx.onCleanup(() => window.__appearanceTrace.push('cleanup:${version}'));
                return { ports: { 'odk:theme/pixel/v1': structuredClone(appearance) },
                  start() { window.__appearanceRunning = '${version}'; window.__appearanceTrace.push('start:${version}'); },
                  stop() { window.__appearanceTrace.push('stop:${version}'); },
                  destroy() { window.__appearanceTrace.push('destroy:${version}'); } };
              } });
          })();`)
          const files = await Promise.all(['entry.js', 'manifest.json'].map(async name => ({ path: name,
            sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(bundle, name))).digest('hex') })))
          const payload = { schemaVersion: 1, keyId: 'fixture', replace: true, files }
          await fs.writeFile(path.join(bundle, 'bundle.json'), JSON.stringify({ ...payload,
            signature: crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64') }))
        }
        env.ODK_APPEARANCE_FIRST = path.join(root, '2.0.0')
        env.ODK_APPEARANCE_NEXT = path.join(root, '3.0.0')
        const draft = path.join(env.ODK_WORKSPACE, 'apps/counter')
        await fs.mkdir(draft, { recursive: true })
        await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id: 'counter', name: 'Counter', version: '1', kind: 'app' }))
        await fs.writeFile(path.join(draft, 'index.html'), rejectPackage
          ? '<!doctype html><html><body>Counter<script>console.error("Controlled Appearance verification rejection")</script></body></html>'
          : '<!doctype html><html><body><button id="counter">0</button><script>counter.onclick=()=>counter.textContent=Number(counter.textContent)+1</script></body></html>')
        if (!emptyStartup) await execute(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'),
          'native', 'install', env.ODK_APPEARANCE_FIRST, '--trust', '--keyring', env.ODK_NATIVE_KEYRING], { env, signal: t.signal })
        const operation = execute(require('electron'), [`--user-data-dir=${env.ODK_APPEARANCE_PROFILE}`, fixture],
          { env, cwd: path.resolve(__dirname, '..'), signal: t.signal, timeout: appearanceChildTimeout, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
        const closed = new Promise(resolve => operation.child.once('close', resolve))
        try {
          const result = await operation
          assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), { productionMain: true, actualPreload: true,
            actualInstallation: !rejectPackage, actualVerification: true, emptyStartup,
            ...(rejectPackage ? { rejected: true, verifierError: 'Controlled Appearance verification rejection' } : { themes: 3, retainedAppState: true }),
            released: true, pid: operation.child.pid })
          for (const channel of ['renderer-plugin-control', 'user-app-control']) {
            await assert.rejects(fs.stat(resolveShellHost({ env }).endpoint(channel)), { code: 'ENOENT' })
          }
        } finally { await closed }
      } finally { await fs.rm(root, { recursive: true, force: true }) }
    })
}
