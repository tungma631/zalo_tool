import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import * as path from 'path';
import { AccountManager } from './account';
import { scanGroupMembers } from './scraper';
import { dispatchMessages, type SpamRunControl } from './dispatcher';
import { ZaloForwarder } from './zaloForwarder';
import { LicenseManager } from './licenseManager';

const licenseManager = new LicenseManager();
const accountManager = new AccountManager();
let spamRunControls: SpamRunControl[] = [];
let spamAccountFilenames: string[] = [];
let activeAccounts: ReturnType<typeof accountManager.restoreSessions> extends Promise<infer U> ? U : any[] = [];

// Lưu context của lần quét gần nhất để chuẩn bị chiến dịch gửi.
let lastScannedGroupId: string | null = null;
let lastScannedGroupLink: string | null = null;
let lastScanAccountFilename: string | null = null;

async function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1000,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            // Khuyến cáo tắt nodeIntegration và dùng preload cho bảo mật, nhưng có thể mở tạm nếu preload phức tạp
            nodeIntegration: false,
            contextIsolation: true,
        }
    });

    // mainWindow.webContents.openDevTools(); // Mở F12 debug

    const template = [
        {
            label: 'Hệ thống',
            submenu: [
                { label: 'Thoát phần mềm', role: 'quit' }
            ]
        },
        {
            label: 'Giao diện',
            submenu: [
                { label: 'Tải lại trang (F5)', role: 'reload' },
            ]
        },
        {
            label: 'Trợ giúp',
            submenu: [
                {
                    label: 'Liên hệ Hỗ trợ',
                    click: async () => {
                        dialog.showMessageBox({
                            type: 'info',
                            title: 'Thông tin liên hệ',
                            message: 'Zalo: 0928822756 (Tùng)',
                            buttons: ['Đóng']
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template as any);
    Menu.setApplicationMenu(menu);

    await mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));
}

app.whenReady().then(async () => {
    // Khôi phục session khi bật app
    activeAccounts = await accountManager.restoreSessions();

    // Khởi tạo ZaloForwarder và IPC TRƯỚC khi bật giao diện (createWindow)
    const forwarderDataPath = path.join(app.getPath('userData'), 'sessions', 'forwarder');
    const zaloForwarder = new ZaloForwarder(forwarderDataPath);

    zaloForwarder.on('log', (message: string) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.webContents.send('zalo-forward-log', message);
    });
    zaloForwarder.on('qr_ready', (qrData: string) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.webContents.send('zalo-forward-qr', qrData);
    });
    zaloForwarder.on('login_success', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.webContents.send('zalo-forward-login-success');
    });
    zaloForwarder.on('logged_out', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.webContents.send('zalo-forward-logged-out');
    });

    // License Check IPCs
    ipcMain.handle('validate-license', async (_event, key) => await licenseManager.validateKey(key));
    ipcMain.handle('get-license-status', async () => await licenseManager.checkSavedLicense());
    ipcMain.handle('get-hwid', () => licenseManager.hwid);
    ipcMain.handle('get-license-info', () => ({ key: licenseManager.currentKey, expiry: licenseManager.expiryDate }));

    // Cổng Zalo Forwarder API
    ipcMain.handle('zalo-forward-login', async () => {
        if (!licenseManager.isLicensed) return false;
        return await zaloForwarder.login();
    });
    ipcMain.handle('zalo-forward-logout', async () => {
        if (!licenseManager.isLicensed) return false;
        return await zaloForwarder.logout();
    });
    ipcMain.handle('zalo-forward-get-groups', async () => {
        if (!licenseManager.isLicensed) return [];
        return await zaloForwarder.getGroups();
    });
    ipcMain.handle('zalo-forward-get-config', () => {
        if (!licenseManager.isLicensed) return {};
        return zaloForwarder.config;
    });
    ipcMain.handle('zalo-forward-save-config', (_event, srcIds: string[], destIds: string[]) => {
        if (!licenseManager.isLicensed) return;
        zaloForwarder.saveConfig(srcIds, destIds);
    });

    await createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ==========================
// IPC Handlers: Giao tiếp UI - Backend
// ==========================

// 1. Quản lý Tài khoản (Accounts)
ipcMain.handle('get-accounts', () => {
    if (!licenseManager.isLicensed) return [];
    return activeAccounts.map(acc => ({ filename: acc.filename, name: acc.name }));
});

ipcMain.handle('add-account', async (event) => {
    if (!licenseManager.isLicensed) return { success: false, error: "App bị khóa bởi License_Server" };
    try {
        await accountManager.addAccount((qrUrl) => {
            event.sender.send('add-account-qr', qrUrl);
        }); 
        activeAccounts = await accountManager.restoreSessions(); // Reload
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('remove-account', async (event, filename) => {
    if (!licenseManager.isLicensed) return { success: false, error: "App bị khóa bởi License_Server" };
    try {
        const acc = activeAccounts.find(a => a.filename === filename);
        await accountManager.removeSession(filename, acc?.api);
        activeAccounts = activeAccounts.filter(a => a.filename !== filename);
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
});

// 2. Lấy Danh sách Nhóm
ipcMain.handle('get-groups', async (event, filename) => {
    if (!licenseManager.isLicensed) return { success: false, error: "App bị khóa bởi License_Server" };
    try {
        const acc = activeAccounts.find(a => a.filename === filename);
        if (!acc) throw new Error("Tài khoản không tồn tại.");

        // Lấy danh sách ID nhóm
        const res = await (acc.api as any).getAllGroups();
        if (!res || !res.gridVerMap) throw new Error("Không có nhóm nào tìm thấy.");

        const groupIds = Object.keys(res.gridVerMap);
        if (groupIds.length === 0) return { success: true, groups: [] };

        // Lấy thông tin chi tiết từng nhóm (tên nhóm)
        const infoRes = await (acc.api as any).getGroupInfo(groupIds);
        if (!infoRes || !infoRes.gridInfoMap) throw new Error("Lỗi khi tải thông tin nhóm.");

        const mapped = Object.values(infoRes.gridInfoMap).map((g: any) => ({
            id: g.groupId,
            name: g.name || "Nhóm không tên"
        }));

        return { success: true, groups: mapped };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
});

// 3. Select File Image
ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['jpg', 'png', 'gif'] }]
    });
    if (canceled) { return null; }
    return filePaths[0];
});

