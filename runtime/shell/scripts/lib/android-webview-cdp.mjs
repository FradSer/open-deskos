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

const DEVTOOLS_SOCKET = /webview_devtools_remote_(\d+)/

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
  const unix = await adb(device, ['shell', 'cat', '/proc/net/unix'])
  const names = [...unix.matchAll(/@?(webview_devtools_remote_[\w.]*)/g)].map((match) => match[1])
  if (names.length === 0) throw new Error('no WebView devtools socket on ' + device + ': is the app running, and is WebView debugging enabled?')
  const socket = names.sort((a, b) => b.length - a.length)[0]
  const pid = DEVTOOLS_SOCKET.exec(socket)?.[1]
  await adb(device, ['forward', '--no-rebind', `tcp:${localPort}`, `localabstract:${socket}`])
  return { localPort, socket, pid }
}

async function listPages(localPort) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${localPort}/json/list`)
      const pages = await response.json()
      const page = pages.find((entry) => entry.type === 'page' && (entry.url || '').includes('/renderer/index.html'))
      if (page?.webSocketDebuggerUrl) return page
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
  const page = await listPages(localPort)
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  const pending = new Map()
  let nextId = 1
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('the WebView devtools socket refused the connection')), { once: true })
  })
  socket.addEventListener('message', (event) => {
    let message
    try { message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString()) } catch { return }
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message || 'devtools error'))
    else waiter.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
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
    },
  }
}

export async function launchShell(device) {
  await adb(device, ['shell', 'am', 'force-stop', 'com.odk.shell'])
  await adb(device, ['shell', 'am', 'start', '-n', 'com.odk.shell/.ShellActivity'])
}

