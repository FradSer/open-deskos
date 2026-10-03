import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { execFile, spawn } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { createBashToolDefinition, SessionManager } from '@earendil-works/pi-coding-agent'

let testRoot
let originalEnv
let isolatedEnv

// All real processes in this file use scratch HOME/config and a known executable
// path. No project scripts, user shell startup files, credentials or providers run.
before(async () => {
  testRoot = await realpath(await mkdtemp(join(tmpdir(), 'coding-check-tests-')))
  await mkdir(join(testRoot, 'home'))
  originalEnv = { ...process.env }
  isolatedEnv = {
    PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.platform === 'win32' ? (process.env.SystemRoot ?? 'C:\\Windows') + '\\System32' : '/usr/bin:/bin'}`,
    HOME: join(testRoot, 'home'), USERPROFILE: join(testRoot, 'home'),
    XDG_CONFIG_HOME: join(testRoot, 'home'), TMPDIR: testRoot, TEMP: testRoot, TMP: testRoot,
    LANG: 'C', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_SYSTEM: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, ProgramFiles: process.env.ProgramFiles } : {}),
  }
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, isolatedEnv)
})

after(async () => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, originalEnv)
  await rm(testRoot, { recursive: true, force: true })
})

function git(cwd, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'core.fsmonitor=false', ...args], {
      cwd, env: isolatedEnv, encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()))
    child.stdin.on('error', () => {})
    child.stdin.end(input ?? '')
  })
}

async function fixture(t, tracked = { 'source.txt': 'original source\n' }) {
  const dir = await mkdtemp(join(testRoot, 'fixture-'))
  const repo = join(dir, 'repo')
  await mkdir(repo)
  await git(repo, ['init', '--quiet'])
  for (const [path, content] of Object.entries(tracked)) {
    await mkdir(dirname(join(repo, path)), { recursive: true })
    await writeFile(join(repo, path), content)
  }
  if (Object.keys(tracked).length) await git(repo, ['add', '--all'])
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, repo }
}

const quote = value => `'${value.replaceAll("'", "'\\''")}'`
const command = code => `${quote(process.execPath)} -e ${quote(code)}`
const output = result => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')

async function tool(cwd) {
  const { createCodingCheckTool } = await import('../src/candidate-checks.mjs')
  return createCodingCheckTool(cwd)
}

async function check(cwd, code = 'console.log("checked")', { timeout, signal, onUpdate, ctx } = {}) {
  const definition = await tool(cwd)
  return definition.execute('fixture-check', { command: command(code), ...(timeout === undefined ? {} : { timeout }) }, signal, onUpdate, ctx)
}

function evidence(result) {
  const value = result.details?.codingCheck
  assert.equal(value?.version, 1)
  assert.ok(['exited', 'aborted', 'timed_out', 'error'].includes(value.outcome))
  assert.ok(value.exitCode === null || Number.isInteger(value.exitCode))
  assert.ok(['matching', 'changed', 'unavailable'].includes(value.sourceBinding))
  for (const sample of [value.before, value.after]) {
    assert.ok(['available', 'unavailable'].includes(sample.status))
    if (sample.status === 'available') {
      assert.match(sample.digest, /^sha256:[a-f0-9]{64}$/)
      assert.ok(Number.isSafeInteger(sample.files) && sample.files >= 0)
      assert.ok(Number.isSafeInteger(sample.bytes) && sample.bytes >= 0)
    } else {
      assert.match(sample.reason, /^[a-z_]+$/)
      assert.equal(sample.digest, undefined)
    }
  }
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < 8 * 1024)
  assert.ok(Buffer.byteLength(JSON.stringify(JSON.stringify(value))) < 8 * 1024)
  assert.equal(result.isError ?? false, value.outcome !== 'exited' || value.exitCode !== 0)
  assert.deepEqual(result.structuredContent.codingCheck, value)
  const textEvidence = result.content.find(part => part.type === 'text' && part.text.startsWith('{"codingCheck":'))
  assert.deepEqual(JSON.parse(textEvidence.text).codingCheck, value)
  assert.match(JSON.stringify(value.sourceScheme), /SHA-256/i)
  assert.match(JSON.stringify(value.sourceScheme), /environment/i)
  assert.match(JSON.stringify(value.sourceScheme), /external services/i)
  assert.match(JSON.stringify(value.sourceScheme), /ignored/i)
  assert.match(JSON.stringify(value.sourceScheme), /not (?:an )?(?:atomic|immutable)/i)
  assert.equal(value.verification, undefined)
  assert.equal(value.verified, undefined)
  return value
}

// Given the readable fixture Git project, when a harmless process exits, then
// the host records matching samples, not an independent verifier or certification.
test('full SDK command contract is retained under a separate coding_check tool', async t => {
  const f = await fixture(t)
  const definition = await tool(f.repo)
  const bash = createBashToolDefinition(f.repo)
  assert.equal(definition.name, 'coding_check')
  assert.equal(bash.name, 'bash')
  assert.deepEqual(definition.parameters, bash.parameters)
  assert.match(definition.description, /evidence/i)
  assert.match(definition.description, /not.*verif/i)
  const result = await check(f.repo)
  const value = evidence(result)
  assert.equal(value.outcome, 'exited')
  assert.equal(value.exitCode, 0)
  assert.equal(value.sourceBinding, 'matching')
  assert.equal(value.before.files, 1)
  assert.deepEqual(value.before, value.after)
  assert.match(output(result), /checked/)
})

test('unchanged candidate evidence survives the actual SDK persisted session format', async t => {
  const f = await fixture(t)
  const result = await check(f.repo)
  const manager = SessionManager.create(f.repo, join(f.dir, 'sessions'))
  manager.appendMessage({ role: 'user', content: 'Run a harmless check', timestamp: Date.now() })
  manager.appendMessage({
    role: 'assistant', content: [{ type: 'toolCall', id: 'fixture-check', name: 'coding_check', arguments: { command: command('console.log("checked")') } }],
    api: 'test', provider: 'test', model: 'test', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: Date.now(),
  })
  manager.appendMessage({ role: 'toolResult', toolCallId: 'fixture-check', toolName: 'coding_check', ...result, isError: false, timestamp: Date.now() })
  const reopened = SessionManager.open(manager.getSessionFile()).getEntries().find(entry => entry.type === 'message' && entry.message.role === 'toolResult')
  assert.deepEqual(reopened.message.details.codingCheck, result.details.codingCheck)
  assert.deepEqual(reopened.message.content, result.content)
})

test('subdirectory checks and SDK execution cwd overrides sample the entire containing repo', async t => {
  const f = await fixture(t, { 'source.txt': 'root source', 'nested/child.txt': 'child source' })
  const value = evidence(await check(join(f.repo, 'nested')))
  const root = evidence(await check(f.repo))
  assert.equal(value.before.files, 2)
  assert.equal(value.before.digest, root.before.digest)
  const changed = evidence(await check(f.dir, 'require("node:fs").writeFileSync("../source.txt", "changed from subdir")', { ctx: { cwd: join(f.repo, 'nested'), sessionManager: { getSessionId: () => 'fixture', getSessionFile: () => undefined } } }))
  assert.equal(changed.sourceBinding, 'changed')
  assert.equal(changed.before.digest, root.before.digest)
})

test('nonzero process exit retains output and exact evidence instead of throwing it away', async t => {
  const f = await fixture(t)
  const result = await check(f.repo, 'console.log("failure output"); process.exit(7)')
  const value = evidence(result)
  assert.equal(value.outcome, 'exited')
  assert.equal(value.exitCode, 7)
  assert.equal(value.sourceBinding, 'matching')
  assert.match(output(result), /failure output/)
  assert.match(output(result), /Command exited with code 7/)
})

test('a check that writes source reports changed samples even when its exit is zero', async t => {
  const f = await fixture(t)
  const value = evidence(await check(f.repo, 'require("node:fs").writeFileSync("source.txt", "mutated source"); console.log("wrote source")'))
  assert.equal(value.exitCode, 0)
  assert.equal(value.sourceBinding, 'changed')
  assert.notEqual(value.before.digest, value.after.digest)
})

test('same-length unstaged content changes affect the digest, not only HEAD or diff status', async t => {
  const f = await fixture(t, { 'source.txt': 'alpha' })
  const first = evidence(await check(f.repo)).before.digest
  await writeFile(join(f.repo, 'source.txt'), 'bravo')
  const second = evidence(await check(f.repo)).before.digest
  assert.notEqual(first, second)
  await writeFile(join(f.repo, 'source.txt'), 'alpha')
  assert.equal(evidence(await check(f.repo)).before.digest, first)
})

test('tracked deletions have explicit missing entries and nonignored new bytes affect identity', async t => {
  const f = await fixture(t)
  const first = evidence(await check(f.repo)).before
  await unlink(join(f.repo, 'source.txt'))
  const deleted = evidence(await check(f.repo)).before
  assert.equal(deleted.files, first.files)
  assert.equal(deleted.bytes, 0)
  assert.notEqual(deleted.digest, first.digest)
  await writeFile(join(f.repo, 'new.txt'), 'nonignored new content')
  const added = evidence(await check(f.repo)).before
  assert.equal(added.files, 2)
  assert.notEqual(added.digest, deleted.digest)
})

test('staged deletions remain represented by HEAD tracked paths', async t => {
  const f = await fixture(t)
  // Construct scratch HEAD with plumbing; no project commit or user hook runs.
  const tree = await git(f.repo, ['write-tree'])
  const commit = await git(f.repo, ['commit-tree', tree, '-m', 'isolated fixture'])
  await git(f.repo, ['update-ref', 'HEAD', commit])
  const initial = evidence(await check(f.repo)).before
  await git(f.repo, ['rm', '--quiet', 'source.txt'])
  const deleted = evidence(await check(f.repo)).before
  assert.equal(deleted.files, 1)
  assert.equal(deleted.bytes, 0)
  assert.notEqual(deleted.digest, initial.digest)
})

test('missing tracked parent directories retain explicit deleted file records', async t => {
  const f = await fixture(t, { 'nested/source.txt': 'nested source' })
  const first = evidence(await check(f.repo)).before.digest
  await rm(join(f.repo, 'nested'), { recursive: true })
  const value = evidence(await check(f.repo))
  assert.equal(value.before.status, 'available')
  assert.equal(value.before.files, 1)
  assert.equal(value.before.bytes, 0)
  assert.notEqual(value.before.digest, first)
})

test('sorted path identity handles whitespace, renames and deletion/recreation ordering', async t => {
  const f = await fixture(t, {})
  await writeFile(join(f.repo, 'b\nsource.txt'), 'b source')
  await writeFile(join(f.repo, 'a\t source.txt'), 'a source')
  const first = evidence(await check(f.repo)).before.digest
  await unlink(join(f.repo, 'b\nsource.txt'))
  await unlink(join(f.repo, 'a\t source.txt'))
  await writeFile(join(f.repo, 'a\t source.txt'), 'a source')
  await writeFile(join(f.repo, 'b\nsource.txt'), 'b source')
  assert.equal(evidence(await check(f.repo)).before.digest, first)
  await unlink(join(f.repo, 'b\nsource.txt'))
  await writeFile(join(f.repo, 'renamed.txt'), 'b source')
  assert.notEqual(evidence(await check(f.repo)).before.digest, first)
})

test('filesystem executable bits affect source identity independently of git core.fileMode', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  await git(f.repo, ['config', 'core.fileMode', 'false'])
  await chmod(join(f.repo, 'source.txt'), 0o644)
  const first = evidence(await check(f.repo)).before.digest
  await chmod(join(f.repo, 'source.txt'), 0o744)
  assert.notEqual(evidence(await check(f.repo)).before.digest, first)
  await chmod(join(f.repo, 'source.txt'), 0o644)
  assert.equal(evidence(await check(f.repo)).before.digest, first)
})

test('symlinks hash link text, never the external target content', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  const secret = 'outside-content-must-not-be-recorded'
  await writeFile(join(f.dir, 'external.txt'), secret)
  await symlink('../external.txt', join(f.repo, 'linked.txt'))
  const first = evidence(await check(f.repo))
  assert.equal(first.before.files, 2)
  await writeFile(join(f.dir, 'external.txt'), 'different external content')
  const second = evidence(await check(f.repo))
  assert.equal(second.before.digest, first.before.digest)
  await unlink(join(f.repo, 'linked.txt'))
  await symlink('../another-external.txt', join(f.repo, 'linked.txt'))
  const changed = evidence(await check(f.repo))
  assert.notEqual(changed.before.digest, first.before.digest)
  assert.ok(!JSON.stringify(changed).includes(secret))
  assert.equal(changed.cwd, f.repo)
  assert.ok(!JSON.stringify([changed.before, changed.after]).includes(f.dir))
  assert.ok(!JSON.stringify(changed).includes('linked.txt'))
})

test('ignored untracked files are excluded while tracked ignore-pattern matches are included', async t => {
  const f = await fixture(t, { '.gitignore': '*.ignored\n', 'source.txt': 'tracked' })
  const first = evidence(await check(f.repo)).before.digest
  await writeFile(join(f.repo, 'private.ignored'), 'ignored private output')
  assert.equal(evidence(await check(f.repo)).before.digest, first)
  await writeFile(join(f.repo, 'tracked.ignored'), 'tracked despite pattern')
  await git(f.repo, ['add', '-f', 'tracked.ignored'])
  const tracked = evidence(await check(f.repo)).before.digest
  assert.notEqual(tracked, first)
  await writeFile(join(f.repo, 'tracked.ignored'), 'updated tracked content')
  assert.notEqual(evidence(await check(f.repo)).before.digest, tracked)
})

test('sampling does not mutate the index or honor inherited Git workspace/config overrides', async t => {
  const f = await fixture(t)
  const other = await fixture(t, { 'foreign.txt': 'foreign' })
  const first = evidence(await check(f.repo)).before.digest
  const index = await readFile(join(f.repo, '.git', 'index'))
  const previous = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE, GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT, GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0, GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0 }
  Object.assign(process.env, { GIT_DIR: join(other.repo, '.git'), GIT_WORK_TREE: other.repo, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: other.repo })
  try {
    assert.equal(evidence(await check(f.repo)).before.digest, first)
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value
  }
  assert.deepEqual(await readFile(join(f.repo, '.git', 'index')), index)
  await assert.rejects(lstat(join(f.repo, '.git', 'index.lock')), { code: 'ENOENT' })
})

test('non-Git scope still executes the requested command without inventing an identity', async t => {
  const dir = await mkdtemp(join(testRoot, 'non-git-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const result = await check(dir, 'console.log("non-git command ran")')
  const value = evidence(result)
  assert.equal(value.exitCode, 0)
  assert.equal(value.sourceBinding, 'unavailable')
  assert.equal(value.before.status, 'unavailable')
  assert.equal(value.after.status, 'unavailable')
  assert.match(output(result), /non-git command ran/)
  assert.equal(value.cwd, dir)
  assert.ok(!JSON.stringify([value.before, value.after]).includes(dir))
})

test('oversized regular files fail sampling without preventing command execution', async t => {
  const f = await fixture(t)
  const initial = evidence(await check(f.repo))
  const file = await open(join(f.repo, 'oversized.txt'), 'w')
  try { await file.truncate(initial.sourceScheme.limits.fileBytes + 1) } finally { await file.close() }
  const result = await check(f.repo, 'console.log("oversized command ran")')
  const value = evidence(result)
  assert.equal(value.sourceBinding, 'unavailable')
  assert.equal(value.before.reason, 'too_large')
  assert.equal(value.exitCode, 0)
  assert.match(output(result), /oversized command ran/)
})

test('total byte budget rejects excessive scope while the command still runs', async t => {
  const f = await fixture(t)
  const initial = evidence(await check(f.repo))
  const { fileBytes, totalBytes } = initial.sourceScheme.limits
  for (let i = 0; i <= Math.floor(totalBytes / fileBytes); i++) {
    const handle = await open(join(f.repo, `large-${i}.txt`), 'w')
    try { await handle.truncate(fileBytes) } finally { await handle.close() }
  }
  const value = evidence(await check(f.repo))
  assert.equal(value.before.status, 'unavailable')
  assert.equal(value.before.reason, 'too_large')
  assert.equal(value.exitCode, 0)
})

test('file-count budget rejects an oversized index without reading arbitrary path content', async t => {
  const f = await fixture(t, {})
  const initial = evidence(await check(f.repo))
  const hash = await git(f.repo, ['hash-object', '-w', '--stdin'], '')
  const index = Array.from({ length: initial.sourceScheme.limits.files + 1 }, (_, i) => `100644 ${hash}\tmissing-${String(i).padStart(5, '0')}\n`).join('')
  await git(f.repo, ['update-index', '--index-info'], index)
  const value = evidence(await check(f.repo))
  assert.equal(value.before.reason, 'too_large')
  assert.equal(value.exitCode, 0)
})

test('unreadable source reports unavailable, never a partial digest', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, async t => {
  const f = await fixture(t)
  const file = join(f.repo, 'source.txt')
  await chmod(file, 0)
  t.after(() => chmod(file, 0o600).catch(() => {}))
  const result = await check(f.repo)
  const value = evidence(result)
  assert.equal(value.before.status, 'unavailable')
  assert.equal(value.before.reason, 'unreadable')
  assert.equal(value.exitCode, 0)
})

test('tracked paths below a symlinked parent do not escape the project', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, { 'nested/source.txt': 'inside' })
  await mkdir(join(f.dir, 'outside'))
  await writeFile(join(f.dir, 'outside', 'source.txt'), 'external private source')
  await rm(join(f.repo, 'nested'), { recursive: true })
  await symlink('../outside', join(f.repo, 'nested'))
  const result = await check(f.repo)
  const value = evidence(result)
  assert.equal(value.before.status, 'unavailable')
  assert.equal(value.before.reason, 'unsafe_path')
  assert.equal(value.exitCode, 0)
  assert.ok(!JSON.stringify(value).includes('external private source'))
})

test('Git submodule entries are unavailable rather than silently omitted', async t => {
  const f = await fixture(t)
  await git(f.repo, ['update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},submodule`])
  const value = evidence(await check(f.repo))
  assert.equal(value.before.reason, 'submodule')
  assert.equal(value.sourceBinding, 'unavailable')
  assert.equal(value.exitCode, 0)
})

