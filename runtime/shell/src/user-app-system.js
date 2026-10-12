const path = require('node:path')
const { createUserAppStore } = require('./user-app-store')
const { createUserAppVerifier } = require('./user-app-verifier')
const { createUserAppControl, listenUserAppControl } = require('./user-app-control')
const { createUserAppResponse } = require('./user-app-protocol')
const { buildUserAppDocument, USER_APP_CSP } = require('./user-app-content')
const { resolveShellHost } = require('./platform')
const { readOrCreateToken } = require('./local-channel')
const { NATIVE_PLUGIN_SCHEME, NATIVE_PLUGIN_PRIVILEGES } = require('./native-renderer-assets')

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
  protocol.registerSchemesAsPrivileged([{ scheme: 'odk-user-app', privileges: USER_APP_SCHEME_PRIVILEGES },
    { scheme: NATIVE_PLUGIN_SCHEME, privileges: NATIVE_PLUGIN_PRIVILEGES }])
}

async function startUserAppSystem({ app, ipcMain, protocol, BrowserWindow, env = process.env, smokeMode = false, deskData = null, store: selectedStore, isStopping = () => app.isQuitting === true, onCleanup, appearancePlugins }) {
  let stopped = false
  let server = null
  let opening = null
  let releasing = null
  let verifier = null
  const releases = new Set()
  const pending = new Set()
  const stopping = () => stopped || isStopping() || app.isQuitting === true
  const execute = (action, unavailable = () => ({ ok: false, error: 'application-store-unavailable' })) => {
    if (stopping()) return unavailable()
    const value = action()
    if (!value || typeof value.then !== 'function') return value
    const operation = Promise.resolve(value)
    pending.add(operation)
    void operation.then(() => pending.delete(operation), () => pending.delete(operation))
    return operation
  }
  const stop = () => {
    stopped = true
    if (releasing) return releasing
    releasing = (async () => {
      // A cancelled acquisition can still return an owned listener. Keep it
      // until close succeeds, and let the Host retain dependencies on failure.
      try { await opening } catch { /* Failed acquisition owns no listener. */ }
      // Stop admission before draining accepted work, so replacement cannot race
      // an old catalog write or release a provider that work still consumes.
      await Promise.allSettled([...pending])
      await selectedStore?.waitForVerification?.()
      await verifier?.close()
      const failures = []
      for (const release of [...releases].reverse()) {
        try { await release(); releases.delete(release) } catch (error) { failures.push(error) }
      }
      if (server) {
        try { await server.close(); server = null } catch (error) { failures.push(error) }
      }
      if (failures.length) throw new AggregateError(failures, 'User application runtime cleanup failed')
    })().finally(() => { releasing = null })
    return releasing
  }
  if (onCleanup) onCleanup(stop)
  else app.once('before-quit', () => { void stop().catch(error => console.error(error.message)) })
  const surface = resolveUserAppSurface({ env })
  if (!selectedStore) verifier = createUserAppVerifier({ electronPath: process.execPath })
  const store = smokeMode
    ? { list: async () => [], getContent: async () => ({ ok: false, error: 'not-found' }) }
    : selectedStore || createUserAppStore({ workspace: env.ODESK_WORKSPACE, stateDir: surface.stateDir, verify: bundle => verifier.verify(bundle) })
  const control = createUserAppControl(store, () => {
    if (stopping()) return
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('odk-user-apps-changed')
    // An installed revision drives which packages may answer, so a new, replaced
    // or removed revision re-registers what those packages may publish.
    if (deskData) void Promise.resolve(execute(() => deskData.syncPackages())).catch(() => {
      console.error('User application data synchronization failed')
    })
  })
  const bind = (channel, handler) => {
    ipcMain.handle(channel, (...args) => execute(() => handler(...args)))
    releases.add(() => ipcMain.removeHandler(channel))
  }
  bind('odk-user-apps-list', () => control.dispatch({ command: 'list' }))
  bind('odk-user-apps-dispatch', (_event, request) => control.dispatch(request))
  bind('odk-user-apps-publish', (_event, request) => deskData?.registry.publish(request?.appId, request?.data) ?? { ok: false, error: 'unknown-reading' })
  protocol.handle('odk-user-app', request => execute(
    () => createUserAppResponse(request.url, store, buildUserAppDocument, USER_APP_CSP, { appearancePlugins }),
    () => new Response('Application runtime unavailable', { status: 503 })))
  releases.add(() => protocol.unhandle('odk-user-app'))
  if (smokeMode || !surface.controlEndpoint) return
  try {
    if (stopping()) return
    const host = resolveShellHost({ env })
    // The endpoint's authentication is the channel's own, so the token is read
    // where this host needs one and left alone where ownership already proves it.
    const channelToken = await readOrCreateToken({ stateDir: host.stateDir })
    if (stopping()) return
    opening = listenUserAppControl({ socketPath: surface.controlEndpoint,
      control: { dispatch: request => Promise.resolve(execute(() => control.dispatch(request))) }, channelToken, platform: host.platform })
      .then(listening => { server = listening })
    await opening
  } catch {
    console.error('User application control socket unavailable; desktop controls remain available')
  }
  if (stopping()) await stop()
}

module.exports = { registerUserAppScheme, startUserAppSystem, resolveUserAppSurface, USER_APP_SCHEME_PRIVILEGES }
