import { Zalo, ThreadType } from 'zca-js';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { createZaloSessionOptions } from './zaloSessionOptions';

export class ZaloForwarder extends EventEmitter {
    public api: any = null;
    public basePath: string;
    public credentialsPath: string;
    public configPath: string;
    public cookiePath: string;
    public qrPath: string;

    private zalo: Zalo;
    private masterQueue: Record<string, { timer: NodeJS.Timeout | null, items: any[] }> = {};
    private groupNames: Record<string, string> = {};
    private globalQueue: { sourceThreadId: string, items: any[] }[] = [];
    private isProcessingGlobalQueue = false;

    public config: { SOURCE_GROUP_IDS: string[], DESTINATION_GROUP_IDS: string[] } = { SOURCE_GROUP_IDS: [], DESTINATION_GROUP_IDS: [] };

    constructor(userDataPath: string) {
        super();
        this.basePath = userDataPath;
        if (!fs.existsSync(this.basePath)) {
            fs.mkdirSync(this.basePath, { recursive: true });
        }

        this.credentialsPath = path.join(this.basePath, 'credentials.json');
        this.configPath = path.join(this.basePath, 'config.json');
        this.cookiePath = path.join(this.basePath, 'cookies.json');
        this.qrPath = path.join(this.basePath, 'qr.png');

        // Reuse the secure custom context to avoid cookie bleeding
        const sessionOpts = createZaloSessionOptions(async (fp) => {
            const buf = await fs.promises.readFile(fp);
            const m = await sharp(buf).metadata();
            return { width: m.width || 0, height: m.height || 0, size: buf.length };
        });
        
        this.zalo = new Zalo({
            ...sessionOpts,
            selfListen: true
        });

        if (fs.existsSync(this.configPath)) {
            try {
                this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            } catch (e) {
                console.error("Lỗi đọc config forwarder:", e);
            }
        }
    }

    log(message: string) {
        console.log("[Forwarder]", message);
        this.emit('log', message);
    }

    saveConfig(sourceIds: string[], destIds: string[]) {
        this.config.SOURCE_GROUP_IDS = sourceIds || [];
        this.config.DESTINATION_GROUP_IDS = destIds || [];
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        this.log(`=> Đã cập nhật cấu hình Nhóm Nguồn và Đích.`);
    }

    async getGroups() {
        if (!this.api) return [];
        try {
            const groupsResp = await this.api.getAllGroups();
            const result: { id: string, name: string }[] = [];
            if (groupsResp && groupsResp.gridVerMap) {
                const groupIds = Object.keys(groupsResp.gridVerMap);
                for (let i = 0; i < groupIds.length; i += 50) {
                    const chunk = groupIds.slice(i, i + 50);
                    const infoResp = await this.api.getGroupInfo(chunk);
                    if (infoResp && infoResp.gridInfoMap) {
                        for (const [id, info] of Object.entries(infoResp.gridInfoMap)) {
                            const name = (info as any).name || 'Không rõ';
                            this.groupNames[id] = name;
                            result.push({ id, name });
                        }
                    }
                }
            }
            return result;
        } catch (err: any) {
            this.log(`=> Lỗi lấy danh sách nhóm: ${err.message}`);
            return [];
        }
    }

    async logout() {
        if (fs.existsSync(this.credentialsPath)) fs.unlinkSync(this.credentialsPath);
        if (fs.existsSync(this.cookiePath)) fs.unlinkSync(this.cookiePath);
        this.api = null;
        this.log("=> Đã đăng xuất khỏi máy chủ chuyển tiếp.");
        this.emit('logged_out');
    }

    async login() {
        if (fs.existsSync(this.credentialsPath)) {
            try {
                this.log("Đang kiểm tra phiên đăng nhập cũ...");
                const creds = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
                this.api = await this.zalo.login(creds);
                this.log("=> Đăng nhập thành công!");
                this.emit('login_success');
                this.startListener();
                return true;
            } catch (error: any) {
                this.log(`Phiên đăng nhập hết hạn (${error.message}). Đang chuẩn bị tạo mã QR mới...`);
            }
        }

        return await this.generateNewQR();
    }

    async generateNewQR(): Promise<boolean> {
        try {
            this.log("=> Đang yêu cầu mã QR từ Zalo...");
            let capturedCredentials: any = null;
            const tempApi = await this.zalo.loginQR(
                { language: 'vi' },
                (event: any) => {
                    if (event.type === 0) { // QRCodeGenerated
                        this.emit('qr_ready', event.data.image);
                        this.log("=> Đã tìm thấy mã QR.");
                    } else if (event.type === 1) { // QRCodeExpired
                        this.log("=> Mã QR đã hết hạn. Hệ thống sẽ tự tải lại...");
                    } else if (event.type === 2) { // QRCodeScanned
                        this.log("=> Đang chờ xác nhận quét QR...");
                    } else if (event.type === 4) { // GotLoginInfo
                        capturedCredentials = event.data;
                        this.log("=> Quét thành công! Đang hoàn tất đăng nhập...");
                    }
                }
            );

            if (tempApi) this.api = tempApi;
            
            const ctx = (this.api as any).ctx;
            const credentialsToSave = capturedCredentials || {
                imei: ctx?.imei,
                cookie: ctx?.cookie?.toJSON ? ctx.cookie.toJSON().cookies : ctx?.cookie,
                userAgent: ctx?.userAgent,
                language: ctx?.language
            };
            
            if (!credentialsToSave.imei && ctx?.imei) credentialsToSave.imei = ctx.imei;
            if (!credentialsToSave.userAgent && ctx?.userAgent) credentialsToSave.userAgent = ctx.userAgent;

            fs.writeFileSync(this.credentialsPath, JSON.stringify(credentialsToSave, null, 2));
            
            this.emit('login_success');
            this.startListener();
            return true;
        } catch (err: any) {
            this.log(`=> Lỗi quét QR (${err.message}). Đang khởi tạo lại...`);
            // Chống loop vô hạn trong thời gian ngắn (tuỳ chọn add sleep)
            await new Promise(r => setTimeout(r, 2000));
            return await this.generateNewQR(); 
        }
    }