test('tracked special source files are rejected before opening them', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  await unlink(join(f.repo, 'source.txt'))
  await new Promise((resolve, reject) => execFile('mkfifo', [join(f.repo, 'source.txt')], { env: isolatedEnv, timeout: 5000 }, error => error ? reject(error) : resolve()))
  const value = evidence(await check(f.repo, 'console.log("special command ran")'))
  assert.equal(value.before.reason, 'unsupported')
  assert.equal(value.exitCode, 0)
})

test('nonignored untracked special files are unavailable even when Git omits them', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t, { '.gitignore': '*.ignored\n', 'source.txt': 'regular' })
  const first = evidence(await check(f.repo)).before.digest
  await new Promise((resolve, reject) => execFile('mkfifo', [join(f.repo, 'pipe.ignored')], { env: isolatedEnv, timeout: 5000 }, error => error ? reject(error) : resolve()))
  assert.equal(evidence(await check(f.repo)).before.digest, first)
  await new Promise((resolve, reject) => execFile('mkfifo', [join(f.repo, 'visible-pipe')], { env: isolatedEnv, timeout: 5000 }, error => error ? reject(error) : resolve()))
  const value = evidence(await check(f.repo))
  assert.equal(value.before.reason, 'unsupported')
  assert.equal(value.exitCode, 0)
})

