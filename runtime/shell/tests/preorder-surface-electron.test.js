'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')

for (const mode of ['development', 'native']) for (const control of ['normal', 'missing-tick', 'missing-pixel']) {
  test(`${mode} Pre-order preserves canvas pixels, countdown and recovery without navigation (${control})`, { timeout: 60000 }, async t => {
    await fs.access(path.join(__dirname, 'preorder-surface-electron.cjs'))
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-preorder-surface-'))
    const env = { ...process.env, ODK_CONFIG_DIR: path.join(profile, 'config'),
      XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state'),
      ODK_PREORDER_SURFACE_PROFILE: profile, ODK_PREORDER_SURFACE_NATIVE: mode === 'native' ? '1' : '0' }
    delete env.ELECTRON_RUN_AS_NODE
    try {
      const directory = path.join(profile, 'surface')
      await fs.cp(path.join(__dirname, 'fixtures/preorder-surface-replacement'), directory, { recursive: true })
      const entry = path.join(directory, 'entry.js')
      if (control !== 'normal') {
        const source = await fs.readFile(entry, 'utf8')
        const changed = control === 'missing-tick'
          ? source.replace('context.onTick(now => {', 'void (now => {')
          : source.replace("if (renderedTheme !== 'pixel') return", 'if (true) return')
        assert.notEqual(changed, source, 'Controlled entry mutation must apply')
        await fs.writeFile(entry, changed)
      }
      const cli = path.resolve(__dirname, '../scripts/odk-plugin-cli.js')
      if (mode === 'native') {
        const keys = crypto.generateKeyPairSync('ed25519')
        const keyring = path.join(profile, 'publishers.json')
        await fs.writeFile(keyring, JSON.stringify({ schemaVersion: 1, publishers: { preorder: {
          publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }),
          identities: ['odk.tile.preorder'], hosts: ['electron-renderer'],
        } } }))
        const files = []
        for (const name of ['entry.js', 'manifest.json']) files.push({ path: name,
          sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex') })
        const payload = { schemaVersion: 1, keyId: 'preorder', replace: true, files }
        const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
        await fs.writeFile(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload, signature }))
        env.ODK_NATIVE_KEYRING = keyring
        await runCommand(process.execPath, [cli, 'native', 'install', directory, '--keyring', keyring, '--trust'],
          { env, signal: t.signal, timeout: 10000 })
      } else await runCommand(process.execPath, [cli, 'link', directory, '--trust', '--replace'],
        { env, signal: t.signal, timeout: 10000 })
      const launch = () => runCommand(require('electron'), [`--user-data-dir=${profile}`, '--force-device-scale-factor=1',
        path.join(__dirname, 'preorder-surface-electron.cjs')], { env, signal: t.signal, timeout: 50000, maxBuffer: 1024 * 1024 })
      if (control !== 'normal') {
        const expected = control === 'missing-tick' ? 'Pre-order subscriptions not retained' : 'Pre-order Pixel block is not uniform'
        await assert.rejects(launch, error => error.code === 1 && error.stderr.includes(expected))
        return
      }
      const result = await launch()
      assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
        actualPreload: true, mode, documentLoads: 1, themes: 3, sizes: 3, comparisons: 18,
        sharedTickUpdates: 6, retainedDesktop: true, canvasPixels: true, actualViewports: 3, enableCycles: 3, softwareRaster: true,
        restored: true, discoveryReleased: true, assetLeaseReleased: mode === 'native',
      })
    } finally { await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })
}
