const electron = require('electron')
const app = electron?.app
const BrowserWindow = electron?.BrowserWindow
const ipcMain = electron?.ipcMain
const session = electron?.session
const fs = require('node:fs')
const { createRemoteBridgeClient, resolveRemoteBridgeSocketPath } = require('./remote-bridge-client')
const { resolveShellHost } = require('./platform')

const DEFAULT_WIDTH = 1920
const DEFAULT_HEIGHT = 1280
const { resolveOpenCodeGoConfig, fetchOpenCodeGo } = require('./opencode-go')
const { createAppManagerEndpoint } = require('./app-manager-endpoint')
const { createCameraSource, createCameraCaptureProvider } = require('./camera-source')
const { createPiSessionsSource, createConfiguredPiSessionReader } = require('./pi-sessions-source')
const { createOdkLinkClient, createOdkLinkTransport } = require('./odk-link-client')
const { KIOSK_WINDOW_LOCK, enterPanel, resolvePanelBounds } = require('./panel')
const { createPiSessionEventsSource } = require('./pi-session-events-source')
const { readSessionEvents } = require('./pi-sessions')
const { createHydraSource, connectHydraMqtt } = require('./hydra-mqtt')
const { createPersonalBotClient, resolvePersonalBotSocketPath } = require('./personal-bot-client')
const { createWeReadSource } = require('./weread-source')
const { createFutuSource } = require('./futu-source')
const { createWeatherSource } = require('./weather-source')
const { registerUserAppScheme, startUserAppSystem, resolveUserAppSurface } = require('./user-app-system')
const { createUserAppVerifier } = require('./user-app-verifier')
const { createShellOdkData } = require('./odk-data')
const { listenOdkData } = require('./odk-data-control')
const { createPluginHost } = require('./plugin-host')
const { resolveStartupDisabled, readConfig, resolveConfigPath } = require('./plugin-config')
const { loadDevelopmentPlugins, loadAppearanceReplacements } = require('./development-plugins')
const { loadNativePlugins, loadNativeRendererPlugins, loadNativeAppearancePlugins } = require('./native-plugin-loader')
const { createNativeRendererAssets } = require('./native-renderer-assets')
const { createNativeRuntimeActivator } = require('./native-runtime-activation')
const { createNativeRendererActivator } = require('./native-renderer-activation')
const { selectAppearancePlugins } = require('./renderer/core/appearance-plugins')
const { installPluginShutdown } = require('./plugin-shutdown')
const { createMainPlugins } = require('./plugins/main-composition')
const { createFrameReadyEvents } = require('./frame-ready')
const { resolveHostedPiSocketPath } = require('./odk-link-host-adapter')
const { SYSTEM_PORTS } = require('./plugins/system-channels')

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
  const requested = env.ODK_GPU_BACKEND
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
  const forceSoftware = env.ODK_DISABLE_GPU === '1' || env.LIBGL_ALWAYS_SOFTWARE === '1'
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
  const width = Number.parseInt(env.ODK_SHELL_WIDTH ?? '', 10) || DEFAULT_WIDTH
  const height = Number.parseInt(env.ODK_SHELL_HEIGHT ?? '', 10) || DEFAULT_HEIGHT
  return {
    width,
    height,
    smoke: argv.includes('--smoke'),
    kiosk: argv.includes('--kiosk') || env.ODK_SHELL_KIOSK === '1',
    disabledPlugins: resolveDisabledPlugins(env),
    piSessionReasoning: resolvePiSessionReasoning(env),
  }
}

// The panel itself is src/panel.js: what a kiosk panel covers, and how it asks
// for that geometry again while a Windows Shell Host has dropped the request.
function resolveDisabledPlugins(env = process.env) {
  return (env.ODK_DISABLED_PLUGINS ?? '')
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean)
}