test('unstable source is rejected by repeated samples and read-time stat checks', async t => {
  const f = await fixture(t)
  const file = join(f.repo, 'source.txt')
  await writeFile(file, Buffer.alloc(4 * 1024 * 1024, 65))
  const child = spawn(process.execPath, ['-e', 'const fs=require("node:fs"); const fd=fs.openSync(process.argv[1], "r+"); process.stdout.write("ready\\n"); let i=0; const b=Buffer.alloc(1); while(true){b[0]=i++%256; fs.writeSync(fd,b,0,1,0)}', file], { env: isolatedEnv, stdio: ['ignore', 'pipe', 'pipe'] })
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  t.after(async () => { child.kill('SIGKILL'); await closed })
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject) })
  const value = evidence(await check(f.repo))
  assert.equal(value.sourceBinding, 'unavailable')
  assert.equal(value.before.reason, 'unstable')
  assert.equal(value.exitCode, 0)
})

test('source restored during execution has matching samples without an immutable/ABA claim', async t => {
  const f = await fixture(t)
  const value = evidence(await check(f.repo, 'const fs=require("node:fs"); const original=fs.readFileSync("source.txt"); fs.writeFileSync("source.txt","temporary"); fs.writeFileSync("source.txt",original)'))
  assert.equal(value.sourceBinding, 'matching')
  assert.equal(value.before.digest, value.after.digest)
  assert.match(value.sourceScheme.stability, /cannot exclude intermediate or ABA changes/)
})

