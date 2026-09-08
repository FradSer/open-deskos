const test = require('node:test')
const assert = require('node:assert/strict')
const { createPiSessionsSource } = require('../src/pi-sessions-source')
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
  const output = execFileSync(process.execPath, [path.join(__dirname, '../scripts/pi-sessions-snapshot.js')], { encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 })
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