// The Session Detail's reasoning display is device-local configuration: only an
// explicit `shown` publishes what Pi was thinking, and every other value keeps
// the desk's folded default instead of guessing at intent.
function resolvePiSessionReasoning(env = process.env) {
  return String(env.ODK_PI_REASONING ?? '').trim() === 'shown' ? 'shown' : 'hidden'
}

// The renderer learns launch configuration from its own URL. A value the desk
// already defaults to is not restated there.
function rendererQuery(options) {
  const params = new URLSearchParams()
  if (options.kiosk) params.set('kiosk', '1')
  if (options.disabledPlugins.length > 0) params.set('disabledPlugins', options.disabledPlugins.join(','))
  if (options.piSessionReasoning === 'shown') params.set('piReasoning', 'shown')
  if (options.appearanceReplacements?.length) params.set('appearanceReplacements', JSON.stringify(options.appearanceReplacements))
  return params.size > 0 ? `?${params}` : ''
}

function createWindow(options) {
  const panelBounds = resolvePanelBounds(options)
  const win = new BrowserWindow({
    width: panelBounds ? panelBounds.width : options.width,
    height: panelBounds ? panelBounds.height : options.height,
    useContentSize: true,
    frame: false,
    hasShadow: false,
    thickFrame: false,
    ...(panelBounds ? KIOSK_WINDOW_LOCK : {}),
    // Kiosk is applied after the window is shown, never in the constructor: a
    // Windows fullscreen transition requested on a window that has not been shown
    // yet can leave it invisible, and a kiosk desk with no visible window is a
    // black panel. On the reference host the window's content size is already the
    // display size, so the order changes nothing there.
    kiosk: false,
    fullscreen: false,
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

  const query = rendererQuery(options)
  win.loadFile('src/renderer/index.html', { search: query })
  return win
}

function writeSmokeResult(result) {
  const serialized = `${JSON.stringify(result)}\n`
  process.stdout.write(serialized)
  const resultFile = process.env.ODK_SMOKE_RESULT_FILE
  if (resultFile) fs.writeFileSync(resultFile, serialized, 'utf8')
}

function finishSmoke(result) {
  writeSmokeResult(result)
  setTimeout(() => app.exit(result.ok ? 0 : 1), 0)
}

function runSmokeCheck(win, expected) {
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    finishSmoke({ ok: false, reason: 'timeout' })
  }, 15000)
  win.webContents.once('did-finish-load', () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    const actual = win.getContentBounds()
    const ok = actual.width === expected.width && actual.height === expected.height
    finishSmoke({ ok, width: actual.width, height: actual.height })
  })
}

