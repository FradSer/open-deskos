const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { parseProcessTable, scanPiSessions, readSessionEvents } = require('../src/pi-sessions')

test('parseProcessTable finds Pi executables and derives elapsed start times', () => {
  const now = 1_700_000_000_000
  const output = [
    ' 321 1 3600 pi pi',
    ' 654 321 00:12:05 node node /opt/tools/pi',
    ' 777 1 42 node node pi',
    ' 778 1 42 npm npm exec pi',
    ' 779 1 42 bun bun run pi',
    ' 780 1 42 sh sh -c pi',
    ' 781 1 42 npx npx pi',
    ' 782 1 42 yarn yarn pi',
    ' 783 1 42 sh sh -c "exec pi"',
    ' 784 1 42 env env PI_MODE=live pi',
    ' 785 1 42 sudo sudo -u desk pi',
    ' 786 1 42 corepack corepack yarn pi',
    ' 987 1 42 node node /opt/tools/not-pi',
    ' 999 1 42 node node app.js --name pi',
  ].join('\n')

  const processes = parseProcessTable(output, now)

  assert.equal(processes.length, 12)
  assert.deepEqual(processes.map((processInfo) => processInfo.pid), [321, 654, 777, 778, 779, 780, 781, 782, 783, 784, 785, 786])
  assert.equal(processes[0].startedAt, now - 3600 * 1000)
  assert.equal(processes[1].elapsedSeconds, 12 * 60 + 5)
  assert.equal(processes[0].isAlive, true)
})

test('scanPiSessions returns empty summary when agent directory does not exist', async () => {
  const nonExistentDir = path.join(os.tmpdir(), `pi-test-agent-${Date.now()}`)
  const result = await scanPiSessions({ agentDir: nonExistentDir, listProcesses: () => [] })
  assert.equal(result.ok, true)
  assert.equal(result.summary.total, 0)
  assert.equal(result.summary.running, 0)
  assert.deepEqual(result.sessions, [])
  assert.deepEqual(result.workspaces, [])
})

test('scanPiSessions ignores running Pi processes without metadata', async () => {
  const nonExistentDir = path.join(os.tmpdir(), `pi-process-agent-${Date.now()}`)
  const result = await scanPiSessions({
    agentDir: nonExistentDir,
    now: 1_700_000_000_000,
    listProcesses: () => [{
      pid: 4321,
      ppid: 1,
      cwd: '/Users/test/desk-app',
      command: 'pi',
      startedAt: 1_699_999_940_000,
      isAlive: true,
    }],
  })

  assert.equal(result.ok, true)
  assert.equal(result.summary.total, 0)
  assert.equal(result.summary.running, 0)
  assert.equal(result.summary.workspacesCount, 0)
  assert.deepEqual(result.sessions, [])
  assert.deepEqual(result.workspaces, [])
  assert.equal(result.orphanProcesses, 1)
})

