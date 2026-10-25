import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, opendir, readlink, realpath } from 'node:fs/promises'
import { Type } from 'typebox'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createBashToolDefinition, createLocalBashOperations } from '@earendil-works/pi-coding-agent'

/** Structured output a script receives for one check, matched to the model-facing bound. */
const OUTPUT_BYTES = 64 * 1024
const LIMITS = Object.freeze({ files: 10000, entries: 20000, fileBytes: 8 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, readBytes: 128 * 1024 * 1024, listBytes: 2 * 1024 * 1024, timeMs: 5000 })
const SOURCE_SCHEME = Object.freeze({
  id: 'git-worktree-sha256-v1',
  scope: 'Whole canonical containing Git repo: union of HEAD and index tracked paths (including missing/deleted), plus nonignored untracked paths; sorted by UTF-8 bytes. Repository ignore rules apply; user/global Git config is disabled.',
  digest: 'SHA-256 of 8-byte big-endian length-framed fields: scheme id, canonical repo root, then each relative path, kind (file/link/missing), executable-bit mask in octal, and raw file bytes or symlink link text (never target bytes); missing payload is empty.',
  stability: 'Two complete passes must agree on digest and stat witnesses; read-time and final stats and parent directories are checked. Not an atomic or immutable snapshot; matching samples cannot exclude intermediate or ABA changes.',
  outsideSource: 'Ignored untracked files, Git administrative state except path selection, dependencies not in the selected source, symlink target contents, external services, and the execution environment are outside these source samples. Exit zero is process evidence, not verification or check adequacy.',
  limits: LIMITS,
})
const NULL_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null'
const UTF8 = new TextDecoder('utf-8', { fatal: true })

class SampleFailure extends Error {
  constructor(reason) { super(reason); this.reason = reason }
}
const fail = reason => { throw new SampleFailure(reason) }

function snapshotEnv() {
  // Never inherit Git overrides, shell startup files, provider keys or credentials.
  // These Git commands cannot launch filters, hooks, fsmonitor or network helpers.
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
  return {
    [pathKey]: process.env[pathKey] ?? '',
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR } : {}),
    HOME: NULL_FILE, USERPROFILE: NULL_FILE, XDG_CONFIG_HOME: NULL_FILE,
    LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: NULL_FILE, GIT_CONFIG_GLOBAL: NULL_FILE,
    GIT_CONFIG_COUNT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1',
  }
}

