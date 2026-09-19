'use strict'

const electron = require('electron')
const { app, BrowserWindow, protocol, session } = electron
const { buildUserAppDocument, USER_APP_CSP } = require('./user-app-content')
const { fontResponse, DEFAULT_THEME } = require('./user-app-context')
const { USER_APP_SCHEME_PRIVILEGES } = require('./user-app-system')

const TIMEOUT_MS = 8000
const MAX_INPUT_BYTES = 1024 * 1024
const MAX_HTML_BYTES = 256 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024
protocol.registerSchemesAsPrivileged([{ scheme: 'odk-user-app', privileges: USER_APP_SCHEME_PRIVILEGES }])
const send = (value) => {
  const output = JSON.stringify(value)
  if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) { app.exit(1); return }
  process.stdout.write(`${output}\n`)
  setImmediate(() => app.exit(value.ok ? 0 : 1))
}

async function readBundle() {
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > MAX_INPUT_BYTES) throw new Error('bundle-too-large')
    chunks.push(chunk)
  }
  const bundle = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!bundle || typeof bundle.html !== 'string' || Buffer.byteLength(bundle.html, 'utf8') > MAX_HTML_BYTES) throw new Error('html-too-large')
  return bundle
}

async function run() {
  const bundle = await readBundle()
  const token = `verify-${process.pid}`
  // The candidate is rendered with the base appearance's context, so a package that
  // uses the Shell's tokens and faces still has them inside the verifier session.
  const html = buildUserAppDocument(bundle, { token, theme: DEFAULT_THEME })
  await app.whenReady()
  // One first-wins reason: whichever gate the candidate trips first is the one the
  // package author is told about.
  let failed = null
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const scheme = new URL(details.url).protocol
    const allowed = ['odk-user-app:', 'data:'].includes(scheme)
    // This session filter runs before the navigation guards, so an outside URL is
    // reported as a blocked network request rather than a network-layer abort.
    if (!allowed) failed ??= `network blocked: ${details.url}`
    callback({ cancel: !allowed })
  })
  protocol.handle('odk-user-app', async (request) => {
    const requestUrl = new URL(request.url)
    if (requestUrl.hostname !== 'app') return new Response('Not found', { status: 404 })
    const font = /^\/font\/([a-z0-9-]{1,32})$/.exec(requestUrl.pathname)
    if (font) return fontResponse(font[1])
    if (requestUrl.pathname !== '/verify/revision') return new Response('Not found', { status: 404 })
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': USER_APP_CSP },
    })
  })
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, destination) => {
    if (!destination.startsWith('odk-user-app://app/verify/revision')) {
      event.preventDefault()
      failed ??= 'navigation blocked'
    }
  })
  win.webContents.on('will-frame-navigate', (event) => {
    if (!event.url.startsWith('odk-user-app://app/verify/revision')) {
      event.preventDefault()
      failed ??= 'navigation blocked'
    }
  })
  win.webContents.on('console-message', (_event, level, message) => {
    // First failure wins: a later, unrelated console line must not describe why a
    // candidate was rejected.
    if (level >= 2 && !failed) failed = message
  })
  win.webContents.on('render-process-gone', (_event, details) => { failed ??= details.reason || 'renderer-gone' })
  let loadFailure = null
  win.webContents.on('did-fail-load', (_event, _code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    // A candidate that navigates away aborts its own document load. Name what the
    // verifier blocked instead of repeating the network layer's error string.
    loadFailure ??= /^odk-user-app:/.test(validatedURL)
      ? `document load failed: ${description}`
      : `navigation blocked to ${validatedURL}`
  })
  await win.loadURL(`odk-user-app://app/verify/revision?token=${encodeURIComponent(token)}`).catch((error) => { loadFailure ??= error.message })
  // A blocked navigation is reported after the abort it caused, so give the gates one
  // tick before falling back to the load error.
  await new Promise((resolve) => setTimeout(resolve, 50))
  const reason = failed || loadFailure
  if (reason) throw new Error(reason)
  const state = await win.webContents.executeJavaScript('({visible:!!(document.body && document.body.innerText.trim()),error:window.__odkUserAppError||""})')
  if (state.error) throw new Error(state.error)
  if (!state.visible) throw new Error('user app has no visible body content')
  send({ ok: true })
}

if (app?.whenReady) {
  run().catch((error) => send({ ok: false, error: error.message || 'verification failed' }))
}

module.exports = { TIMEOUT_MS }