test('scanPiSessions hides Pi worker processes spawned by another live Pi session', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-worker-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-worker--')
  fs.mkdirSync(wsDir, { recursive: true })
  fs.writeFileSync(path.join(wsDir, 'worker.json'), JSON.stringify({
    sessionId: 'worker-01a062fe-a0a6-7922-a757-abb790ef9977',
    pid: 4322,
    cwd: '/Users/test/worker-workspace',
    startedAt: 1_699_999_990_000,
    updatedAt: 1_700_000_000_000,
    status: 'running',
    latestGoal: 'Worker goal',
    modifiedFiles: [],
  }))
  fs.writeFileSync(path.join(wsDir, 'leader.json'), JSON.stringify({
    sessionId: 'leader-02b062fe-b0a6-7922-a757-abb790ef8888',
    pid: 4321,
    cwd: '/Users/test/worker-workspace',
    startedAt: 1_699_999_940_000,
    updatedAt: 1_700_000_000_000,
    status: 'running',
    latestGoal: 'Leader goal',
    modifiedFiles: [],
  }))

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: () => true,
    listProcesses: () => [
      { pid: 4321, ppid: 1, cwd: '/Users/test/worker-workspace', command: 'pi', startedAt: 1_699_999_940_000, isAlive: true },
      { pid: 4322, ppid: 4321, cwd: '/Users/test/worker-workspace', command: 'pi', startedAt: 1_699_999_990_000, isAlive: true },
    ],
  })

  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].latestGoal, 'Leader goal')
  assert.equal(result.summary.running, 1)
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions merges process facts into a matching metadata record', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-merge-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-merge--')
  fs.mkdirSync(wsDir, { recursive: true })
  fs.writeFileSync(path.join(wsDir, 'merge.json'), JSON.stringify({
    sessionId: 'merge-01a062fe-a0a6-7922-a757-abb790ef9977',
    pid: '4321',
    cwd: '',
    startedAt: 1_699_999_940_000,
    updatedAt: 1_700_000_000_000,
    status: 'running',
    latestGoal: 'Keep the user goal',
    modifiedFiles: ['README.md'],
  }))

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 4321,
    listProcesses: () => [{
      pid: 4321,
      cwd: '/Users/test/merge-workspace',
      command: 'pi',
      startedAt: 1_699_999_940_500,
      isAlive: true,
    }],
  })

  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].pid, 4321)
  assert.equal(result.sessions[0].cwd, '/Users/test/merge-workspace')
  assert.equal(result.sessions[0].command, 'pi')
  assert.equal(result.sessions[0].latestGoal, 'Keep the user goal')
  assert.deepEqual(result.sessions[0].modifiedFiles, ['README.md'])
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions merges duplicate metadata fields without losing complete facts', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-metadata-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-metadata--')
  fs.mkdirSync(wsDir, { recursive: true })
  const uuid = '03c062fe-c0a6-7922-a757-abb790ef7777'
  fs.writeFileSync(path.join(wsDir, 'older.json'), JSON.stringify({
    sessionId: `older-${uuid}`,
    pid: 4321,
    cwd: '/Users/test/metadata-workspace',
    command: 'pi --resume',
    startedAt: 1_699_999_940_000,
    updatedAt: 1_699_999_950_000,
    status: 'running',
    latestGoal: 'Known goal',
    modifiedFiles: ['old-file.md'],
  }))
  fs.writeFileSync(path.join(wsDir, 'newer.json'), JSON.stringify({
    sessionId: `newer-${uuid}`,
    pid: 4321,
    startedAt: 1_699_999_940_000,
    updatedAt: 1_700_000_000_000,
    status: 'running',
    latestGoal: 'Newer goal',
    modifiedFiles: [],
  }))

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 4321,
    listProcesses: () => [],
  })

  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].sessionId, `newer-${uuid}`)
  assert.equal(result.sessions[0].latestGoal, 'Newer goal')
  assert.equal(result.sessions[0].cwd, '/Users/test/metadata-workspace')
  assert.equal(result.sessions[0].command, 'pi --resume')
  assert.deepEqual(result.sessions[0].modifiedFiles, ['old-file.md'])
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions separates a reused PID from its historical metadata', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-reuse-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-reuse--')
  fs.mkdirSync(wsDir, { recursive: true })
  fs.writeFileSync(path.join(wsDir, 'old.json'), JSON.stringify({
    sessionId: 'old-01a062fe-a0a6-7922-a757-abb790ef9977',
    pid: 4321,
    cwd: '/Users/test/old-workspace',
    startedAt: 1_699_000_000_000,
    updatedAt: 1_699_000_000_000,
    status: 'running',
    latestGoal: 'Historical goal',
    modifiedFiles: [],
  }))
  fs.writeFileSync(path.join(wsDir, 'current.json'), JSON.stringify({
    sessionId: 'current-02b062fe-b0a6-7922-a757-abb790ef8888',
    pid: 4321,
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    status: 'running',
    latestGoal: 'Current goal',
    modifiedFiles: [],
  }))

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 4321,
    listProcesses: () => [{
      pid: 4321,
      cwd: '/Users/test/new-workspace',
      command: 'pi',
      startedAt: 1_700_000_000_000,
      isAlive: true,
    }],
  })

  assert.equal(result.sessions.length, 2)
  assert.equal(result.summary.running, 1)
  assert.equal(result.summary.exited, 1)
  assert.equal(result.sessions.find((session) => session.latestGoal === 'Historical goal').status, 'exited')
  const currentSession = result.sessions.find((session) => session.latestGoal === 'Current goal')
  assert.equal(currentSession.cwd, '/Users/test/new-workspace')
  assert.equal(currentSession.source, 'session')
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions refuses indistinguishable live PID metadata candidates', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-tied-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-tied--')
  fs.mkdirSync(wsDir, { recursive: true })
  for (const [file, sessionId, goal] of [
    ['first.json', 'first-04c062fe-d0a6-7922-a757-abb790ef6666', 'First candidate'],
    ['second.json', 'second-05c062fe-e0a6-7922-a757-abb790ef5555', 'Second candidate'],
  ]) {
    fs.writeFileSync(path.join(wsDir, file), JSON.stringify({
      sessionId,
      pid: 4321,
      cwd: '/Users/test/ambiguous-workspace',
      startedAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      status: 'running',
      latestGoal: goal,
      modifiedFiles: [],
    }))
  }

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 4321,
    listProcesses: () => [{
      pid: 4321,
      cwd: '/Users/test/current-workspace',
      command: 'pi',
      startedAt: 1_700_000_000_000,
      isAlive: true,
    }],
  })

  assert.equal(result.sessions.length, 2)
  assert.equal(result.summary.running, 0)
  assert.equal(result.summary.exited, 2)
  assert.equal(result.orphanProcesses, 1)
  assert.equal(result.sessions.filter((session) => session.status === 'exited').length, 2)
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions does not merge ambiguous metadata without a start time', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-ambiguous-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-ambiguous--')
  fs.mkdirSync(wsDir, { recursive: true })
  fs.writeFileSync(path.join(wsDir, 'unknown-start.json'), JSON.stringify({
    sessionId: 'unknown-start-03c062fe-c0a6-7922-a757-abb790ef7777',
    pid: 4321,
    cwd: '/Users/test/old-workspace',
    status: 'running',
    latestGoal: 'Possibly stale goal',
  }))

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 4321,
    listProcesses: () => [{
      pid: 4321,
      cwd: '/Users/test/new-workspace',
      command: 'pi',
      startedAt: 1_700_000_000_000,
      isAlive: true,
    }],
  })

  assert.equal(result.sessions.length, 1)
  assert.equal(result.summary.running, 0)
  assert.equal(result.summary.exited, 1)
  assert.equal(result.orphanProcesses, 1)
  assert.equal(result.sessions.find((session) => session.latestGoal === 'Possibly stale goal').status, 'exited')
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions merges a live process with a session resumed into it', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-resume-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-resume--')
  fs.mkdirSync(wsDir, { recursive: true })
  // The session was created long before the user launched the pi process that
  // resumed it; the resumed process keeps writing the metadata file.
  fs.writeFileSync(path.join(wsDir, 'resumed.json'), JSON.stringify({
    sessionId: 'resumed-06c062fe-f0a6-7922-a757-abb790ef4444',
    pid: 4321,
    cwd: '/Users/test/resume-workspace',
    startedAt: 1_699_000_000_000,
    updatedAt: 1_700_000_005_000,
    status: 'running',
    latestGoal: 'Resumed goal',
    modifiedFiles: [],
  }))

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 4321,
    listProcesses: () => [{
      pid: 4321,
      cwd: '/Users/test/resume-workspace',
      command: 'pi',
      startedAt: 1_700_000_000_000,
      isAlive: true,
    }],
  })

  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].source, 'session')
  assert.equal(result.sessions[0].status, 'running')
  assert.equal(result.sessions[0].latestGoal, 'Resumed goal')
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions merges a session created inside a long-lived process', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-newsession-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-newsession--')
  fs.mkdirSync(wsDir, { recursive: true })
  // /new inside a long-running process: the current session started long after
  // the process itself, and the file stays actively written.
  fs.writeFileSync(path.join(wsDir, 'current.json'), JSON.stringify({
    sessionId: 'current-07c062fe-0ba6-7922-a757-abb790ef3333',
    pid: 4321,
    cwd: '/Users/test/long-lived-workspace',
    startedAt: 1_700_000_300_000,
    updatedAt: 1_700_000_310_000,
    status: 'running',
    latestGoal: 'Long-lived goal',
    modifiedFiles: [],
  }))

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 4321,
    listProcesses: () => [{
      pid: 4321,
      cwd: '/Users/test/long-lived-workspace',
      command: 'pi',
      startedAt: 1_700_000_000_000,
      isAlive: true,
    }],
  })

  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].source, 'session')
  assert.equal(result.sessions[0].status, 'running')
  assert.equal(result.sessions[0].latestGoal, 'Long-lived goal')
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions matches start-time-less metadata written by the live process', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-nostart-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-nostart--')
  fs.mkdirSync(wsDir, { recursive: true })
  // Current pi versions omit startedAt; recent updatedAt proves the file
  // belongs to this live process.
  fs.writeFileSync(path.join(wsDir, 'live.json'), JSON.stringify({
    sessionId: 'live-08c062fe-1ba6-7922-a757-abb790ef2222',
    pid: 4321,
    cwd: '/Users/test/nostart-workspace',
    updatedAt: 1_700_000_010_000,
    status: 'running',
    latestGoal: 'No-start goal',
    modifiedFiles: [],
  }))

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 4321,
    listProcesses: () => [{
      pid: 4321,
      cwd: '/Users/test/nostart-workspace',
      command: 'pi',
      startedAt: 1_700_000_000_000,
      isAlive: true,
    }],
  })

  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].source, 'session')
  assert.equal(result.sessions[0].status, 'running')
  assert.equal(result.sessions[0].latestGoal, 'No-start goal')
  assert.equal(result.sessions[0].startedAt, 1_700_000_000_000)
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions marks unmatched settled metadata as exited', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-stale-settled-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-stalesettled--')
  fs.mkdirSync(wsDir, { recursive: true })
  fs.writeFileSync(path.join(wsDir, 'stale.json'), JSON.stringify({
    sessionId: 'stale-09c062fe-2ba6-7922-a757-abb790ef1111',
    pid: 4321,
    cwd: '/Users/test/stale-workspace',
    startedAt: 1_699_000_000_000,
    updatedAt: 1_699_000_000_500,
    status: 'settled',
    latestGoal: 'Stale settled goal',
    modifiedFiles: [],
  }))

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 4321,
    listProcesses: () => [{
      pid: 4321,
      cwd: '/Users/test/fresh-workspace',
      command: 'pi',
      startedAt: 1_700_000_000_000,
      isAlive: true,
    }],
  })

  assert.equal(result.summary.exited, 1)
  assert.equal(result.sessions.find((session) => session.latestGoal === 'Stale settled goal').status, 'exited')
  assert.equal(result.orphanProcesses, 1)
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions puts running sessions before activity order', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-sort-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-workspace--')
  fs.mkdirSync(wsDir, { recursive: true })
  const oldRunning = {
    sessionId: 'old-running-01a062fe-a0a6-7922-a757-abb790ef9977', pid: 111,
    cwd: '/Users/test/workspace', startedAt: 100, updatedAt: 1_000, status: 'running',
  }
  const newerSettled = {
    sessionId: 'newer-settled-02b062fe-b0a6-7922-a757-abb790ef8888', pid: 222,
    cwd: '/Users/test/workspace', startedAt: 200, updatedAt: 2_000, status: 'settled',
  }
  fs.writeFileSync(path.join(wsDir, 'old.json'), JSON.stringify(oldRunning))
  fs.writeFileSync(path.join(wsDir, 'new.json'), JSON.stringify(newerSettled))

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 111,
    listProcesses: () => [],
  })

  assert.deepEqual(result.sessions.map((session) => session.pid), [111, 222])
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions parses sessions, deduplicates, and evaluates process liveness', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const dirSessions = path.join(tmpAgentDir, 'directory-sessions')
  const wsDir1 = path.join(dirSessions, '--Users-FradSer-Developer-open-deskos--')
  const wsDir2 = path.join(dirSessions, '--Users-FradSer-Developer-pi-packages--')

  fs.mkdirSync(wsDir1, { recursive: true })
  fs.mkdirSync(wsDir2, { recursive: true })

  // Workspace 1: one running session (alive PID), with a short and long filename (dedup)
  const session1Data = {
    sessionId: '2026-09-02T16-40-49-574Z_01a062fe-a0a6-7922-a757-abb790ef9977',
    pid: 12345,
    cwd: '/Users/FradSer/Developer/open-deskos',
    startedAt: 1000,
    updatedAt: 2000,
    status: 'running',
    latestGoal: 'Refactor desk UI layout for 1080P screen',
    modifiedFiles: ['src/renderer/shell.js', 'src/renderer/uno.css'],
  }
  const session1Legacy = {
    sessionId: '01a062fe-a0a6-7922-a757-abb790ef9977',
    pid: 12345,
    cwd: '/Users/FradSer/Developer/open-deskos',
    startedAt: 1000,
    updatedAt: 1500,
    status: 'running',
    latestGoal: 'Old goal',
    modifiedFiles: [],
  }

  // Workspace 2: an exited session (dead PID)
  const session2Data = {
    sessionId: '2026-09-01T12-00-00-000Z_02b062fe-b0a6-7922-a757-abb790ef8888',
    pid: 99999,
    cwd: '/Users/FradSer/Developer/pi-packages',
    startedAt: 500,
    updatedAt: 1000,
    status: 'running',
    latestGoal: 'Build npm package',
    modifiedFiles: ['package.json'],
  }

  fs.writeFileSync(path.join(wsDir1, '2026-09-02T16-40-49-574Z_01a062fe-a0a6-7922-a757-abb790ef9977.json'), JSON.stringify(session1Data))
  fs.writeFileSync(path.join(wsDir1, '01a062fe-a0a6-7922-a757-abb790ef9977.json'), JSON.stringify(session1Legacy))
  fs.writeFileSync(path.join(wsDir2, '2026-09-01T12-00-00-000Z_02b062fe-b0a6-7922-a757-abb790ef8888.json'), JSON.stringify(session2Data))

  const mockCheckAlive = (pid) => pid === 12345

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: mockCheckAlive,
    listProcesses: () => [],
  })

  assert.equal(result.ok, true)
  assert.equal(result.summary.total, 2)
  assert.equal(result.summary.running, 1)
  assert.equal(result.summary.exited, 1)
  assert.equal(result.sessions.length, 2)

  const activeSession = result.sessions.find(s => s.pid === 12345)
  assert.ok(activeSession)
  assert.equal(activeSession.status, 'running')
  assert.equal(activeSession.isAlive, true)
  assert.equal(activeSession.workspaceName, 'open-deskos')
  assert.equal(activeSession.latestGoal, 'Refactor desk UI layout for 1080P screen')
  assert.deepEqual(activeSession.modifiedFiles, ['src/renderer/shell.js', 'src/renderer/uno.css'])

  const deadSession = result.sessions.find(s => s.pid === 99999)
  assert.ok(deadSession)
  assert.equal(deadSession.status, 'exited')
  assert.equal(deadSession.isAlive, false)

  assert.equal(result.workspaces.length, 2)
  const ws1 = result.workspaces.find(w => w.name === 'open-deskos')
  assert.equal(ws1.runningCount, 1)
  assert.equal(ws1.totalCount, 1)

  // Cleanup
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('Pi Sessions widget reports scanner failure without fabricating zero sessions', async () => {
  const vm = require('node:vm')
  const pluginSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/pi-sessions.js'), 'utf8')
  const registered = []
  const root = {
    odkPlugins: {
      register(def) { registered.push(def) },
    },
    odkPlatform: {
      getPiSessions: async () => null,
    },
  }
  const context = vm.createContext({ window: root, globalThis: root })
  vm.runInContext(pluginSrc, context)

  const nodes = {
    '.pi-widget-count': { textContent: '' },
    '.pi-indicator-dot': { className: '' },
    '.pi-widget-tag-label': { textContent: '', className: '' },
    '.pi-widget-summary': { textContent: '' },
    '.w-state': { textContent: '' },
  }
  const fakeEl = {
    innerHTML: '',
    querySelector(selector) { return nodes[selector] || null },
  }

  registered.find((plugin) => plugin.id === 'odk.tile.pi-sessions').mount(fakeEl, { onTick() {} })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(nodes['.pi-widget-count'].textContent, '--')
  assert.equal(nodes['.pi-widget-tag-label'].textContent, 'OFFLINE')
  assert.equal(nodes['.pi-widget-summary'].textContent, 'Scanner unavailable')
  assert.equal(nodes['.w-state'].textContent, 'Unavailable')
})