test('signal-killed shell records the SDK nonzero signal code rather than exit zero', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  const definition = await tool(f.repo)
  const result = await definition.execute('signal-check', { command: 'kill -TERM $$' }, undefined, undefined, undefined)
  const value = evidence(result)
  assert.equal(value.outcome, 'exited')
  assert.equal(value.exitCode, 143)
  assert.equal(result.isError, true)
})

test('SDK timeout preserves bounded partial output and a distinct timed_out outcome', async t => {
  const f = await fixture(t)
  const result = await check(f.repo, 'console.log("timeout output"); setInterval(()=>{}, 1000)', { timeout: 0.2 })
  const value = evidence(result)
  assert.equal(value.outcome, 'timed_out')
  assert.equal(value.exitCode, null)
  assert.match(output(result), /timeout output/)
  assert.match(output(result), /Command timed out/)
})

test('SDK cancellation retains streamed output and never records an exit-zero check', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  const updates = []
  const result = await check(f.repo, 'console.log("cancel output"); setInterval(()=>{}, 1000)', {
    signal: controller.signal,
    onUpdate: partial => { updates.push(partial); if (output(partial).includes('cancel output')) controller.abort() },
  })
  const value = evidence(result)
  assert.equal(value.outcome, 'aborted')
  assert.equal(value.exitCode, null)
  assert.ok(updates.some(partial => output(partial).includes('cancel output')))
  assert.match(output(result), /cancel output/)
  assert.match(output(result), /Command aborted/)
})

