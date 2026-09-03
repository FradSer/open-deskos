const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('odkPlatform', {
  callPluginRpc: (request) => ipcRenderer.invoke('odk-plugin-rpc', request),
  getOpenCodeGoStatus: () => ipcRenderer.invoke('odk-opencode-go-status'),
  getFaceAgentStatus: () => ipcRenderer.invoke('odk-face-agent-status'),
  getPiSessions: () => ipcRenderer.invoke('odk-pi-sessions'),
  listApps: () => ipcRenderer.invoke('odk-app-manager-list'),
  getAppState: (appId) => ipcRenderer.invoke('odk-app-manager-state', appId),
  dispatchIntent: (intent) => ipcRenderer.invoke('odk-app-manager-intent', intent),
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
})
