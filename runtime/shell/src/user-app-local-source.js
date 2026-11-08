'use strict'

const fs = require('node:fs/promises')
const { constants } = require('node:fs')
const path = require('node:path')

const ID = '[a-z][a-z0-9-]{0,63}'
const FILE = new RegExp(`^${ID}/${ID}\\.json$`)
const KEY = new RegExp(`^${ID}:[a-f0-9]{32}:${ID}$`)

async function boundedJson(file, limit, privateFile = false) {
  if (await fs.realpath(file) !== file) throw Error('invalid-local-source')
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit || (privateFile && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) {
      throw Error('invalid-local-source')
    }
    const bytes = Buffer.alloc(limit + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > limit) throw Error('invalid-local-source')
    return JSON.parse(bytes.toString('utf8', 0, offset))
  } finally {
    await handle.close()
  }
}

async function grantedSnapshot(stateDir, key) {
  if (typeof process.getuid !== 'function' || !path.isAbsolute(stateDir || '')) return null
  try {
    const config = await boundedJson(path.join(stateDir, 'package-source-grants.json'), 16384, true)
    const { schemaVersion, grants } = config
    if (Object.keys(config).length !== 2 || schemaVersion !== 1 || !Array.isArray(grants) || grants.length > 64) return null
    const paths = new Map()
    for (const grant of grants) {
      const { appId, revision, sourceId, file } = grant
      const identity = `${appId}:${revision}:${sourceId}`
      if (![appId, revision, sourceId, file].every(value => typeof value === 'string') || !KEY.test(identity)
        || !FILE.test(file) || Object.keys(grant).length !== 4 || paths.has(identity)) return null
      paths.set(identity, file)
    }
    const file = paths.get(key)
    return file ? path.join(stateDir, 'package-snapshots', file) : null
  } catch {
    return null
  }
}

module.exports = { grantedSnapshot, readSnapshot: file => boundedJson(file, 64 * 1024) }
