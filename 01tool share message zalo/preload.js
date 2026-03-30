const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zaloAPI', {
    // Actions
    login: () => ipcRenderer.invoke('zalo-login'),
    logout: () => ipcRenderer.invoke('zalo-logout'),
    getGroups: () => ipcRenderer.invoke('zalo-get-groups'),
    getConfig: () => ipcRenderer.invoke('zalo-get-config'),
    saveConfig: (sourceIds, destIds) => ipcRenderer.invoke('zalo-save-config', sourceIds, destIds),

    // Listeners
    onLog: (callback) => ipcRenderer.on('zalo-log', (event, msg) => callback(msg)),
    onQR: (callback) => ipcRenderer.on('zalo-qr', (event, qrPath) => callback(qrPath)),
    onLoginSuccess: (callback) => ipcRenderer.on('zalo-login-success', () => callback()),
    onLoggedOut: (callback) => ipcRenderer.on('zalo-logged-out', () => callback()),
});
