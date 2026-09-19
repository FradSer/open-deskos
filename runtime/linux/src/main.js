const electron = require('electron')
const app = electron?.app
const BrowserWindow = electron?.BrowserWindow
const ipcMain = electron?.ipcMain
const session = electron?.session
const fs = require('node:fs')
const { createRemoteBridgeClient, resolveRemoteBridgeSocketPath } = require('./remote-bridge-client')

const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1280
const { resolveOpenCodeGoConfig, fetchOpenCodeGo } = require('./opencode-go')
const { createAppManagerEndpoint } = require('./app-manager-endpoint')
const { createCameraSource } = require('./camera-source')
const { createPiSessionsSource } = require('./pi-sessions-source')
const { createDeskLinkClient } = require('./desk-link-client')
const { createPiSessionEventsSource } = require('./pi-session-events-source')
const { createHydraSource } = require('./hydra-mqtt')
const { createVoiceAgentClient, resolveVoiceSocketPath } = require('./voice-agent-client')
const { createWeReadSource } = require('./weread-source')
const { createFutuSource } = require('./futu-source')
const { createWeatherSource } = require('./weather-source')
const { registerUserAppScheme, startUserAppSystem } = require('./user-app-system')
const deskLink = createDeskLinkClient()
const scanPiSessions = createPiSessionsSource({ deskLink })
const readPiSessionEvents = createPiSessionEventsSource({ deskLink })
const cameraSource = createCameraSource()

// Mali userspace (ARM libmali blob plus CSF firmware) installed by
// scripts/cm5-gpu-userspace.sh. Its presence marks a CM5 that can render
// through the Mali-G610 instead of the llvmpipe software rasterizer.
const MALI_USERSPACE_DIR = '/usr/lib/aarch64-linux-gnu/libmali'

function hasMaliUserspace(dir = MALI_USERSPACE_DIR) {
  try {
    return fs.existsSync(dir)
  } catch {
    return false
  }
}

function resolveGpuBackend(env = process.env, options = {}) {
  const requested = env.ODESK_GPU_BACKEND
  if (requested === 'mali' || requested === 'default') return requested
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const maliUserspacePresent = options.maliUserspacePresent ?? hasMaliUserspace()
  // The installed blob only serves the X11 and GBM EGL platforms, so a Wayland
  // session keeps the default backend.
  const x11Session = Boolean(env.DISPLAY) && !env.WAYLAND_DISPLAY
  return platform === 'linux' && arch === 'arm64' && maliUserspacePresent && x11Session
    ? 'mali'
    : 'default'
}

function configureGpuSwitches(targetApp = app, env = process.env, options = {}) {
  const forceSoftware = env.ODESK_DISABLE_GPU === '1' || env.LIBGL_ALWAYS_SOFTWARE === '1'
  if (forceSoftware) {
    if (targetApp?.commandLine?.appendSwitch) {
      targetApp.commandLine.appendSwitch('disable-gpu')
    }
    return { hardwareAcceleration: false, backend: 'software' }
  }
  const backend = resolveGpuBackend(env, options)
  if (targetApp?.commandLine?.appendSwitch) {
    targetApp.commandLine.appendSwitch('ignore-gpu-blocklist')
    targetApp.commandLine.appendSwitch('enable-gpu-rasterization')
    targetApp.commandLine.appendSwitch('enable-zero-copy')
    if (backend === 'mali') {
      // Chromium rejects native GL implementations and only accepts the ANGLE
      // one (`gl=egl-angle`), so ANGLE must be pinned to its GLES/EGL backend to
      // reach the Mali blob.
      targetApp.commandLine.appendSwitch('use-gl', 'angle')
      targetApp.commandLine.appendSwitch('use-angle', 'gles-egl')
      // The blob drops the GPU context when Chromium swaps an X11 window
      // surface, which crash-loops the GPU process. Software display
      // compositing keeps GPU rasterization and WebGL on the Mali GPU.
      targetApp.commandLine.appendSwitch('disable-gpu-compositing')
    }
  }
  return { hardwareAcceleration: true, backend }
}

function resolveLaunchOptions(argv, env) {
  const width = Number.parseInt(env.ODESK_SHELL_WIDTH ?? '', 10) || DEFAULT_WIDTH
  const height = Number.parseInt(env.ODESK_SHELL_HEIGHT ?? '', 10) || DEFAULT_HEIGHT
  return {
    width,
    height,
    smoke: argv.includes('--smoke'),
    kiosk: argv.includes('--kiosk') || env.ODESK_SHELL_KIOSK === '1',
    disabledPlugins: resolveDisabledPlugins(env),
  }
}

function resolveDisabledPlugins(env = process.env) {
  return (env.ODESK_DISABLED_PLUGINS ?? '')
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean)
}

