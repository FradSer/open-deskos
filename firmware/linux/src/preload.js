const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('odkCompanion', {
  checkHealth: (endpoint) => ipcRenderer.invoke('odk-companion-health', endpoint),
  listApps: () => ipcRenderer.invoke('odk-app-manager-list'),
  getAppState: (appId) => ipcRenderer.invoke('odk-app-manager-state', appId),
  dispatchIntent: (intent) => ipcRenderer.invoke('odk-app-manager-intent', intent),
})
