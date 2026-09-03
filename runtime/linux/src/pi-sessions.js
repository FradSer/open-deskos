const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

function defaultCheckProcessAlive(pid) {
  if (typeof pid !== 'number' || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function extractUuid(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return ''
  const match = sessionId.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return match ? match[1].toLowerCase() : sessionId
}

function resolveWorkspaceName(cwd) {
  if (!cwd || typeof cwd !== 'string') return 'Unknown'
  const trimmed = cwd.replace(/[/\\]+$/, '')
  return path.basename(trimmed) || trimmed
}

async function scanPiSessions(options = {}) {
  const agentDir = options.agentDir || process.env.PI_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent')
  const checkAlive = options.checkProcessAlive || defaultCheckProcessAlive
  const dirSessionsPath = path.join(agentDir, 'directory-sessions')

  const fallback = {
    ok: true,
    scannedAt: Date.now(),
    summary: { total: 0, running: 0, settled: 0, exited: 0, workspacesCount: 0 },
    workspaces: [],
    sessions: [],
  }

  if (!fs.existsSync(dirSessionsPath)) {
    return fallback
  }

  let wsEntries = []
  try {
    wsEntries = fs.readdirSync(dirSessionsPath, { withFileTypes: true })
  } catch {
    return fallback
  }

  const sessionMap = new Map()

  for (const wsEntry of wsEntries) {
    if (!wsEntry.isDirectory()) continue
    const wsDirPath = path.join(dirSessionsPath, wsEntry.name)
    let files = []
    try {
      files = fs.readdirSync(wsDirPath)
    } catch {
      continue
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const filePath = path.join(wsDirPath, file)
      try {
        const raw = fs.readFileSync(filePath, 'utf8')
        const parsed = JSON.parse(raw)
        const uuid = extractUuid(parsed.sessionId || file)
        if (!uuid) continue

        const existing = sessionMap.get(uuid)
        // Keep the record with the higher updatedAt or more complete info
        if (!existing || (parsed.updatedAt && (!existing.updatedAt || parsed.updatedAt > existing.updatedAt))) {
          sessionMap.set(uuid, {
            ...parsed,
            uuid,
            file,
          })
        }
      } catch {
        // Skip corrupt JSON files silently
      }
    }
  }

  const sessions = []

  for (const [uuid, data] of sessionMap.entries()) {
    const isAlive = typeof data.pid === 'number' && checkAlive(data.pid)
    let status = 'exited'
    if (isAlive) {
      status = data.status === 'running' ? 'running' : 'settled'
    } else if (data.status === 'running') {
      // Process was marked running but PID is dead
      status = 'exited'
    } else {
      status = data.status || 'exited'
    }

    const cwd = data.cwd || ''
    const workspaceName = resolveWorkspaceName(cwd)

    sessions.push({
      sessionId: data.sessionId || uuid,
      uuid,
      pid: data.pid || null,
      cwd,
      workspaceName,
      status,
      isAlive,
      startedAt: data.startedAt || 0,
      updatedAt: data.updatedAt || 0,
      latestGoal: data.latestGoal || '',
      modifiedFiles: Array.isArray(data.modifiedFiles) ? data.modifiedFiles : [],
    })
  }

  // Sort sessions: running first, then by updatedAt descending
  sessions.sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1
    if (b.status === 'running' && a.status !== 'running') return 1
    return (b.updatedAt || 0) - (a.updatedAt || 0)
  })

  // Group by workspace
  const workspaceMap = new Map()
  for (const s of sessions) {
    const key = s.cwd || s.workspaceName
    if (!workspaceMap.has(key)) {
      workspaceMap.set(key, {
        name: s.workspaceName,
        cwd: s.cwd,
        runningCount: 0,
        settledCount: 0,
        exitedCount: 0,
        totalCount: 0,
        sessions: [],
      })
    }
    const ws = workspaceMap.get(key)
    ws.totalCount += 1
    if (s.status === 'running') ws.runningCount += 1
    else if (s.status === 'settled') ws.settledCount += 1
    else ws.exitedCount += 1
    ws.sessions.push(s)
  }

  const workspaces = Array.from(workspaceMap.values()).sort((a, b) => {
    if (a.runningCount !== b.runningCount) return b.runningCount - a.runningCount
    return b.totalCount - a.totalCount
  })

  const runningCount = sessions.filter(s => s.status === 'running').length
  const settledCount = sessions.filter(s => s.status === 'settled').length
  const exitedCount = sessions.filter(s => s.status === 'exited').length

  return {
    ok: true,
    scannedAt: Date.now(),
    summary: {
      total: sessions.length,
      running: runningCount,
      settled: settledCount,
      exited: exitedCount,
      workspacesCount: workspaces.length,
    },
    workspaces,
    sessions,
  }
}

module.exports = {
  scanPiSessions,
  extractUuid,
  resolveWorkspaceName,
}
