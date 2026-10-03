const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const { boundedEvent, retainEvents } = require('./pi-session-events')
const { resolveShellHost } = require('./platform')
const { tokenizeWindowsCommandLine } = require('./platform/win32-command-line')

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

  for (const field of ['pid', 'cwd', 'startedAt', 'latestGoal', 'command', 'recap', 'activity']) {
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

function extractLatestLine(text) {
  if (!text || typeof text !== 'string') return ''
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].replace(/\s+/g, ' ').trim()
    if (trimmed.length > 0 && !trimmed.startsWith('... [truncated') && !trimmed.startsWith('…[truncated')) {
      return trimmed
    }
  }
  return ''
}

function formatToolCall(toolName, args) {
  if (!toolName) return 'Working...'
  const parsed = typeof args === 'string'
    ? (() => { try { return JSON.parse(args) } catch { return {} } })()
    : (args || {})
  // The call is kept as Pi issued it: a multi-line command or a heredoc is
  // content, and collapsing it to one line is the omission this surface no
  // longer makes. The overview's one-line activity stays a summary.
  if (parsed.command && typeof parsed.command === 'string') {
    return `bash: ${parsed.command.trim()}`
  }
  if (parsed.path && typeof parsed.path === 'string') {
    return `${toolName}: ${parsed.path.trim()}`
  }
  if (parsed.query && typeof parsed.query === 'string') {
    return `search: ${parsed.query.trim()}`
  }
  if (parsed.subject && typeof parsed.subject === 'string') {
    return `${toolName}: ${parsed.subject.trim()}`
  }
  return toolName
}

const LATEST_ACTIVITY_MAX_BYTES = 65536
const SESSION_EVENT_MAX_BYTES = 2 * 1024 * 1024
const SESSION_EVENT_MAX_EVENTS = 300
// Pi renders every event it produces; the desk keeps each body and bounds it per
// kind instead of flattening it to one line, so a bash command, a prompt, or a
// result is read in full within its own limit.
const SESSION_EVENT_BODY_BYTES = {
  result: 64 * 1024,
  assistant: 16 * 1024,
  user: 8 * 1024,
  thinking: 4 * 1024,
  tool: 4 * 1024,
}
const SESSION_EVENT_MAX_BODY_BYTES = SESSION_EVENT_BODY_BYTES.result

function resolveSessionLogPath(agentDir, cwd, sessionId) {
  if (!agentDir || !cwd || !sessionId) return ''
  const dirName = '--' + cwd.replace(/^[/\\]+/, '').replace(/[/\\]+/g, '-').replace(/-+$/, '') + '--'
  const sessionsDir = path.join(agentDir, 'sessions', dirName)
  if (!fs.existsSync(sessionsDir)) return ''
  const match = fs.readdirSync(sessionsDir).find((file) => file.includes(sessionId) && file.endsWith('.jsonl'))
  return match ? path.join(sessionsDir, match) : ''
}

function openLogTail(filePath, maxBytes) {
  const stat = fs.statSync(filePath)
  const size = Math.min(stat.size, maxBytes)
  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(size)
    fs.readSync(fd, buffer, 0, size, Math.max(0, stat.size - size))
    return { text: buffer.toString('utf8'), truncated: stat.size > size }
  } finally {
    fs.closeSync(fd)
  }
}

function extractLatestActivity(agentDir, cwd, sessionId) {
  try {
    const filePath = resolveSessionLogPath(agentDir, cwd, sessionId)
    if (!filePath) return ''
    const lines = openLogTail(filePath, LATEST_ACTIVITY_MAX_BYTES).text.trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i])
        const msg = entry?.message
        if (msg?.role === 'assistant') {
          const contents = Array.isArray(msg.content) ? msg.content : []
          for (let j = contents.length - 1; j >= 0; j--) {
            const part = contents[j]
            if (part?.type === 'toolCall') {
              return formatToolCall(part.name, part.arguments)
            }
            if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
              const line = extractLatestLine(part.text)
              if (line) return line
            }
            if (part?.type === 'thinking' && typeof part.thinking === 'string' && part.thinking.trim()) {
              const line = extractLatestLine(part.thinking)
              if (line) return line
            }
          }
        }
      } catch {}
    }
  } catch {}
  return ''
}

