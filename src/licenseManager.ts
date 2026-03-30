import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { machineIdSync } from 'node-machine-id';

const LICENSE_API = 'https://script.google.com/macros/s/AKfycbwUlOP7EikXC38xbuDyPM0dgDfIcqRB1yFOT37XVMrdgwlcQqeYYLTE8-ZEf9aPTE8Z/exec';

export class LicenseManager {
    public isLicensed = false;
    private licensePath: string;
    public hwid: string = '';
    public currentKey: string = '';
    public expiryDate: string = '';

    constructor() {
        this.licensePath = path.join(app.getPath('userData'), 'license.json');
        this.hwid = this.getWindowsHWID();
    }

    private getWindowsHWID(): string {
        try {
            return machineIdSync();
        } catch (e: any) {
            console.error("Lỗi lấy mã máy:", e.message);
            return 'ERROR_HWID';
        }
    }

    public async checkSavedLicense(): Promise<{valid: boolean, message: string}> {
        if (!fs.existsSync(this.licensePath)) {
            return { valid: false, message: "Chưa kích hoạt License Key" };
        }
        try {
            const data = JSON.parse(fs.readFileSync(this.licensePath, 'utf8'));
            if (!data.key) return { valid: false, message: "License file hỏng" };
            return await this.validateKey(data.key);
        } catch (e) {
            return { valid: false, message: "Lỗi file bản quyền." };
        }
    }

    public async validateKey(key: string): Promise<{valid: boolean, message: string}> {
        try {
            // Chuyển sang dùng GET để vượt rào tường lửa 302 Redirect của Google một cách mượt mà nhất
            const url = new URL(LICENSE_API);
            url.searchParams.append('action', 'validate');
            url.searchParams.append('key', key);
            url.searchParams.append('hwid', this.hwid);

            const res = await fetch(url.toString(), {
                method: 'GET'
            });

            const bodyStr = await res.text();
            let json;
            try {
                json = JSON.parse(bodyStr);
            } catch (e) {
                console.error("Raw Response từ Google:", bodyStr.substring(0, 500));
                return { valid: false, message: "API Server trả về sai định dạng (Vui lòng bấm F12 xem thông báo lỗi ở Terminal)." };
            }

            if (json.success) {
                this.isLicensed = true;
                this.currentKey = key;
                this.expiryDate = json.expiry || "Vĩnh viễn";
                
                // Lưu cache lại key ở máy người dùng
                fs.writeFileSync(this.licensePath, JSON.stringify({ key }));
                return { valid: true, message: json.message };
            } else {
                this.isLicensed = false;
                if (fs.existsSync(this.licensePath)) fs.unlinkSync(this.licensePath);
                return { valid: false, message: json.message };
            }
        } catch (e: any) {
            this.isLicensed = false;
            return { valid: false, message: "Lỗi kết nối Server Kiểm Tuyến: " + e.message };
        }
    }

    public startPeriodicCheck(window: any) {
        // Tuần tra giám sát mỗi 6 tiếng = 6 * 60 * 60 * 1000
        setInterval(async () => {
            if (!this.isLicensed || !this.currentKey) return;
            try {
                // Background Check
                const res = await this.validateKey(this.currentKey);
                if (!res.valid) {
                    // Nếu phát hiện Banned hoặc hết ngày
                    this.isLicensed = false;
                    if(window && !window.isDestroyed()) {
                        window.webContents.send('license-expired', res.message);
                    }
                }
            } catch(e) { /* Lỗi mạng thì im lặng giữ nguyên trạng thái cũ */ }
        }, 6 * 60 * 60 * 1000);
    }
}
