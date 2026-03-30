import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { Zalo, API } from 'zca-js';
import { createZaloSessionOptions } from './zaloSessionOptions';
import * as crypto from 'crypto';

/** zca-js v2 bắt buộc khi gửi ảnh/GIF từ đường dẫn file (xem README zca-js). */
async function imageMetadataGetter(filePath: string) {
    const data = await fs.promises.readFile(filePath);
    const metadata = await sharp(data).metadata();
    return {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        size: metadata.size ?? data.length,
    };
}

function generateImei15(): string {
    // Zalo thường chấp nhận imei dạng string; dùng 15 chữ số để ổn định với nhiều endpoint.
    // Không dùng Luhn vì server hiếm khi check; mục tiêu là UNIQUE.
    const digits = crypto.randomBytes(16).toString('hex').replace(/\D/g, '');
    const base = (digits + String(Date.now())).replace(/\D/g, '');
    return base.slice(0, 15).padEnd(15, '0');
}

function randomHashDigits(len: number): string {
    const seed = crypto.randomBytes(32);
    const hex = crypto.createHash('sha256').update(seed).digest('hex');
    const digits = hex.replace(/\D/g, '');
    return digits.padEnd(len, '0').slice(0, len);
}

/** Giữ IMEI 15 số, chỉ thay phần đuôi bằng băm ngẫu nhiên. */
function mutateImeiTail(imei: unknown, tailLen = 6): string {
    const raw = imei != null ? String(imei).trim() : '';
    const baseDigits = raw.replace(/\D/g, '');
    const safeTail = Math.min(12, Math.max(1, tailLen));
    const headLen = Math.max(0, 15 - safeTail);
    const head = (baseDigits || generateImei15()).padEnd(15, '0').slice(0, headLen);
    const tail = randomHashDigits(safeTail);
    return (head + tail).slice(0, 15).padEnd(15, '0');
}

/**
 * Tăng/giảm nhẹ phiên bản trình duyệt trong UA để tránh các account giống nhau 100%.
 * Ví dụ: Firefox/133.0 → Firefox/133.1 (hoặc 132.9)
 */
function tweakUserAgentVersion(userAgent: unknown): string {
    const ua = userAgent != null ? String(userAgent) : '';
    if (!ua) return ua;
    const bump = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2)); // ±1..2
    // Firefox
    const ff = ua.match(/Firefox\/(\d+)\.(\d+)/);
    if (ff) {
        const major = Number(ff[1]);
        const minor = Math.max(0, Number(ff[2]) + bump);
        return ua.replace(/Firefox\/\d+\.\d+/, `Firefox/${major}.${minor}`);
    }
    // Chrome (giữ major, tăng/giảm patch)
    const ch = ua.match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/);
    if (ch) {
        const a = Number(ch[1]);
        const b = Number(ch[2]);
        const c = Number(ch[3]);
        const d = Math.max(0, Number(ch[4]) + bump);
        return ua.replace(/Chrome\/\d+\.\d+\.\d+\.\d+/, `Chrome/${a}.${b}.${c}.${d}`);
    }
    return ua;
}

export class AccountManager {
    private sessionsDir: string;

    constructor(sessionsDir?: string) {
        this.sessionsDir = sessionsDir || path.join(app.getPath('userData'), 'sessions');
        if (!fs.existsSync(this.sessionsDir)) {
            fs.mkdirSync(this.sessionsDir, { recursive: true });
        }
    }

    /**
     * Thêm tài khoản: Mở phương thức login bằng QR code, sau khi thành công 
     * thì lưu thông tin đăng nhập vào một file trong thư mục sessions/
     */
    public async addAccount(onQrCode?: (qrUrl: string) => void): Promise<void> {
        const zalo = new Zalo(createZaloSessionOptions(imageMetadataGetter));
        console.log("Đang lấy mã QR đăng nhập...");

        return new Promise(async (resolve, reject) => {
            let capturedCredentials: any = null;
            let capturedName: string = "Zalo User";
            try {
                // QUAN TRỌNG: imei/userAgent phải nhất quán với cookie/session do loginQR tạo ra.
                // Vì vậy, chỉ random hóa ngay từ lúc khởi tạo QR (đầu vào), KHÔNG sửa imei/userAgent sau khi đã login thành công.
                const seededImei = mutateImeiTail(generateImei15(), 6);
                const seededUA = tweakUserAgentVersion(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0"
                );
                const api = await zalo.loginQR(
                    { userAgent: seededUA, language: 'vi' },
                    (event: any) => {
                        if (event.type === 0) { // QRCodeGenerated
                            if (onQrCode) onQrCode(event.data.image);
                            console.log("Mã QR đã được trả về giao diện. Vui lòng quét trên app.");
                        } else if (event.type === 1) { // QRCodeExpired
                            console.log("QR Code đã hết hạn! Vui lòng làm lại.");
                        } else if (event.type === 2) { // QRCodeScanned
                            capturedName = event.data?.display_name || "Zalo User";
                            console.log("Đang chờ xác nhận quét QR... Xin chào, " + capturedName);
                        } else if (event.type === 4) { // GotLoignInfo
                            capturedCredentials = event.data;
                            console.log("Quét thành công! Đang hoàn tất đăng nhập...");
                        }
                    }
                );

                const ctx = (api as any).ctx;
                const credentials = capturedCredentials || {
                    imei: ctx?.imei,
                    cookie: ctx?.cookie?.toJSON ? ctx.cookie.toJSON().cookies : ctx?.cookie,
                    userAgent: ctx?.userAgent
                };
                // Nếu credential event không có imei (hiếm), fallback về imei seed dùng lúc tạo QR.
                if (!credentials.imei || String(credentials.imei).trim() === '') {
                    credentials.imei = seededImei;
                }
                // Nếu userAgent rỗng, fallback về UA seed dùng lúc tạo QR.
                if (!credentials.userAgent || String(credentials.userAgent).trim() === '') {
                    credentials.userAgent = seededUA;
                }

                credentials.userName = capturedName;

                const timestamp = Date.now();
                const sessionFile = path.join(this.sessionsDir, `account_${timestamp}.json`);
                fs.writeFileSync(sessionFile, JSON.stringify(credentials, null, 2), 'utf-8');

                console.log(`Đã lưu phiên đăng nhập vào tài khoản: ${sessionFile}`);
                resolve();
            } catch (error) {
                console.error("Lỗi khi thêm tài khoản qua QR:", error);
                reject(error);
            }
        });
    }