function boundEventBody(text, maxBytes = SESSION_EVENT_MAX_BODY_BYTES) {
  if (!text || typeof text !== 'string') return { text: '' }
  const bytes = Buffer.from(text)
  if (bytes.length <= maxBytes) return { text }
  let end = maxBytes
  // A byte limit must never bisect a UTF-8 code point.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return { text: bytes.subarray(0, end).toString('utf8').replace(/\s+$/, ''), truncated: true }
}

// Every event keeps its body for safe Markdown rendering, with explicit
// per-kind truncation.
function sessionEventsFromEntry(entry) {
  if (!entry || entry.type !== 'message') return []
  const message = entry.message
  if (!message || typeof message !== 'object') return []
  const content = Array.isArray(message.content) ? message.content : []
  const events = []
  if (message.role === 'toolResult') {
    const text = content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n\n')
    if (!text.trim()) return []
    // The body is bounded once, when the event is emitted, so a second pass
    // cannot drop the tool name or lose the truncation flag. The call identity
    // and Pi's own error flag travel with it, so the desk colours the tool box
    // from the outcome Pi recorded instead of guessing one from the kind.
    const toolName = typeof message.toolName === 'string' ? message.toolName.trim() : ''
    const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId.trim() : ''
    return [{
      kind: 'result',
      text,
      ...(toolName ? { toolName } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(message.isError === true ? { isError: true } : {}),
    }]
  }
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    if (message.role === 'user' && part.type === 'text') {
      const text = typeof part.text === 'string' ? part.text.trim() : ''
      if (text) events.push({ kind: 'user', text })
      continue
    }
    if (message.role === 'assistant' && part.type === 'thinking') {
      const text = typeof part.thinking === 'string' ? part.thinking.trim() : ''
      if (text) events.push({ kind: 'thinking', text })
      continue
    }
    if (message.role === 'assistant' && part.type === 'toolCall') {
      const text = formatToolCall(part.name, part.arguments)
      const toolCallId = typeof part.id === 'string' ? part.id.trim() : ''
      if (text && text.trim()) events.push({ kind: 'tool', text, ...(toolCallId ? { toolCallId } : {}) })
      continue
    }
    // The reply body is added once, after its thinking and tool calls.
  }
  if (message.role === 'assistant') {
    // One reply may stream as several text parts; Pi reads them as one body.
    const said = content.filter(part => part?.type === 'text' && typeof part.text === 'string' && part.text.trim())
    if (said.length > 0) events.push({ kind: 'assistant', text: said.map(part => part.text).join('\n\n') })
  }
  return events
}

