const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('odkPlatform', {
  getOpenCodeGoStatus: () => ipcRenderer.invoke('odk-opencode-go-status'),
  getFaceAgentStatus: () => ipcRenderer.invoke('odk-face-agent-status'),
  getPiSessions: () => ipcRenderer.invoke('odk-pi-sessions'),
  getHydraStatus: () => ipcRenderer.invoke('odk-hydra-status'),
  getWeReadHighlight: () => ipcRenderer.invoke('odk-weread-highlight'),
  listApps: () => ipcRenderer.invoke('odk-app-manager-list'),
  getAppState: (appId) => ipcRenderer.invoke('odk-app-manager-state', appId),
  dispatchIntent: (intent) => ipcRenderer.invoke('odk-app-manager-intent', intent),
})

contextBridge.exposeInMainWorld('odkUserApps', {
  list: () => ipcRenderer.invoke('odk-user-apps-list'),
  dispatch: (request) => ipcRenderer.invoke('odk-user-apps-dispatch', request),
  subscribe(listener) {
    const handler = () => listener()
    ipcRenderer.on('odk-user-apps-changed', handler)
    return () => ipcRenderer.removeListener('odk-user-apps-changed', handler)
  },
})

contextBridge.exposeInMainWorld('odkVoice', {
  toggle: () => ipcRenderer.invoke('odk-voice-toggle'),
  getStatus: () => ipcRenderer.invoke('odk-voice-status'),
  subscribe(listener) {
    const handler = (_event, update) => listener(update)
    ipcRenderer.on('odk-voice-status', handler)
    return () => ipcRenderer.removeListener('odk-voice-status', handler)
  },
})

contextBridge.exposeInMainWorld('odkRemote', {
  publishPageState: (state) => ipcRenderer.invoke('odk-remote-publish-page-state', state),
  subscribeLinkState(listener) {
    const handler = (_event, update) => listener(update.state)
    ipcRenderer.on('odk-remote-link-state', handler)
    return () => ipcRenderer.removeListener('odk-remote-link-state', handler)
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
