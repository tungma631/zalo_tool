const { Zalo, ThreadType } = require('zca-js');
const fs = require('fs');
const { imageSize } = require('image-size');
const EventEmitter = require('events');
const path = require('path');

class ZaloManager extends EventEmitter {
    constructor(userDataPath) { 
        super();
        this.api = null;
        
        // Sử dụng đường dẫn từ AppData để có quyền ghi khi build .exe
        this.basePath = userDataPath; 
        this.credentialsPath = path.join(this.basePath, 'credentials.json');
        this.configPath = path.join(this.basePath, 'config.json');
        this.cookiePath = path.join(this.basePath, 'cookies.json');
        this.qrPath = path.join(this.basePath, 'qr.png');

        this.zalo = new Zalo({
            cookiePath: this.cookiePath,
            selfListen: true
        });

        this.masterQueue = {};
        this.groupNames = {}; 
        this.globalQueue = []; 
        this.isProcessingGlobalQueue = false;

        // Tải cấu hình từ AppData
        this.config = { SOURCE_GROUP_IDS: [], DESTINATION_GROUP_IDS: [] };
        if (fs.existsSync(this.configPath)) {
            try { 
                this.config = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); 
            } catch (e) {
                console.error("Lỗi đọc config:", e);
            }
        }
    }

    log(message) {
        console.log(message);
        this.emit('log', message);
    }

    saveConfig(sourceIds, destIds) {
        this.config.SOURCE_GROUP_IDS = sourceIds || [];
        this.config.DESTINATION_GROUP_IDS = destIds || [];
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        this.log(`=> Đã cập nhật cấu hình Nhóm Nguồn và Đích.`);
    }

    async getGroups() {
        if (!this.api) return [];
        try {
            const groupsResp = await this.api.getAllGroups();
            const result = [];
            if (groupsResp && groupsResp.gridVerMap) {
                const groupIds = Object.keys(groupsResp.gridVerMap);
                for (let i = 0; i < groupIds.length; i += 50) {
                    const chunk = groupIds.slice(i, i + 50);
                    const infoResp = await this.api.getGroupInfo(chunk);
                    if (infoResp && infoResp.gridInfoMap) {
                        for (const [id, info] of Object.entries(infoResp.gridInfoMap)) {
                            const name = info.name || 'Không rõ';
                            this.groupNames[id] = name;
                            result.push({ id, name });
                        }
                    }
                }
            }
            return result;
        } catch (err) {
            this.log(`=> Lỗi lấy danh sách nhóm: ${err.message}`);
            return [];
        }
    }

    async logout() {
        if (fs.existsSync(this.credentialsPath)) fs.unlinkSync(this.credentialsPath);
        if (fs.existsSync(this.cookiePath)) fs.unlinkSync(this.cookiePath);
        this.api = null;
        this.log("=> Đã đăng xuất và xóa phiên làm việc.");
        this.emit('logged_out');
    }

    async login() {
        // 1. Thử đăng nhập bằng phiên cũ
        if (fs.existsSync(this.credentialsPath)) {
            try {
                this.log("Đang kiểm tra phiên đăng nhập cũ...");
                const creds = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
                this.api = await this.zalo.login(creds);
                this.log("=> Đăng nhập thành công!");
                this.emit('login_success');
                this.startListener();
                return true;
            } catch (error) {
                this.log("Phiên đăng nhập hết hạn. Đang chuẩn bị tạo mã QR mới...");
            }
        }

        // 2. Nếu không có phiên hoặc hết hạn -> Quét mã QR
        return await this.generateNewQR();
    }