function boundEventBodyOf(event) {
  const body = boundEventBody(event.text, SESSION_EVENT_BODY_BYTES[event.kind] || SESSION_EVENT_MAX_BODY_BYTES)
  if (!body.text) return null
  const toolName = typeof event.toolName === 'string' ? event.toolName.trim() : ''
  const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId.trim() : ''
  return {
    kind: event.kind,
    text: body.text,
    ...(toolName ? { toolName } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(event.isError === true ? { isError: true } : {}),
    ...(body.truncated ? { truncated: true } : {}),
  }
}

function readSessionEvents(options = {}) {
  const agentDir = options.agentDir || process.env.PI_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent')
  const { cwd, sessionId } = options
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : SESSION_EVENT_MAX_BYTES
  const maxEvents = Number.isFinite(options.maxEvents) && options.maxEvents > 0 ? options.maxEvents : SESSION_EVENT_MAX_EVENTS
  if (!cwd || !sessionId) return { ok: false, reason: 'session-identity-required' }

  let filePath = ''
  let tail = null
  try {
    filePath = resolveSessionLogPath(agentDir, cwd, sessionId)
    if (filePath) tail = openLogTail(filePath, maxBytes)
  } catch {
    return { ok: false, reason: 'session-log-unreadable' }
  }
  if (!tail) return { ok: false, reason: 'session-log-missing' }

  const lines = tail.text.split('\n')
  // A tail read can start mid-record; that partial first line is not an entry.
  if (tail.truncated) lines.shift()

  const collected = []
  for (const line of lines) {
    if (!line.trim()) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    for (const event of sessionEventsFromEntry(entry)) collected.push(event)
  }

  const events = retainEvents(collected.map(boundEventBodyOf).filter(Boolean),
    Math.min(maxEvents, SESSION_EVENT_MAX_EVENTS))
  if (events.length === 0 && tail.truncated) return { ok: false, reason: 'session-log-tail-limit' }
  return { ok: true, events, truncated: tail.truncated || collected.length > events.length }
}

function resolveWorkspaceName(cwd) {
  if (!cwd || typeof cwd !== 'string') return 'Unknown'
  const trimmed = cwd.replace(/[/\\]+$/, '')
  // Both separators are split on every host: a session row can name a path the
  // running host did not produce (a Windows desk reading a reported POSIX path,
  // or the reverse), and `path.basename` would then return the whole string.
  const name = trimmed.split(/[\\/]/).pop() || ''
  return name || trimmed
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
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '')
  // `://` is the one thing that makes a value certainly not a path; a URL's
  // backslash is not a separator. Otherwise the last of either separator wins,
  // because Windows accepts both in the same path.
  const name = (trimmed.includes('://') ? trimmed.split('/').pop() : trimmed.split(/[\\/]/).pop()) || ''
  // A Windows launcher suffix names the same program: `node.exe` is `node`, and
  // `pi.cmd` is `pi`. Stripping it here keeps one rule for both hosts instead of
  // a second executable list.
  return name.replace(WINDOWS_EXECUTABLE_SUFFIX, '').toLowerCase()
}

function isPiExecutable(value) {
  const name = executableName(value)
  return name === 'pi' || name === 'pi.js' || name === 'pi.mjs' || name === 'pi.cjs'
}

const WINDOWS_EXECUTABLE_SUFFIX = /\.(exe|cmd|bat|ps1)$/i
const POSIX_SHELL_LAUNCHERS = ['sh', 'bash', 'zsh', 'fish']
const WINDOWS_SHELL_LAUNCHERS = ['cmd', 'powershell', 'pwsh']

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
    if (['command', 'exec', 'corepack', 'time', 'nice', 'nohup', 'setsid'].includes(name)) {
      index += 1
      continue
    }
    break
  }
  return index
}

