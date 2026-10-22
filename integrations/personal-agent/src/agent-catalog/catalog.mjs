import { constants, lstatSync, realpathSync, readdirSync, openSync, fstatSync, readSync, writeFileSync, closeSync, fsyncSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parseFrontmatter } from '@earendil-works/pi-coding-agent'
import lockfile from 'proper-lockfile'
import { readProactiveFile, checkProactivePath, createProactiveDirectory, openProactiveTemporary } from '../proactive-private.mjs'

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const REVISION = /^[a-f0-9]{64}$/
const LIMIT = 2 * 1024 * 1024
const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))
const text = (value, limit) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= limit && !/[\x00-\x1f]/.test(value)
const identity = value => text(value, 64) && ID.test(value)
const hash = value => createHash('sha256').update(value).digest('hex')
const resourcePath = value => typeof value === 'string' && value.length <= 256 && !/[\\\x00-\x1f]/.test(value)
  && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..')

function privateDirectory(directory) {
  createProactiveDirectory(directory)
  checkDirectory(directory)
}

function checkDirectory(directory) {
  const info = lstatSync(directory)
  if (!info.isDirectory() || realpathSync(directory) !== directory || (process.platform !== 'win32'
    && (info.uid !== process.getuid?.() || info.mode & 0o077))) throw Error('Unsafe private agent catalog directory')
  checkProactivePath(directory)
}

function writeAtomic(file, content) {
  const directory = dirname(file)
  checkDirectory(directory)
  const temporary = join(directory, `.package-${randomUUID()}.tmp`)
  try {
    const fd = openProactiveTemporary(temporary)
    try { writeFileSync(fd, content); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(temporary, file)
    if (process.platform !== 'win32') {
      const parent = openSync(directory, 'r')
      try { fsyncSync(parent) } finally { closeSync(parent) }
    }
  } finally { try { unlinkSync(temporary) } catch {} }
}

function readResource(file) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = fstatSync(fd)
    if (!before.isFile() || before.nlink !== 1 || before.size > 262144) throw Error('Unsafe or oversized Skill resource')
    const buffer = Buffer.alloc(262145)
    let size = 0
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null)
      if (!count) break
      size += count
    }
    const after = fstatSync(fd)
    const path = lstatSync(file)
    if (size > 262144 || realpathSync(file) !== file || before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs || path.ino !== after.ino || path.dev !== after.dev || after.nlink !== 1) throw Error('Skill resource changed during its snapshot')
    let content
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)) } catch { throw Error('Skill resources must be UTF-8 text') }
    if (content.includes('\0')) throw Error('Skill resources must be UTF-8 text')
    return content
  } finally { closeSync(fd) }
}

