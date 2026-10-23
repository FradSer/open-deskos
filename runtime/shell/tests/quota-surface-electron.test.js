'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { runCommand, fixtureRejection } = require('./helpers/hydra-wire-lifecycle')
const specs = [{ file: 'quota', id: 'odk.page.quota' }]

for (const { mode, bypass = false } of [{ mode: 'development', bypass: true }, { mode: 'development' }, { mode: 'native' }]) {
  test(`${mode} Quota ${bypass ? 'rejects a consumer bypassing shared service selection' : 'surface preserves readings interaction and recovery'}`, { timeout: 65000 }, async t => {
    const fixture = path.join(__dirname, 'quota-surface-electron.cjs')
    await fs.access(fixture)
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-quota-surface-'))
    const env = { ...process.env, ODK_CONFIG_DIR: path.join(profile, 'config'),
      XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state'),
      ODK_QUOTA_SURFACE_PROFILE: profile, ODK_QUOTA_SURFACE_NATIVE: mode === 'native' ? '1' : '0',
      ODK_QUOTA_SERVICE_BYPASS: bypass ? '1' : '0' }
    delete env.ELECTRON_RUN_AS_NODE
    try {
      const cli = path.resolve(__dirname, '../scripts/odk-plugin-cli.js')
      const keys = crypto.generateKeyPairSync('ed25519')
      const keyring = path.join(profile, 'publishers.json')
      await fs.writeFile(keyring, JSON.stringify({ schemaVersion: 1, publishers: { quota: {
        publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }),
        identities: specs.map(spec => spec.id), hosts: ['electron-renderer'],
      } } }))
      env.ODK_NATIVE_KEYRING = keyring
      for (const spec of specs) {
        const directory = path.join(profile, spec.file)
        await fs.cp(path.join(__dirname, `fixtures/${spec.file}-surface-replacement`), directory, { recursive: true })
        if (mode === 'native') {
          const files = []
          for (const name of ['entry.js', 'manifest.json']) files.push({ path: name,
            sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex') })
          const payload = { schemaVersion: 1, keyId: 'quota', replace: true, files }
          const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
          await fs.writeFile(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload, signature }))
          await runCommand(process.execPath, [cli, 'native', 'install', directory, '--keyring', keyring, '--trust'],
            { env, signal: t.signal, timeout: 10000 })
        } else await runCommand(process.execPath, [cli, 'link', directory, '--trust', '--replace'],
          { env, signal: t.signal, timeout: 10000 })
      }
      const renderingArgs = process.platform === 'linux' ? ['--disable-gpu'] : []
      const running = runCommand(require('electron'), [...renderingArgs, `--user-data-dir=${profile}`, '--force-device-scale-factor=1', fixture],
        { env, signal: t.signal, timeout: 55000, maxBuffer: 1024 * 1024 })
      if (bypass) {
        await assert.rejects(running, error => fixtureRejection(error, /Quota consumer bypassed selected subscription service/))
        return
      }
      const result = await running
      assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
        actualPreload: true, mode, documentLoads: 1, comparisons: 12, states: 20,
        retainedConsumers: true, lifecycleRecovery: true, selectedServiceConsumers: 3, subscriptionsReleased: true,
        discoveryReleased: true, assetLeaseReleased: mode === 'native',
      })
    } finally { await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })
}