function shellCommandIsPi(value, depth = 0) {
  const command = String(value || '').trim().replace(/^(['"])(.*)\1$/, '$2')
  return isPiInvocation(command.split(/\s+/).filter(Boolean), depth)
}

const IS_WINDOWS_COMMAND_SEPARATOR = /^(&&|\|\||[&|])$/
// A redirection is not part of the command being run: it is removed before the
// command line is read, so `cmd /c "node pi.js" 2>&1` is the same invocation as
// `cmd /c "node pi.js"`.
const WINDOWS_REDIRECTION = /^(?:\d?>>?|\d?<|\d?>&\d?)$/
const WINDOWS_REDIRECTION_WITH_TARGET = /^(?:\d?>>?|\d?<)$/
// A process table is untrusted input, so wrapper unwrapping is bounded. Without
// a bound, a pathologically nested `cmd /c` line overflows the stack, and a
// throw on the Windows path empties the Pi process set: every session would be
// hidden because one row was absurd.
const MAX_WRAPPER_DEPTH = 8

function stripWindowsRedirection(tail) {
  const kept = []
  for (let index = 0; index < tail.length; index += 1) {
    const token = tail[index]
    if (WINDOWS_REDIRECTION.test(token)) {
      // `> log.txt` is a redirection plus its target; `2>&1` is one token.
      if (WINDOWS_REDIRECTION_WITH_TARGET.test(token)) index += 1
      continue
    }
    // `>`, `<`, and `|` cannot appear in a Windows path, so a target glued to
    // the command is a redirection rather than part of the name.
    const glued = token.search(/[<>]/)
    kept.push(glued === -1 ? token : token.slice(0, glued))
  }
  return kept
}

/**
 * `cmd /c {"<whole command line>"}` arrives as one argument whose inner quoting
 * the outer tokenization consumed. That string is ambiguous —
 * `node C:\my tools\pi.js` could be one path or two arguments — so both readings
 * are tried and either one recognizing a Pi invocation is enough.
 *
 * Separators are read only where they arrived as their own argv element. Two
 * earlier attempts to recover separators and quoting from inside a token both
 * over-accepted (`cmd /c node "C:\tools\pi&b.js"` read as Pi because of the `&`
 * in a filename), and an accepted non-Pi row is not harmless: it enters the
 * scan's Pi pid set, where a session parented by that pid is discarded as
 * another session's worker. The unrecognized forms below are the price, and they
 * are pinned by tests rather than left to chance.
 */
function recognizeWindowsWrappedCommand(tail, depth) {
  const args = stripWindowsRedirection(tail)
  if (args.length === 0) return false
  const candidates = []
  if (args.length > 1) {
    // Arguments the outer tokenizer already split, used as they arrived.
    candidates.push(args)
    // `cmd /c "node pi.js" 2 > log.txt`: the quoted command line is one argument
    // and what follows it belongs to that command, so the line is read as the
    // command and the rest as its arguments. Gating this on whether a redirection
    // happened made the desk's answer depend on an incidental redirection, which
    // is worse than the one recorded over-acceptance it shares with the reference
    // host: a command whose first non-flag argument names a script called `pi`
    // (see isPiInvocation's generic script rule) reads as Pi.
    if (/\s/.test(args[0])) {
      const words = args[0].match(/^(\S+)\s+([\s\S]+)$/)
      if (words) {
        candidates.push([words[1], ...tokenizeWindowsCommandLine(words[2]), ...args.slice(1)])
        candidates.push([words[1], words[2], ...args.slice(1)])
      }
    }
  } else {
    const words = args[0].match(/^(\S+)\s+([\s\S]+)$/)
    if (!words) candidates.push([args[0]])
    else {
      candidates.push([words[1], ...tokenizeWindowsCommandLine(words[2])])
      candidates.push([words[1], words[2]])
    }
  }
  return candidates.some((candidate) => windowsCommandSegments(candidate).some((segment) => isPiInvocation(segment, depth + 1)))
}

// A shell line can chain commands (`set FOO=1 && pi`), and the process holding
// that line is the wrapper for whatever it runs, exactly as `sh -c` is.
function windowsCommandSegments(tokens) {
  const segments = [[]]
  for (const token of tokens) {
    if (IS_WINDOWS_COMMAND_SEPARATOR.test(token)) segments.push([])
    else segments[segments.length - 1].push(token)
  }
  return segments.filter((segment) => segment.length > 0)
}

function isPiInvocation(tokens, depth = 0) {
  if (depth > MAX_WRAPPER_DEPTH) return false
  const commandIndex = skipCommandWrappers(tokens)
  const command = tokens[commandIndex]
  if (isPiExecutable(command)) return true
  const launcher = executableName(command)
  if (POSIX_SHELL_LAUNCHERS.includes(launcher)) {
    const flagIndex = tokens.slice(commandIndex + 1).findIndex((token) => /^-[^-]*c/.test(token))
    return flagIndex >= 0 && shellCommandIsPi(tokens.slice(commandIndex + 2 + flagIndex).join(' '), depth + 1)
  }
  if (WINDOWS_SHELL_LAUNCHERS.includes(launcher)) {
    // `cmd /c pi`, `pwsh -Command pi`: the shell is a wrapper, and what follows
    // its command switch is another command line.
    const rest = tokens.slice(commandIndex + 1)
    const flagIndex = rest.findIndex((token) => /^\/c$/i.test(token) || /^-c(ommand)?$/i.test(token))
    if (flagIndex >= 0 && recognizeWindowsWrappedCommand(rest.slice(flagIndex + 1), depth)) return true
    return windowsCommandSegments(rest).some((segment) => isPiInvocation(segment, depth + 1))
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
  // POSIX reports the command line as `args`; a Windows host reports it as
  // `command` with the tokens its own quoting rules produced.
  const command = typeof processInfo?.args === 'string'
    ? processInfo.args
    : (typeof processInfo?.command === 'string' ? processInfo.command : '')
  if (!command) return false
  const tokens = Array.isArray(processInfo.tokens)
    ? processInfo.tokens
    : command.split(/\s+/).filter(Boolean)
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

let windowsProcessSource = null

function resolveWindowsProcessSource() {
  if (!windowsProcessSource) {
    const { createWindowsProcessSource } = require('./platform/win32-processes')
    windowsProcessSource = createWindowsProcessSource()
  }
  return windowsProcessSource
}

function listPiProcesses(now = Date.now(), strict = false, options = {}) {
  const host = options.host || resolveShellHost()
  if (host.isWindows) {
    // A Windows host has no `ps`: its own source owns the table, and the native
    // module owns the work directory whenever it is built and loadable.
    const source = options.windowsSource || resolveWindowsProcessSource()
    try {
      // The scan reads the returned rows as the Pi process set — the POSIX path
      // filters as it parses, so this path filters too. Without it, every row
      // would count as a Pi process and a live session parented by any running
      // process would be discarded as another session's worker.
      return (source.list(now) || []).filter(isPiProcess)
    } catch (error) {
      if (strict) throw new Error('Pi process inspection unavailable')
      return []
    }
  }
  const format = process.platform === 'darwin'
    ? ['-axo', 'pid=,ppid=,etime=,comm=,args=']
    : ['-eo', 'pid=,ppid=,etimes=,comm=,args=']
  const result = spawnSync('ps', format, { encoding: 'utf8' })
  if (result.status !== 0) {
    if (strict) throw new Error('Pi process inspection unavailable')
    return []
  }
  return parseProcessTable(result.stdout, now)
}

function processMatchesMetadata(metadataSession, processSessionInfo) {
  const processStartedAt = Number(processSessionInfo?.startedAt)
  if (!Number.isFinite(processStartedAt) || processStartedAt <= 0) return true
  const metadataStartedAt = Number(metadataSession?.startedAt)
  if (Number.isFinite(metadataStartedAt) && metadataStartedAt > 0 &&
      Math.abs(metadataStartedAt - processStartedAt) <= 5000) return true
  // The metadata was written while the current process was alive: it covers
  // resumed sessions, sessions created inside a long-lived process, and
  // metadata that records no startedAt. A stale file of a dead process cannot
  // have been written after the live process started, so PID reuse stays safe.
  const metadataUpdatedAt = Number(metadataSession?.updatedAt)
  return Number.isFinite(metadataUpdatedAt) && metadataUpdatedAt > 0 &&
         metadataUpdatedAt >= processStartedAt - 5000
}

function selectMetadataSession(candidates, processSessionInfo) {
  const compatible = candidates.filter((candidate) => processMatchesMetadata(candidate, processSessionInfo))
  if (compatible.length === 0) return null
  const sorted = compatible.sort((a, b) => {
    // The candidate whose file is written most recently is the session the
    // live process is serving now; activity distance is only a tie-breaker.
    const updatedDiff = (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
    if (updatedDiff !== 0) return updatedDiff
    const aDistance = Math.abs((Number(a.startedAt) || 0) - (Number(processSessionInfo.startedAt) || 0))
    const bDistance = Math.abs((Number(b.startedAt) || 0) - (Number(processSessionInfo.startedAt) || 0))
    return aDistance - bDistance || (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)
  })
  const processStartedAt = Number(processSessionInfo.startedAt)
  const startsAreKnown = Number.isFinite(processStartedAt) && processStartedAt > 0 && sorted.every((candidate) => Number.isFinite(Number(candidate.startedAt)) && Number(candidate.startedAt) > 0)
  if (sorted.length > 1 && (!startsAreKnown || Math.abs(Number(sorted[0].startedAt) - Number(sorted[1].startedAt)) <= 5000)) return null
  return sorted[0]
}

function markMetadataExited(session) {
  session.isAlive = false
  session.status = 'exited'
}

function isDirectPiChild(pid, ppidByPid, piPids) {
  const ppid = normalizePid(ppidByPid.get(pid))
  return ppid !== null && ppid !== pid && piPids.has(ppid)
}

function normalizeProcessEntry(processInfo) {
  const pid = normalizePid(processInfo?.pid)
  if (pid === null) return null
  const cwd = typeof processInfo.cwd === 'string' ? processInfo.cwd : ''
  const startedAt = Number.isFinite(processInfo.startedAt) ? processInfo.startedAt : 0
  return {
    pid,
    ppid: normalizePid(processInfo?.ppid),
    cwd,
    workspaceName: resolveWorkspaceName(cwd),
    isAlive: processInfo.isAlive !== false,
    startedAt,
    command: processInfo.command || processInfo.comm || 'pi',
  }
}

async function scanPiSessions(options = {}) {
  const agentDir = options.agentDir || process.env.PI_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent')
  const checkAlive = options.checkProcessAlive || defaultCheckProcessAlive
  const now = Number.isFinite(options.now) ? options.now : Date.now()
  const listProcesses = options.listProcesses || (() => listPiProcesses(now, options.strictProcessInspection))
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
    }

    const cwd = data.cwd || ''
    const workspaceName = resolveWorkspaceName(cwd)
    const activity = extractLatestActivity(agentDir, cwd, data.sessionId || uuid) || data.recap || ''

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
      activity,
      recap: data.recap || '',
    })
  }

  let rawProcessEntries = []
  try {
    rawProcessEntries = listProcesses(now) || []
  } catch (error) {
    if (options.strictProcessInspection) throw error
    rawProcessEntries = []
  }
  // The process table is a liveness and enrichment oracle only: sessions come
  // exclusively from directory-sessions metadata. Processes without metadata
  // (transient workers, nested helpers, unregistered roots) are counted for
  // diagnostics and never synthesized into sessions.
  const processEntries = []
  const piPids = new Set()
  const ppidByPid = new Map()
  for (const raw of rawProcessEntries) {
    const entry = normalizeProcessEntry(raw)
    if (!entry || !entry.isAlive) continue
    processEntries.push(entry)
    piPids.add(entry.pid)
    if (entry.ppid !== null) ppidByPid.set(entry.pid, entry.ppid)
  }

  // Worker processes spawned by another live Pi session (teammates, isolated
  // research children) are implementation details of their parent session.
  // Their metadata registrations, if any, must not appear as top-level sessions.
  const leaderSessions = sessions.filter((session) => {
    if (!session.isAlive || session.pid === null) return true
    return !isDirectPiChild(session.pid, ppidByPid, piPids)
  })
  sessions.length = 0
  sessions.push(...leaderSessions)

  const metadataByPid = new Map()
  for (const session of sessions) {
    if (!session.isAlive || session.pid === null) continue
    const candidates = metadataByPid.get(session.pid) || []
    candidates.push(session)
    metadataByPid.set(session.pid, candidates)
  }
  let orphanProcessCount = 0
  for (const processInfo of processEntries) {
    const candidates = metadataByPid.get(processInfo.pid) || []
    const metadataSession = selectMetadataSession(candidates, processInfo)
    if (metadataSession) {
      for (const candidate of candidates) {
        if (candidate !== metadataSession) markMetadataExited(candidate)
      }
      if (!metadataSession.cwd && processInfo.cwd) {
        metadataSession.cwd = processInfo.cwd
        metadataSession.workspaceName = processInfo.workspaceName
      }
      if (!metadataSession.command && processInfo.command) metadataSession.command = processInfo.command
      if (!metadataSession.startedAt && processInfo.startedAt) metadataSession.startedAt = processInfo.startedAt
      metadataByPid.delete(processInfo.pid)
      continue
    }
    for (const candidate of candidates) markMetadataExited(candidate)
    metadataByPid.delete(processInfo.pid)
    orphanProcessCount += 1
  }

  // Sort by running state first; latest activity breaks ties deterministically.
  sessions.sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1
    if (b.status === 'running' && a.status !== 'running') return 1
    const activityDiff = (b.updatedAt || b.startedAt || 0) - (a.updatedAt || a.startedAt || 0)
    if (activityDiff !== 0) return activityDiff
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
    orphanProcesses: orphanProcessCount,
    workspaces,
    sessions,
  }
}

module.exports = {
  scanPiSessions,
  readSessionEvents,
  extractUuid,
  resolveWorkspaceName,
  parseElapsedSeconds,
  parseProcessTable,
  listPiProcesses,
  isPiProcess,
  tokenizeWindowsCommandLine,
}
