const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { parseProcessTable, scanPiSessions } = require('../src/pi-sessions')

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

test('scanPiSessions includes running Pi processes without metadata', async () => {
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

  assert.equal(result.summary.total, 1)
  assert.equal(result.summary.running, 1)
  assert.equal(result.summary.workspacesCount, 1)
  assert.equal(result.sessions[0].sessionId, 'process-4321')
  assert.equal(result.sessions[0].workspaceName, 'desk-app')
  assert.equal(result.sessions[0].startedAt, 1_699_999_940_000)
  assert.equal(result.sessions[0].latestGoal, '')
  assert.deepEqual(result.sessions[0].modifiedFiles, [])
  assert.equal(result.sessions[0].source, 'process')
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

  assert.equal(result.sessions.length, 3)
  assert.equal(result.summary.running, 1)
  assert.equal(result.summary.exited, 2)
  assert.equal(result.sessions.filter((session) => session.source === 'process').length, 1)
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

  assert.equal(result.sessions.length, 2)
  assert.equal(result.summary.running, 1)
  assert.equal(result.summary.exited, 1)
  assert.equal(result.sessions.find((session) => session.latestGoal === 'Possibly stale goal').status, 'exited')
  assert.equal(result.sessions.find((session) => session.source === 'process').cwd, '/Users/test/new-workspace')
  fs.rmSync(tmpAgentDir, { recursive: true, force: true })
})

test('scanPiSessions sorts by latest activity before running state', async () => {
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

  assert.deepEqual(result.sessions.map((session) => session.pid), [222, 111])
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
  const ctx = {
    navigateToPage(pageId) { navigated = pageId },
    onTick(fn) {},
  }

  plugin.mount(fakeEl, ctx)
  assert.ok(fakeEl.innerHTML.includes('sb-pi-status'))
  assert.ok(fakeEl.innerHTML.includes('PI'))
  assert.equal(typeof btnListeners.click, 'function')
  btnListeners.click()
  assert.equal(navigated, 'pi-sessions')
})

