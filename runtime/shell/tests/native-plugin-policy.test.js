'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { readNativeKeyring } = require('../src/native-plugin-policy')

test('publisher policy rejects malformed shape unauthorized key types links and oversized files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-native-policy-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'keyring.json')
  const pair = crypto.generateKeyPairSync('ed25519')
  const rule = { publicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }), identities: ['odk.test.native'], hosts: ['electron-main'] }
  for (const change of [{ identities: [] }, { identities: ['wrong'] }, { identities: ['odk.test.native', 'odk.test.native'] },
    { hosts: ['python-agent'] }, { hosts: [] }, { hosts: ['electron-main', 'electron-main'] }, { unknown: true },
    { publicKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }) }]) {
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, publishers: { fixture: { ...rule, ...change } } }))
    await assert.rejects(readNativeKeyring(file), /policy/)
  }
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, publishers: { fixture: rule } }))
  assert.equal((await readNativeKeyring(file)).get('fixture').publicKey.asymmetricKeyType, 'ed25519')
  const alias = path.join(root, 'alias.json')
  await fs.symlink(file, alias)
  await assert.rejects(readNativeKeyring(alias), /unsafe/)
  await fs.writeFile(file, 'x'.repeat(65537))
  await assert.rejects(readNativeKeyring(file), /large/)
  await fs.writeFile(file, 'invalid JSON containing PRIVATE_FIXTURE_CONTENT')
  await assert.rejects(readNativeKeyring(file), error => error.message === 'invalid native publisher policy JSON')
})
