'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const cli = path.resolve(__dirname, '../scripts/odk-plugin-cli.js')

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-native-cli-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'), XDG_STATE_HOME: path.join(root, 'state'),
    LOCALAPPDATA: path.join(root, 'state') }
  const source = path.join(root, 'source')
  await fs.mkdir(source)
  const keyring = path.join(root, 'keyring.json')
  const keys = crypto.generateKeyPairSync('ed25519')
  await fs.writeFile(keyring, JSON.stringify({ schemaVersion: 1, publishers: { fixture: {
    publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }), identities: ['odk.test.native'], hosts: ['electron-main'],
  } } }))
  const manifest = { schemaVersion: 1, id: 'odk.test.native', name: 'Native CLI fixture', version: '1.0.0', kind: 'service',
    host: 'electron-main', entry: 'entry.cjs', permissions: ['fixture'], provides: [], requires: [] }
  const marker = path.join(root, 'executed')
  async function write(version, id = manifest.id) {
    await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify({ ...manifest, version, id }))
    await fs.writeFile(path.join(source, 'entry.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`)
    const files = []
    for (const file of ['entry.cjs', 'manifest.json']) files.push({ path: file,
      sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(source, file))).digest('hex') })
    const payload = { schemaVersion: 1, keyId: 'fixture', replace: false, files }
    const signature = crypto.sign(null, Buffer.from('Open DeskOS native bundle v1\n' + JSON.stringify(payload)), keys.privateKey).toString('base64')
    await fs.writeFile(path.join(source, 'bundle.json'), JSON.stringify({ ...payload, signature }))
  }
  await write('1.0.0')
  const run = args => promisify(execFile)(process.execPath, [cli, 'native', ...args], { env })
  const policy = ['--keyring', keyring]
  const authorization = [...policy, '--trust', '--grant', 'fixture']
  return { root, source, keyring, env, run, write, marker, policy, authorization,
    selected: () => readConfig(resolveConfigPath(env)).plugins['odk.test.native'] }
}

test('actual native CLI installs inspects updates rolls back and removes without executing entries', async t => {
  const f = await fixture(t)
  const first = JSON.parse((await f.run(['install', f.source, ...f.authorization])).stdout)
  assert.match(first.selection.revision, /^[a-f0-9]{64}$/)
  assert.equal(first.effect, 'selection-only')
  assert.equal(JSON.parse((await f.run(['list', ...f.policy])).stdout)[0].state, 'verified')
  assert.equal(JSON.parse((await f.run(['inspect', 'odk.test.native', ...f.policy])).stdout).manifest.version, '1.0.0')
  await f.write('2.0.0')
  await f.run(['update', 'odk.test.native', f.source, ...f.authorization])
  assert.equal(JSON.parse((await f.run(['inspect', 'odk.test.native', ...f.policy])).stdout).manifest.version, '2.0.0')
  await f.run(['rollback', 'odk.test.native', ...f.policy])
  assert.equal(f.selected().native.revision, first.selection.revision)
  await f.run(['remove', 'odk.test.native'])
  assert.equal(f.selected().native, undefined)
  await fs.stat(path.join(f.source, 'entry.cjs'))
  await assert.rejects(fs.stat(f.marker), { code: 'ENOENT' })
})

test('native CLI refuses missing authorization malformed flags and unsigned updates without configuration changes', async t => {
  const f = await fixture(t)
  for (const args of [ ['install', f.source], ['install', f.source, ...f.policy],
    ['install', f.source, ...f.policy, '--trust'], ['install', f.source, ...f.authorization, '--runtime'],
    ['install', f.source, ...f.authorization, '--keyring', f.keyring], ['remove', 'odk.test.native', '--trust'] ]) {
    await assert.rejects(f.run(args))
    assert.equal(f.selected(), undefined)
  }
  await f.run(['install', f.source, ...f.authorization])
  const bytes = await fs.readFile(resolveConfigPath(f.env), 'utf8')
  await fs.writeFile(path.join(f.source, 'entry.cjs'), 'unsigned update')
  await assert.rejects(f.run(['update', 'odk.test.native', f.source, ...f.authorization]))
  assert.equal(await fs.readFile(resolveConfigPath(f.env), 'utf8'), bytes)
})

test('native CLI rejects malformed publisher policy and reports no verified selection', async t => {
  const f = await fixture(t)
  for (const value of [{ schemaVersion: 2, publishers: {} }, { schemaVersion: 1, publishers: {} },
    { schemaVersion: 1, publishers: { fixture: { publicKey: 'invalid', identities: ['odk.test.native'], hosts: ['electron-main'] } } }]) {
    await fs.writeFile(f.keyring, JSON.stringify(value))
    await assert.rejects(f.run(['install', f.source, ...f.authorization]))
    assert.equal(f.selected(), undefined)
  }
})

test('native CLI list isolates corrupt revisions while preserving independent verified identities', async t => {
  const f = await fixture(t)
  await f.run(['install', f.source, ...f.authorization])
  const first = f.selected().native.revision
  const policy = JSON.parse(await fs.readFile(f.keyring, 'utf8'))
  policy.publishers.fixture.identities.push('odk.test.other')
  await fs.writeFile(f.keyring, JSON.stringify(policy))
  await f.write('1.0.0', 'odk.test.other')
  await f.run(['install', f.source, ...f.authorization])
  const state = require('../src/platform').resolveShellHost({ env: f.env }).stateDir
  await fs.writeFile(path.join(state, 'plugins', 'native', 'revisions', first, 'entry.cjs'), 'corrupt')
  let result
  try { await f.run(['list', ...f.policy]) } catch (error) { result = error }
  assert.equal(result.code, 1)
  const items = JSON.parse(result.stdout)
  assert.deepEqual(items.find(item => item.pluginId === 'odk.test.native'), { pluginId: 'odk.test.native', state: 'unavailable', error: 'verification-failed' })
  assert.equal(items.find(item => item.pluginId === 'odk.test.other').state, 'verified')
})

test('outer CLI config errors retain invalid bytes without disclosing JSON fragments', async t => {
  const f = await fixture(t)
  const file = resolveConfigPath(f.env)
  await fs.mkdir(path.dirname(file))
  const invalid = 'PRIVATE_CONFIG_FIXTURE invalid JSON'
  await fs.writeFile(file, invalid)
  await assert.rejects(f.run(['list', ...f.policy]), error => {
    assert.equal(error.code, 1)
    assert.doesNotMatch(error.stderr, /PRIVATE/)
    assert.match(error.stderr, /invalid.*JSON/)
    return true
  })
  assert.equal(await fs.readFile(file, 'utf8'), invalid)
})
