import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import { isAbsolute, resolve } from 'node:path'

/** Every failure the model sees is one of these; the CLI's own detail never escapes unbounded. */
export class BrowserError extends Error {
  /** A killed mutating command may already have reached the page. */
  outcomeUnknown = false
  /** The CLI was killed by its own deadline. */
  timedOut = false
  /** The caller's signal aborted the command. */
  aborted = false
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_OUTPUT_CHARS = 12_000
// The CLI writes one JSON document per command. The cap is a backstop for a page
// far larger than the character budget; it is not the budget itself.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_ERROR_CHARS = 400

// A suffix the desk's own services answer on. The device runs its Shell debug
// port and an SSH tunnel on loopback, so a page that names one of these hosts
// must not become a reader for them.
const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'lan', 'home.arpa', 'in-addr.arpa', 'ip6.arpa']

function isPrivateV4(host) {
  const [first, second] = host.split('.').map(Number)
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 168 || second === 0))
    || (first === 198 && (second === 18 || second === 19))
}

function isPrivateV6(host) {
  const value = host.split('%')[0]
  if (value === '::' || value === '::1') return true
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return true
  if (/^fe[89ab][0-9a-f]:/.test(value)) return true
  // An IPv4-mapped address reaches exactly what its IPv4 form reaches.
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  if (dotted) return isPrivateV4(dotted[1])
  const packed = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(value)
  if (packed) {
    const high = Number.parseInt(packed[1], 16)
    const low = Number.parseInt(packed[2], 16)
    return isPrivateV4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`)
  }
  return false
}

/** True when a host reaches the desk itself rather than the public web. */
export function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  const version = isIP(host)
  if (version === 4) return isPrivateV4(host)
  if (version === 6) return isPrivateV6(host)
  const labels = host.split('.')
  // A single label is an intranet name; no public site is addressed that way.
  if (labels.length === 1) return true
  // Decimal and hexadecimal labels are alternative encodings of an address.
  if (labels.every(label => /^(?:0x[0-9a-f]+|[0-9]+)$/.test(label))) return true
  return LOCAL_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`))
}

/**
 * Normalize a model-supplied target, or refuse it.
 *
 * This is a host-name policy, not a network boundary: it refuses the schemes
 * that read the filesystem and the names that reach the desk, and it does not
 * resolve DNS, so a public name that later resolves to a private address is not
 * covered here.
 *
 * @param {unknown} raw
 */
export function checkedTarget(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) throw new BrowserError('网址无效。')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new BrowserError('网址无效。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BrowserError('只支持 http 或 https 网址。')
  if (url.username || url.password) throw new BrowserError('网址不得携带凭据。')
  if (isPrivateHost(url.hostname)) throw new BrowserError('不访问本机或内网地址。')
  return url.href
}

/** Page text reaches the model only inside these markers. */
export function boundedContent(content, limit) {
  const text = typeof content === 'string' ? content : ''
  if (text.length <= limit) return { text, truncated: false }
  return { text: text.slice(0, limit), truncated: true }
}

/** Bound a CLI diagnostic and strip the control characters a page could hide behind. */
function safeDetail(value) {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_ERROR_CHARS)
}

function defaultSpawn(executable, args, { timeoutMs, signal, sessionName }) {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      maxBuffer: MAX_RESPONSE_BYTES,
      windowsHide: true,
      signal,
      env: { ...process.env, AGENT_BROWSER_SESSION: sessionName },
    }, (error, stdout) => {
      if (!error) { resolve(stdout); return }
      const failure = new BrowserError('浏览器命令未完成。')
      failure.timedOut = error.killed === true || error.signal === 'SIGKILL'
      failure.aborted = error.name === 'AbortError'
      reject(failure)
    })
  })
}

/**
 * One browser session for one host-owned private agent state directory. Every command is one CLI
 * invocation; the CLI's own daemon keeps the browser alive between them, so the
 * bot holds no long-lived child process.
 *
 * @param {{executablePath: string, stateDir: string, signal?: AbortSignal, timeoutMs?: number, maxOutputChars?: number, spawn?: typeof defaultSpawn}} options
 */