async function main() {
  // Quit can begin while startup waits on the catalog or a local listener.
  // Every asynchronous continuation checks this guard before attaching resources.
  let stopping = false
  app.once('before-quit', () => { stopping = true })
  const isStopping = () => stopping
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  const smokeMode = process.argv.includes('--smoke')
  const shellHost = resolveShellHost()
  let pluginConfig = { version: 1, plugins: {} }
  try { pluginConfig = readConfig(resolveConfigPath(process.env)) }
  catch (error) { console.error(`plugin configuration unavailable: ${error.message}`) }
  const disabledPlugins = resolveStartupDisabled(process.env, undefined, pluginConfig)
  const nativeRendererAssets = createNativeRendererAssets()
  app.once('before-quit', () => nativeRendererAssets.close())
  let nativeAppearanceEntries = []
  let appearanceReplacements = []
  if (!smokeMode) {
    try { appearanceReplacements = loadAppearanceReplacements(pluginConfig, { disabled: disabledPlugins,
      report: id => console.error(`appearance selection unavailable: ${id}`) }) }
    catch (error) { console.error(`appearance selection unavailable: ${error.message}`) }
    const nativeAppearances = await loadNativeAppearancePlugins(pluginConfig, { env: process.env, disabled: disabledPlugins,
      existingPlugins: appearanceReplacements.map(manifest => ({ manifest })), assets: nativeRendererAssets,
      report: id => console.error(`native Appearance unavailable: ${id}`) })
    appearanceReplacements.push(...nativeAppearances.filter(entry => !entry.entryUrl).map(entry => entry.manifest))
    nativeAppearanceEntries = nativeAppearances.filter(entry => entry.entryUrl)
    if (stopping) { nativeRendererAssets.close(); return }
  }
  const appearancePlugins = selectAppearancePlugins(appearanceReplacements)
  if (smokeMode || !shellHost.endpoint('plugin-diagnostics')) disabledPlugins.push('odk.system.plugin-diagnostics')
  if (smokeMode || !shellHost.endpoint('plugin-control')) disabledPlugins.push('odk.system.plugin-control')
  if (smokeMode || !shellHost.endpoint('renderer-plugin-control')) disabledPlugins.push('odk.system.renderer-control')
  if (!smokeMode) {
    // One statement of what this host cannot inspect, so a degraded reading is
    // visible instead of being inferred from a blank column. The reader is
    // Windows-only, so another host has nothing to report here.
    if (shellHost.isWindows) {
      const { createNativeProcessReader } = require('./platform/native-process-reader')
      const { reason } = createNativeProcessReader()
      if (reason) console.error(`Pi Sessions: ${reason}; session work directories read as unknown`)
    }
    // A host outside the supported set still runs, but the desk says its
    // behavior there is unverified instead of presenting it as a supported host.
    if (!shellHost.supported) {
      console.error(`Shell Host ${shellHost.id} is outside the supported set; behavior on this host is unverified`)
    }
  }
  let remoteSocketPath = null
  if (!smokeMode) {
    try {
      remoteSocketPath = resolveRemoteBridgeSocketPath()
    } catch (error) {
      console.error(`remote bridge disabled: ${error.message}`)
    }
  }
  const broadcast = (channel, payload) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
  }
  let lastFutuRejection = null
  const { createUserAppStore } = require('./user-app-store')
  const frames = createFrameReadyEvents()
  const diagnosisFrames = new Set()
  let nativeRendererEntries = []
  const rendererEntries = () => smokeMode ? [] : [...loadDevelopmentPlugins(pluginConfig, {
    disabled: disabledPlugins, host: 'electron-renderer',
    report: id => console.error(`renderer development plugin unavailable: ${id}`),
  }), ...nativeRendererEntries, ...nativeAppearanceEntries]
  const servicePush = readingIds => pluginHost.get(SYSTEM_PORTS.serviceNotifications)?.publish(readingIds)
  const pluginHost = createPluginHost({
    disabled: disabledPlugins,
    onError: (id, error) => console.error(`plugin ${id} failed: ${error.message}`),
    capabilities: {
      'shell.frames': { subscribe: frames.subscribe },
      'system.renderer-development': { ipc: ipcMain, protocol: electron.protocol, nativeAssets: nativeRendererAssets,
        runtimeNativeAssets: !smokeMode && !disabledPlugins.includes('odk.system.renderer-control'),
        frames: () => [...diagnosisFrames], entries: rendererEntries },
      'system.renderer-diagnostics': { ipc: ipcMain, frames: () => [...diagnosisFrames].map(sender => ({
        id: sender.id, sender, mainFrame: () => sender.mainFrame, send: sender.send.bind(sender),
      })) },
      'system.renderer-control': { ipc: ipcMain, frames: () => [...diagnosisFrames].map(sender => ({
        sender, mainFrame: () => sender.mainFrame, send: sender.send.bind(sender),
      })), prepareActivation: (id, options) => activateRenderer(id, options), endpoint: shellHost.endpoint('renderer-plugin-control'), stateDir: shellHost.stateDir, platform: shellHost.platform, smokeMode },
      'system.hosted-pi-diagnostics': { endpoint: () => smokeMode ? null : resolveHostedPiSocketPath(process.env) },
      'plugin.diagnostics': { endpoint: shellHost.endpoint('plugin-diagnostics'), stateDir: shellHost.stateDir, platform: shellHost.platform, smokeMode, snapshot: () => pluginHost.list() },
      'plugin.control': { endpoint: shellHost.endpoint('plugin-control'), stateDir: shellHost.stateDir, platform: shellHost.platform, smokeMode,
        snapshot: () => pluginHost.list(), setEnabled: (id, enabled) => pluginHost.setEnabled(id, enabled),
        activate: (id, options) => activateNative(id, options) },
      ipc: ipcMain,
      broadcast,
      'desk.catalog': { create: createUserAppStore, createVerifier: () => createUserAppVerifier({ electronPath: process.execPath }), smokeMode, options: {
        workspace: process.env.ODK_WORKSPACE,
        stateDir: resolveUserAppSurface({ env: process.env }).stateDir,
      } },
      'desk.futu': { create: createFutuSource, env: process.env, report: message => console.error(message), options: {
        onUpdate: id => servicePush([id]),
        runtimeDir: require('node:path').join(process.env.XDG_RUNTIME_DIR || require('node:os').tmpdir(), 'odk'),
        stateDir: shellHost.stateDir,
        onReject: reason => {
          if (reason === lastFutuRejection) return
          lastFutuRejection = reason
          console.error(`futu service plugin refused a connection: ${reason}`)
        },
        onRefuse: (id, reason) => console.error(`futu service ${id} is not listening: ${reason}`),
      } },
      'desk.data': { create: createShellOdkData, smokeMode, onUpdate: id => servicePush([id]) },
      'desk.refresh': { smokeMode, setInterval, clearInterval, report: message => console.error(message) },
      'desk.user-apps': { start: startUserAppSystem, smokeMode, isStopping, options: {
        app, ipcMain, protocol: electron.protocol, BrowserWindow, smokeMode, appearancePlugins,
      } },
      'desk.link': { listen: listenOdkData, smokeMode, enabled: shellHost.provisionsOdkData, report: message => console.error(message), options: {
        endpoint: shellHost.odkDataEndpoint, stateDir: shellHost.stateDir, platform: shellHost.platform,
      } },
      'system.personal-bot': { create: createPersonalBotClient, smokeMode, isConsumerFrame: event => diagnosisFrames.has(event.sender) && event.senderFrame === event.sender.mainFrame, options: {
        socketPath: smokeMode ? null : resolvePersonalBotSocketPath(process.env, shellHost), host: shellHost,
      } },
      'system.remote-link': { create: createRemoteBridgeClient, smokeMode, options: { socketPath: remoteSocketPath } },
      'system.app-manager': { create: createAppManagerEndpoint },
      'source.odk-link': { create: createOdkLinkClient, createTransport: createOdkLinkTransport, options: smokeMode ? {} : { onCompletion: () => servicePush(['odk.app.pi-sessions.completed']) } },
      'source.pi-sessions': { create: createPiSessionsSource, configured: createConfiguredPiSessionReader },
      'source.pi-events': { create: createPiSessionEventsSource, readLocal: readSessionEvents },
      'source.camera': { create: createCameraSource, provider: createCameraCaptureProvider },
      'source.personal-agent-readings': { endpoint: smokeMode ? null : shellHost.endpoint('personal-bot-control'), tokenFile: shellHost.localChannelTokenFile, platform: shellHost.platform },
      'source.quota': { read: options => fetchOpenCodeGo(resolveOpenCodeGoConfig(), options) },
      'source.hydra': { create: createHydraSource, connect: connectHydraMqtt, options: smokeMode ? {} : {
        url: process.env.ODK_HYDRA_MQTT_URL,
        topicPrefix: process.env.ODK_HYDRA_MQTT_TOPIC,
        onUpdate: () => servicePush(['odk.tile.hydra']),
      } },
      'source.weread': { create: createWeReadSource, options: {
        cacheFile: require('node:path').join(app.getPath('userData'), 'weread-highlights.json'),
      } },
      'source.weather': { create: createWeatherSource, options: smokeMode ? { latitude: null, longitude: null } : {
        cacheFile: require('node:path').join(app.getPath('userData'), 'weather-reading.json'),
        onUpdate: () => servicePush(['odk.tile.weather']),
      } },
    },
  })
  let developmentPlugins = []
  if (!smokeMode) {
    try { developmentPlugins = loadDevelopmentPlugins(pluginConfig, { disabled: disabledPlugins,
      report: id => console.error(`development plugin unavailable: ${id}`) }) }
    catch (error) { console.error(`development plugins unavailable: ${error.message}`) }
    developmentPlugins.push(...await loadNativePlugins(pluginConfig, { env: process.env, disabled: disabledPlugins, existingPlugins: developmentPlugins,
      report: id => console.error(`native plugin unavailable: ${id}`) }))
    if (stopping) { nativeRendererAssets.close(); return }
    const rendererDevelopment = loadDevelopmentPlugins(pluginConfig, { disabled: disabledPlugins, host: 'electron-renderer',
      report: id => console.error(`renderer development plugin unavailable: ${id}`) })
    nativeRendererEntries = await loadNativeRendererPlugins(pluginConfig, { env: process.env, disabled: disabledPlugins,
      existingPlugins: [...rendererDevelopment, ...nativeAppearanceEntries], assets: nativeRendererAssets,
      report: id => console.error(`native Renderer plugin unavailable: ${id}`) })
    if (stopping) { nativeRendererAssets.close(); return }
  }
  let plugins
  let defaults
  try {
    plugins = createMainPlugins({ developmentPlugins: developmentPlugins.filter(plugin => !plugin.replacement),
      replacementPlugins: developmentPlugins.filter(plugin => plugin.replacement), onDefaults: definitions => { defaults = definitions } })
  } catch (error) {
    console.error(`development replacements unavailable: ${error.message}`)
    plugins = createMainPlugins({ onDefaults: definitions => { defaults = definitions } })
  }
  for (const plugin of plugins) pluginHost.register(plugin)
  const activateNative = createNativeRuntimeActivator({ host: pluginHost, defaults })
  const activateRenderer = createNativeRendererActivator({ assets: nativeRendererAssets, entries: rendererEntries,
    publishSelection(entry) {
      if (entry.manifest.id.startsWith('odk.theme.')) {
        nativeAppearanceEntries = [...nativeAppearanceEntries.filter(current => current.manifest.id !== entry.manifest.id), entry]
      } else nativeRendererEntries = [...nativeRendererEntries.filter(current => current.manifest.id !== entry.manifest.id), entry]
    },
  })
  installPluginShutdown(app, pluginHost, error => console.error(`plugins stop failed: ${error.message}`))
  await pluginHost.start()
  if (stopping) return

  const options = { ...resolveLaunchOptions(process.argv, process.env), disabledPlugins, appearanceReplacements }
  const win = createWindow(options)
  const diagnosisFrame = win.webContents
  diagnosisFrames.add(diagnosisFrame)
  diagnosisFrame.once('destroyed', () => diagnosisFrames.delete(diagnosisFrame))
  if (options.smoke) runSmokeCheck(win, { width: options.width, height: options.height })
  win.webContents.once('did-finish-load', () => {
    frames.publish({ send: win.webContents.send.bind(win.webContents) })
  })
  win.once('ready-to-show', () => {
    if (!options.smoke) {
      win.show()
      if (options.kiosk) enterPanel(win, resolvePanelBounds(options), process.platform)
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
    app.whenReady().then(main).catch(error => {
      console.error(`Shell startup failed: ${error.message}`)
      app.exit(1)
    })
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
  resolvePiSessionReasoning,
  rendererQuery,
}