function createWindow(options) {
  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    useContentSize: true,
    frame: false,
    hasShadow: false,
    thickFrame: false,
    kiosk: options.kiosk,
    fullscreen: options.kiosk,
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: require('node:path').join(__dirname, 'preload.js'),
    },
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !event.url.startsWith('odk-user-app://app/')) event.preventDefault()
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    console.error(`renderer gone (${details.reason}); exiting for restart`)
    app.exit(1)
  })
  if (options.kiosk) {
    win.webContents.on('before-input-event', (event, input) => {
      const devtoolsKey = input.key === 'F12'
        || (input.control && input.shift && input.key.toLowerCase() === 'i')
      if (devtoolsKey) event.preventDefault()
    })
  }

  const params = new URLSearchParams()
  if (options.kiosk) params.set('kiosk', '1')
  if (options.disabledPlugins.length > 0) params.set('disabledPlugins', options.disabledPlugins.join(','))
  const query = params.size > 0 ? `?${params}` : ''
  win.loadFile('src/renderer/index.html', { search: query })
  return win
}

function writeSmokeResult(result) {
  const serialized = `${JSON.stringify(result)}\n`
  process.stdout.write(serialized)
  const resultFile = process.env.ODESK_SMOKE_RESULT_FILE
  if (resultFile) fs.writeFileSync(resultFile, serialized, 'utf8')
}

function finishSmoke(result) {
  writeSmokeResult(result)
  setTimeout(() => process.exit(result.ok ? 0 : 1), 0)
}

function runSmokeCheck(win, expected) {
  const timer = setTimeout(() => {
    finishSmoke({ ok: false, reason: 'timeout' })
  }, 15000)
  win.webContents.once('did-finish-load', () => {
    clearTimeout(timer)
    const actual = win.getContentBounds()
    const ok = actual.width === expected.width && actual.height === expected.height
    finishSmoke({ ok, width: actual.width, height: actual.height })
  })
}

