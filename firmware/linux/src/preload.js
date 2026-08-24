const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('odkCompanion', {
  checkHealth: (endpoint) => ipcRenderer.invoke('odk-companion-health', endpoint),
})