function references(value = {}) {
  return object(value, Object.keys(value)) && Object.entries(value).every(([key, source]) => /^[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(key)
    && object(source, ['fromEnv']) && typeof source.fromEnv === 'string' && /^ODK_MCP_[A-Z0-9_]{1,100}$/.test(source.fromEnv))
}

export function validateMcpManifest(value) {
  if (!object(value, ['schemaVersion', 'kind', 'id', 'name', 'transport']) || value.schemaVersion !== 1 || value.kind !== 'mcp'
    || !identity(value.id) || !text(value.name, 120)) throw Error('Invalid DeskOS MCP manifest')
  const transport = value.transport
  if (transport?.type === 'stdio') {
    if (!object(transport, ['type', 'command', 'args', 'env']) || !text(transport.command, 4096) || !isAbsolute(transport.command)
      || !Array.isArray(transport.args) || transport.args.length > 64 || !transport.args.every(arg => typeof arg === 'string' && Buffer.byteLength(arg) <= 4096 && !/[\x00-\x1f]/.test(arg))
      || !references(transport.env)) throw Error('Invalid DeskOS MCP stdio configuration')
  } else if (transport?.type === 'streamable-http') {
    if (!object(transport, ['type', 'url', 'headers']) || !text(transport.url, 4096) || !references(transport.headers)) throw Error('Invalid DeskOS MCP HTTP configuration')
    const url = new URL(transport.url)
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:'
      && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw Error('MCP requires HTTPS or loopback HTTP without embedded credentials')
  } else throw Error('Unsupported DeskOS MCP transport')
  if (Buffer.byteLength(JSON.stringify(value)) > 32768) throw Error('MCP manifest exceeds its size limit')
  return structuredClone(value)
}

function validateSkill(snapshot) {
  if (!object(snapshot, ['schemaVersion', 'kind', 'id', 'description', 'files']) || snapshot.schemaVersion !== 1 || snapshot.kind !== 'skill'
    || !identity(snapshot.id) || !text(snapshot.description, 2048) || !Array.isArray(snapshot.files) || snapshot.files.length < 1 || snapshot.files.length > 128
    || !snapshot.files.every(file => object(file, ['path', 'content']) && resourcePath(file.path) && typeof file.content === 'string' && Buffer.byteLength(file.content) <= 262144)
    || new Set(snapshot.files.map(file => file.path)).size !== snapshot.files.length || !snapshot.files.some(file => file.path === 'SKILL.md')) throw Error('Invalid DeskOS Skill snapshot')
  return snapshot
}

/** Snapshot local text resources only. The catalog never imports or executes package code. */
function snapshotSkill(source) {
  if (!isAbsolute(source) || realpathSync(source) !== source || !lstatSync(source).isDirectory()) throw Error('Unsafe Skill source directory')
  const files = []
  let bytes = 0, visited = 0
  function visit(relative = '') {
    for (const name of readdirSync(join(source, relative)).sort()) {
      if (++visited > 256) throw Error('Skill resource inventory exceeds its size limit')
      if (name === '.git' || name === 'node_modules') throw Error('Skill sources cannot contain repository or dependency directories')
      const path = relative ? `${relative}/${name}` : name
      if (!resourcePath(path)) throw Error('Unsafe Skill resource path')
      const absolute = join(source, path)
      const info = lstatSync(absolute)
      if (realpathSync(absolute) !== absolute || info.isSymbolicLink()) throw Error('Linked Skill resources are unsafe')
      if (info.isDirectory()) { visit(path); continue }
      if (!info.isFile() || info.nlink !== 1 || info.size > 262144 || files.length >= 128) throw Error('Unsafe or oversized Skill resource')
      const content = readResource(absolute)
      bytes += Buffer.byteLength(content)
      if (bytes > LIMIT / 2) throw Error('Skill source exceeds its size limit')
      files.push({ path, content })
    }
  }
  visit()
  const skill = files.find(file => file.path === 'SKILL.md')
  if (!skill) throw Error('Skill source requires SKILL.md')
  const { frontmatter } = parseFrontmatter(skill.content)
  return validateSkill({ schemaVersion: 1, kind: 'skill', id: frontmatter.name, description: typeof frontmatter.description === 'string' ? frontmatter.description.trim().replace(/\s+/g, ' ') : undefined, files })
}

/** A candidate name selects one directory; neither model paths nor package code enter the loader. */
export function readAgentCandidate(directory, id) {
  if (!isAbsolute(directory) || realpathSync(directory) !== directory || !identity(id)) throw Error('Invalid agent package candidate directory or identity')
  const source = join(directory, id)
  if (realpathSync(source) !== source || !lstatSync(source).isDirectory()) throw Error('Unsafe agent package candidate')
  const names = readdirSync(source)
  const skill = names.includes('SKILL.md'), mcp = names.includes('manifest.json')
  if (skill === mcp) throw Error('Agent package candidate must contain either SKILL.md or an MCP manifest')
  const snapshot = skill ? snapshotSkill(source) : validateMcpManifest(JSON.parse(readResource(join(source, 'manifest.json'))))
  if (snapshot.id !== id) throw Error('Agent package candidate identity does not match its directory')
  return { revision: hash(JSON.stringify(snapshot)), snapshot }
}

/** Immutable revision files and atomic activation pointers keep updates separate from source drafts. */
export async function openAgentCatalog(directory) {
  if (!isAbsolute(directory)) throw Error('Agent catalog requires an absolute private directory')
  privateDirectory(directory)
  let mutationQueue = Promise.resolve()
  function packageDirectory(id, create = false) {
    if (!identity(id)) throw Error('Invalid agent package identity')
    privateDirectory(directory)
    const path = join(directory, id)
    if (create) privateDirectory(path)
    else checkDirectory(path)
    return path
  }
  function active(id) {
    let file
    try { file = join(packageDirectory(id), 'active.json'); lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    const value = JSON.parse(readProactiveFile(file, 1024))
    if (!object(value, ['schemaVersion', 'revision']) || value.schemaVersion !== 1 || (value.revision !== null && !REVISION.test(value.revision))) throw Error('Invalid agent package activation')
    return value.revision
  }
  function readRevision(id, revision) {
    if (!REVISION.test(revision)) throw Error('Invalid agent package revision')
    const raw = readProactiveFile(join(packageDirectory(id), `${revision}.json`), LIMIT)
    if (hash(raw) !== revision) throw Error('Agent package revision digest mismatch')
    const snapshot = JSON.parse(raw)
    if (snapshot.id !== id) throw Error('Agent package identity mismatch')
    if (snapshot.kind !== packageKind(id)) throw Error('Agent package revision changes its identity kind')
    return snapshot.kind === 'skill' ? validateSkill(snapshot) : validateMcpManifest(snapshot)
  }
  function packageKind(id) {
    let file
    try { file = join(packageDirectory(id), 'identity.json'); lstatSync(file) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    const value = JSON.parse(readProactiveFile(file, 1024))
    if (!object(value, ['schemaVersion', 'id', 'kind']) || value.schemaVersion !== 1 || value.id !== id || !['skill', 'mcp'].includes(value.kind)) throw Error('Invalid agent package identity kind')
    return value.kind
  }
  function writeActive(id, revision) {
    writeAtomic(join(packageDirectory(id), 'active.json'), JSON.stringify({ schemaVersion: 1, revision }))
  }
  function mutate(id, operation, create = false, preflight = () => {}, signal = undefined) {
    if (!identity(id)) return Promise.reject(Error('Invalid agent package identity'))
    const attempt = mutationQueue.then(async () => {
      signal?.throwIfAborted()
      privateDirectory(directory)
      // Serialize inventory admission as well as activation, including other processes.
      const release = await lockfile.lock(directory, { realpath: false, stale: 30000, retries: { retries: 30, minTimeout: 10, maxTimeout: 100 } })
      try {
        signal?.throwIfAborted()
        preflight()
        if (create) {
          let exists = true
          try { lstatSync(join(directory, id)) } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error }
          if (!exists && readdirSync(directory).filter(identity).length >= 128) throw Error('Agent package inventory capacity limit reached')
          packageDirectory(id, true)
        }
        return operation()
      } finally { await release() }
    })
    mutationQueue = attempt.then(() => {}, () => {})
    return attempt
  }
  async function install(snapshot, { expectedRevision = undefined, signal = undefined } = {}) {
    const raw = JSON.stringify(snapshot)
    if (Buffer.byteLength(raw) > LIMIT) throw Error('Agent package exceeds its size limit')
    const revision = hash(raw)
    let kind
    return mutate(snapshot.id, () => {
      if (!kind) writeAtomic(join(packageDirectory(snapshot.id), 'identity.json'), JSON.stringify({ schemaVersion: 1, id: snapshot.id, kind: snapshot.kind }))
      const file = join(packageDirectory(snapshot.id), `${revision}.json`)
      let exists = true
      try { lstatSync(file) } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error }
      if (exists) readRevision(snapshot.id, revision)
      else writeAtomic(file, raw)
      writeActive(snapshot.id, revision)
      return { id: snapshot.id, kind: snapshot.kind, revision }
    }, true, () => {
      const previous = active(snapshot.id)
      kind = packageKind(snapshot.id)
      if (kind && kind !== snapshot.kind) throw Error('An agent package cannot change its identity kind')
      if (previous) readRevision(snapshot.id, previous)
      if (expectedRevision !== undefined && expectedRevision !== previous) throw Error('Installed agent package revision changed')
    }, signal)
  }
  function packageSnapshot(id) {
    const revision = active(id)
    if (!revision) throw Error('Agent package is not installed')
    const snapshot = readRevision(id, revision)
    return { revision, snapshot }
  }
  function installed(id, kind) {
    const { snapshot } = packageSnapshot(id)
    if (snapshot.kind !== kind) throw Error('Agent package has a different kind')
    return snapshot
  }
  return {
    installSkill: (source, options = {}) => Promise.resolve().then(() => install(snapshotSkill(source), options)),
    installMcp: (manifest, options = {}) => Promise.resolve().then(() => install(validateMcpManifest(manifest), options)),
    installCandidate(candidate, options = {}) {
      const snapshot = candidate?.snapshot?.kind === 'skill' ? validateSkill(candidate.snapshot) : validateMcpManifest(candidate?.snapshot)
      if (hash(JSON.stringify(snapshot)) !== candidate.revision) return Promise.reject(Error('Agent package candidate revision changed'))
      return install(structuredClone(snapshot), options)
    },
    async package(id) { return packageSnapshot(id) },
    async list() {
      privateDirectory(directory)
      const ids = readdirSync(directory).filter(identity).sort()
      if (ids.length > 128) throw Error('Agent package inventory exceeds its size limit')
      const entries = []
      for (const id of ids) {
        const revision = active(id)
        if (revision) {
          const snapshot = readRevision(id, revision)
          entries.push({ id, kind: snapshot.kind, revision, ...(snapshot.kind === 'skill' ? { description: snapshot.description } : { name: snapshot.name }) })
        }
      }
      return entries
    },
    async skill(id) { return installed(id, 'skill') },
    async mcp(id) { return installed(id, 'mcp') },
    async readSkill(id, path = 'SKILL.md') {
      if (!resourcePath(path)) throw Error('Unsafe Skill resource path')
      const file = installed(id, 'skill').files.find(file => file.path === path)
      if (!file) throw Error('Installed Skill resource is unavailable')
      return file.content
    },
    rollback: (id, revision, { expectedRevision = undefined, signal = undefined } = {}) => mutate(id, () => { readRevision(id, revision); writeActive(id, revision); return { id, revision } }, false, () => {
      if (expectedRevision !== undefined && active(id) !== expectedRevision) throw Error('Installed agent package revision changed')
    }, signal),
    remove: (id, { expectedRevision = undefined, signal = undefined } = {}) => mutate(id, () => { const revision = active(id); if (!revision) return { id, removed: false }; readRevision(id, revision); writeActive(id, null); return { id, removed: true } }, false, () => {
      if (expectedRevision !== undefined && active(id) !== expectedRevision) throw Error('Installed agent package revision changed')
    }, signal),
  }
}
