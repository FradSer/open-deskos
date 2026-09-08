const { execFile } = require('node:child_process')
const { scanPiSessions } = require('./pi-sessions')

function quote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function validSession(session) {
  return session && typeof session === 'object' && typeof session.isAlive === 'boolean'
    && ['running', 'settled', 'exited'].includes(session.status)
    && (session.pid === null || (Number.isSafeInteger(session.pid) && session.pid > 0))
    && ['cwd', 'workspaceName', 'latestGoal', 'uuid', 'sessionId', 'command', 'activity', 'recap'].every((key) => session[key] === undefined || typeof session[key] === 'string')
    && (session.modifiedFiles === undefined || (Array.isArray(session.modifiedFiles) && session.modifiedFiles.every((file) => typeof file === 'string')))
}

function validSnapshot(data) {
  const counts = ['total', 'running', 'settled', 'exited', 'workspacesCount']
  return data?.ok === true && Number.isFinite(data.scannedAt)
    && Math.abs(Date.now() - data.scannedAt) < 60000
    && Array.isArray(data.sessions) && Array.isArray(data.workspaces)
    && counts.every((key) => Number.isSafeInteger(data.summary?.[key]) && data.summary[key] >= 0)
    && data.summary.total === data.sessions.length
    && data.summary.workspacesCount === data.workspaces.length
    && data.summary.total === data.summary.running + data.summary.settled + data.summary.exited
    && data.sessions.every(validSession)
    && data.workspaces.every((workspace) => workspace && Array.isArray(workspace.sessions) && workspace.sessions.every(validSession))
}

function unavailable(source, error) {
  return { ok: false, source, error, scannedAt: null, summary: null, sessions: [], workspaces: [] }
}

function scanRemote(config, source, execute) {
  const { host, node, collector } = config
  const validPath = (value) => typeof value === 'string' && value.startsWith('/') && !/[\r\n\0]/.test(value)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/.test(host || '') || !validPath(node) || !validPath(collector)) {
    return Promise.resolve(unavailable(source, 'Invalid SSH configuration: set host and absolute Node/collector paths.'))
  }
  const args = ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ConnectTimeout=5', '-o', 'ConnectionAttempts=1', '-o', 'ServerAliveInterval=3',
    '-o', 'ServerAliveCountMax=1', '-o', 'ClearAllForwardings=yes', host,
    `${quote(node)} ${quote(collector)}`]
  return new Promise((resolve) => {
    execute('ssh', args, { encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024, killSignal: 'SIGKILL' }, (error, stdout) => {
      if (error) return resolve(unavailable(source, 'SSH scan unavailable: check connection, host key, authentication, and collector.'))
      try {
        const data = JSON.parse(stdout)
        if (!validSnapshot(data)) throw new Error('Invalid snapshot')
        resolve({ ...data, source })
      } catch {
        resolve(unavailable(source, 'SSH collector returned an invalid or stale snapshot.'))
      }
    })
  })
}

function createPiSessionsSource({ env = process.env, scanLocal = scanPiSessions, execute = execFile } = {}) {
  const config = { host: env.ODK_PI_SSH_HOST, node: env.ODK_PI_SSH_NODE, collector: env.ODK_PI_SSH_COLLECTOR }
  const remote = Object.values(config).some((value) => value !== undefined)
  const source = remote
    ? { kind: 'ssh', label: `Mac / SSH · ${config.host || 'unconfigured'}` }
    : { kind: 'local', label: 'Local' }
  let pending
  return () => {
    if (!pending) {
      pending = (remote ? scanRemote(config, source, execute) : Promise.resolve().then(scanLocal)
        .then((data) => ({ ...data, source })))
        .catch(() => unavailable(source, 'Pi scan unavailable.'))
        .finally(() => { pending = null })
    }
    return pending
  }
}

module.exports = { createPiSessionsSource }
