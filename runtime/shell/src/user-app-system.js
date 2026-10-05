const path = require('node:path')
const { createUserAppStore } = require('./user-app-store')
const { createUserAppVerifier } = require('./user-app-verifier')
const { createUserAppControl, listenUserAppControl } = require('./user-app-control')
const { createUserAppResponse } = require('./user-app-protocol')
const { buildUserAppDocument, USER_APP_CSP } = require('./user-app-content')
const { resolveShellHost } = require('./platform')
const { readOrCreateToken } = require('./local-channel')

// supportFetchAPI + corsEnabled are what let a sandboxed frame (opaque origin) load the
// appearance fonts this process serves; without them every font request is a network
// error rather than a CORS-checked read.
const USER_APP_SCHEME_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }

/**
 * Where this Shell Host keeps installed Widgets and Apps, and which control
 * endpoint it provisions for an external agent. The endpoint is a link the host
 * either has or does not: a host without one states that, and Shell-side control
 * is unaffected either way.
 */
function resolveUserAppSurface({ env = process.env, host, homedir } = {}) {
  const resolved = host || (homedir === undefined ? resolveShellHost({ env }) : resolveShellHost({ env, homedir }))
  const join = resolved.isWindows ? path.win32.join : path.join
  return {
    stateDir: join(resolved.stateDir, 'user-apps'),
    controlEndpoint: resolved.provisionsUserAppControl ? resolved.endpoint('user-app-control') : null,
  }
}

function registerUserAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: 'odk-user-app', privileges: USER_APP_SCHEME_PRIVILEGES }])
}

async function startUserAppSystem({ app, ipcMain, protocol, BrowserWindow, env = process.env, smokeMode = false, deskData = null, isStopping = () => app.isQuitting === true }) {
  const stopping = () => isStopping() || app.isQuitting === true
  const surface = resolveUserAppSurface({ env })
  const verifier = createUserAppVerifier({ electronPath: process.execPath })
  const store = smokeMode
    ? { list: async () => [], getContent: async () => ({ ok: false, error: 'not-found' }) }
    : createUserAppStore({ workspace: env.ODESK_WORKSPACE, stateDir: surface.stateDir, verify: bundle => verifier.verify(bundle) })
  const control = createUserAppControl(store, () => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('odk-user-apps-changed')
    // An installed revision drives which packages may answer, so a new, replaced
    // or removed revision re-registers what those packages may publish.
    if (!stopping()) void deskData?.syncPackages()
  })
  ipcMain.handle('odk-user-apps-list', () => control.dispatch({ command: 'list' }))
  ipcMain.handle('odk-user-apps-dispatch', (_event, request) => control.dispatch(request))
  ipcMain.handle('odk-user-apps-publish', (_event, request) => deskData?.registry.publish(request?.appId, request?.data) ?? { ok: false, error: 'unknown-reading' })
  protocol.handle('odk-user-app', request => createUserAppResponse(request.url, store, buildUserAppDocument, USER_APP_CSP))
  if (smokeMode || !surface.controlEndpoint) return
  try {
    if (stopping()) return
    const host = resolveShellHost({ env })
    // The endpoint's authentication is the channel's own, so the token is read
    // where this host needs one and left alone where ownership already proves it.
    const channelToken = await readOrCreateToken({ stateDir: host.stateDir })
    if (stopping()) return
    const server = await listenUserAppControl({ socketPath: surface.controlEndpoint, control, channelToken, platform: host.platform })
    if (stopping()) {
      await server.close().catch(() => {})
      return
    }
    app.once('before-quit', () => { void server.close().catch(() => {}) })
  } catch {
    console.error('User application control socket unavailable; desktop controls remain available')
  }
}

module.exports = { registerUserAppScheme, startUserAppSystem, resolveUserAppSurface, USER_APP_SCHEME_PRIVILEGES }
