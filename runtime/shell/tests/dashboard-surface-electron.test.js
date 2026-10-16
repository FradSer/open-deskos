'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')

for (const mode of ['development', 'native']) for (const invalid of [false, 'message', 'placement', 'released']) {
  test(`${mode} Dashboard ${invalid ? `rejects invalid ${invalid} behavior` : 'preserves rendered briefing and recovery without navigation'}`, { timeout: 60000 }, async t => {
    await fs.access(path.join(__dirname, 'dashboard-surface-electron.cjs'))
    const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-dashboard-surface-'))
    const env = { ...process.env, ODK_CONFIG_DIR: path.join(profile, 'config'),
      XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state'),
      ODK_DASHBOARD_SURFACE_PROFILE: profile, ODK_DASHBOARD_SURFACE_NATIVE: mode === 'native' ? '1' : '0' }
    delete env.ELECTRON_RUN_AS_NODE
    try {
      const directory = path.join(profile, 'surface')
      await fs.cp(path.join(__dirname, 'fixtures/dashboard-surface-replacement'), directory, { recursive: true })
      if (invalid) {
        const entry = path.join(directory, 'entry.js')
        const source = await fs.readFile(entry, 'utf8')
        const marker = invalid === 'message' ? 'Personal Agent has no new desk briefing.'
          : invalid === 'released' ? 'const current = () => !released && !context.signal?.aborted' : 'mount(container, context) {'
        assert.ok(source.includes(marker))
        await fs.writeFile(entry, source.replace(marker, invalid === 'message' ? 'Controlled invalid Dashboard text.'
          : invalid === 'released' ? 'const current = () => true'
            : marker + "\n      if (container.id !== 'dashboard-acceptance') { container.replaceChildren(); return }"))
      }
      const cli = path.resolve(__dirname, '../scripts/odk-plugin-cli.js')
      if (mode === 'native') {
        const keys = crypto.generateKeyPairSync('ed25519')
        const keyring = path.join(profile, 'publishers.json')
        await fs.writeFile(keyring, JSON.stringify({ schemaVersion: 1, publishers: { dashboard: {
          publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }),
          identities: ['odk.page.dashboard'], hosts: ['electron-renderer'],
        } } }))
        const files = []
        for (const name of ['entry.js', 'manifest.json']) files.push({ path: name,
          sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex') })
        const payload = { schemaVersion: 1, keyId: 'dashboard', replace: true, files }
        const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
        await fs.writeFile(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload, signature }))
        env.ODK_NATIVE_KEYRING = keyring
        await runCommand(process.execPath, [cli, 'native', 'install', directory, '--keyring', keyring, '--trust'],
          { env, signal: t.signal, timeout: 10000 })
      } else await runCommand(process.execPath, [cli, 'link', directory, '--trust', '--replace'],
        { env, signal: t.signal, timeout: 10000 })
      const renderingArgs = process.platform === 'linux' ? ['--disable-gpu'] : []
      const operation = runCommand(require('electron'), [...renderingArgs, `--user-data-dir=${profile}`, '--force-device-scale-factor=1',
        path.join(__dirname, 'dashboard-surface-electron.cjs')], { env, signal: t.signal, timeout: 50000, maxBuffer: 1024 * 1024 })
      if (invalid) {
        const expected = invalid === 'message' ? /independent instrument 0 parity/
          : invalid === 'released' ? /Released implementation changed former nodes/
            : /Dashboard actual placement differs from controlled placement/
        await assert.rejects(operation, error => expected.test(error.stderr || ''))
        return
      }
      const result = await operation
      assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
        actualPreload: true, mode, documentLoads: 1, themes: 3, frames: 10, comparisons: 60, retainedPage: true,
        retainedForeground: true, pointerBack: 3, noSourceControls: 3, dateTransitions: 6, restored: true,
        discoveryReleased: true, assetLeaseReleased: mode === 'native',
      })
    } finally { await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })
}
