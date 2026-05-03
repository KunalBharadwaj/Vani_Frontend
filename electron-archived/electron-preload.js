// Electron preload script - Bridge between Electron and React app
const { contextBridge, ipcRenderer } = require('electron');

// Expose safe APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // File operations
    saveFile: (options) => ipcRenderer.invoke('save-file', options),
    openFile: (options) => ipcRenderer.invoke('open-file', options),

    // App info
    getAppInfo: () => ipcRenderer.invoke('get-app-info'),

    // Window controls
    toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
    exitApp: () => ipcRenderer.invoke('exit-app'),

    // Dialogs
    showError: (options) => ipcRenderer.invoke('show-error', options),
    showMessage: (options) => ipcRenderer.invoke('show-message', options),

    // Platform detection
    isElectron: true,
    platform: process.platform,
    arch: process.arch
});

// Log that preload script loaded successfully
console.log('Electron preload script loaded');