async function main() {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  const smokeMode = process.argv.includes('--smoke')
  await startUserAppSystem({ app, ipcMain, protocol: electron.protocol, BrowserWindow, smokeMode })
  let remoteSocketPath = null
  if (!smokeMode) {
    try {
      remoteSocketPath = resolveRemoteBridgeSocketPath()
    } catch (error) {
      console.error(`remote bridge disabled: ${error.message}`)
    }
  }
  const voiceAgent = createVoiceAgentClient({ socketPath: smokeMode ? null : resolveVoiceSocketPath() })
  const broadcastVoiceStatus = (status) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('odk-voice-status', status)
  }
  let pendingVoiceToggle = null
  voiceAgent.subscribe((status) => {
    if (pendingVoiceToggle === 'starting' && status.state === 'idle') return
    if (pendingVoiceToggle === 'sending' && status.state === 'recording') return
    pendingVoiceToggle = null
    broadcastVoiceStatus(status)
  })
  if (!smokeMode) voiceAgent.start()
  ipcMain.handle('odk-voice-status', () => voiceAgent.snapshot())
  const toggleVoiceAgent = () => {
    const current = voiceAgent.snapshot()
    if (pendingVoiceToggle || ['transcribing', 'thinking'].includes(current.state)) return false
    const sent = voiceAgent.toggle()
    if (sent) {
      pendingVoiceToggle = current.state === 'recording' ? 'sending' : 'starting'
      broadcastVoiceStatus({
        state: pendingVoiceToggle,
        message: '',
      })
    } else {
      broadcastVoiceStatus({ ...current, activated: true })
    }
    return sent
  }
  ipcMain.handle('odk-voice-toggle', () => ({ accepted: toggleVoiceAgent() }))
  app.once('before-quit', () => voiceAgent.stop())
  const remoteBridge = createRemoteBridgeClient({
    socketPath: remoteSocketPath,
    onRemoteMic: () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.send('odk-voice-mic')
    },
  })
  let remoteSequence = 0
  const broadcastRemoteLinkState = (state) => {
    remoteSequence += 1
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('odk-remote-link-state', { state, sequence: remoteSequence })
    }
  }
  remoteBridge.onLinkState(broadcastRemoteLinkState)
  remoteBridge.onNavigation((direction) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('odk-remote-navigation', { direction })
    }
  })
  remoteBridge.onInput((input) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('odk-remote-input', { input })
    }
  })
  if (!smokeMode) remoteBridge.start()
  ipcMain.handle('odk-remote-link-state', () => ({
    state: remoteBridge.getLinkState(),
    sequence: remoteSequence,
  }))
  ipcMain.handle('odk-remote-publish-page-state', (_event, state) => remoteBridge.publishPageState(state))
  ipcMain.handle('odk-opencode-go-status', () => {
    const openCodeGoConfig = resolveOpenCodeGoConfig()
    return fetchOpenCodeGo(openCodeGoConfig)
  })
  ipcMain.handle('odk-camera-frame', async () => {
    await cameraSource.refresh()
    return cameraSource.snapshot()
  })
  ipcMain.handle('odk-pi-sessions', () => scanPiSessions())
  ipcMain.handle('odk-pi-session-events', async (_event, request) => {
    const cwd = typeof request?.cwd === 'string' ? request.cwd : ''
    const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : ''
    return readPiSessionEvents({ cwd, sessionId, hostedPi: request?.hostedPi === true })
  })
  const hydraSource = smokeMode
    ? createHydraSource({})
    : createHydraSource({
      url: process.env.ODK_HYDRA_MQTT_URL,
      topicPrefix: process.env.ODK_HYDRA_MQTT_TOPIC,
    })
  ipcMain.handle('odk-hydra-status', () => hydraSource.snapshot())
  const wereadSource = createWeReadSource({
    cacheFile: require('node:path').join(app.getPath('userData'), 'weread-highlights.json'),
  })
  ipcMain.handle('odk-weread-highlight', async () => {
    await wereadSource.refresh()
    return wereadSource.snapshot()
  })

  // Service Plugin data seam (ADR 0009): each declared service owns one Unix
  // socket; the shell never performs provider network I/O. The registry is
  // rebuilt from the installed catalog so a service has no lifecycle apart
  // from its package revision. ODESK_FUTU_SERVICE is the tracer bootstrap for
  // first light before the installer (T3) drives the registry; it is not a
  // second lifecycle.
  const futuServiceDefs = {}
  const futuRuntimeDir = (() => {
    const base = process.env.XDG_RUNTIME_DIR || require('node:os').tmpdir()
    return require('node:path').join(base, 'open-deskos')
  })()
  const futuSource = createFutuSource({
    runtimeDir: futuRuntimeDir,
    services: () => ({ ...futuServiceDefs }),
  })
  const refreshFutuServices = async () => {
    try {
      const { createUserAppStore } = require('./user-app-store')
      const store = createUserAppStore({
        workspace: process.env.ODESK_WORKSPACE,
        stateDir: require('node:path').join(process.env.XDG_STATE_HOME || require('node:os').homedir() + '/.local/state', 'open-deskos/user-apps'),
      })
      for (const entry of await store.list()) {
        if (entry?.service && entry?.id && !futuServiceDefs[entry.service.id]) {
          futuServiceDefs[entry.service.id] = { revision: entry.revision, socket: entry.service.socket }
        }
      }
    } catch {}
    if (process.env.ODESK_FUTU_SOCKET && !futuServiceDefs['futu-poller']) {
      futuServiceDefs['futu-poller'] = { revision: 'dev', socket: process.env.ODESK_FUTU_SOCKET }
    }
    try { await futuSource.refreshServices() } catch (error) {
      console.error(`futu services unavailable: ${error.message}`)
    }
  }
  ipcMain.handle('odk-futu-holdings', (_event, request) => futuSource.snapshot(request?.service || 'futu-poller'))
  void refreshFutuServices()
  setInterval(refreshFutuServices, 60 * 1000).unref?.()

  // The desk's weather instrument is the only surface allowed to reach a weather
  // provider: the renderer asks for a snapshot and never performs network I/O.
  // A smoke run stays offline by asking for an explicit empty location.
  const weatherSource = smokeMode
    ? createWeatherSource({ latitude: null, longitude: null })
    : createWeatherSource({
      cacheFile: require('node:path').join(app.getPath('userData'), 'weather-reading.json'),
    })
  ipcMain.handle('odk-weather-status', (_event, request) => weatherSource.refresh({ force: Boolean(request?.force) }))

  const appManager = createAppManagerEndpoint()
  ipcMain.handle('odk-app-manager-list', () => appManager.list())
  ipcMain.handle('odk-app-manager-state', (_event, appId) => appManager.get(appId))
  ipcMain.handle('odk-app-manager-intent', (_event, intent) => appManager.dispatch(intent))

  const options = resolveLaunchOptions(process.argv, process.env)
  const win = createWindow(options)
  if (options.smoke) runSmokeCheck(win, { width: options.width, height: options.height })
  win.webContents.once('did-finish-load', () => {
    broadcastVoiceStatus(voiceAgent.snapshot())
    win.webContents.send('odk-remote-link-state', {
      state: remoteBridge.getLinkState(),
      sequence: remoteSequence,
    })
  })
  win.once('ready-to-show', () => {
    if (!options.smoke) {
      if (options.kiosk) {
        win.setFullScreen(true)
        win.setKiosk(true)
      }
      win.show()
    }
  })
}

if (app && typeof app.on === 'function') {
  configureGpuSwitches(app, process.env)
  registerUserAppScheme(electron.protocol)

  app.on('child-process-gone', (_event, details) => {
    console.error(`child process gone: ${details.type} (${details.reason})`)
  })

  const smokeMode = process.argv.includes('--smoke')
  if (!smokeMode && !app.requestSingleInstanceLock()) {
    console.error('another Open DeskOS Shell instance owns the Electron profile')
    process.exit(1)
  } else {
    app.on('second-instance', () => {
      const [win] = BrowserWindow.getAllWindows()
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.focus()
    })
    app.whenReady().then(main)
  }

  app.on('window-all-closed', () => {
    app.quit()
  })
}

module.exports = {
  configureGpuSwitches,
  resolveGpuBackend,
  resolveLaunchOptions,
  resolveDisabledPlugins,
}