test('status-pi-sessions plugin satisfies Open DeskOS status contract and mounts interactive indicator', () => {
  const vm = require('node:vm')
  const pluginSrc = fs.readFileSync(path.join(__dirname, '../src/renderer/plugins/status-pi-sessions.js'), 'utf8')
  const registered = []
  const root = {
    odkPlugins: {
      register(def) { registered.push(def) },
    },
    odkPlatform: {
      getPiSessions: async () => ({
        ok: true,
        summary: { running: 2, total: 5 },
      }),
    },
  }
  const context = vm.createContext({ window: root, globalThis: root })
  vm.runInContext(pluginSrc, context)

  assert.equal(registered.length, 1)
  const plugin = registered[0]
  assert.equal(plugin.id, 'odk.status.pi-sessions')
  assert.equal(plugin.kind, 'status')
  assert.equal(plugin.slot, 'left')
  assert.equal(plugin.manifest.schemaVersion, 1)

  const btnListeners = {}
  const fakeEl = {
    innerHTML: '',
    querySelector(sel) {
      if (sel === '#sb-pi-status') {
        return {
          classList: { add() {}, remove() {} },
          setAttribute() {},
          addEventListener(event, fn) { btnListeners[event] = fn },
        }
      }
      if (sel === '.sb-pi-dot') return { className: '' }
      if (sel === '#sb-pi-count') return { textContent: '' }
      return null
    },
  }

  let navigated = null
  const contributions = []
  const ctx = {
    navigateToPage(pageId) { navigated = pageId },
    onTick(fn) {},
    briefing: { contribute(statement) { contributions.push(statement); return true } },
  }

  plugin.mount(fakeEl, ctx)
  assert.ok(fakeEl.innerHTML.includes('sb-pi-status'))
  assert.ok(fakeEl.innerHTML.includes('PI'))
  assert.equal(typeof btnListeners.click, 'function')
  btnListeners.click()
  assert.equal(navigated, 'pi-sessions')

  return new Promise((resolve) => setImmediate(() => {
    const [statement] = contributions
    assert.equal(statement.id, 'odk.briefing.pi-sessions')
    assert.equal(statement.order, 20)
    assert.equal(statement.parts[0].text, 'You have ')
    assert.equal(statement.parts[1].text, '2 Pi sessions')
    assert.equal(statement.parts[1].emphasis, true)
    assert.match(statement.parts[1].icon, /^<svg data-tabler="terminal-2"/)
    resolve()
  }))
})

