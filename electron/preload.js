const { contextBridge, ipcRenderer } = require('electron')

function createIpcSubscription(channel) {
  return (callback) => {
    if (typeof callback !== 'function') {
      return () => {}
    }

    const listener = (_event, payload) => {
      callback(payload)
    }

    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Example API methods
  getVersion: () => process.versions.electron,
  getPlatform: () => process.platform,

  // IPC communication example
  sendMessage: (message, data) => ipcRenderer.invoke('send-message', message, data),

  // Window management
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),

  // Project management
  onProjectImported: (callback) => ipcRenderer.on('project-imported', callback),
  removeProjectImportedListener: (callback) => ipcRenderer.removeListener('project-imported', callback),

  // Theme management
  onThemeChanged: (callback) => ipcRenderer.on('theme-changed', callback),
  removeThemeChangedListener: (callback) => ipcRenderer.removeListener('theme-changed', callback),

  // Locale management
  onLocaleChanged: (callback) => ipcRenderer.on('locale-changed', callback),
  removeLocaleChangedListener: (callback) => ipcRenderer.removeListener('locale-changed', callback),

  // Terminal bridge
  terminal: {
    open: (options) => ipcRenderer.invoke('send-message', 'open-terminal', options),
    close: (sessionId) => ipcRenderer.invoke('terminal-close', { sessionId }),
    write: (sessionId, data) => ipcRenderer.send('terminal-write', { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.send('terminal-resize', { sessionId, cols, rows }),
    onData: createIpcSubscription('terminal-data'),
    onExit: createIpcSubscription('terminal-exit')
  }
})
