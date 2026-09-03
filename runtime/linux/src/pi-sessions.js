const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

function normalizePid(value) {
  const pid = Number(value)
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

function defaultCheckProcessAlive(pid) {
  const normalizedPid = normalizePid(pid)
  if (normalizedPid === null) return false
  try {
    process.kill(normalizedPid, 0)
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

function mergeSessionMetadata(existing, candidate) {
  const existingUpdatedAt = Number(existing?.updatedAt) || 0
  const candidateUpdatedAt = Number(candidate?.updatedAt) || 0
  const newer = candidateUpdatedAt >= existingUpdatedAt ? candidate : existing
  const older = newer === candidate ? existing : candidate
  const merged = { ...older, ...newer }

  for (const field of ['pid', 'cwd', 'startedAt', 'latestGoal', 'command']) {
    if (!merged[field] && older[field]) merged[field] = older[field]
  }
  const newerFiles = Array.isArray(newer.modifiedFiles) ? newer.modifiedFiles : []
  const olderFiles = Array.isArray(older.modifiedFiles) ? older.modifiedFiles : []
  if (newerFiles.length === 0 && olderFiles.length > 0) {
    merged.modifiedFiles = olderFiles
  } else if (newerFiles.length > 0 && olderFiles.length > 0) {
    merged.modifiedFiles = [...new Set([...olderFiles, ...newerFiles])]
  }
  return merged
}

function resolveWorkspaceName(cwd) {
  if (!cwd || typeof cwd !== 'string') return 'Unknown'
  const trimmed = cwd.replace(/[/\\]+$/, '')
  return path.basename(trimmed) || trimmed
}

function parseElapsedSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  if (typeof value !== 'string') return 0
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const parts = trimmed.split(/[-:]/).map(Number)
  if (parts.some((part) => !Number.isFinite(part))) return 0
  if (parts.length === 4) return (((parts[0] * 24) + parts[1]) * 60 + parts[2]) * 60 + parts[3]
  if (parts.length === 3) return (parts[0] * 60 + parts[1]) * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

function readProcessCwd(pid) {
  try {
    return fs.realpathSync(`/proc/${pid}/cwd`)
  } catch {
    const result = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
    if (result.status !== 0) return ''
    const pathLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('n'))
    return pathLine ? pathLine.slice(1) : ''
  }
}

function executableName(value) {
  if (!value || typeof value !== 'string') return ''
  return path.basename(value.trim().replace(/^['"]|['"]$/g, '')).toLowerCase()
}

function isPiExecutable(value) {
  const name = executableName(value)
  return name === 'pi' || name === 'pi.js' || name === 'pi.mjs' || name === 'pi.cjs'
}

function skipCommandWrappers(tokens) {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1
      continue
    }
    const name = executableName(token)
    if (name === 'env') {
      index += 1
      while (index < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]) || tokens[index].startsWith('-'))) {
        if (['-u', '--unset'].includes(tokens[index])) index += 1
        index += 1
      }
      continue
    }
    if (name === 'sudo') {
      index += 1
      while (index < tokens.length && tokens[index].startsWith('-')) {
        if (['-u', '--user', '-g', '--group', '-C', '--chdir'].includes(tokens[index])) index += 1
        index += 1
      }
      continue
    }
    if (name === 'command' || name === 'exec') {
      index += 1
      continue
    }
    break
  }
  return index
}