test('large failing output uses the SDK bounds and keeps evidence smaller than 8 KiB', async t => {
  const f = await fixture(t)
  const result = await check(f.repo, 'process.stdout.write("x".repeat(100000), () => process.exit(3))')
  const value = evidence(result)
  assert.equal(value.exitCode, 3)
  assert.equal(value.outcome, 'exited')
  assert.equal(result.details.truncation.truncated, true)
  assert.ok(result.details.fullOutputPath.startsWith(testRoot))
  assert.ok(Buffer.byteLength(output(result)) < 64 * 1024)
  assert.equal((await readFile(result.details.fullOutputPath)).length, 100000)
  assert.ok(!JSON.stringify(value).includes(result.details.fullOutputPath))
})

test('command/cwd/call identity is exact when small and explicitly truncated within escaped evidence bounds', async t => {
  const f = await fixture(t)
  const definition = await tool(f.repo)
  const exact = command('console.log("identity")')
  const value = evidence(await definition.execute('call-exact', { command: exact }, undefined, undefined, undefined))
  assert.equal(value.toolCallId, 'call-exact')
  assert.equal(value.command, exact)
  assert.equal(value.cwd, f.repo)
  assert.equal(value.commandTruncated, false)
  assert.equal(value.cwdTruncated, false)
  const largeCommand = command('console.log("bounded identity")') + '\n#' + '\\'.repeat(20000)
  const bounded = evidence(await definition.execute('call-' + 'x'.repeat(2000), { command: largeCommand }, undefined, undefined, undefined))
  assert.equal(bounded.commandTruncated, true)
  assert.equal(bounded.commandBytes, Buffer.byteLength(largeCommand))
  assert.match(bounded.commandDigest, /^sha256:[a-f0-9]{64}$/)
  assert.ok(largeCommand.startsWith(bounded.command))
  assert.equal(bounded.toolCallIdTruncated, true)
  assert.equal(bounded.exitCode, 0)
})