    startListener() {
        if (!this.api) return;

        this.api.listener.on("message", (message: any) => {
            const threadId = String(message.threadId);

            if (this.config.SOURCE_GROUP_IDS.includes(threadId)) {
                const groupName = this.groupNames[threadId] || threadId;
                this.log(`\n>>> [NGUỒN: ${groupName}] Tin nhắn từ ${message?.data?.dName || 'Ẩn danh'}`);

                const content = message.data.content;
                const msgType = message.data.msgType;
                const timestamp = message.timestamp || Date.now();

                if (!this.masterQueue[threadId]) {
                    this.masterQueue[threadId] = { timer: null, items: [] };
                }

                let inserted = false;

                if (typeof content === "string" && content.trim() !== "") {
                    this.masterQueue[threadId].items.push({ type: 'text', data: content, timestamp });
                    inserted = true;
                }
                else if (msgType === "chat.photo" && content && content.href) {
                    let imgUrl = content.href;
                    if (content.params) {
                        try {
                            const paramsObj = JSON.parse(content.params);
                            if (paramsObj.hd) imgUrl = paramsObj.hd;
                        } catch (e) {}
                    }
                    if (imgUrl && imgUrl.startsWith("http")) {
                        const promise = fetch(imgUrl)
                            .then(async res => {
                                if (!res.ok) throw new Error(String(res.status));
                                const arrayBuffer = await res.arrayBuffer();
                                return Buffer.from(arrayBuffer);
                            })
                            .catch(err => {
                                this.log("=> Lỗi tải ảnh: " + err.message);
                                return null;
                            });

                        this.masterQueue[threadId].items.push({ type: 'photo', promise, timestamp });
                        inserted = true;
                    }
                }

                if (inserted) {
                    if (this.masterQueue[threadId].timer) clearTimeout(this.masterQueue[threadId].timer);

                    this.masterQueue[threadId].timer = setTimeout(() => {
                        const itemsToProcess = [...this.masterQueue[threadId].items];
                        this.masterQueue[threadId].items = [];
                        this.masterQueue[threadId].timer = null;

                        if (itemsToProcess.length > 0) {
                            this.globalQueue.push({ sourceThreadId: threadId, items: itemsToProcess });
                            this.processGlobalQueue();
                        }
                    }, 60000); 
                }
            }
        });

        this.api.listener.on("connected", () => this.log("=> Hệ thống (Chuyển tiếp) đang trực tuyến..."));
        this.api.listener.on("error", (e: any) => this.log("=> Lỗi kết nối Listener: " + e.message));
        this.api.listener.start({ retryOnClose: true });
    }

    async processGlobalQueue() {
        if (this.isProcessingGlobalQueue || this.globalQueue.length === 0) return;

        this.isProcessingGlobalQueue = true;

        while (this.globalQueue.length > 0) {
            const job = this.globalQueue.shift();
            if (!job) continue;
            
            const threadId = job.sourceThreadId;
            const itemsToProcess = job.items.sort((a, b) => a.timestamp - b.timestamp);

            let currentPhotoPromises: Promise<Buffer | null>[] = [];
            let lastPhotoTimestamp = 0;

            const flushPhotos = async () => {
                if (currentPhotoPromises.length === 0) return;
                const buffers = (await Promise.all(currentPhotoPromises)).filter((b): b is Buffer => b !== null);
                currentPhotoPromises = [];
                
                if (buffers.length === 0) return;

                const attachmentsArray: any[] = [];
                for (const buffer of buffers) {
                    try {
                        const dims = await sharp(buffer).metadata();
                        attachmentsArray.push({
                            data: buffer,
                            filename: `img_${Date.now()}.jpg`,
                            metadata: { totalSize: buffer.length, width: dims.width || 1080, height: dims.height || 1080 }
                        });
                    } catch (e) {}
                }

                if (attachmentsArray.length > 0) {
                    for (const destId of this.config.DESTINATION_GROUP_IDS) {
                        try {
                            await this.api.sendMessage({ msg: "", attachments: attachmentsArray }, destId, ThreadType.Group);
                            this.log(`=> Đã chuyển tiếp Album (${attachmentsArray.length} ảnh)`);
                            await new Promise(r => setTimeout(r, 1000));
                        } catch (e: any) {
                             this.log(`=> Lỗi chuyển Album: ${e.message}`);
                        }
                    }
                }
            };

            for (const item of itemsToProcess) {
                if (item.type === 'photo') {
                    if (currentPhotoPromises.length > 0 && (item.timestamp - lastPhotoTimestamp > 5000)) {
                        await flushPhotos();
                    }
                    currentPhotoPromises.push(item.promise);
                    lastPhotoTimestamp = item.timestamp;
                } else if (item.type === 'text') {
                    await flushPhotos(); 
                    for (const destId of this.config.DESTINATION_GROUP_IDS) {
                        try {
                            await this.api.sendMessage(item.data, String(destId), ThreadType.Group);
                            await new Promise(r => setTimeout(r, 1000));
                        } catch(e: any) {
                            this.log(`=> Lỗi chuyển gửi Text: ${e.message}`);
                        }
                    }
                    this.log(`=> Đã chuyển tiếp tin nhắn chữ.`);
                }
            }
            await flushPhotos();
        }
        this.isProcessingGlobalQueue = false;
    }
}
