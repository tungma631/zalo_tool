import { contextBridge, ipcRenderer } from 'electron';

// Gỡ bỏ IPC thông qua ContextBridge để Frontend truy cập API Backend an toàn
contextBridge.exposeInMainWorld('zaloAPI', {
    // 1. Quản lý Tài khoản
    getAccounts: () => ipcRenderer.invoke('get-accounts'),
    addAccount: () => ipcRenderer.invoke('add-account'),
    removeAccount: (filename: string) => ipcRenderer.invoke('remove-account', filename),
    onQRCodeReceived: (callback: (qrData: string) => void) => {
        ipcRenderer.on('add-account-qr', (_event, qrData) => callback(qrData));
    },
    
    // 2. Lấy Danh sách Nhóm
    getGroups: (filename: string) => ipcRenderer.invoke('get-groups', filename),

    // 3. Scan Group Members
    scanGroup: (sourceType: 'account'|'link', value: string, runAccountFilename: string) => {
        return ipcRenderer.invoke('scan-group', { sourceType, value, runAccountFilename });
    },

    // 3. Helper System (vd Dialog file hình)
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),

    // 4. Bắt đầu Dispatch Tin nhắn
    startSpam: (data: any) => ipcRenderer.invoke('start-spam', data),
    spamControl: (payload: { filename: string; action: 'pause' | 'resume' | 'stop' }) =>
        ipcRenderer.invoke('spam-control', payload),
    onSpamAccountFinished: (callback: (filename: string) => void) => {
        ipcRenderer.on('spam-account-finished', (_event, filename: string) => callback(filename));
    },
    onSpamAccountLog: (
        callback: (payload: { filename: string; line: string; level: 'info' | 'error' }) => void
    ) => {
        ipcRenderer.on('spam-account-log', (_event, payload) => callback(payload));
    },
    onSpamStatus: (callback: (status: string, message: string) => void) => {
        ipcRenderer.on('spam-complete', () => callback('complete', 'Gửi tin nhắn thành công'));
        ipcRenderer.on('spam-stopped', () => callback('stopped', 'Đã dừng chiến dịch (có thể đã gửi một phần).'));
        ipcRenderer.on('spam-error', (_event, message) => callback('error', message));
    },

    // ================== FORWARDER IPC ==================
    forwarderLogin: () => ipcRenderer.invoke('zalo-forward-login'),
    forwarderLogout: () => ipcRenderer.invoke('zalo-forward-logout'),
    forwarderGetGroups: () => ipcRenderer.invoke('zalo-forward-get-groups'),
    forwarderGetConfig: () => ipcRenderer.invoke('zalo-forward-get-config'),
    forwarderSaveConfig: (srcIds: string[], dstIds: string[]) => ipcRenderer.invoke('zalo-forward-save-config', srcIds, dstIds),
    
    onForwarderLog: (callback: (msg: string) => void) => {
        ipcRenderer.on('zalo-forward-log', (_event, msg) => callback(msg));
    },
    onForwarderQr: (callback: (qrBase64: string) => void) => {
        ipcRenderer.on('zalo-forward-qr', (_event, qr) => callback(qr));
    },
    onForwarderLoginSuccess: (callback: () => void) => {
        ipcRenderer.on('zalo-forward-login-success', () => callback());
    },
    onForwarderLoggedOut: (callback: () => void) => {
        ipcRenderer.on('zalo-forward-logged-out', () => callback());
    },

    // ================== LICENSE IPC ==================
    validateLicense: (key: string) => ipcRenderer.invoke('validate-license', key),
    getLicenseStatus: () => ipcRenderer.invoke('get-license-status'),
    getHwid: () => ipcRenderer.invoke('get-hwid'),
    getLicenseInfo: () => ipcRenderer.invoke('get-license-info'),
    onLicenseExpired: (callback: (msg: string) => void) => {
        ipcRenderer.on('license-expired', (_event, msg) => callback(msg));
    }
});