test('a credential in the command is scrubbed from persisted evidence while the digest still identifies it', async t => {
  const f = await fixture(t)
  const secret = 'sup3rs3cr3t'
  const commandLine = command('process.exit(9)') + " -- --header='Authorization: Bearer " + secret + "' --token=" + secret + " API_KEY=" + secret
  const definition = await tool(f.repo)
  const result = await definition.execute('redacted-check', { command: commandLine }, undefined, undefined, undefined)
  const value = evidence(result)
  const serialized = JSON.stringify(value)
  assert.ok(!serialized.includes(secret), 'the command label must not carry a credential value')
  assert.match(value.command, /\[redacted\]/)
  assert.equal(value.commandScrubbed, true)
  assert.equal(value.commandDigest, 'sha256:' + createHash('sha256').update(commandLine).digest('hex'))
  assert.notEqual(value.commandDigest, 'sha256:' + createHash('sha256').update(value.command).digest('hex'))
  assert.equal(value.outcome, 'exited', 'the command still runs; its outcome is reported as observed')
  assert.equal(value.exitCode, 9)
  assert.equal(value.cwdScrubbed, undefined)
})

test('structured output a script receives stays inside the model-facing bound', async t => {
  const f = await fixture(t)
  const definition = await tool(f.repo)
  const result = await definition.execute('structured-check', { command: command('process.stdout.write("y".repeat(2 * 1024 * 1024))') }, undefined, undefined, undefined)
  const value = evidence(result)
  assert.equal(value.exitCode, 0)
  assert.ok(Buffer.byteLength(result.structuredContent.output) <= 64 * 1024)
  assert.equal(result.structuredContent.truncated, true)
  assert.equal(result.structuredContent.full_output_path, undefined, 'a temp path must not cross into a script payload')
  assert.ok(result.structuredContent.codingCheck)
})

