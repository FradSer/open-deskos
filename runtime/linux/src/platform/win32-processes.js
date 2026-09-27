'use strict'

const { execFileSync } = require('node:child_process')
const { tokenizeWindowsCommandLine } = require('./win32-command-line')
const { createNativeProcessReader } = require('./native-process-reader')

// The managed fallback projects exactly the fields the desk needs, so the
// decoder never has to guess at PowerShell's own date serialization.
const PROCESS_TABLE_SCRIPT = [
  '$ErrorActionPreference = "Stop";',
  'Get-CimInstance Win32_Process |',
  '  Select-Object ProcessId, ParentProcessId, Name, CommandLine,',
  "    @{n='startedAtMs'; e={ [int64]([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }} |",
  '  ConvertTo-Json -Compress -Depth 3',
].join(' ')

function normalizePid(value) {
  const pid = Number(value)
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

function normalizeStart(value, now) {
  const startedAt = Number(value)
  if (!Number.isFinite(startedAt) || startedAt <= 0) return { startedAt: 0, elapsedSeconds: 0 }
  return { startedAt, elapsedSeconds: Math.max(0, Math.floor((now - startedAt) / 1000)) }
}

// One row shape for both backends: the managed table names its columns, the
// native reader names its fields, and everything downstream sees this.
function toProcessRow(entry, now) {
  if (!entry || typeof entry !== 'object') return null
  const pid = normalizePid(entry.ProcessId ?? entry.pid)
  if (pid === null) return null
  const command = typeof (entry.CommandLine ?? entry.command) === 'string' ? (entry.CommandLine ?? entry.command) : ''
  const { startedAt, elapsedSeconds } = normalizeStart(entry.startedAtMs, now)
  const cwd = typeof entry.cwd === 'string' ? entry.cwd : ''
  return {
    pid,
    ppid: normalizePid(entry.ParentProcessId ?? entry.ppid),
    comm: typeof (entry.Name ?? entry.exe) === 'string' ? (entry.Name ?? entry.exe) : '',
    command,
    tokens: tokenizeWindowsCommandLine(command),
    // A host that cannot read another process's directory reports it empty.
    // Nothing downstream may fill it in from the executable or the command line.
    cwd,
    startedAt,
    elapsedSeconds,
    isAlive: true,
  }
}

function parseWindowsProcessTable(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'string') return []
  let decoded = null
  try {
    decoded = JSON.parse(payload)
  } catch {
    return []
  }
  if (!decoded || typeof decoded !== 'object') return []
  const entries = Array.isArray(decoded) ? decoded : [decoded]
  const rows = []
  for (const entry of entries) {
    const row = toProcessRow(entry, now)
    if (row) rows.push(row)
  }
  return rows
}

function readManagedProcessTable() {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROCESS_TABLE_SCRIPT], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  })
}

/**
 * The Windows process source. The native module owns the table when it loads,
 * because it reads the command line and the work directory in one place; the
 * managed fallback keeps the desk working without it and leaves every directory
 * it cannot read unknown.
 */
function createWindowsProcessSource({ loadNative, readManagedTable, now = () => Date.now() } = {}) {
  const load = loadNative || (() => createNativeProcessReader().reader)
  const managed = readManagedTable || readManagedProcessTable
  let reader = null
  try {
    reader = load()
  } catch {
    reader = null
  }
  let backend = reader ? 'native' : 'managed'

  return {
    get backend() {
      return backend
    },
    list(when = now()) {
      if (reader) {
        try {
          const entries = reader.listProcesses()
          return (Array.isArray(entries) ? entries : []).map((entry) => toProcessRow(entry, when)).filter(Boolean)
        } catch {
          // A refused enumeration is degradation, not failure: the desk keeps a
          // smaller truth for this host instead of showing nothing.
          reader = null
          backend = 'managed'
        }
      }
      try {
        return parseWindowsProcessTable(managed(), when)
      } catch {
        return []
      }
    },
  }
}

module.exports = {
  createWindowsProcessSource,
  parseWindowsProcessTable,
  toProcessRow,
  PROCESS_TABLE_SCRIPT,
}