async function git(cwd, args, budget, allowMissing = false, input = '') {
  budget.check()
  const result = await new Promise((resolveResult, reject) => {
    const child = execFile('git', [
      '--no-optional-locks', '--no-pager', '--no-replace-objects',
      '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', `core.hooksPath=${NULL_FILE}`,
      '-c', 'credential.helper=', '-c', 'credential.interactive=false', '-c', 'protocol.allow=never', '-c', 'gc.auto=0',
      ...args,
    ], {
      cwd, env: snapshotEnv(), encoding: 'buffer', timeout: Math.max(1, Math.ceil(budget.deadline - performance.now())),
      maxBuffer: LIMITS.listBytes, signal: budget.controller.signal, windowsHide: true,
    }, (error, stdout) => {
      if (!error) resolveResult(stdout)
      else if (allowMissing && error.code === 1) resolveResult(null)
      else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') reject(new SampleFailure('too_large'))
      else if (error.killed || error.name === 'AbortError') reject(new SampleFailure('time_limit'))
      else reject(new SampleFailure('git_unavailable'))
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
  budget.check()
  return result
}

function decode(bytes) {
  try { return UTF8.decode(bytes) } catch { return fail('unsupported') }
}

function inside(root, path) {
  const child = relative(root, path)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

async function repository(cwd, budget) {
  budget.check()
  const directory = await realpath(cwd)
  budget.check()
  let bytes
  try { bytes = await git(directory, ['rev-parse', '--path-format=absolute', '--show-toplevel'], budget) }
  catch (error) { if (error instanceof SampleFailure && error.reason === 'git_unavailable') fail('not_git'); throw error }
  const rootName = decode(bytes).replace(/\r?\n$/, '')
  if (!isAbsolute(rootName)) fail('unsafe_path')
  const root = await realpath(rootName)
  budget.check()
  if (!inside(root, directory)) fail('unsafe_path')
  return root
}

function pathName(bytes, paths) {
  const path = decode(bytes)
  if (Buffer.byteLength(path) > 4096) fail('too_large')
  const parts = path.split('/')
  if (!path || isAbsolute(path) || parts.length > 64 || parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git') || (process.platform === 'win32' && (path.includes('\\') || path.includes(':')))) fail('unsafe_path')
  paths.add(path)
  if (paths.size > LIMITS.files) fail('too_large')
}

function records(bytes, callback, budget) {
  let start = 0
  while (start < bytes.length) {
    budget.check()
    const end = bytes.indexOf(0, start)
    if (end < 0) fail('git_unavailable')
    callback(bytes.subarray(start, end))
    start = end + 1
  }
}

async function sourcePaths(root, budget, observed) {
  const paths = new Set()
  const indexed = await git(root, ['ls-files', '--stage', '--full-name', '-z'], budget)
  const addTracked = record => {
    const tab = record.indexOf(9)
    if (tab < 0) fail('git_unavailable')
    const mode = record.subarray(0, record.indexOf(32)).toString('ascii')
    if (mode === '160000') fail('submodule')
    if (!['100644', '100755', '120000'].includes(mode)) fail('unsupported')
    pathName(record.subarray(tab + 1), paths)
  }
  records(indexed, addTracked, budget)
  // HEAD retains paths removed from the index, so a staged deletion is sampled
  // as missing, not silently discarded. Object ids do not substitute for bytes.
  const head = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], budget, true)
  if (head !== null) records(await git(root, ['ls-tree', '-r', '--full-tree', '-z', 'HEAD'], budget), addTracked, budget)
  records(await git(root, ['ls-files', '--others', '--exclude-standard', '--full-name', '-z'], budget), record => pathName(record, paths), budget)
  // ls-files omits untracked FIFOs/sockets. Enumerate bounded directory entries
  // and apply Git's repository ignore rules before descending or selecting them.
  await untrackedPaths(root, paths, observed, budget)
  return [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
}

async function untrackedPaths(root, paths, observed, budget) {
  const pending = ['']
  let entries = 0
  while (pending.length) {
    budget.check()
    const prefix = pending.pop()
    const directory = join(root, prefix)
    await parents(root, prefix ? `${prefix}/entry` : 'entry', observed, budget)
    const children = []
    const handle = await opendir(directory, { bufferSize: 32 })
    try {
      for await (const entry of handle) {
        budget.check()
        if (++entries > LIMITS.entries) fail('too_large')
        if (entry.name.toLowerCase() === '.git') continue
        // Reject non-round-tripping names rather than sample a different path.
        const name = entry.name
        if (name.includes('\uFFFD')) fail('unsupported')
        const path = prefix ? `${prefix}/${name}` : name
        pathName(Buffer.from(path), new Set())
        children.push({ path, directory: entry.isDirectory() })
      }
    } finally { await handle.close().catch(error => { if (error.code !== 'ERR_DIR_CLOSED') throw error }) }
    if (!children.length) continue
    const queries = children.map(child => child.path + (child.directory ? '/' : ''))
    const input = queries.join('\0') + '\0'
    if (Buffer.byteLength(input) > LIMITS.listBytes) fail('too_large')
    const excluded = new Set()
    const ignored = await git(root, ['check-ignore', '--no-index', '-z', '--stdin'], budget, true, input)
    if (ignored) records(ignored, record => excluded.add(decode(record)), budget)
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (excluded.has(queries[i]) && !paths.has(child.path)) continue
      if (child.directory) pending.push(child.path)
      else pathName(Buffer.from(child.path), paths)
    }
  }
}

function frame(hash, value) {
  const bytes = typeof value === 'string' ? Buffer.from(value) : value
  frameLength(hash, bytes.length)
  hash.update(bytes)
}
function frameLength(hash, length) {
  const header = Buffer.alloc(8)
  header.writeBigUInt64BE(BigInt(length))
  hash.update(header)
}
const statSignature = stat => stat === null ? 'missing' : [stat.dev, stat.ino, stat.mode, stat.size, stat.mtimeNs, stat.ctimeNs].join(':')
const sameStat = (a, b) => statSignature(a) === statSignature(b)

async function stat(path, budget) {
  budget.check()
  try {
    const value = await lstat(path, { bigint: true })
    budget.check()
    return value
  } catch (error) {
    budget.check()
    if (error.code === 'ENOENT') return null
    if (error.code === 'ENOTDIR' || error.code === 'ELOOP') fail('unsafe_path')
    throw error
  }
}

function observe(observed, path, value) {
  if (observed.has(path) && !sameStat(observed.get(path), value)) fail('unstable')
  observed.set(path, value)
}

async function parents(root, path, observed, budget) {
  const parts = path.split('/').slice(0, -1)
  let directory = root
  for (const part of ['', ...parts]) {
    if (part) directory = join(directory, part)
    const value = await stat(directory, budget)
    observe(observed, directory, value)
    if (value === null) return false
    if (value.isSymbolicLink()) fail('unsafe_path')
    if (!value.isDirectory()) fail('unsupported')
  }
  // O_NOFOLLOW below protects the leaf; physical parent checks and subsequent
  // stat verification reject escapes/replacements instead of hashing a target.
  if (await realpath(directory) !== directory) fail('unsafe_path')
  budget.check()
  return true
}

function countBytes(bytes, pass, budget) {
  pass.bytes += bytes
  if (pass.bytes > LIMITS.totalBytes) fail('too_large')
  budget.check()
}

async function fileBytes(path, value, hash, pass, budget) {
  if (value.size > BigInt(LIMITS.fileBytes)) fail('too_large')
  const length = Number(value.size)
  countBytes(length, pass, budget)
  frameLength(hash, length)
  // NONBLOCK prevents a race replacing a regular file with a FIFO from hanging
  // the sampler. fstat rejects it; only regular descriptors are ever read.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    budget.check()
    const before = await handle.stat({ bigint: true })
    budget.check()
    if (!before.isFile() || !sameStat(before, value)) fail('unstable')
    const chunk = Buffer.alloc(Math.min(64 * 1024, Math.max(1, length)))
    let position = 0
    while (position < length) {
      budget.check()
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, length - position), position)
      budget.check()
      if (bytesRead === 0) fail('unstable')
      budget.readBytes += bytesRead
      if (budget.readBytes > LIMITS.readBytes) fail('too_large')
      hash.update(chunk.subarray(0, bytesRead))
      position += bytesRead
    }
    if (!sameStat(before, await handle.stat({ bigint: true }))) fail('unstable')
    budget.check()
  } finally { await handle.close() }
}

async function scan(cwd, budget) {
  const root = await repository(cwd, budget)
  const observed = new Map()
  const paths = await sourcePaths(root, budget, observed)
  const hash = createHash('sha256')
  frame(hash, SOURCE_SCHEME.id)
  frame(hash, root)
  const pass = { bytes: 0 }
  for (const path of paths) {
    budget.check()
    const absolute = join(root, ...path.split('/'))
    if (!inside(root, absolute)) fail('unsafe_path')
    const hasParents = await parents(root, path, observed, budget)
    const value = hasParents ? await stat(absolute, budget) : null
    observe(observed, absolute, value)
    frame(hash, path)
    if (value === null) {
      frame(hash, 'missing'); frame(hash, ''); frame(hash, Buffer.alloc(0))
    } else if (value.isSymbolicLink()) {
      if (value.size > BigInt(LIMITS.fileBytes)) fail('too_large')
      const link = await readlink(absolute, { encoding: 'buffer' })
      budget.check()
      if (link.length > LIMITS.fileBytes) fail('too_large')
      countBytes(link.length, pass, budget)
      budget.readBytes += link.length
      if (budget.readBytes > LIMITS.readBytes) fail('too_large')
      frame(hash, 'link'); frame(hash, ''); frame(hash, link)
    } else if (value.isFile()) {
      frame(hash, 'file'); frame(hash, (Number(value.mode) & 0o111).toString(8))
      await fileBytes(absolute, value, hash, pass, budget)
    } else fail('unsupported')
    if (hasParents) await parents(root, path, observed, budget)
    if (!sameStat(value, await stat(absolute, budget))) fail('unstable')
  }
  // Include the root witness even for an empty checkout. Validate every visited
  // entry at the end: a change after an earlier file was read is not accepted.
  if (!paths.length) await parents(root, '', observed, budget)
  const witnesses = createHash('sha256')
  for (const [path, value] of observed) {
    if (!sameStat(value, await stat(path, budget))) fail('unstable')
    frame(witnesses, path); frame(witnesses, statSignature(value))
  }
  budget.check()
  return { status: 'available', digest: `sha256:${hash.digest('hex')}`, files: paths.length, bytes: pass.bytes, witness: witnesses.digest('hex') }
}

function unavailable(error) {
  if (error instanceof SampleFailure) return { status: 'unavailable', reason: error.reason }
  if (['ENOENT', 'ELOOP', 'ENOTDIR'].includes(error?.code)) return { status: 'unavailable', reason: 'unstable' }
  return { status: 'unavailable', reason: 'unreadable' }
}

async function sourceSample(cwd) {
  const budget = {
    deadline: performance.now() + LIMITS.timeMs, readBytes: 0, expired: false, controller: new AbortController(),
    check() { if (this.expired || performance.now() >= this.deadline) fail('time_limit') },
  }
  let timer
  const deadline = new Promise(resolveDeadline => {
    timer = setTimeout(() => {
      budget.expired = true
      budget.controller.abort()
      resolveDeadline({ status: 'unavailable', reason: 'time_limit' })
    }, LIMITS.timeMs)
  })
  const sampling = (async () => {
    const first = await scan(resolve(cwd), budget)
    const second = await scan(resolve(cwd), budget)
    if (first.digest !== second.digest || first.witness !== second.witness) fail('unstable')
    const { witness, ...sample } = second
    return sample
  })().catch(unavailable)
  try { return await Promise.race([sampling, deadline]) }
  finally { clearTimeout(timer) }
}

// Budget escaped JSON, not string length. These labels are request identity,
// never error text, source paths, command output or an authorization grant.
function boundedLabel(text, maxBytes) {
  const original = typeof text === 'string' ? text : ''
  const cost = value => Buffer.byteLength(JSON.stringify(JSON.stringify(value)))
  if (cost(original) <= maxBytes) return { text: original, truncated: false }
  let low = 0
  let high = original.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (cost(original.slice(0, middle)) <= maxBytes) low = middle
    else high = middle - 1
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(original[low - 1])) low--
  return { text: original.slice(0, low), truncated: true, bytes: Buffer.byteLength(original), digest: `sha256:${createHash('sha256').update(original).digest('hex')}` }
}

