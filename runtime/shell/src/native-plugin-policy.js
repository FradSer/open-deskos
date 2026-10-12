'use strict'

const path = require('node:path')
const crypto = require('node:crypto')
const { readBoundedFile } = require('./user-app-files')

async function readNativeKeyring(file) {
  const bytes = await readBoundedFile(path.dirname(file), path.basename(file), 65536)
  let policy
  try { policy = JSON.parse(bytes.toString('utf8')) } catch { throw Error('invalid native publisher policy JSON') }
  if (!policy || policy.schemaVersion !== 1 || Object.keys(policy).some(key => !['schemaVersion', 'publishers'].includes(key))
    || !policy.publishers || typeof policy.publishers !== 'object' || Array.isArray(policy.publishers)
    || Object.keys(policy.publishers).length > 16) throw Error('invalid native publisher policy')
  const keyring = new Map()
  for (const [id, rule] of Object.entries(policy.publishers)) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id) || !rule || typeof rule !== 'object'
      || Object.keys(rule).some(key => !['publicKey', 'identities', 'hosts'].includes(key))
      || typeof rule.publicKey !== 'string' || !rule.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')
      || !Array.isArray(rule.identities) || !rule.identities.length || rule.identities.length > 64
      || new Set(rule.identities).size !== rule.identities.length
      || rule.identities.some(value => typeof value !== 'string' || !/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(value))
      || !Array.isArray(rule.hosts) || !rule.hosts.length || new Set(rule.hosts).size !== rule.hosts.length
      || rule.hosts.some(value => !['electron-main', 'electron-renderer'].includes(value))) throw Error('invalid native publisher policy')
    const publicKey = crypto.createPublicKey(rule.publicKey)
    if (publicKey.asymmetricKeyType !== 'ed25519') throw Error('native publisher policy requires Ed25519 public keys')
    keyring.set(id, { publicKey, identities: [...rule.identities], hosts: [...rule.hosts] })
  }
  return keyring
}

module.exports = { readNativeKeyring }
