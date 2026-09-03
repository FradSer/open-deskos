const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { scanPiSessions } = require('../src/pi-sessions')

test('scanPiSessions returns empty summary when agent directory does not exist', async () => {
  const nonExistentDir = path.join(os.tmpdir(), `pi-test-agent-${Date.now()}`)
  const result = await scanPiSessions({ agentDir: nonExistentDir })
  assert.equal(result.ok, true)
  assert.equal(result.summary.total, 0)
  assert.equal(result.summary.running, 0)
  assert.deepEqual(result.sessions, [])
  assert.deepEqual(result.workspaces, [])
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

