const test = require('node:test')
const assert = require('node:assert/strict')
const { createPiSessionsSource, dedupeSnapshot } = require('../src/pi-sessions-source')
const { scanPiSessions } = require('../src/pi-sessions')
const fs = require('node:fs')
const os = require('node:os')
const { execFileSync, spawnSync } = require('node:child_process')
const path = require('node:path')

const env = { ODK_PI_SSH_HOST: 'desk-mac', ODK_PI_SSH_NODE: '/opt/homebrew/bin/node', ODK_PI_SSH_COLLECTOR: '/Users/example/.local/share/open-deskos/pi-sessions-snapshot.js' }
function snapshot() {
  return { ok: true, scannedAt: Date.now(), summary: { total: 1, running: 1, settled: 0, exited: 0, workspacesCount: 1 }, sessions: [{ pid: 42, status: 'running', isAlive: true }], workspaces: [{ sessions: [] }] }
}
function remote(options = {}) {
  return createPiSessionsSource({ env, scanLocal: () => { throw new Error('must not fall back') }, ...options })
}
test('deployed snapshot entry point emits a snapshot accepted by SSH provider', async () => {
  // Process inspection can be slow when the full Node suite is running on a
  // loaded development host. Keep a finite bound without making parallel test
  // scheduling look like a collector failure.
  const output = execFileSync(process.execPath, [path.join(__dirname, '../scripts/pi-sessions-snapshot.js')], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 })
  const data = JSON.parse(output)
  assert.equal(data.ok, true)
  assert.ok(Array.isArray(data.sessions))
  assert.equal(data.summary.total, data.sessions.length)
  const result = await remote({ execute(_f, _a, _o, callback) { callback(null, output) } })()
  assert.equal(result.ok, true)
})

