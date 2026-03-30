const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const ZaloManager = require('./zaloService');

let mainWindow;
let zaloManager;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "Zalo Forwarding Tool Pro",
        icon: path.join(__dirname, 'assets', 'icon.ico'), // Nếu bạn có icon
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'frontend', 'index.html'));

    // Mở DevTools nếu cần debug khi build (tùy chọn)
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
    // 1. Lấy đường dẫn thư mục lưu trữ dữ liệu người dùng (Sửa lỗi treo khi build .exe)
    // Đường dẫn này thường là: C:\Users\<Name>\AppData\Roaming\antigravity_zalo
    const userDataPath = app.getPath('userData'); 
    
    // 2. Khởi tạo ZaloManager với đường dẫn mới
    zaloManager = new ZaloManager(userDataPath);

    // Custom Menu
    const template = [
        {
            label: 'Hệ thống',
            submenu: [
                { role: 'reload', label: 'Tải lại giao diện' },
                { type: 'separator' },
                { role: 'quit', label: 'Thoát ứng dụng' }
            ]
        },
        {
            label: 'Trợ giúp',
            click: () => {
                dialog.showMessageBox(mainWindow, {
                    title: 'Thông tin hỗ trợ',
                    type: 'info',
                    message: 'Zalo: 0928822756 (Tùng)\nPhiên bản: 1.0.0 Pro'
                });
            }
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    createWindow();

    // --- Lắng nghe các sự kiện từ ZaloService ---

    zaloManager.on('log', (message) => {
        if (mainWindow) mainWindow.webContents.send('zalo-log', message);
    });

    zaloManager.on('qr_ready', (qrPath) => {
        if (mainWindow) mainWindow.webContents.send('zalo-qr', qrPath);
    });

    zaloManager.on('login_success', () => {
        if (mainWindow) mainWindow.webContents.send('zalo-login-success');
    });

    zaloManager.on('logged_out', () => {
        if (mainWindow) mainWindow.webContents.send('zalo-logged-out');
    });

    // Xử lý khi QR hết hạn (ZCA-JS ném lỗi hoặc timeout)
    zaloManager.on('qr_expired', async () => {
        if (mainWindow) {
            mainWindow.webContents.send('zalo-log', "⚠️ Mã QR đã hết hạn, đang tự động tạo mã mới...");
            await zaloManager.login(); // Gọi lại hàm login để tạo QR mới
        }
    });

    // --- Handle IPC calls từ Frontend ---

    ipcMain.handle('zalo-login', async () => {
        try {
            return await zaloManager.login();
        } catch (error) {
            console.error("Lỗi Login IPC:", error);
            return false;
        }
    });

    ipcMain.handle('zalo-logout', async () => {
        await zaloManager.logout();
    });

    ipcMain.handle('zalo-get-groups', async () => {
        return await zaloManager.getGroups();
    });

    ipcMain.handle('zalo-get-config', () => {
        return zaloManager.config;
    });

    ipcMain.handle('zalo-save-config', (event, sourceIds, destIds) => {
        zaloManager.saveConfig(sourceIds, destIds);
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});