for (const exitCode of [0, 3]) {
  test('line-truncated output excludes the SDK temporary path for exit ' + exitCode, async t => {
    const f = await fixture(t)
    const result = await check(f.repo, 'process.stdout.write("short line\\n".repeat(2001), () => process.exit(' + exitCode + '))')
    const value = evidence(result)
    const path = result.details.fullOutputPath
    assert.equal(value.exitCode, exitCode)
    assert.equal(result.details.truncation.truncatedBy, 'lines', 'regression must trigger line truncation below the byte cap')
    assert.ok(path.startsWith(testRoot))
    assert.ok(Buffer.byteLength(result.structuredContent.output) < 64 * 1024)
    assert.equal(result.structuredContent.truncated, true)
    assert.ok(!JSON.stringify(result.structuredContent).includes(path), 'temporary full-output path must not appear in text either')
    assert.ok(!result.structuredContent.output.includes('Full output:'), 'SDK display footer is not command output')
    assert.ok(result.structuredContent.output.includes('short line'))
    if (exitCode !== 0) assert.equal(result.isError, true)
  })
}

test('interrupted line-truncated output excludes the SDK path and retains observed status', async t => {
  const f = await fixture(t)
  const result = await check(f.repo, 'process.stdout.write("short line\\n".repeat(2001)); setInterval(() => {}, 1000)', { timeout: 0.2 })
  const value = evidence(result)
  const path = result.details.fullOutputPath
  assert.equal(value.outcome, 'timed_out')
  assert.equal(value.exitCode, null)
  assert.equal(result.details.truncation.truncatedBy, 'lines')
  assert.ok(path.startsWith(testRoot))
  assert.ok(Buffer.byteLength(result.structuredContent.output) < 64 * 1024)
  assert.equal(result.structuredContent.truncated, true)
  assert.ok(!JSON.stringify(result.structuredContent).includes(path))
  assert.match(result.structuredContent.output, /short line/)
  assert.match(result.structuredContent.output, /Command timed out/)
})

test('cancelled line-truncated output excludes the SDK path without losing cancellation', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  const result = await check(f.repo, 'process.stdout.write("short line\\n".repeat(2001)); setInterval(() => {}, 1000)', {
    signal: controller.signal,
    onUpdate: partial => { if (partial.details?.truncation?.truncated) controller.abort() },
  })
  const value = evidence(result)
  const path = result.details.fullOutputPath
  assert.equal(value.outcome, 'aborted')
  assert.equal(value.exitCode, null)
  assert.equal(result.details.truncation.truncatedBy, 'lines')
  assert.ok(path.startsWith(testRoot))
  assert.equal(result.structuredContent.truncated, true)
  assert.ok(!JSON.stringify(result.structuredContent).includes(path))
  assert.match(result.structuredContent.output, /short line/)
  assert.match(result.structuredContent.output, /Command aborted/)
})

test('invalid execution options and unexpected SDK errors do not leak raw messages', async t => {
  const f = await fixture(t)
  const invalid = evidence(await check(f.repo, 'console.log("must not run")', { timeout: -1 }))
  assert.equal(invalid.outcome, 'error')
  assert.equal(invalid.exitCode, null)
  const secret = 'untrusted-sdk-error-secret'
  const result = await check(f.repo, 'console.log("must not run")', {
    ctx: { cwd: f.repo, sessionManager: { getSessionId() { throw new Error(secret) } } },
  })
  const value = evidence(result)
  assert.equal(value.outcome, 'error')
  assert.equal(value.exitCode, null)
  assert.ok(!JSON.stringify(result).includes(secret))
  assert.equal(value.cwd, f.repo)
  assert.ok(!JSON.stringify([value.before, value.after]).includes(f.repo))
})
