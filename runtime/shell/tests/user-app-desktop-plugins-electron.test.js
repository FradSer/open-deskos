'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')

for (const mode of ['default', 'independent', 'invalid-contract', 'retained-cleanup', 'retry-shutdown', 'retry-startup-shutdown', 'initial-startup-shutdown', 'wrong-role',
  'development', 'native', 'development-wrong-role', 'native-wrong-role', 'development-definition-rejected', 'native-definition-rejected',
  'development-discovery-shutdown', 'native-discovery-shutdown']) {
  test(`installed desktop ${mode} composition in the actual Shell`, { timeout: 60000 }, async t => {
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-installed-desktop-'))
    const env = { ...process.env, ODK_INSTALLED_DESKTOP_PROFILE: profile, ODK_INSTALLED_DESKTOP_MODE: mode,
      OPEN_DESKOS_CONFIG_DIR: path.join(profile, 'config'), XDG_STATE_HOME: path.join(profile, 'state'),
      LOCALAPPDATA: path.join(profile, 'state') }
    delete env.ELECTRON_RUN_AS_NODE
    try {
      if (mode.startsWith('development') || mode.startsWith('native')) {
        const directory = path.join(profile, 'desktop')
        await fs.cp(path.join(__dirname, 'fixtures/user-app-desktop-replacement'), directory, { recursive: true })
        const entry = path.join(directory, 'entry.js')
        await fs.writeFile(entry, 'window.desktopExternalEntryExecuted=true;\n' + await fs.readFile(entry, 'utf8'))
        if (mode.endsWith('wrong-role')) await fs.writeFile(entry, (await fs.readFile(entry, 'utf8')).replace("surface: 'app'", "surface: 'display'"))
        if (mode.endsWith('definition-rejected')) await fs.writeFile(entry, (await fs.readFile(entry, 'utf8')).replace('id: definition.manifest.id', "id: 'odk.system.other'"))
        const cli = path.join(__dirname, '../scripts/open-deskos-plugin-cli.js')
        if (mode.startsWith('native')) {
          const keys = crypto.generateKeyPairSync('ed25519'), keyring = path.join(profile, 'publishers.json')
          await fs.writeFile(keyring, JSON.stringify({ schemaVersion: 1, publishers: { desktop: {
            publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: ['odk.system.user-app-desktop'], hosts: ['electron-renderer'],
          } } }))
          const files = []
          for (const name of ['entry.js', 'manifest.json']) files.push({ path: name,
            sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex') })
          const payload = { schemaVersion: 1, keyId: 'desktop', replace: true, files }
          const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
          await fs.writeFile(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload, signature }))
          env.OPEN_DESKOS_NATIVE_KEYRING = keyring
          await runCommand(process.execPath, [cli, 'native', 'install', directory, '--keyring', keyring, '--trust'], { env, signal: t.signal, timeout: 10000 })
        } else await runCommand(process.execPath, [cli, 'link', directory, '--trust', '--replace'], { env, signal: t.signal, timeout: 10000 })
      }
      const renderingArgs = process.platform === 'linux' ? ['--disable-gpu'] : []
      const operation = runCommand(require('electron'), [...renderingArgs, `--user-data-dir=${profile}`,
        path.join(__dirname, 'user-app-desktop-plugins-electron.cjs')], { env, signal: t.signal, timeout: 50000, maxBuffer: 1024*1024 })
      if (mode.endsWith('wrong-role')) {
        await assert.rejects(operation, error => /Installed App surface role changed/.test(error.stderr || ''))
        return
      }
      const report = JSON.parse((await operation).stdout.trim().split('\n').pop())
      if (mode === 'retry-shutdown' || mode === 'retry-startup-shutdown' || mode === 'initial-startup-shutdown' || mode.endsWith('discovery-shutdown')) {
        assert.deepEqual(report, { mode, documentLoads: 1, recoveryDrained: true, released: true })
        return
      }
      assert.deepEqual(report, { mode, documentLoads: 1, actualPreload: true, retainedFrames: true,
        pointerBack: true, themes: 3, released: true })
    } finally { await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })
}