export function createBrowserSession({ executablePath, stateDir, signal: lifetimeSignal, timeoutMs = DEFAULT_TIMEOUT_MS, maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS, spawn = defaultSpawn }) {
  if (typeof executablePath !== 'string' || !isAbsolute(executablePath)) throw new BrowserError('浏览器命令路径必须是绝对路径。')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) throw new BrowserError('浏览器超时设置无效。')
  if (!Number.isInteger(maxOutputChars) || maxOutputChars < 1_000 || maxOutputChars > 200_000) throw new BrowserError('浏览器输出上限设置无效。')

  if (typeof stateDir !== 'string' || !isAbsolute(stateDir)) throw new BrowserError('浏览器状态目录必须是绝对路径。')
  // The host supplies this path. Configuration and model arguments cannot pick
  // another agent's daemon. Hashing also avoids leaking the path to CLI output.
  const namespace = `odk-agent-${createHash('sha256').update(resolve(stateDir)).digest('hex').slice(0, 32)}-${randomBytes(8).toString('hex')}`
  let epoch = 0
  let sessionName = `${namespace}-${epoch.toString(36)}`
  const retiredSessions = new Set()
  const closing = new AbortController()
  let closed = false
  let pageClosing
  let disposal
  let pageLifetime = new AbortController()

  /**
   * @param {string[]} args
   * @param {{mutation?: boolean, signal?: AbortSignal}} [options]
   */
  async function command(args, { mutation = false, signal } = {}) {
    if (pageClosing) await pageClosing
    if (closed) throw new BrowserError('浏览器已关闭。')
    const signals = [closing.signal, pageLifetime.signal, lifetimeSignal, signal].filter(Boolean)
    const commandSignal = AbortSignal.any(signals)
    if (commandSignal.aborted) throw new BrowserError('浏览器命令已取消。')
    // All failures after dispatch leave a mutation potentially applied. Never
    // infer that a cancelled CLI or a missing response rolled back the page.
    retiredSessions.add(sessionName)
    try {
      let stdout
      try {
        stdout = await spawn(executablePath, [...args, '--content-boundaries', '--json'], { timeoutMs, signal: commandSignal, sessionName })
      } catch (error) {
        if (error?.aborted) throw new BrowserError('浏览器命令已取消。')
        if (error?.timedOut) {
          // A killed command may already have reached the page. The outcome is
          // unknown, and an unknown mutation is never retried automatically.
          const failure = new BrowserError(mutation
            ? '浏览器命令超时，操作结果未知。不要自动重试；先读取当前页面状态。'
            : '浏览器命令超时。')
          failure.outcomeUnknown = mutation
          throw failure
        }
        if (error instanceof BrowserError) throw error
        throw new BrowserError('浏览器命令未完成。')
      }
      if (commandSignal.aborted) throw new BrowserError('浏览器命令已取消。')
      let envelope
      try {
        envelope = JSON.parse(stdout)
      } catch {
        throw new BrowserError('浏览器返回了无法解析的结果。')
      }
      if (!envelope || typeof envelope !== 'object') throw new BrowserError('浏览器返回了无法解析的结果。')
      if (envelope.success !== true) {
        const detail = safeDetail(envelope.error)
        throw new BrowserError(detail ? `浏览器未完成请求：${detail}` : '浏览器未完成请求。')
      }
      if (!envelope.data || typeof envelope.data !== 'object') throw new BrowserError('浏览器未返回数据。')
      const boundary = envelope._boundary && typeof envelope._boundary === 'object' ? envelope._boundary : null
      return { data: envelope.data, boundary }
    } catch (error) {
      if (mutation && !error?.outcomeUnknown) {
        const failure = new BrowserError(`${error instanceof BrowserError ? error.message : '浏览器命令未完成。'} 操作结果未知。不要自动重试；先读取当前页面状态。`)
        failure.outcomeUnknown = true
        throw failure
      }
      throw error
    }
  }

  async function cleanupSession(name) {
    try {
      const response = await spawn(executablePath, ['close', '--json'], { timeoutMs: 15_000, signal: undefined, sessionName: name })
      if (JSON.parse(response)?.success === true) {
        retiredSessions.delete(name)
        return true
      }
    } catch { /* Retain failed cleanup for final disposal of this runtime. */ }
    return false
  }

  // A successful close response can precede daemon exit. Rotate before any
  // next dispatch rather than replaying a command against the retiring daemon.
  function closePage() {
    if (pageClosing) return pageClosing
    if (closed) return Promise.reject(new BrowserError('浏览器已关闭。'))
    if (!retiredSessions.has(sessionName)) return Promise.resolve()
    pageLifetime.abort()
    const retired = sessionName
    epoch += 1
    sessionName = `${namespace}-${epoch.toString(36)}`
    pageClosing = cleanupSession(retired).then(released => {
      if (!released) {
        const failure = new BrowserError('浏览器关闭未获确认，操作结果未知。不要自动重试；请报告未确认的释放状态。')
        failure.outcomeUnknown = true
        throw failure
      }
    }).finally(() => {
      pageLifetime = new AbortController()
      pageClosing = undefined
    })
    return pageClosing
  }

  return {
    maxOutputChars,
    command,
    closePage,
    /** Final runtime disposal is permanent and fences all pending results. */
    close() {
      if (disposal) return disposal
      // Initiate page cleanup before the permanent gate closes.
      const currentCleanup = closePage()
      closed = true
      closing.abort()
      disposal = (async () => {
        try { await currentCleanup } catch { /* Attempt every owned epoch before reporting failure. */ }
        await Promise.all([...retiredSessions].map(cleanupSession))
        if (retiredSessions.size > 0) {
          const failure = new BrowserError('浏览器释放未获确认，操作结果未知。')
          failure.outcomeUnknown = true
          throw failure
        }
      })()
      return disposal
    },
  }
}