function shellCommandIsPi(value) {
  const command = String(value || '').trim().replace(/^(['"])(.*)\1$/, '$2')
  return isPiInvocation(command.split(/\s+/).filter(Boolean))
}

function isPiInvocation(tokens) {
  const commandIndex = skipCommandWrappers(tokens)
  const command = tokens[commandIndex]
  if (isPiExecutable(command)) return true
  const launcher = executableName(command)
  if (['sh', 'bash', 'zsh', 'fish'].includes(launcher)) {
    const flagIndex = tokens.slice(commandIndex + 1).findIndex((token) => /^-[^-]*c/.test(token))
    return flagIndex >= 0 && shellCommandIsPi(tokens.slice(commandIndex + 2 + flagIndex).join(' '))
  }
  const script = tokens.slice(commandIndex + 1).find((token) => !token.startsWith('-'))
  if (isPiExecutable(script)) return true
  if (['npx', 'yarn', 'bunx'].includes(launcher)) {
    return tokens.slice(commandIndex + 1).some((token) => isPiExecutable(token))
  }
  if (['bun', 'deno', 'npm', 'pnpm'].includes(launcher)) {
    const subcommandIndex = tokens.slice(commandIndex + 1).findIndex((token) => ['exec', 'dlx', 'run', 'x'].includes(executableName(token)))
    return subcommandIndex >= 0 && tokens.slice(commandIndex + 2 + subcommandIndex).some((token) => isPiExecutable(token))
  }
  return false
}

function isPiProcess(processInfo) {
  if (isPiExecutable(processInfo?.comm)) return true
  if (!processInfo?.args || typeof processInfo.args !== 'string') return false
  const tokens = processInfo.args.split(/\s+/).filter(Boolean)
  return isPiInvocation(tokens)
}

function parseProcessTable(output, now = Date.now()) {
  if (!output || typeof output !== 'string') return []
  const processes = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/)
    if (!match) continue
    const pid = Number(match[1])
    const ppid = Number(match[2])
    const elapsedSeconds = parseElapsedSeconds(match[3])
    const comm = match[4]
    const args = match[5].trim()
    if (!isPiProcess({ comm, args })) continue
    processes.push({
      pid,
      ppid,
      comm,
      command: comm,
      cwd: readProcessCwd(pid),
      elapsedSeconds,
      startedAt: Math.max(0, now - elapsedSeconds * 1000),
      isAlive: true,
    })
  }
  return processes
}

function listPiProcesses(now = Date.now()) {
  const format = process.platform === 'darwin'
    ? ['-axo', 'pid=,ppid=,etime=,comm=,args=']
    : ['-eo', 'pid=,ppid=,etimes=,comm=,args=']
  const result = spawnSync('ps', format, { encoding: 'utf8' })
  if (result.status !== 0) return []
  return parseProcessTable(result.stdout, now)
}

function processMatchesMetadata(metadataSession, processSessionInfo) {
  const metadataStartedAt = Number(metadataSession?.startedAt)
  const processStartedAt = Number(processSessionInfo?.startedAt)
  if (!Number.isFinite(processStartedAt) || processStartedAt <= 0) return true
  if (!Number.isFinite(metadataStartedAt) || metadataStartedAt <= 0) return false
  return Math.abs(metadataStartedAt - processStartedAt) <= 5000
}

function selectMetadataSession(candidates, processSessionInfo) {
  const compatible = candidates.filter((candidate) => processMatchesMetadata(candidate, processSessionInfo))
  if (compatible.length === 0) return null
  return compatible.sort((a, b) => {
    const aDistance = Math.abs((Number(a.startedAt) || 0) - (Number(processSessionInfo.startedAt) || 0))
    const bDistance = Math.abs((Number(b.startedAt) || 0) - (Number(processSessionInfo.startedAt) || 0))
    return aDistance - bDistance || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
  })[0]
}

function markMetadataExited(session) {
  session.isAlive = false
  if (session.status === 'running') session.status = 'exited'
}

function processSession(processInfo) {
  const pid = normalizePid(processInfo?.pid)
  if (pid === null) return null
  const cwd = typeof processInfo.cwd === 'string' ? processInfo.cwd : ''
  const startedAt = Number.isFinite(processInfo.startedAt) ? processInfo.startedAt : 0
  return {
    sessionId: `process-${pid}`,
    uuid: `process-${pid}`,
    pid,
    cwd,
    workspaceName: resolveWorkspaceName(cwd),
    status: 'running',
    isAlive: processInfo.isAlive !== false,
    startedAt,
    updatedAt: startedAt,
    latestGoal: '',
    modifiedFiles: [],
    source: 'process',
    command: processInfo.command || processInfo.comm || 'pi',
  }
}

async function scanPiSessions(options = {}) {
  const agentDir = options.agentDir || process.env.PI_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent')
  const checkAlive = options.checkProcessAlive || defaultCheckProcessAlive
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const listProcesses = options.listProcesses || (() => listPiProcesses(now))
  const dirSessionsPath = path.join(agentDir, 'directory-sessions')

  let wsEntries = []
  if (fs.existsSync(dirSessionsPath)) {
    try {
      wsEntries = fs.readdirSync(dirSessionsPath, { withFileTypes: true })
    } catch {
      wsEntries = []
    }
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
        if (!existing) {
          sessionMap.set(uuid, {
            ...parsed,
            uuid,
            file,
            source: 'session',
          })
        } else {
          sessionMap.set(uuid, {
            ...mergeSessionMetadata(existing, parsed),
            uuid,
            file: Number(parsed.updatedAt) >= Number(existing.updatedAt) ? file : existing.file,
            source: 'session',
          })
        }
      } catch {
        // Skip corrupt JSON files silently
      }
    }
  }

  const sessions = []

  for (const [uuid, data] of sessionMap.entries()) {
    const pid = normalizePid(data.pid)
    const isAlive = pid !== null && checkAlive(pid)
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
      pid,
      cwd,
      workspaceName,
      status,
      isAlive,
      startedAt: data.startedAt || 0,
      updatedAt: data.updatedAt || 0,
      latestGoal: data.latestGoal || '',
      modifiedFiles: Array.isArray(data.modifiedFiles) ? data.modifiedFiles : [],
      source: data.source || 'session',
      command: data.command || '',
    })
  }

  const metadataByPid = new Map()
  for (const session of sessions) {
    if (!session.isAlive || session.pid === null) continue
    const candidates = metadataByPid.get(session.pid) || []
    candidates.push(session)
    metadataByPid.set(session.pid, candidates)
  }
  let processEntries = []
  try {
    processEntries = listProcesses(now) || []
  } catch {
    processEntries = []
  }
  for (const processInfo of processEntries) {
    const session = processSession(processInfo)
    if (!session || !session.isAlive) continue
    const candidates = metadataByPid.get(session.pid) || []
    const metadataSession = selectMetadataSession(candidates, session)
    if (metadataSession) {
      for (const candidate of candidates) {
        if (candidate !== metadataSession) markMetadataExited(candidate)
      }
      if (!metadataSession.cwd && session.cwd) {
        metadataSession.cwd = session.cwd
        metadataSession.workspaceName = session.workspaceName
      }
      if (!metadataSession.command && session.command) metadataSession.command = session.command
      if (!metadataSession.startedAt && session.startedAt) metadataSession.startedAt = session.startedAt
      metadataByPid.delete(session.pid)
      continue
    }
    for (const candidate of candidates) markMetadataExited(candidate)
    metadataByPid.delete(session.pid)
    sessions.push(session)
  }

  // Sort by latest activity; use running state only as a deterministic tie-breaker.
  sessions.sort((a, b) => {
    const activityDiff = (b.updatedAt || b.startedAt || 0) - (a.updatedAt || a.startedAt || 0)
    if (activityDiff !== 0) return activityDiff
    if (a.status === 'running' && b.status !== 'running') return -1
    if (b.status === 'running' && a.status !== 'running') return 1
    return String(a.sessionId).localeCompare(String(b.sessionId))
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
    scannedAt: now,
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
  parseElapsedSeconds,
  parseProcessTable,
  listPiProcesses,
}
