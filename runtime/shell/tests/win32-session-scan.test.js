const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { listPiProcesses, scanPiSessions } = require('../src/pi-sessions')

// A Windows Shell Host answers with every process it can see, and a Pi session
// is recognized from its command line. The scan then treats the returned rows as
// the Pi process set, so a row source that is not filtered hides sessions.

const NOW = Date.parse('2026-03-01T12:00:00Z')
const WINDOWS_HOST = { id: 'win32-x64', isWindows: true, supported: true }

function windowsRow(overrides) {
  return {
    pid: 300,
    ppid: 100,
    comm: 'node.exe',
    command: 'node C:\\tools\\pi.js',
    tokens: ['node', 'C:\\tools\\pi.js'],
    cwd: 'C:\\work\\desk',
    startedAt: NOW - 60_000,
    elapsedSeconds: 60,
    isAlive: true,
    ...overrides,
  }
}

// The rows a Windows host really produces: no `args` field, a `command`, and the
// tokens the platform tokenizer derived from it.
function windowsSource(rows) {
  return { backend: 'native', list: () => rows }
}

function metadataSession({ sessionId, pid, cwd, startedAt, updatedAt, status = 'running' }) {
  return JSON.stringify({ sessionId, pid, cwd, startedAt, updatedAt, status, latestGoal: 'Goal', modifiedFiles: [] })
}

test('a Windows session survives a live non-Pi parent process', async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-win-scan-'))
  const wsDir = path.join(agentDir, 'directory-sessions', '--C-work-desk--')
  fs.mkdirSync(wsDir, { recursive: true })
  fs.writeFileSync(path.join(wsDir, 'session.json'), metadataSession({
    sessionId: 'session-01a062fe-a0a6-7922-a757-abb790ef9977',
    pid: 300,
    cwd: 'C:\\work\\desk',
    startedAt: NOW - 60_000,
    updatedAt: NOW - 5_000,
  }))

  // explorer.exe is alive and is the Pi process's parent, exactly as a session
  // launched from a Windows shell is parented by the shell that started it.
  const rows = listPiProcesses(NOW, false, {
    host: WINDOWS_HOST,
    windowsSource: windowsSource([
      windowsRow({ pid: 100, ppid: 4, comm: 'explorer.exe', command: 'C:\\Windows\\explorer.exe', tokens: ['C:\\Windows\\explorer.exe'], cwd: '' }),
      windowsRow({}),
    ]),
  })

  const snapshot = await scanPiSessions({
    agentDir,
    now: NOW,
    listProcesses: () => rows,
    checkProcessAlive: (pid) => pid === 300,
  })

  assert.deepEqual(snapshot.sessions.map((session) => session.pid), [300], 'a non-Pi parent must not hide a live session')
  assert.equal(snapshot.sessions[0].cwd, 'C:\\work\\desk')
  assert.equal(snapshot.sessions[0].workspaceName, 'desk')
  assert.equal(snapshot.orphanProcesses, 0, 'a non-Pi process is not an unmatched Pi process')
  fs.rmSync(agentDir, { recursive: true, force: true })
})

test('a Windows scan reports only Pi processes from the host table', () => {
  const rows = listPiProcesses(NOW, false, {
    host: WINDOWS_HOST,
    windowsSource: windowsSource([
      windowsRow({ pid: 100, ppid: 4, comm: 'explorer.exe', command: 'C:\\Windows\\explorer.exe', tokens: ['C:\\Windows\\explorer.exe'] }),
      windowsRow({ pid: 200, ppid: 4, comm: 'notepad.exe', command: 'notepad.exe', tokens: ['notepad.exe'] }),
      windowsRow({ pid: 300, ppid: 200 }),
      windowsRow({ pid: 400, ppid: 200, comm: 'pi.exe', command: 'pi --continue', tokens: ['pi', '--continue'] }),
    ]),
  })

  assert.deepEqual(rows.map((row) => row.pid), [300, 400])
})

test('a Windows session with no readable work directory reports it unknown', async () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-win-unknown-'))
  const wsDir = path.join(agentDir, 'directory-sessions', '--C-work-unknown--')
  fs.mkdirSync(wsDir, { recursive: true })
  fs.writeFileSync(path.join(wsDir, 'session.json'), metadataSession({
    sessionId: 'session-02b062fe-b0a6-7922-a757-abb790ef8888',
    pid: 300,
    cwd: '',
    startedAt: NOW - 30_000,
    updatedAt: NOW - 1_000,
  }))

  const rows = listPiProcesses(NOW, false, {
    host: WINDOWS_HOST,
    windowsSource: windowsSource([windowsRow({ cwd: '' })]),
  })
  const snapshot = await scanPiSessions({
    agentDir,
    now: NOW,
    listProcesses: () => rows,
    checkProcessAlive: (pid) => pid === 300,
  })

  assert.deepEqual(snapshot.sessions.map((session) => session.pid), [300])
  assert.equal(snapshot.sessions[0].cwd, '', 'the host cannot read it, so the desk does not invent one')
  assert.equal(snapshot.sessions[0].workspaceName, 'Unknown')
  assert.equal(snapshot.sessions[0].startedAt, NOW - 30_000, 'identity and start time survive an unreadable directory')
  fs.rmSync(agentDir, { recursive: true, force: true })
})