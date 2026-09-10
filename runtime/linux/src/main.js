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
const { fetchFaceAgentStatus } = require('./face-agent-status')
const { createPiSessionsSource } = require('./pi-sessions-source')
const { createHydraSource } = require('./hydra-mqtt')
const { createVoiceAgentClient, resolveVoiceSocketPath } = require('./voice-agent-client')
const { createWeReadSource } = require('./weread-source')
const { registerUserAppScheme, startUserAppSystem } = require('./user-app-system')
const scanPiSessions = createPiSessionsSource()

function configureGpuSwitches(targetApp = app, env = process.env) {
  const forceSoftware = env.ODESK_DISABLE_GPU === '1' || env.LIBGL_ALWAYS_SOFTWARE === '1'
  if (forceSoftware) {
    if (targetApp?.commandLine?.appendSwitch) {
      targetApp.commandLine.appendSwitch('disable-gpu')
    }
    return { hardwareAcceleration: false }
  }
  if (targetApp?.commandLine?.appendSwitch) {
    targetApp.commandLine.appendSwitch('ignore-gpu-blocklist')
    targetApp.commandLine.appendSwitch('enable-gpu-rasterization')
    targetApp.commandLine.appendSwitch('enable-zero-copy')
    if (env.ODESK_USE_EGL === '1' || env.WAYLAND_DISPLAY) {
      targetApp.commandLine.appendSwitch('use-gl', 'egl')
    }
  }
  return { hardwareAcceleration: true }
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
  voiceAgent.subscribe(broadcastVoiceStatus)
  if (!smokeMode) voiceAgent.start()
  ipcMain.handle('odk-voice-status', () => voiceAgent.snapshot())
  ipcMain.handle('odk-voice-toggle', () => {
    const sent = voiceAgent.toggle()
    if (!sent) broadcastVoiceStatus(voiceAgent.snapshot())
    return { accepted: sent }
  })
  app.once('before-quit', () => voiceAgent.stop())
  const remoteBridge = createRemoteBridgeClient({ socketPath: remoteSocketPath })
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
    if (input === 'mic') {
      if (!voiceAgent.toggle()) broadcastVoiceStatus(voiceAgent.snapshot())
      return
    }
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
  ipcMain.handle('odk-face-agent-status', fetchFaceAgentStatus)
  ipcMain.handle('odk-pi-sessions', () => scanPiSessions())
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

  const appManager = createAppManagerEndpoint()
  ipcMain.handle('odk-app-manager-list', () => appManager.list())
  ipcMain.handle('odk-app-manager-state', (_event, appId) => appManager.get(appId))
  ipcMain.handle('odk-app-manager-intent', (_event, intent) => appManager.dispatch(intent))

  const options = resolveLaunchOptions(process.argv, process.env)
  const win = createWindow(options)
  if (options.smoke) runSmokeCheck(win, { width: options.width, height: options.height })
  win.webContents.once('did-finish-load', () => {
    if (voiceAgent.snapshot().state !== 'unavailable') broadcastVoiceStatus(voiceAgent.snapshot())
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
  resolveLaunchOptions,
  resolveDisabledPlugins,
}
