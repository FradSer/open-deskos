const path = require('node:path')
const os = require('node:os')
const { createUserAppStore } = require('./user-app-store')
const { createUserAppVerifier } = require('./user-app-verifier')
const { createUserAppControl, listenUserAppControl } = require('./user-app-control')
const { createUserAppResponse } = require('./user-app-protocol')
const { buildUserAppDocument, USER_APP_CSP } = require('./user-app-content')

function registerUserAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: 'odk-user-app', privileges: { standard: true, secure: true } }])
}

async function startUserAppSystem({ app, ipcMain, protocol, BrowserWindow, env = process.env, smokeMode = false }) {
  const stateDir = path.join(env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'open-deskos', 'user-apps')
  const verifier = createUserAppVerifier({ electronPath: process.execPath })
  const store = smokeMode
    ? { list: async () => [], getContent: async () => ({ ok: false, error: 'not-found' }) }
    : createUserAppStore({ workspace: env.ODESK_WORKSPACE, stateDir, verify: bundle => verifier.verify(bundle) })
  const control = createUserAppControl(store, () => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('odk-user-apps-changed')
  })
  ipcMain.handle('odk-user-apps-list', () => control.dispatch({ command: 'list' }))
  ipcMain.handle('odk-user-apps-dispatch', (_event, request) => control.dispatch(request))
  protocol.handle('odk-user-app', request => createUserAppResponse(request.url, store, buildUserAppDocument, USER_APP_CSP))
  if (smokeMode || !env.XDG_RUNTIME_DIR || !path.isAbsolute(env.XDG_RUNTIME_DIR)) return
  try {
    const server = await listenUserAppControl({ socketPath: path.join(env.XDG_RUNTIME_DIR, 'open-deskos-apps', 'control.sock'), control })
    app.once('before-quit', () => { void server.close().catch(() => {}) })
  } catch {
    console.error('User application control socket unavailable; desktop controls remain available')
  }
}

module.exports = { registerUserAppScheme, startUserAppSystem }