// 3. Scan Group (Account or Link)
ipcMain.handle('scan-group', async (event, data) => {
    if (!licenseManager.isLicensed) return { success: false, error: "App bị khóa bởi License_Server" };
    const { sourceType, value, runAccountFilename } = data;
    try {
        // Tìm instance Zalo
        const acc = activeAccounts.find(a => a.filename === runAccountFilename);
        if (!acc) throw new Error("Tài khoản quét không tồn tại hoặc chưa đăng nhập.");

        let members: { id: string, name: string }[] = [];

        if (sourceType === 'account') {
            // value is groupId
            members = await scanGroupMembers(acc.api, value);
            lastScannedGroupId = String(value || '').trim() || null;
            lastScannedGroupLink = null;
            lastScanAccountFilename = runAccountFilename || null;
        } else if (sourceType === 'link') {
            const { scanGroupMembersByLink } = require('./scraper');
            members = await scanGroupMembersByLink(acc.api, value);
            lastScannedGroupId = null;
            lastScannedGroupLink = String(value || '').trim() || null;
            lastScanAccountFilename = runAccountFilename || null;
        }
        return { success: true, members };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('spam-control', (_event, payload: { filename: string; action: 'pause' | 'resume' | 'stop' }) => {
    const idx = spamAccountFilenames.indexOf(payload.filename);
    if (idx < 0 || !spamRunControls[idx]) return { ok: false };
    const c = spamRunControls[idx];
    if (payload.action === 'pause') c.paused = true;
    if (payload.action === 'resume') c.paused = false;
    if (payload.action === 'stop') c.stopped = true;
    return { ok: true };
});

// 4. Dispatch Messages
ipcMain.handle('start-spam', async (event, data: {
    accountFilenames: string[];
    targetMembers?: { id: string; name?: string; gender?: number }[];
    targetUserIds?: string[];
    messageContent: string;
    imagePath?: string;
    minDelay?: number;
    maxDelay?: number;
}) => {
    if (!licenseManager.isLicensed) return { success: false, error: "App bị khóa bởi License_Server" };
    const { accountFilenames, messageContent, imagePath } = data;
    spamAccountFilenames = [...accountFilenames];
    spamRunControls = accountFilenames.map(() => ({ paused: false, stopped: false }));
    const minDelaySec = Math.max(1, Number(data.minDelay) || 30);
    const maxDelaySec = Math.max(minDelaySec, Number(data.maxDelay) || 60);
    const raw = data.targetMembers ?? data.targetUserIds;
    const targets: { id: string; name?: string; gender?: number }[] = Array.isArray(raw)
        ? raw
            .map((t: string | { id?: string; name?: string; gender?: number }) => {
                if (typeof t === 'string') return { id: t };
                if (t && typeof t === 'object' && typeof t.id === 'string' && t.id.length > 0) {
                    return { id: t.id, name: t.name, gender: t.gender };
                }
                return null;
            })
            .filter((x): x is { id: string; name?: string; gender?: number } => x !== null)
        : [];
    try {
        // Phải khớp thứ tự với accountFilenames / spamRunControls / từng tab UI (không dùng thứ tự activeAccounts).
        const selectedApis = accountFilenames.map((fn) => {
            const acc = activeAccounts.find(a => a.filename === fn);
            if (!acc) throw new Error(`Không tìm thấy phiên đăng nhập cho tài khoản: ${fn}`);
            return acc.api;
        });
        const uniqueApi = new Set(selectedApis);
        if (uniqueApi.size !== selectedApis.length) {
            throw new Error('Lỗi nội bộ: hai tài khoản đang trỏ cùng một instance API — hãy khởi động lại app.');
        }
        // IMEI đã được tự khử trùng trong restoreSessions(); ở đây chỉ cảnh báo nếu vẫn trùng (phòng trường hợp runtime bị sửa).
        const imeiByAccount = new Map<string, string>();
        for (const fn of accountFilenames) {
            const acc = activeAccounts.find(a => a.filename === fn);
            const imei = acc && (acc.api as { ctx?: { imei?: string } }).ctx?.imei;
            if (imei != null && String(imei).trim() !== '') {
                const k = String(imei).trim();
                if (imeiByAccount.has(k)) {
                    event.sender.send('spam-account-log', {
                        filename: fn,
                        level: 'error',
                        line: `⚠ Cảnh báo: vẫn trùng imei (${k}) với ${imeiByAccount.get(k)}. Có thể gây lỗi khi chạy song song.`,
                    });
                } else {
                    imeiByAccount.set(k, fn);
                }
            }
        }

        // Không tự động join nhóm theo yêu cầu.

        function splitTargetsForStreams(items: any[], num: number) {
            if (num <= 0) return [];
            if (items.length >= num) {
                const chunk = Math.ceil(items.length / num);
                return Array.from({ length: num }, (_, i) => items.slice(i * chunk, (i + 1) * chunk));
            }
            const resBuckets: any[][] = Array.from({ length: num }, () => []);
            items.forEach((t, i) => resBuckets[i % num].push(t));
            return resBuckets;
        }

        let buckets = splitTargetsForStreams(targets, selectedApis.length);

        // Dịch ID thành viên: Mỗi account Zalo mã hóa Zalo UID khác nhau.
        // Tài khoản quét sẽ sinh ra ID chuẩn của nó. Các tài khoản khác phải tự quét lại nhóm
        // để thu được ID chuẩn của chính nó, rồi map theo chỉ số mảng.
        if ((lastScannedGroupId || lastScannedGroupLink) && lastScanAccountFilename && targets.length > 0) {
            const sourceAcc = activeAccounts.find(a => a.filename === lastScanAccountFilename);
            if (sourceAcc) {
                let sourceMembers: { id: string }[] = [];
                try {
                    const { scanGroupMembersByLink } = require('./scraper');
                    if (lastScannedGroupId) {
                        sourceMembers = await scanGroupMembers(sourceAcc.api, lastScannedGroupId);
                    } else if (lastScannedGroupLink) {
                        sourceMembers = await scanGroupMembersByLink(sourceAcc.api, lastScannedGroupLink);
                    }
                } catch (e: any) {
                    console.error("Không thể lấy lại danh sách gốc để dịch ID:", e.message);
                }

                if (sourceMembers.length > 0) {
                    const sourceDict = new Map<string, number>();
                    sourceMembers.forEach((m, idx) => sourceDict.set(m.id, idx));

                    for (let i = 0; i < accountFilenames.length; i++) {
                        const fn = accountFilenames[i];
                        if (fn !== lastScanAccountFilename && buckets[i].length > 0) {
                            const acc = activeAccounts.find(a => a.filename === fn);
                            if (acc) {
                                try {
                                    event.sender.send('spam-account-log', { filename: fn, line: `Đang đồng bộ hóa ID thành viên cho tài khoản này...`, level: 'info' });
                                    const { scanGroupMembersByLink } = require('./scraper');
                                    let dstMembers: { id: string }[] = [];
                                    if (lastScannedGroupId) {
                                        dstMembers = await scanGroupMembers(acc.api, lastScannedGroupId);
                                    } else if (lastScannedGroupLink) {
                                        dstMembers = await scanGroupMembersByLink(acc.api, lastScannedGroupLink);
                                    }

                                    let translatedCount = 0;
                                    for (let j = 0; j < buckets[i].length; j++) {
                                        const t = buckets[i][j];
                                        const origIdx = sourceDict.get(t.id);
                                        if (origIdx !== undefined && dstMembers[origIdx]) {
                                            buckets[i][j].id = dstMembers[origIdx].id;
                                            translatedCount++;
                                        }
                                    }
                                    event.sender.send('spam-account-log', { filename: fn, line: `Đã đồng bộ thành công ${translatedCount}/${buckets[i].length} người nhận.`, level: 'info' });
                                } catch (e: any) {
                                    event.sender.send('spam-account-log', { filename: fn, line: `Lỗi đồng bộ ID: ${e.message}`, level: 'error' });
                                }
                            }
                        }
                    }
                }
            }
        }

        // Chạy dispatcher ngầm, không await để không treo UI, 
        // Thay vào đó có thể báo event tiến độ qua webContents
        dispatchMessages(selectedApis, buckets, messageContent, imagePath, {
            controls: spamRunControls,
            minDelaySec,
            maxDelaySec,
            accountFilenames: spamAccountFilenames,
            // Độ trễ gối đầu giữa các luồng: giảm thundering herd lúc bắt đầu.
            staggerStartMs: 5000,
            // Phase offset cố định 5s theo từng luồng để tránh trùng thời điểm gửi.
            phaseShiftSec: 5,
            onAccountLog: (filename, line, level) => {
                event.sender.send('spam-account-log', { filename, line, level });
            },
            onAccountFinished: (accountIndex) => {
                const fn = spamAccountFilenames[accountIndex];
                if (fn) event.sender.send('spam-account-finished', fn);
            },
        }).then(() => {
            const allStopped = spamRunControls.length > 0 && spamRunControls.every(c => c.stopped);
            if (allStopped) {
                event.sender.send('spam-stopped');
            } else {
                event.sender.send('spam-complete');
            }
        }).catch(err => {
            event.sender.send('spam-error', err.message);
        });

        return { success: true, message: "Đã bắt đầu trình gửi spam chạy ngầm" };
    } catch (err: any) {
        return { success: false, error: err.message };
    }
});