// Tìm hàm generateNewQR trong zaloService.js và thay thế bằng đoạn này:
    async generateNewQR() {
        try {
            // Xóa file QR cũ nếu có
            if (fs.existsSync(this.qrPath)) fs.unlinkSync(this.qrPath);
            // Trong môi trường dev, zca-js có thể tạo file ở thư mục gốc, ta xóa luôn cho chắc
            const devQR = path.join(process.cwd(), 'qr.png');
            if (fs.existsSync(devQR)) fs.unlinkSync(devQR);

            const qrCheckInterval = setInterval(() => {
                // Kiểm tra cả 2 nơi: AppData và thư mục gốc project (cho bản Dev)
                const targetPath = fs.existsSync(this.qrPath) ? this.qrPath : (fs.existsSync(devQR) ? devQR : null);

                if (targetPath) {
                    try {
                        // Đọc file và chuyển sang Base64
                        const imageBuffer = fs.readFileSync(targetPath);
                        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
                        
                        this.emit('qr_ready', base64Image); // Gửi chuỗi Base64 thay vì path
                        this.log("=> Đã tìm thấy mã QR.");
                        clearInterval(qrCheckInterval);
                    } catch (e) {
                        this.log("Lỗi xử lý ảnh QR: " + e.message);
                    }
                }
            }, 1000);

            this.log("=> Đang yêu cầu mã QR từ Zalo...");
            this.api = await this.zalo.loginQR();
            
            clearInterval(qrCheckInterval);

            const ctx = this.api.getContext();
            const credentialsToSave = {
                imei: ctx.imei,
                cookie: ctx.cookie.toJSON ? ctx.cookie.toJSON().cookies : ctx.cookie,
                userAgent: ctx.userAgent,
                language: ctx.language
            };
            fs.writeFileSync(this.credentialsPath, JSON.stringify(credentialsToSave, null, 2));
            
            this.emit('login_success');
            this.startListener();
            return true;

        } catch (err) {
            this.log("=> Mã QR đã hết hạn hoặc có lỗi. Đang khởi tạo lại...");
            return await this.generateNewQR(); 
        }
    }

    startListener() {
        if (!this.api) return;

        this.api.listener.on("message", (message) => {
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

                if (typeof content === "string") {
                    this.masterQueue[threadId].items.push({ type: 'text', data: content, timestamp });
                    inserted = true;
                }
                else if (msgType === "chat.photo") {
                    let imgUrl = content.href;
                    if (content.params) {
                        try {
                            const paramsObj = JSON.parse(content.params);
                            if (paramsObj.hd) imgUrl = paramsObj.hd;
                        } catch (e) {}
                    }
                    if (imgUrl && imgUrl.startsWith("http")) {
                        // Tải ảnh ngầm để tối ưu tốc độ
                        const promise = fetch(imgUrl)
                            .then(async res => {
                                if (!res.ok) throw new Error(res.status);
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

                    // Chờ 60 giây im lặng để gom đơn hàng
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

        this.api.listener.on("connected", () => this.log("=> Hệ thống đang trực tuyến..."));
        this.api.listener.on("error", (e) => this.log("=> Lỗi kết nối: " + e.message));
        this.api.listener.start({ retryOnClose: true });
    }

    async processGlobalQueue() {
        if (this.isProcessingGlobalQueue || this.globalQueue.length === 0) return;

        this.isProcessingGlobalQueue = true;

        while (this.globalQueue.length > 0) {
            const job = this.globalQueue.shift();
            const threadId = job.sourceThreadId;
            const itemsToProcess = job.items.sort((a, b) => a.timestamp - b.timestamp);

            let currentPhotoPromises = [];
            let lastPhotoTimestamp = 0;

            const flushPhotos = async () => {
                if (currentPhotoPromises.length === 0) return;
                const buffers = (await Promise.all(currentPhotoPromises)).filter(b => b !== null);
                currentPhotoPromises = [];
                
                if (buffers.length === 0) return;

                const attachmentsArray = [];
                for (const buffer of buffers) {
                    try {
                        const dims = imageSize(buffer);
                        attachmentsArray.push({
                            data: buffer,
                            filename: `img_${Date.now()}.jpg`,
                            metadata: { totalSize: buffer.length, width: dims.width || 1080, height: dims.height || 1080 }
                        });
                    } catch (e) {}
                }

                if (attachmentsArray.length > 0) {
                    for (const destId of this.config.DESTINATION_GROUP_IDS) {
                        await this.api.sendMessage({ msg: "", attachments: attachmentsArray }, destId, ThreadType.Group);
                        this.log(`=> Đã chuyển tiếp Album (${attachmentsArray.length} ảnh)`);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }
            };

            for (const item of itemsToProcess) {
                if (item.type === 'photo') {
                    // Tự động tách cụm ảnh nếu gửi cách nhau quá 5 giây
                    if (currentPhotoPromises.length > 0 && (item.timestamp - lastPhotoTimestamp > 5000)) {
                        await flushPhotos();
                    }
                    currentPhotoPromises.push(item.promise);
                    lastPhotoTimestamp = item.timestamp;
                } else if (item.type === 'text') {
                    await flushPhotos(); 
                    for (const destId of this.config.DESTINATION_GROUP_IDS) {
                        await this.api.sendMessage(item.data, destId, ThreadType.Group);
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    this.log(`=> Đã chuyển tiếp tin nhắn chữ.`);
                }
            }
            await flushPhotos();
        }
        this.isProcessingGlobalQueue = false;
    }
}

module.exports = ZaloManager;