    /**
     * Đăng nhập lại: Đọc tất cả các file trong thư mục sessions/ 
     * và khởi tạo lại các instance Zalo từ credential đó.
     */
    public async restoreSessions(): Promise<{ filename: string; api: API; name?: string }[]> {
        const activeSessions: { filename: string; api: API; name?: string }[] = [];
        const files = fs.readdirSync(this.sessionsDir);
        const imeiOwner = new Map<string, string>();

        for (const file of files) {
            if (file.endsWith('.json') || file.endsWith('.txt')) {
                const filePath = path.join(this.sessionsDir, file);
                try {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    const credentials = JSON.parse(content);

                    const imeiStr = credentials?.imei != null ? String(credentials.imei).trim() : '';
                    if (imeiStr) {
                        if (imeiOwner.has(imeiStr)) {
                            console.warn(
                                `[Cảnh báo] Trùng imei giữa ${imeiOwner.get(imeiStr)} và ${file}. Không tự đổi imei vì sẽ làm session mất hiệu lực.`
                            );
                        } else {
                            imeiOwner.set(imeiStr, file);
                        }
                    }

                    const zalo = new Zalo(createZaloSessionOptions(imageMetadataGetter));
                    const api = await zalo.login({
                        ...credentials,
                        language: credentials.language ?? 'vi',
                    });
                    
                    let name = credentials.userName;
                    if (!name || name === "Zalo User") {
                        try {
                            const myUid = (api as any).ctx.uid;
                            if (myUid) {
                                const myInfo = await (api as any).getUserInfo(myUid);
                                if (myInfo && myInfo.changed_profiles && myInfo.changed_profiles[myUid]) {
                                    name = myInfo.changed_profiles[myUid].displayName || myInfo.changed_profiles[myUid].zaloName;
                                    credentials.userName = name;
                                    fs.writeFileSync(filePath, JSON.stringify(credentials, null, 2), 'utf-8');
                                    console.log(`[Cập nhật Tên] Đã lấy được tên thật cho ${file}: ${name}`);
                                }
                            }
                        } catch (e) {
                            console.log(`[Cảnh báo] Không thể lấy profile cho session cũ ${file}`);
                        }
                    }
                    
                    activeSessions.push({ 
                        filename: file, 
                        api,
                        name: name || "Zalo User" 
                    });
                    console.log(`[Khôi phục] Đăng nhập lại thành công từ file: ${file}`);
                } catch (error: any) {
                    console.error(`[Khôi phục] Lỗi phiên từ file ${file}:`, error.message);
                }
            }
        }
        return activeSessions;
    }

    /**
     * Xóa/Đăng xuất tài khoản: Nhận vào tên file session, gọi API logout 
     * và xóa file đó khỏi thư mục.
     */
    public async removeSession(filename: string, activeApi?: API): Promise<void> {
        const filePath = path.join(this.sessionsDir, filename);

        // Gọi API logout nếu đang truyền instance và có hỗ trợ logout
        if (activeApi && typeof (activeApi as any).logout === 'function') {
            try {
                await (activeApi as any).logout();
                console.log(`Đã gọi yêu cầu logout cho phiên: ${filename}`);
            } catch (error: any) {
                console.error(`Lỗi api logout cho phiên ${filename}:`, error.message);
            }
        }

        // Xóa file khỏi thư mục sessions/
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`Đã xoá file session: ${filename}`);
        } else {
            console.warn(`Không tìm thấy file session: ${filename}`);
        }
    }
}
