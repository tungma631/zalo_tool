require('dotenv').config();
const { Zalo, ThreadType } = require('zca-js');
const https = require('https');
const { imageSize } = require('image-size');

const SOURCE_GROUP_IDS = (process.env.GROUP_A_ID || "").split(',').map(s => s.trim()).filter(Boolean);
const DESTINATION_GROUP_IDS = (process.env.GROUP_B_ID || "").split(',').map(s => s.trim()).filter(Boolean);

const zalo = new Zalo({
    cookiePath: './cookies.json',
    selfListen: true // Cho phép lắng nghe tin nhắn của chính mình
});

async function main() {
    const fs = require('fs');

    // Xử lý cờ đăng xuất
    if (process.argv.includes('--logout')) {
        if (fs.existsSync('./credentials.json')) {
            fs.unlinkSync('./credentials.json');
            console.log("Đã xoá phiên đăng nhập cũ (credentials.json). Bạn sẽ quét mã để đăng nhập lại.");
        }
    }

    console.log("Đang khởi tạo Zalo...");

    let api;
    let loginSuccess = false;

    // 1. Thử dùng session cũ trước
    if (fs.existsSync('./credentials.json')) {
        try {
            console.log("Tìm thấy thông tin đăng nhập cũ, đang thử đăng nhập...");
            const creds = JSON.parse(fs.readFileSync('./credentials.json', 'utf8'));
            api = await zalo.login(creds);
            loginSuccess = true;
            console.log("=> Đăng nhập lại qua cookie thành công!");
        } catch (error) {
            console.log("Phiên đăng nhập cũ đã hết hạn hoặc không hợp lệ. Chuẩn bị quét mã mới...");
        }
    }

    // 2. Fallback sang quét mã QR nếu chưa có session hoặc session lỗi
    if (!loginSuccess) {
        try {
            api = await zalo.loginQR();
            console.log("=> Quét mã thành công, đang lưu phiên đăng nhập cho lần chạy sau...");
            
            // Trích xuất credentials
            const ctx = api.getContext();
            const credentialsToSave = {
                imei: ctx.imei,
                cookie: ctx.cookie.toJSON ? ctx.cookie.toJSON().cookies : ctx.cookie,
                userAgent: ctx.userAgent,
                language: ctx.language
            };
            
            fs.writeFileSync('./credentials.json', JSON.stringify(credentialsToSave, null, 2));
            console.log("=> Đã lưu phiên đăng nhập vào credentials.json");

        } catch (err) {
            console.error("Lỗi đăng nhập/quét mã:", err);
            return;
        }
    }

    console.log(`\n=> Cấu hình ${SOURCE_GROUP_IDS.length} Nhóm Nguồn (A): [${SOURCE_GROUP_IDS.join(', ')}]`);
    console.log(`=> Cấu hình ${DESTINATION_GROUP_IDS.length} Nhóm Đích  (B): [${DESTINATION_GROUP_IDS.join(', ')}]`);

    console.log("\n--- BẮT ĐẦU THU THẬP DANH SÁCH NHÓM ---");
    try {
        const groupsResp = await api.getAllGroups();
        if (groupsResp && groupsResp.gridVerMap) {
            const groupIds = Object.keys(groupsResp.gridVerMap);
            console.log(`=> Đang lấy file thông tin tên của ${groupIds.length} nhóm. Vui lòng đợi...`);

            for (let i = 0; i < groupIds.length; i += 50) {
                const chunk = groupIds.slice(i, i + 50);
                const infoResp = await api.getGroupInfo(chunk);

                if (infoResp && infoResp.gridInfoMap) {
                    for (const [id, info] of Object.entries(infoResp.gridInfoMap)) {
                        console.log(`[Nhóm] Tên: ${info.name || 'Không rõ'} | ID: ${id}`);
                    }
                }
            }
        }
    } catch (err) {
        console.log("Không thể quét danh sách nhóm:", err.message);
    }

    console.log("\n--- BẮT ĐẦU LẮNG NGHE TIN NHẮN ---");

    // Hàng chờ chung cho tất cả các loại tin nhắn
    const masterQueue = {};

    api.listener.on("message", (message) => {
        const threadId = String(message.threadId);
        console.log(`\n[DEBUG] Nhận được tin nhắn từ ID: ${threadId}`);

        if (SOURCE_GROUP_IDS.includes(threadId)) {
            console.log(`\n>>> [NHÓM A - ${threadId}] Phát hiện tin nhắn mới từ: ${message?.data?.dName || 'Không rõ'}`);

            const content = message.data.content;
            const msgType = message.data.msgType;

            // Khởi tạo hàng chờ nếu chưa có
            if (!masterQueue[threadId]) {
                masterQueue[threadId] = { timer: null, items: [] };
            }

            let inserted = false;

            // 1. CHỮ
            if (typeof content === "string") {
                masterQueue[threadId].items.push({ type: 'text', data: content });
                inserted = true;
            }
            // 2. HÌNH ẢNH
            else if (msgType === "chat.photo") {
                let imgUrl = content.href;
                if (content.params) {
                    try {
                        const paramsObj = JSON.parse(content.params);
                        if (paramsObj.hd) imgUrl = paramsObj.hd;
                    } catch (e) { }
                }
                if (imgUrl && imgUrl.startsWith("http")) {
                    masterQueue[threadId].items.push({ type: 'photo', data: imgUrl });
                    inserted = true;
                }
            } 
            // 3. KHÁC
            else {
                console.log(`=> Loại tin nhắn [${msgType}] hiện tại chưa hỗ trợ chuyển tiếp.`);
            }

            if (inserted) {
                console.log(`=> Đã đưa vào Hàng đợi chung. Quá trình chuyển tiếp sẽ bắt đầu sau 3 giây yên tĩnh...`);
                // Debounce timer: chờ 3 giây sau tin nhắn CUỐI CÙNG mới bắt đầu xử lý tuần tự
                if (masterQueue[threadId].timer) clearTimeout(masterQueue[threadId].timer);

                masterQueue[threadId].timer = setTimeout(async () => {
                    const itemsToProcess = [...masterQueue[threadId].items];
                    // Reset queue
                    masterQueue[threadId].items = [];
                    masterQueue[threadId].timer = null;

                    console.log(`\n=> BẮT ĐẦU XỬ LÝ TUẦN TỰ ${itemsToProcess.length} TIN NHẮN TRONG HÀNG ĐỢI...`);

                    // Hàm tải 1 ảnh
                    const downloadImage = (url) => new Promise((resolve, reject) => {
                        https.get(url, (res) => {
                            const dataChunks = [];
                            res.on('data', chunk => dataChunks.push(chunk));
                            res.on('end', () => resolve(Buffer.concat(dataChunks)));
                        }).on('error', reject);
                    });

                    // Khối gom ảnh liên tiếp
                    let currentPhotoBatch = [];

                    // Hàm phụ gửi khối ảnh hiện tại đi
                    const flushPhotos = async () => {
                        if (currentPhotoBatch.length === 0) return;
                        const urls = currentPhotoBatch;
                        currentPhotoBatch = []; // Reset batch
                        
                        console.log(`=> \tĐang tải và gửi ${urls.length} ảnh chuyển tiếp thành khối...`);
                        try {
                            const buffers = await Promise.all(urls.map(url => downloadImage(url)));
                            const attachmentsArray = buffers.map((buffer, index) => {
                                let dims = { width: 0, height: 0 };
                                try { dims = imageSize(buffer); } catch (e) {}

                                return {
                                    data: buffer,
                                    filename: `image_${index}.jpg`,
                                    metadata: { 
                                        totalSize: buffer.length,
                                        width: dims.width || 1080,
                                        height: dims.height || 1080
                                    }
                                };
                            });

                            for (const destId of DESTINATION_GROUP_IDS) {
                                await api.sendMessage({
                                    msg: "", // Không có text kèm theo
                                    attachments: attachmentsArray
                                }, destId, ThreadType.Group);
                                console.log(`=> \tChuyển tiếp khối (${attachmentsArray.length} hình ảnh) đến nhóm [${destId}] thành công!`);

                                // Tạo delay nhẹ giữa các lần gửi cho mượt
                                await new Promise(r => setTimeout(r, 1000));
                            }
                        } catch (err) {
                            console.log("=> \tLỗi tải hoặc gửi khối ảnh:", err.message || err);
                        }
                    };

                    // Diệt tuần tự các lệnh trong hàng chờ
                    for (const item of itemsToProcess) {
                        if (item.type === 'photo') {
                            currentPhotoBatch.push(item.data);
                        } else if (item.type === 'text') {
                            // Gặp chữ thì xả ngay đống ảnh gom được trước đó (nếu có)
                            await flushPhotos();

                            console.log(`=> \tGửi nội dung chữ: ${item.data.substring(0, 50)}...`);
                            try {
                                for (const destId of DESTINATION_GROUP_IDS) {
                                    await api.sendMessage(item.data, destId, ThreadType.Group);
                                    console.log(`=> \tChuyển tiếp chữ đến nhóm [${destId}] thành công!`);
                                    await new Promise(r => setTimeout(r, 1000));
                                }
                            } catch (err) {
                                console.log("=> \tLỗi gửi chữ:", err.message || err);
                            }
                        }
                    }

                    // Xả nốt ảnh ở phần cuối hàng chờ nếu mảng ảnh nằm ở cuối cùng chưa gửi
                    await flushPhotos();
                    console.log(`=> HOÀN TẤT XỬ LÝ HÀNG ĐỢI CỦA THREAD ${threadId}.\n`);

                }, 3000); 
            }
        }
    });

    api.listener.on("connected", () => console.log("\n=> EVENT: Listener đã kết nối thành công!"));
    api.listener.on("closed", (code, reason) => console.log(`=> EVENT: Listener bị đóng (${code}: ${reason})`));
    api.listener.on("disconnected", (code, reason) => console.log(`=> EVENT: Listener ngắt kết nối (${code}: ${reason})`));
    api.listener.on("error", (e) => console.error("=> EVENT: Listener LỖI:", e));

    api.listener.start({ retryOnClose: true });
}

main().catch(console.error);