test('collector counts dead completed metadata as exited', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-pi-history-'))
  try {
    fs.mkdirSync(path.join(dir, 'directory-sessions', 'workspace'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'directory-sessions', 'workspace', 'session.json'), JSON.stringify({ sessionId: 'history', pid: 42, status: 'completed' }))
    const data = await scanPiSessions({ agentDir: dir, checkProcessAlive: () => false, listProcesses: () => [] })
    assert.equal(data.sessions[0].status, 'exited')
    assert.equal(data.summary.exited, 1)
    const result = await remote({ execute(_f, _a, _o, callback) { callback(null, JSON.stringify(data)) } })()
    assert.equal(result.ok, true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('snapshot CLI fails truthfully when process inspection is unavailable', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/pi-sessions-snapshot.js')], { env: { ...process.env, PATH: '/nonexistent' }, encoding: 'utf8', timeout: 10000 })
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
})

test('unconfigured source uses local collector and identifies it', async () => {
  const result = await createPiSessionsSource({ env: {}, scanLocal: async () => snapshot() })()
  assert.equal(result.source.kind, 'local')
  assert.equal(result.summary.running, 1)
})
test('SSH preserves remote PID liveness and uses bounded authenticated execution', async () => {
  const data = snapshot()
  const result = await remote({ execute(file, args, options, callback) {
    assert.equal(file, 'ssh')
    assert.ok(args.includes('BatchMode=yes'))
    assert.ok(args.includes('StrictHostKeyChecking=yes'))
    assert.equal(options.timeout, 10000)
    assert.equal(options.maxBuffer, 2 * 1024 * 1024)
    assert.equal(options.killSignal, 'SIGKILL')
    assert.match(args.at(-1), /^'\/opt\/homebrew\/bin\/node' /)
    callback(null, JSON.stringify(data))
  } })()
  assert.equal(result.source.label, 'Mac / SSH · desk-mac')
  assert.deepEqual(result.sessions, data.sessions)
})
for (const failure of ['connection', 'timeout', 'maxBuffer', 'json', 'shape', 'stale', 'workspace', 'files', 'status']) {
  test(`remote ${failure} is unavailable without local fallback`, async () => {
    const result = await remote({ execute(_file, _args, _options, callback) {
      if (['connection', 'timeout', 'maxBuffer'].includes(failure)) return callback(new Error(failure))
      const data = snapshot()
      if (failure === 'shape') data.summary.running = '1'
      if (failure === 'stale') data.scannedAt -= 120000
      if (failure === 'workspace') data.workspaces = [null]
      if (failure === 'files') data.sessions[0].modifiedFiles = {}
      if (failure === 'status') data.sessions[0].status = '<img src=x>'
      callback(null, failure === 'json' ? 'not JSON' : JSON.stringify(data))
    } })()
    assert.equal(result.ok, false)
    assert.equal(result.source.kind, 'ssh')
    assert.equal(result.summary, null)
    assert.deepEqual(result.sessions, [])
  })
}
test('partial and injection-like configuration is rejected without execution', async () => {
  for (const config of [{ ODK_PI_SSH_NODE: '/node' }, { ...env, ODK_PI_SSH_HOST: '-oProxyCommand=bad' }, { ...env, ODK_PI_SSH_NODE: 'node' }]) {
    const result = await remote({ env: config, execute() { assert.fail('must not execute') } })()
    assert.equal(result.ok, false)
  }
})
test('concurrent polls coalesce and subsequent scans refresh', async () => {
  let calls = 0
  let finish
  const scan = remote({ execute(_file, _args, _options, callback) { calls++; finish = callback } })
  const first = scan()
  const second = scan()
  assert.equal(calls, 1)
  finish(null, JSON.stringify(snapshot()))
  assert.deepEqual(await first, await second)
  const third = scan()
  assert.equal(calls, 2)
  finish(null, JSON.stringify(snapshot()))
  await third
})

/* --- Desk Link precedence --- */

function deskLinkFixture({ machines = ['desk-mac'], snapshot = null } = {}) {
  const calls = { machines: 0, snapshot: 0 }
  return {
    calls,
    async machines() {
      calls.machines += 1
      return machines
    },
    async snapshot() {
      calls.snapshot += 1
      return snapshot ?? {
        ok: true,
        source: { kind: 'desk-link', label: 'Desk Link · desk-mac' },
        scannedAt: Date.now(),
        summary: { total: 1, running: 1, settled: 0, exited: 0, workspacesCount: 1 },
        sessions: [{
          sessionId: 'reported-1',
          uuid: 'reported-1',
          pid: null,
          isAlive: true,
          status: 'running',
          cwd: '/workspace/desk',
          workspaceName: 'desk',
          startedAt: Date.now() - 60000,
          updatedAt: Date.now(),
          latestGoal: 'Reported goal',
          activity: 'bash: pnpm test',
          modifiedFiles: [],
          source: 'desk-link',
          reportedBy: 'desk-mac',
        }],
        workspaces: [{
          name: 'desk',
          cwd: '/workspace/desk',
          sessions: [{
            sessionId: 'reported-1',
            uuid: 'reported-1',
            pid: null,
            isAlive: true,
            status: 'running',
            cwd: '/workspace/desk',
            workspaceName: 'desk',
            startedAt: Date.now() - 60000,
            updatedAt: Date.now(),
            modifiedFiles: [],
          }],
        }],
      }
    },
  }
}

test('a connected Desk Link answers instead of the configured SSH source', async () => {
  const link = deskLinkFixture()
  let executeCalls = 0
  const scan = createPiSessionsSource({
    env,
    deskLink: link,
    execute: () => { executeCalls += 1 },
    scanLocal: async () => { throw new Error('the local collector must not run') },
  })

  const result = await scan()

  assert.equal(executeCalls, 0, 'no SSH scan happens while a Desk Link answers')
  assert.equal(link.calls.machines, 1)
  assert.equal(link.calls.snapshot, 1)
  assert.equal(result.ok, true)
  assert.equal(result.source.kind, 'desk-link')
  assert.equal(result.sessions[0].reportedBy, 'desk-mac')
})

test('a Desk Link with no connected machine leaves the configured SSH source in charge', async () => {
  const link = deskLinkFixture({ machines: [] })
  const execute = (command, args, options, callback) => {
    callback(null, JSON.stringify({
      ok: true,
      scannedAt: Date.now(),
      summary: { total: 0, running: 0, settled: 0, exited: 0, workspacesCount: 0 },
      sessions: [],
      workspaces: [],
    }))
  }
  const scan = createPiSessionsSource({ env, deskLink: link, execute })

  const result = await scan()

  assert.equal(link.calls.snapshot, 0, 'an empty Desk Link state never replaces the SSH source')
  assert.equal(result.ok, true)
  assert.equal(result.source.kind, 'ssh')
})

test('an empty Desk Link state is reported as such rather than mixing sources', async () => {
  const link = deskLinkFixture({ snapshot: {
    ok: true,
    source: { kind: 'desk-link', label: 'Desk Link · desk-mac' },
    scannedAt: Date.now(),
    summary: { total: 0, running: 0, settled: 0, exited: 0, workspacesCount: 0 },
    sessions: [],
    workspaces: [],
  } })
  let executeCalls = 0
  const scan = createPiSessionsSource({
    env,
    deskLink: link,
    execute: () => { executeCalls += 1 },
    scanLocal: async () => { throw new Error('the local collector must not run') },
  })

  const result = await scan()

  assert.equal(executeCalls, 0)
  assert.equal(result.summary.total, 0)
  assert.equal(result.source.kind, 'desk-link')
})

test('without a Desk Link client the local collector still answers', async () => {
  const scan = createPiSessionsSource({
    env: {},
    scanLocal: async () => ({ ok: true, scannedAt: Date.now(), summary: { total: 0, running: 0, settled: 0, exited: 0, workspacesCount: 0 }, sessions: [], workspaces: [] }),
  })

  const result = await scan()

  assert.equal(result.source.kind, 'local')
})

test('one session reported by two machines becomes one entry with consistent counts', () => {
  const shared = {
    uuid: 'shared-session', sessionId: 'shared-session', status: 'running', cwd: '/workspace/desk',
    workspaceName: 'desk', startedAt: 1700000000000, isAlive: true,
  }
  const deduped = dedupeSnapshot({
    ok: true,
    source: { kind: 'desk-link', label: 'Desk Link' },
    scannedAt: Date.now(),
    sessions: [shared, { ...shared, updatedAt: 1700000005000, activity: 'bash: pnpm test' }],
    workspaces: [{ name: 'desk', cwd: '/workspace/desk', sessions: [shared, shared] }],
    summary: { total: 2, running: 2, settled: 0, exited: 0, workspacesCount: 1 },
  })
  assert.equal(deduped.sessions.length, 1)
  assert.equal(deduped.summary.total, 1)
  assert.equal(deduped.summary.running, 1)
  assert.equal(deduped.summary.workspacesCount, 1)
  assert.equal(deduped.workspaces.length, 1)
  assert.deepEqual(deduped.workspaces[0].sessions, deduped.sessions)
  assert.equal(deduped.sessions[0].activity, 'bash: pnpm test')
  // The snapshot the source hands out still satisfies the runtime validator.
  assert.equal(deduped.summary.total, deduped.sessions.length)
  assert.equal(deduped.summary.workspacesCount, deduped.workspaces.length)
})

test('a snapshot without duplicates is returned untouched', () => {
  const snapshot = {
    ok: true, source: { kind: 'local', label: 'Local' }, scannedAt: Date.now(),
    sessions: [{ uuid: 'a', status: 'running', cwd: '/a' }, { uuid: 'b', status: 'settled', cwd: '/b' }],
    workspaces: [], summary: { total: 2, running: 1, settled: 1, exited: 0, workspacesCount: 2 },
  }
  assert.equal(dedupeSnapshot(snapshot), snapshot)
})

test('the source deduplicates what a connected Desk Link reports', async () => {
  const shared = { uuid: 'shared', sessionId: 'shared', status: 'running', cwd: '/workspace/desk', workspaceName: 'desk', isAlive: true, updatedAt: 1 }
  const deskLink = {
    machines: async () => ['first-mac', 'second-mac'],
    snapshot: async () => ({
      ok: true, source: { kind: 'desk-link', label: 'Desk Link' }, scannedAt: Date.now(),
      sessions: [shared, { ...shared, updatedAt: 2 }],
      workspaces: [{ name: 'desk', cwd: '/workspace/desk', sessions: [shared, shared] }],
      summary: { total: 2, running: 2, settled: 0, exited: 0, workspacesCount: 1 },
    }),
  }
  const scan = createPiSessionsSource({ deskLink })
  const result = await scan()
  assert.equal(result.sessions.length, 1)
  assert.equal(result.summary.total, 1)
  assert.equal(result.source.kind, 'desk-link')
})