test('scanPiSessions extracts model activity from session logs and metadata', async () => {
  const tmpAgentDir = path.join(os.tmpdir(), `pi-activity-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const wsDir = path.join(tmpAgentDir, 'directory-sessions', '--Users-test-activity--')
  fs.mkdirSync(wsDir, { recursive: true })
  const uuid = '05a062fe-c0a6-7922-a757-abb790ef8888'
  fs.writeFileSync(path.join(wsDir, 'session.json'), JSON.stringify({
    sessionId: uuid,
    pid: 5432,
    cwd: '/Users/test/activity',
    startedAt: 1_699_999_940_000,
    updatedAt: 1_700_000_000_000,
    status: 'running',
    latestGoal: '<skill name="marketing" location="/test/SKILL.md">\nInstructions\n</skill>\n\nCampaign plan',
    recap: 'Finished initial campaign',
  }))

  const logDir = path.join(tmpAgentDir, 'sessions', '--Users-test-activity--')
  fs.mkdirSync(logDir, { recursive: true })
  const logContent = [
    JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Start' }] } }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'pnpm test' } }] } }),
  ].join('\n')
  fs.writeFileSync(path.join(logDir, `session_${uuid}.jsonl`), logContent)

  const result = await scanPiSessions({
    agentDir: tmpAgentDir,
    checkProcessAlive: (pid) => pid === 5432,
    listProcesses: () => [],
  })

  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0].activity, 'bash: pnpm test')
  assert.equal(result.sessions[0].recap, 'Finished initial campaign')
  assert.ok(result.sessions[0].latestGoal.includes('marketing'))

  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

/* --- Session Detail event stream: bounded, single-line, on demand --- */

function writeSessionLog(agentDir, cwd, sessionId, entries) {
  const dirName = '--' + String(cwd).replace(/^[/\\]+/, '').replace(/[/\\]+/g, '-').replace(/-+$/, '') + '--'
  const dir = path.join(agentDir, 'sessions', dirName)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `session_${sessionId}.jsonl`), entries.join('\n'))
  return dir
}

function messageEntry(role, content) {
  return JSON.stringify({ type: 'message', message: { role, content } })
}

function toolResultEntry(toolName, text) {
  return JSON.stringify({ type: 'message', message: { role: 'toolResult', toolName, isError: false, content: [{ type: 'text', text }] } })
}

test('readSessionEvents returns only a bounded, ordered tail of a session log', () => {
  const agentDir = path.join(os.tmpdir(), `pi-events-tail-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const cwd = '/Users/test/events-workspace'
  const sessionId = 'events-01a062fe-a0a6-7922-a757-abb790ef0001'
  const entries = []
  for (let i = 0; i < 400; i += 1) entries.push(messageEntry('user', [{ type: 'text', text: `prompt ${i}` }]))
  writeSessionLog(agentDir, cwd, sessionId, entries)

  const result = readSessionEvents({ agentDir, cwd, sessionId, maxEvents: 10 })

  assert.equal(result.ok, true)
  assert.equal(result.events.length, 10)
  assert.deepEqual(result.events.map((event) => event.text), [
    'prompt 390', 'prompt 391', 'prompt 392', 'prompt 393', 'prompt 394',
    'prompt 395', 'prompt 396', 'prompt 397', 'prompt 398', 'prompt 399',
  ])
  assert.deepEqual([...new Set(result.events.map((event) => event.kind))], ['user'])
  assert.equal(result.truncated, true)
  fs.rmSync(agentDir, { recursive: true, force: true })
})

test('readSessionEvents keeps every event body and bounds each kind instead of flattening it', () => {
  const agentDir = path.join(os.tmpdir(), `pi-events-lines-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const cwd = '/Users/test/events-lines'
  const sessionId = 'events-01a062fe-a0a6-7922-a757-abb790ef0002'
  const body = ['first line of output', 'second line of output', 'x'.repeat(4000)].join('\n')
  writeSessionLog(agentDir, cwd, sessionId, [
    messageEntry('user', [{ type: 'text', text: 'why is the renderer empty' }]),
    messageEntry('assistant', [{ type: 'thinking', thinking: 'checking the composer' }]),
    messageEntry('assistant', [{ type: 'toolCall', name: 'bash', arguments: { command: 'pnpm test' } }]),
    toolResultEntry('bash', body),
    messageEntry('assistant', [{ type: 'text', text: 'the composer never ran' }]),
  ])

  const result = readSessionEvents({ agentDir, cwd, sessionId })

  assert.equal(result.ok, true)
  assert.deepEqual(result.events.map((event) => event.kind), ['user', 'thinking', 'tool', 'result', 'assistant'])
  const resultEvent = result.events[3]
  assert.equal(resultEvent.text, body, 'all result lines reach the renderer')
  assert.equal(resultEvent.toolName, 'bash')
  // Every kind keeps the body Pi produced; only its own byte limit applies.
  assert.deepEqual(result.events.map((event) => event.truncated), [undefined, undefined, undefined, undefined, undefined])
  assert.equal(result.events[0].text, 'why is the renderer empty')
  assert.equal(result.events[1].text, 'checking the composer')
  assert.equal(result.events[2].text, 'bash: pnpm test')
  assert.equal(result.events[4].text, 'the composer never ran')
  fs.rmSync(agentDir, { recursive: true, force: true })
})

test('readSessionEvents keeps an assistant reply as one bounded multiline Markdown body', () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-events-assistant-body-'))
  const cwd = '/Users/test/assistant-body'
  const sessionId = 'assistant-body-session'
  const reply = '# Findings\n\nFirst paragraph.\n\n| File | Status |\n| --- | --- |\n| a.js | ok |'
  try {
    writeSessionLog(agentDir, cwd, sessionId, [
      messageEntry('assistant', [{ type: 'text', text: reply }]),
    ])
    const result = readSessionEvents({ agentDir, cwd, sessionId })
    assert.equal(result.ok, true)
    assert.deepEqual(result.events.map((event) => event.kind), ['assistant'])
    assert.equal(result.events[0].text, reply, 'line structure and Markdown survive')
    assert.equal(result.events[0].truncated, undefined)
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true })
  }
})

test('readSessionEvents bounds an over-limit assistant body at 16 KiB without splitting a code point', () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-events-assistant-limit-'))
  const cwd = '/Users/test/assistant-limit'
  const sessionId = 'assistant-limit-session'
  try {
    writeSessionLog(agentDir, cwd, sessionId, [
      messageEntry('assistant', [{ type: 'text', text: '\u4e2d'.repeat(20000) }]),
    ])
    const result = readSessionEvents({ agentDir, cwd, sessionId })
    const [event] = result.events
    assert.equal(event.kind, 'assistant')
    assert.equal(event.truncated, true)
    assert.ok(Buffer.byteLength(event.text) <= 16 * 1024)
    assert.ok(event.text.length > 200)
    assert.equal(event.text.includes('\uFFFD'), false)
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true })
  }
})

test('readSessionEvents joins every assistant text part into one body', () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-events-assistant-parts-'))
  const cwd = '/Users/test/assistant-parts'
  const sessionId = 'assistant-parts-session'
  try {
    writeSessionLog(agentDir, cwd, sessionId, [
      messageEntry('assistant', [
        { type: 'text', text: 'First part.' },
        { type: 'thinking', thinking: 'considering the request' },
        { type: 'text', text: 'Second part.' },
      ]),
    ])
    const result = readSessionEvents({ agentDir, cwd, sessionId })
    assert.deepEqual(result.events.map((event) => event.kind), ['thinking', 'assistant'])
    assert.equal(result.events[1].text, 'First part.\n\nSecond part.')
    assert.equal(result.events.filter((event) => event.kind === 'assistant').length, 1)
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true })
  }
})

test('a multi-line tool call keeps its own lines instead of being collapsed', () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-events-command-lines-'))
  const cwd = '/Users/test/command-lines'
  const sessionId = 'command-lines-session'
  const command = "python3 - <<'PY'\nprint('one')\nprint('two')\nPY"
  try {
    writeSessionLog(agentDir, cwd, sessionId, [
      messageEntry('assistant', [{ type: 'toolCall', name: 'bash', arguments: { command } }]),
    ])
    const result = readSessionEvents({ agentDir, cwd, sessionId })
    assert.equal(result.events.length, 1)
    assert.equal(result.events[0].text, `bash: ${command}`)
    assert.equal(result.events[0].truncated, undefined)
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true })
  }
})

test('readSessionEvents keeps multi-line user prompts, thinking, and tool calls instead of flattening them', () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-events-summaries-'))
  const cwd = '/Users/test/event-summaries'
  const sessionId = 'event-summaries-session'
  try {
    writeSessionLog(agentDir, cwd, sessionId, [
      messageEntry('user', [{ type: 'text', text: 'prompt line one\nprompt line two' }]),
      messageEntry('assistant', [{ type: 'thinking', thinking: 'first thought\n' + 'x'.repeat(500) }]),
      messageEntry('assistant', [{ type: 'toolCall', name: 'bash', arguments: { command: 'pnpm test' } }]),
    ])
    const result = readSessionEvents({ agentDir, cwd, sessionId })
    assert.deepEqual(result.events.map((event) => event.kind), ['user', 'thinking', 'tool'])
    // The prompt keeps the lines the user typed rather than its first line.
    assert.equal(result.events[0].text, 'prompt line one\nprompt line two')
    assert.ok(result.events[1].text.includes('\n'))
    assert.equal(result.events[2].text, 'bash: pnpm test')
    // A multi-line command is content, so it is not collapsed to one line.
    assert.equal(result.events.every((event) => event.truncated === undefined || event.truncated === true), true)
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true })
  }
})

test('readSessionEvents preserves tables and explicitly bounds large results', () => {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-events-markdown-'))
  const cwd = '/example/markdown'
  const sessionId = 'markdown-session'
  const table = '# Results\n\n| File | Status |\n| --- | --- |\n| a.js | Passed |\n\nSecond paragraph.\n\n```js\nconst value = 1\n```'
  try {
    writeSessionLog(agentDir, cwd, sessionId, [toolResultEntry('bash', table), toolResultEntry('read', '长'.repeat(30000))])
    const result = readSessionEvents({ agentDir, cwd, sessionId })
    assert.equal(result.events[0].text, table)
    assert.equal(result.events[1].truncated, true)
    assert.ok(Buffer.byteLength(result.events[1].text) <= 65536)
    assert.equal(result.events[1].text.includes('\uFFFD'), false)
  } finally {
    fs.rmSync(agentDir, { recursive: true, force: true })
  }
})

test('readSessionEvents ignores entries that are not session messages', () => {
  const agentDir = path.join(os.tmpdir(), `pi-events-nonmessage-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const cwd = '/Users/test/events-nonmessage'
  const sessionId = 'events-01a062fe-a0a6-7922-a757-abb790ef0003'
  writeSessionLog(agentDir, cwd, sessionId, [
    JSON.stringify({ type: 'session', id: 's1' }),
    JSON.stringify({ type: 'model_change', model: 'test-model' }),
    JSON.stringify({ type: 'thinking_level_change', level: 'high' }),
    JSON.stringify({ type: 'custom', customType: 'note' }),
    JSON.stringify({ type: 'custom_message', content: 'injected' }),
    messageEntry('user', [{ type: 'text', text: 'only real message' }]),
  ])

  const result = readSessionEvents({ agentDir, cwd, sessionId })

  assert.equal(result.ok, true)
  assert.deepEqual(result.events.map((event) => event.kind), ['user'])
  assert.deepEqual(result.events.map((event) => event.text), ['only real message'])
  fs.rmSync(agentDir, { recursive: true, force: true })
})

test('readSessionEvents refuses an unreadable log instead of reporting an empty stream', () => {
  const agentDir = path.join(os.tmpdir(), `pi-events-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  const missingLog = readSessionEvents({ agentDir, cwd: '/Users/test/nowhere', sessionId: 'nothing-here' })
  assert.equal(missingLog.ok, false)
  assert.equal(typeof missingLog.reason, 'string')
  assert.ok(missingLog.reason.length > 0)
  assert.equal(Array.isArray(missingLog.events), false, 'an unreadable log is not an empty successful stream')

  const noRequest = readSessionEvents({ agentDir })
  assert.equal(noRequest.ok, false)
  assert.equal(Array.isArray(noRequest.events), false)
})

test('scanPiSessions carries no session events so the scan stays lightweight', async () => {
  const agentDir = path.join(os.tmpdir(), `pi-events-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const cwd = '/Users/test/events-scan'
  const sessionId = 'events-01a062fe-a0a6-7922-a757-abb790ef0004'
  const wsDir = path.join(agentDir, 'directory-sessions', '--Users-test-events-scan--')
  fs.mkdirSync(wsDir, { recursive: true })
  fs.writeFileSync(path.join(wsDir, 'scan.json'), JSON.stringify({
    sessionId,
    pid: 4321,
    cwd,
    startedAt: 1_700_000_000_000,
    updatedAt: 1_700_000_010_000,
    status: 'running',
    latestGoal: 'Keep the scan lightweight',
    modifiedFiles: [],
  }))
  writeSessionLog(agentDir, cwd, sessionId, [messageEntry('user', [{ type: 'text', text: 'hello' }])])

  const result = await scanPiSessions({
    agentDir,
    checkProcessAlive: (pid) => pid === 4321,
    listProcesses: () => [{ pid: 4321, cwd, command: 'pi', startedAt: 1_700_000_000_000, isAlive: true }],
  })

  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions.every((session) => session.events === undefined), true)
  fs.rmSync(agentDir, { recursive: true, force: true })
})
