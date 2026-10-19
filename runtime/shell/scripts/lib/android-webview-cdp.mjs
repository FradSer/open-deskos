import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

/**
 * Talks to a WebView on an adb device through the Chrome DevTools Protocol.
 *
 * A debug build of the Android Shell Host enables WebView remote debugging, so
 * this is the Android equivalent of the Electron harness reading the renderer
 * through `webContents.executeJavaScript`. It is the only device seam the
 * acceptance run needs.
 */

const run = promisify(execFile)

const SHELL_URL = 'https://appassets.androidplatform.net/assets/web/renderer/index.html'

export function ownedDevtoolsSocket(unix, pid) {
  if (!/^[0-9]+$/.test(pid)) throw new Error('the Android Shell PID is not unique')
  const names = [...new Set([...unix.matchAll(/@?(webview_devtools_remote_[\w.]*)/g)].map(match => match[1]))]
  const matches = names.filter(name => name === 'webview_devtools_remote_' + pid)
  if (matches.length !== 1) throw new Error('the Android Shell devtools socket is not unique')
  return matches[0]
}

export function ownedShellPage(pages, localPort) {
  const matches = pages.filter(page => page.type === 'page' && page.url === SHELL_URL)
  if (matches.length !== 1) throw new Error('the Android Shell page is not unique')
  const address = new URL(matches[0].webSocketDebuggerUrl)
  if (address.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(address.hostname) || address.port !== String(localPort) || address.username || address.password) throw new Error('foreign devtools endpoint')
  return matches[0]
}

async function adb(device, args, options = {}) {
  const { stdout } = await run('adb', ['-s', device, ...args], { maxBuffer: 32 * 1024 * 1024, ...options })
  return stdout
}

/**
 * Forward the WebView devtools socket to a local port. The socket name carries
 * the WebView process id, which changes on every launch, so the forward is
 * rebuilt from the running process rather than reused.
 */
export async function forwardDevtools(device, localPort = 9229) {
  if (!Number.isInteger(localPort) || localPort < 1024 || localPort > 65535) throw new Error('invalid owned devtools port')
  const pid = (await adb(device, ['shell', 'pidof', 'com.odk.shell'])).trim()
  const unix = await adb(device, ['shell', 'cat', '/proc/net/unix'])
  const socket = ownedDevtoolsSocket(unix, pid)
  await adb(device, ['forward', '--no-rebind', `tcp:${localPort}`, `localabstract:${socket}`])
  return { localPort, socket, pid }
}

async function listPages(localPort) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${localPort}/json/list`, { signal: AbortSignal.timeout(5000) })
      const pages = await response.json()
      if (pages.some(page => page.type === 'page' && page.url === SHELL_URL)) return ownedShellPage(pages, localPort)
    } catch {
      // The devtools HTTP endpoint appears a moment after the forward.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('the WebView devtools endpoint did not answer on port ' + localPort)
}

/** Connect once and evaluate expressions against the Shell document. */
export async function connectShell(device, localPort = 9229) {
  const forward = await forwardDevtools(device, localPort)
  const removeForward = () => adb(device, ['forward', '--remove', `tcp:${localPort}`])
  const page = await listPages(localPort).catch(async error => { await removeForward(); throw error })
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('the WebView devtools socket timed out')), 5000)
    socket.addEventListener('open', () => { clearTimeout(deadline); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(deadline); reject(new Error('the WebView devtools socket refused the connection')) }, { once: true })
  }).catch(async error => { socket.close(); await removeForward(); throw error })
  socket.addEventListener('message', (event) => {
    let message
    try { message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()) } catch { return }
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    clearTimeout(waiter.deadline)
    if (message.error) waiter.reject(new Error(message.error.message || 'devtools error'))
    else waiter.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    const deadline = setTimeout(() => { pending.delete(id); reject(new Error('devtools request timed out')) }, 10000)
    pending.set(id, { resolve, reject, deadline })
    socket.send(JSON.stringify({ id, method, params }))
  })
  return {
    forward,
    send,
    /** Evaluate an expression in the Shell document and return its value. */
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'evaluation failed on the device')
      return result.result?.value
    },
    async screenshot(out) {
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      await writeFile(out, Buffer.from(shot.data, 'base64'))
      return out
    },
    close() {
      socket.close()
      for (const row of pending.values()) { clearTimeout(row.deadline); row.reject(new Error('devtools connection closed')) }
      pending.clear()
      return removeForward()
    },
  }
}

export async function launchShell(device) {
  await adb(device, ['shell', 'am', 'force-stop', 'com.odk.shell'])
  await adb(device, ['shell', 'am', 'start', '-n', 'com.odk.shell/.ShellActivity'])
}

