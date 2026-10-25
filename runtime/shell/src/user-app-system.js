const path = require('node:path')
const { createUserAppStore } = require('./user-app-store')
const { createUserAppVerifier } = require('./user-app-verifier')
const { createUserAppControl, listenUserAppControl } = require('./user-app-control')
const { createUserAppResponse } = require('./user-app-protocol')
const { buildUserAppDocument, USER_APP_CSP } = require('./user-app-content')
const { resolveShellHost } = require('./platform')
const { readOrCreateToken } = require('./local-channel')
const { createUserAppApi } = require('./user-app-api')
const { createUserAppDevices, isActiveDeviceFrame } = require('./user-app-devices')
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

async function startUserAppSystem({ app, ipcMain, protocol, BrowserWindow, env = process.env, smokeMode = false, odkData = null, store: selectedStore, isStopping = () => app.isQuitting === true, onCleanup, appearancePlugins, desktopGeometry, deviceGateway, shellDocument }) {
  let stopped = false
  let server = null
  let opening = null
  let releasing = null
  let verifier = null
  let packageApi = null
  let packageDevices = null
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
      await packageApi?.close()
      await packageDevices?.close()
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
    : selectedStore || createUserAppStore({ workspace: env.ODK_WORKSPACE, stateDir: surface.stateDir, verify: bundle => verifier.verify(bundle),
      ...(desktopGeometry ? { getDesktopGeometry: desktopGeometry.read } : {}) })
  packageApi = createUserAppApi({ store, publicDns: env.ODK_PACKAGE_API_PUBLIC_DNS === 'cloudflare' })
  packageDevices = createUserAppDevices({ store, gateway: deviceGateway,
    grantsFile: path.join(resolveShellHost({ env }).stateDir, 'device-grants.json'),
    isActive: identity => !stopping() && isActiveDeviceFrame(identity.event, identity, BrowserWindow.getAllWindows(), shellDocument),
  })
  const control = createUserAppControl(store, () => {
    if (stopping()) return
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('odk-user-apps-changed')
    // An installed revision drives which packages may answer, so a new, replaced
    // or removed revision re-registers what those packages may publish.
    if (odkData) void Promise.resolve(execute(() => odkData.syncPackages())).catch(() => {
      console.error('User application data synchronization failed')
    })
  })
  const bind = (channel, handler) => {
    ipcMain.handle(channel, (...args) => execute(() => handler(...args)))
    releases.add(() => ipcMain.removeHandler(channel))
  }
  if (desktopGeometry) {
    const geometryReport = (event, pages) => {
      if (stopping()) return { ok: false }
      const win = BrowserWindow.getAllWindows().find(win => win.webContents === event.sender)
      if (!win || event.senderFrame !== win.webContents.mainFrame) return { ok: false }
      try {
        if (require('node:url').fileURLToPath(new URL(event.senderFrame.url)) !== path.join(__dirname, 'renderer', 'index.html')) return { ok: false }
      } catch { return { ok: false } }
      const changed = desktopGeometry.update(pages)
      if (changed) for (const target of BrowserWindow.getAllWindows()) target.webContents.send('odk-user-apps-changed')
      return { ok: true }
    }
    ipcMain.on('odk-user-apps-geometry', geometryReport)
    releases.add(() => ipcMain.removeListener('odk-user-apps-geometry', geometryReport))
  }
  bind('odk-user-apps-api', (_event, request) => packageApi.read(request?.appId, request?.revision, request?.sourceId))
  bind('odk-user-apps-device', (event, value) => {
    const identity = { appId: value?.appId, revision: value?.revision, frameToken: value?.frameToken, event }
    const request = value?.request
    if (!request || typeof request !== 'object' || Array.isArray(request)) return { ok: false, error: 'invalid-device-request' }
    if (request.type === 'read' && Object.keys(request).length === 1) return packageDevices.read(identity)
    if (request.type === 'send' && Object.keys(request).length === 3) return packageDevices.send(identity, request.peer, request.payload)
    return { ok: false, error: 'invalid-device-request' }
  })
  bind('odk-user-apps-list', () => control.dispatch({ command: 'list' }))
  bind('odk-user-apps-dispatch', (_event, request) => control.dispatch(request))
  bind('odk-user-apps-publish', (_event, request) => odkData?.registry.publish(request?.appId, request?.data) ?? { ok: false, error: 'unknown-reading' })
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