/**
 * The command is persisted so an operator can tell what was checked, which
 * makes it a place a secret would otherwise be written to. Values that follow a
 * credential carrier are replaced; the digest still identifies the exact
 * command. This is a heuristic, so it is disclosed rather than claimed as
 * complete secret detection, and a command carrying a secret in an unusual
 * position is still a reason not to paste one into a check.
 */
const SECRET_HEADER = /(\bauthorization\s*:\s*)(?:bearer|basic|token|apikey)\s+[^\s"'&;]+/gi
const SECRET_OPTION = /((?:--?[\w-]*(?:token|key|secret|password|passwd|credential|auth)[\w-]*\s*(?:[=:]\s*|\s+)|\b[\w-]*(?:authorization|api[_-]?key|token|secret|password|passwd|credential)[\w-]*\s*[=:]\s*))(?:"[^"]*"|'[^']*'|[^\s"'&;]+)/gi
const REDACTED = '[redacted]'
function scrubbed(text) {
  return text.replace(SECRET_HEADER, (_match, carrier) => carrier + REDACTED)
    .replace(SECRET_OPTION, (_match, carrier) => carrier + REDACTED)
}

function identity(key, text, limit) {
  const original = typeof text === 'string' ? text : ''
  const safe = key === 'command' ? scrubbed(original) : original
  const label = boundedLabel(safe, limit)
  return {
    [key]: label.text, [key + 'Truncated']: label.truncated,
    [key + 'Digest']: 'sha256:' + createHash('sha256').update(original).digest('hex'),
    ...(safe !== original ? { [key + 'Scrubbed']: true } : {}),
    ...(label.truncated ? { [key + 'Bytes']: Buffer.byteLength(original) } : {}),
  }
}

/**
 * Full-capability SDK shell execution with bounded host-observed source/process
 * evidence. This is not a sandbox or verifier; ordinary bash remains separate.
 * @param {string} cwd
 */
export function createCodingCheckTool(cwd) {
  const definition = createBashToolDefinition(cwd)
  const local = createLocalBashOperations()
  const outputSchema = Type.Object({
    output: Type.String(), truncated: Type.Boolean(),
    exit_code: Type.Union([Type.Integer(), Type.Null()]), wall_time_seconds: Type.Number(),
    codingCheck: Type.Object({
      version: Type.Literal(1), toolCallId: Type.String(), toolCallIdTruncated: Type.Boolean(),
      command: Type.String(), commandTruncated: Type.Boolean(), commandDigest: Type.String(),
      commandScrubbed: Type.Optional(Type.Boolean()), commandBytes: Type.Optional(Type.Integer()),
      cwd: Type.String(), cwdTruncated: Type.Boolean(), cwdDigest: Type.String(), cwdBytes: Type.Optional(Type.Integer()),
      toolCallIdDigest: Type.String(), toolCallIdBytes: Type.Optional(Type.Integer()),
      outcome: Type.Union(['exited', 'aborted', 'timed_out', 'error'].map(value => Type.Literal(value))),
      exitCode: Type.Union([Type.Integer(), Type.Null()]),
      before: Type.Object({ status: Type.String(), digest: Type.Optional(Type.String()), reason: Type.Optional(Type.String()), files: Type.Optional(Type.Integer()), bytes: Type.Optional(Type.Integer()) }),
      after: Type.Object({ status: Type.String(), digest: Type.Optional(Type.String()), reason: Type.Optional(Type.String()), files: Type.Optional(Type.Integer()), bytes: Type.Optional(Type.Integer()) }),
      sourceBinding: Type.Union(['matching', 'changed', 'unavailable'].map(value => Type.Literal(value))),
      sourceScheme: Type.Object({ id: Type.String(), scope: Type.String(), digest: Type.String(), stability: Type.String(), outsideSource: Type.String(), limits: Type.Record(Type.String(), Type.Number()) }),
    }),
  })
  return {
    ...definition,
    name: 'coding_check', label: 'coding_check', outputSchema,
    description: `${definition.description} Adds host-observed exit and before/after source evidence. Matching samples are not immutable; this is not independent verification and exit zero does not establish test adequacy. Commands retain full bash capability, not a sandbox.`,
    promptSnippet: 'Run a command with host-observed process and source-sample evidence, not verification',
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const startedAt = performance.now()
      let executionCwd = ctx?.cwd || cwd
      let executionCommand = params.command
      const before = await sourceSample(executionCwd)
      let observation = { outcome: 'error', exitCode: null }
      let lastUpdate
      let result
      const bash = createBashToolDefinition(cwd, {
        operations: {
          async exec(command, actualCwd, options) {
            executionCommand = command
            executionCwd = actualCwd
            try {
              const observed = await local.exec(command, actualCwd, options)
              observation = { outcome: Number.isInteger(observed.exitCode) ? 'exited' : 'error', exitCode: Number.isInteger(observed.exitCode) ? observed.exitCode : null }
              return observed
            } catch (error) {
              if (error instanceof Error && error.message === 'aborted') observation = { outcome: 'aborted', exitCode: null }
              else if (error instanceof Error && error.message === `timeout:${options.timeout}`) observation = { outcome: 'timed_out', exitCode: null }
              throw error
            }
          },
        },
      })
      try {
        result = await bash.execute(toolCallId, params, signal, partial => { lastUpdate = partial; onUpdate?.(partial) }, ctx)
      } catch (error) {
        // Only the known SDK status wrappers carry captured command output.
        // Never parse model/output prose for exit status or echo unknown errors.
        const status = observation.outcome === 'aborted' ? 'Command aborted'
          : observation.outcome === 'timed_out' ? `Command timed out after ${params.timeout} seconds`
            : observation.outcome === 'exited' && observation.exitCode !== 0 ? `Command exited with code ${observation.exitCode}` : null
        const known = status && error instanceof Error && (error.message === status || error.message.endsWith(`\n\n${status}`))
        const fallback = 'Command execution evidence unavailable.'
        result = { content: [{ type: 'text', text: known ? error.message : fallback }],
          details: known ? lastUpdate?.details : undefined, isError: true,
          // SDK errors carry the rendered text (including the temp-file footer),
          // but its final streamed snapshot contains only bounded command output.
          structuredContent: { output: known
            ? [...(lastUpdate?.content ?? []).filter(part => part.type === 'text').map(part => part.text), status].filter(Boolean).join('\n\n')
            : fallback },
        }
        if (!known) observation = { outcome: 'error', exitCode: null }
      }
      const after = await sourceSample(executionCwd)
      // Use raw structured output, never SDK display content: truncation footers
      // in that content embed a temporary full-output path. Error paths above
      // instead use the final raw streaming snapshot and observed status.
      const joined = result.structuredContent.output
      const outputText = boundedLabel(joined, OUTPUT_BYTES).text
      const outputTruncated = outputText !== joined
      const codingCheck = {
        version: 1,
        ...identity('toolCallId', toolCallId, 256),
        ...identity('command', executionCommand, 2048),
        ...identity('cwd', executionCwd, 1024),
        ...observation, before, after,
        sourceBinding: before.status !== 'available' || after.status !== 'available' ? 'unavailable' : before.digest === after.digest ? 'matching' : 'changed',
        sourceScheme: SOURCE_SCHEME,
      }
      return {
        ...result,
        content: [...result.content, { type: 'text', text: JSON.stringify({ codingCheck }) }],
        details: { ...result.details, codingCheck },
        isError: observation.outcome !== 'exited' || observation.exitCode !== 0,
        // A script receives the same bound the model sees. The SDK's own bash
        // structured output can carry up to 1 MiB and a temp file path, which
        // would inflate the persisted tool result and the QuickJS payload.
        structuredContent: {
          output: outputText,
          truncated: Boolean(result.structuredContent.truncated || result.details?.truncation?.truncated) || outputTruncated,
          exit_code: observation.exitCode,
          wall_time_seconds: Math.round((performance.now() - startedAt) / 100) / 10,
          codingCheck,
        },
      }
    },
  }
}
