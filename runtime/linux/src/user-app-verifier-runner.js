'use strict'

const electron = require('electron')
const { app, BrowserWindow, protocol, session } = electron
const { buildUserAppDocument, USER_APP_CSP } = require('./user-app-content')

const TIMEOUT_MS = 8000
const MAX_INPUT_BYTES = 1024 * 1024
const MAX_HTML_BYTES = 256 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024
protocol.registerSchemesAsPrivileged([{ scheme: 'odk-user-app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
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
  const html = buildUserAppDocument(bundle, { token })
  await app.whenReady()
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const scheme = new URL(details.url).protocol
    callback({ cancel: !['odk-user-app:', 'data:'].includes(scheme) })
  })
  protocol.handle('odk-user-app', async (request) => {
    const requestUrl = new URL(request.url)
    if (requestUrl.hostname !== 'app' || requestUrl.pathname !== '/verify/revision') return new Response('Not found', { status: 404 })
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': USER_APP_CSP },
    })
  })
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, destination) => {
    if (!destination.startsWith('odk-user-app://app/verify/revision')) event.preventDefault()
  })
  win.webContents.on('will-frame-navigate', (event) => {
    if (!event.url.startsWith('odk-user-app://app/verify/revision')) event.preventDefault()
  })
  let failed = null
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) failed = message })
  win.webContents.on('render-process-gone', (_event, details) => { failed = details.reason || 'renderer-gone' })
  await win.loadURL(`odk-user-app://app/verify/revision?token=${encodeURIComponent(token)}`)
  if (failed) throw new Error(failed)
  const state = await win.webContents.executeJavaScript('({visible:!!(document.body && document.body.innerText.trim()),error:window.__odkUserAppError||""})')
  if (state.error) throw new Error(state.error)
  if (!state.visible) throw new Error('user app has no visible body content')
  send({ ok: true })
}

if (app?.whenReady) {
  run().catch((error) => send({ ok: false, error: error.message || 'verification failed' }))
}

module.exports = { TIMEOUT_MS }
