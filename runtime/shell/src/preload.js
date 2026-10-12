const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('odkRendererControlBridge', {
  onRequest(listener) {
    const handler = (_event, request) => listener(request)
    ipcRenderer.on('odk-renderer-control-request', handler)
    return () => ipcRenderer.removeListener('odk-renderer-control-request', handler)
  },
  report: (requestId, result) => ipcRenderer.send('odk-renderer-control-report', { requestId, result }),
})

contextBridge.exposeInMainWorld('odkRendererPluginBridge', {
  list: () => ipcRenderer.invoke('odk-renderer-development-plugins'),
})

contextBridge.exposeInMainWorld('odkPlatform', {
  getOpenCodeGoStatus: () => ipcRenderer.invoke('odk-opencode-go-status'),
  getCameraFrame: () => ipcRenderer.invoke('odk-camera-frame'),
  getPiSessions: () => ipcRenderer.invoke('odk-pi-sessions'),
  getPiSessionEvents: (request) => ipcRenderer.invoke('odk-pi-session-events', request),
  getHydraStatus: () => ipcRenderer.invoke('odk-hydra-status'),
  getWeReadHighlight: () => ipcRenderer.invoke('odk-weread-highlight'),
  getFutuHoldings: (request) => ipcRenderer.invoke('odk-futu-holdings', request),
  getWeatherStatus: (request) => ipcRenderer.invoke('odk-weather-status', request),
  listApps: () => ipcRenderer.invoke('odk-app-manager-list'),
  getAppState: (appId) => ipcRenderer.invoke('odk-app-manager-state', appId),
  dispatchIntent: (intent) => ipcRenderer.invoke('odk-app-manager-intent', intent),
})

contextBridge.exposeInMainWorld('odkUserApps', {
  list: () => ipcRenderer.invoke('odk-user-apps-list'),
  dispatch: (request) => ipcRenderer.invoke('odk-user-apps-dispatch', request),
  // Declared Data: a package publishes what its manifest declared, and the Shell
  // decides what of that is a reading. Publishing is not an authority to change
  // anything, so the frame's own app id is all this needs.
  publishData: (appId, data) => ipcRenderer.invoke('odk-user-apps-publish', { appId, data }),
  subscribe(listener) {
    const handler = () => listener()
    ipcRenderer.on('odk-user-apps-changed', handler)
    return () => ipcRenderer.removeListener('odk-user-apps-changed', handler)
  },
})

contextBridge.exposeInMainWorld('odkPersonalBot', {
  onMic(listener) {
    const handler = () => listener()
    ipcRenderer.on('odk-personal-bot-mic', handler)
    return () => ipcRenderer.removeListener('odk-personal-bot-mic', handler)
  },
  toggle: () => ipcRenderer.invoke('odk-personal-bot-toggle'),
  getStatus: () => ipcRenderer.invoke('odk-personal-bot-status'),
  proposalCommand: (command) => ipcRenderer.invoke('odk-personal-bot-proposal', command),
  subscribe(listener) {
    const handler = (_event, update) => listener(update)
    ipcRenderer.on('odk-personal-bot-status', handler)
    return () => ipcRenderer.removeListener('odk-personal-bot-status', handler)
  },
})

contextBridge.exposeInMainWorld('odkRemote', {
  publishPageState: (state) => ipcRenderer.invoke('odk-remote-publish-page-state', state),
  subscribeLinkState(listener) {
    let active = true
    let received = false
    const handler = (_event, update) => {
      if (!active) return
      received = true
      listener(update.state)
    }
    ipcRenderer.on('odk-remote-link-state', handler)
    ipcRenderer.invoke('odk-remote-link-state').then(update => {
      if (active && !received) listener(update.state)
    }, () => {}).catch(error => console.error('Remote Link callback failed:', error))
    return () => {
      active = false
      ipcRenderer.removeListener('odk-remote-link-state', handler)
    }
  },
  subscribeNavigation(listener) {
    const handler = (_event, navigation) => listener(navigation.direction)
    ipcRenderer.on('odk-remote-navigation', handler)
    return () => ipcRenderer.removeListener('odk-remote-navigation', handler)
  },
  subscribeInput(listener) {
    const handler = (_event, payload) => {
      if (typeof payload === 'object' && payload !== null) {
        listener(payload.input, payload.action)
      } else {
        listener(payload)
      }
    }
    ipcRenderer.on('odk-remote-input', handler)
    return () => ipcRenderer.removeListener('odk-remote-input', handler)
  },
})


contextBridge.exposeInMainWorld('odkPluginDiagnosis', {
  onRequest(listener) {
    const handler = (_event, request) => listener(request)
    ipcRenderer.on('odk-plugin-runtime-request', handler)
    return () => ipcRenderer.removeListener('odk-plugin-runtime-request', handler)
  },
  report: (requestId, plugins) => ipcRenderer.send('odk-plugin-runtime-report', { requestId, plugins }),
})
