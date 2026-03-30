// --- LỚP BẢO VỆ LICENSE ---
document.addEventListener('DOMContentLoaded', async () => {
    const hwidEl = document.getElementById('auth-hwid');
    const overlayInfo = document.getElementById('auth-overlay');
    const authLoading = document.getElementById('auth-loading-state');
    const authInput = document.getElementById('auth-input-state');
    
    const btnAct = document.getElementById('auth-btn-activate');
    const inputKey = document.getElementById('auth-key-input');
    const errorMsg = document.getElementById('auth-error-msg');
    
    // Đăng ký nhận còi báo giới nghiêm License từ hệ thống ngầm
    if(window.zaloAPI.onLicenseExpired) {
        window.zaloAPI.onLicenseExpired((msg) => {
            alert("⚠️ CẢNH BÁO BẢN QUYỀN:\n" + msg);
            
            // Đá người dùng về rào chắn
            if(overlayInfo) overlayInfo.style.display = 'flex';
            if(authLoading) authLoading.style.display = 'none';
            if(authInput) authInput.style.display = 'block';
            
            if(errorMsg) {
                errorMsg.innerText = msg || "Phiên đăng nhập đã quá hạn.";
                errorMsg.style.display = 'block';
            }
        });
    }

    // Lấy HWID
    const hwid = await window.zaloAPI.getHwid();
    if(hwidEl) hwidEl.innerText = hwid;

    // Kiểm tra trạng thái Key khi vừa mở app
    const status = await window.zaloAPI.getLicenseStatus();
    if (status.valid) {
        // Mượt mà tắt Overlay mà không nhá Khung nhập
        if(overlayInfo) overlayInfo.style.display = 'none';
        const info = await window.zaloAPI.getLicenseInfo();
        document.title = `Zalo Marketing Pro - (Licensed: ${info.key} | HSD: ${info.expiry})`;
        // Chạy khởi tạo Boot app sau khi đã mở khóa
        window.initZaloApp();
    } else {
        // Lệnh bị chối -> Tắt Spinner -> Hiện Form Nhập Key
        if(overlayInfo) overlayInfo.style.display = 'flex';
        if(authLoading) authLoading.style.display = 'none';
        if(authInput) authInput.style.display = 'block';
        
        if(errorMsg) {
            errorMsg.style.display = 'block';
            errorMsg.innerText = status.message || "Vui lòng nhập License Key để tiếp tục.";
        }
    }

    if(btnAct) {
        btnAct.addEventListener('click', async () => {
            const key = inputKey.value.trim();
            if(!key) {
                errorMsg.innerText = "Vui lòng nhập Key!"; return;
            }
            btnAct.disabled = true;
            btnAct.innerText = "Đang kết nối Server...";
            
            const res = await window.zaloAPI.validateLicense(key);
            if(res.valid) {
                overlayInfo.style.display = 'none';
                const info = await window.zaloAPI.getLicenseInfo();
                document.title = `Zalo Marketing Pro - (Licensed: ${info.key} | HSD: ${info.expiry})`;
                alert(`Kích hoạt thành công!\n${res.message}`);
                
                // Reload dữ liệu tài khoản và QR chuyển tiếp nếu bị block ban đầu
                window.initZaloApp();
            } else {
                errorMsg.innerText = res.message;
                errorMsg.style.display = 'block';
            }
            btnAct.disabled = false;
            btnAct.innerText = "Kích Hoạt";
        });
    }
});
// -----------------------------

// 1. Navigation Tabs
document.querySelectorAll('.nav li').forEach(li => {
    li.addEventListener('click', (e) => {
        document.querySelectorAll('.nav li').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(el => el.classList.add('hidden'));
        
        e.target.classList.add('active');
        const targetTab = e.target.getAttribute('data-target');
        document.getElementById(targetTab).classList.remove('hidden');
    });
});

// API Interface via Preload
const api = window.zaloAPI;

window.initZaloApp = function() {
    loadAccounts();
    if (typeof startForwardAuth === 'function') {
        startForwardAuth();
    }
}

/** === TAB QUẢN LÝ TÀI KHOẢN === */
async function loadAccounts() {
    const listEl = document.getElementById('accountList');
    const dispatchListEl = document.getElementById('dispatchAccounts');
    const selectScrapeEl = document.getElementById('scrapeAccountSelect');
    
    listEl.innerHTML = '<li>Đang tải...</li>';
    
    const accounts = await api.getAccounts();
    if (!accounts || accounts.length === 0) {
        listEl.innerHTML = '<li>Chưa có tài khoản nào được lưu.</li>';
        dispatchListEl.innerHTML = '<p class="status-msg">Vui lòng đăng nhập ít nhất 1 tài khoản.</p>';
        selectScrapeEl.innerHTML = '<option value="">-- Chưa có tài khoản --</option>';
        return;
    }

    listEl.innerHTML = '';
    dispatchListEl.innerHTML = '';
    selectScrapeEl.innerHTML = '<option value="">-- Chọn tài khoản --</option>';

    accounts.forEach((acc, index) => {
        // Tab Accounts
        const li = document.createElement('li');
        li.innerHTML = `<span><span style="font-size:20px;vertical-align:middle;">👤</span> <b>${index + 1}.</b> Tài khoản: <b>${acc.name || "Zalo User"}</b> <small>(${acc.filename})</small></span>
                        <div style="display:flex; align-items:center;">
                            <span style="color:#28a745;font-weight:600; margin-right: 15px;">✓ Đã đăng nhập</span>
                            <button class="btn danger btn-remove-account" data-filename="${acc.filename}" style="padding: 5px 10px; font-size: 13px;">Xoá</button>
                        </div>`;
        listEl.appendChild(li);

        // Tab Scrape
        const option = document.createElement('option');
        option.value = acc.filename;
        option.textContent = `Tài khoản: ${acc.name || acc.filename}`;
        selectScrapeEl.appendChild(option);

        // Tab Dispatch
        const label = document.createElement('label');
        label.innerHTML = `<input type="checkbox" name="dispatchAccFlag" value="${acc.filename}" checked> <b>[${index + 1}]</b> Sử dụng: <b>${acc.name || acc.filename}</b>`;
        dispatchListEl.appendChild(label);
    });

    // Handle delete account clicks
    document.querySelectorAll('.btn-remove-account').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (confirm('Bạn có chắc chắn muốn xoá tài khoản này không? Mọi lịch sử phiên đăng nhập sẽ bị mất.')) {
                const filename = e.target.getAttribute('data-filename');
                const res = await api.removeAccount(filename);
                if (res.success) {
                    loadAccounts(); // reload the list
                } else {
                    alert("Có lỗi khi xoá: " + res.error);
                }
            }
        });
    });
}
// loadAccounts() đã được mang lên window.initZaloApp()

// Thêm Tài khoản
document.getElementById('btnAddAccount').addEventListener('click', async () => {
    document.getElementById('qrModal').classList.remove('hidden');
    document.getElementById('qrStatus').innerText = "Đang tải mã QR từ máy chủ Zalo...";
    document.getElementById('qrContainer').innerHTML = ""; // Clear canvas cũ
    
    const res = await api.addAccount();
    if(res.success) {
        document.getElementById('qrModal').classList.add('hidden');
        alert("Đăng nhập thành công và đã lưu phiên làm việc!");
        loadAccounts();
    } else {
        alert("Có lỗi xảy ra: " + res.error);
        document.getElementById('qrModal').classList.add('hidden');
    }
});

// Nhận QR Code từ Backend để render lên UI Canvas
api.onQRCodeReceived((qrBase64) => {
    document.getElementById('qrStatus').innerText = "Vui lòng mở ứng dụng Zalo trên điện thoại và quét mã QR này:";
    const container = document.getElementById('qrContainer');
    
    // Tạo data url cho ảnh nếu chuỗi chưa có
    const imgSrc = qrBase64.startsWith('data:image') ? qrBase64 : `data:image/png;base64,${qrBase64}`;
    
    // Hiển thị trực tiếp ảnh (Base64) do server Zalo trả về
    container.innerHTML = `<img src="${imgSrc}" style="max-width: 100%; border-radius: 8px;" alt="QR Code" />`;
});

document.getElementById('btnCloseModal').addEventListener('click', () => {
    // Có thể huỷ tác vụ hoặc refresh reload
    document.getElementById('qrModal').classList.add('hidden');
});

/** === TAB QUÉT THÀNH VIÊN === */
// Xử lý Thay đổi UI Option
document.querySelectorAll('input[name="scrapeSource"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const sourceLayout = e.target.value;
        if(sourceLayout === 'account') {
            document.getElementById('sourceAccountView').classList.remove('hidden');
            document.getElementById('sourceLinkView').classList.add('hidden');
        } else {
            document.getElementById('sourceAccountView').classList.add('hidden');
            document.getElementById('sourceLinkView').classList.remove('hidden');
        }
    });
});

// Khi chọn tài khoản, load group cho dropdown
document.getElementById('scrapeAccountSelect').addEventListener('change', async (e) => {
    const filename = e.target.value;
    const groupSelect = document.getElementById('groupSelect');
    groupSelect.innerHTML = '<option value="">Đang tải nhóm...</option>';
    
    if(!filename) {
        groupSelect.innerHTML = '<option value="">-- Vui lòng chọn tài khoản trước --</option>';
        return;
    }

    try {
        const res = await api.getGroups(filename);
        if(res.success && res.groups.length > 0) {
            groupSelect.innerHTML = '';
            res.groups.forEach(g => {
                const opt = document.createElement('option');
                opt.value = g.id;
                opt.textContent = `${g.name} (ID: ${g.id})`;
                groupSelect.appendChild(opt);
            });
        } else {
            groupSelect.innerHTML = '<option value="">Không tìm thấy nhóm nào.</option>';
        }
    } catch(err) {
        groupSelect.innerHTML = '<option value="">Lỗi tải nhóm</option>';
    }
});

// Submit Quét
document.getElementById('btnStartScan').addEventListener('click', async () => {
    const runAccount = document.getElementById('scrapeAccountSelect').value;
    const sourceType = document.querySelector('input[name="scrapeSource"]:checked').value;
    const statusEl = document.getElementById('scanStatus');
    
    if(!runAccount) return alert("Vui lòng chọn tài khoản sẽ thực hiện Quét (Scraper).");
    
    let value = '';
    if(sourceType === 'account') {
        value = document.getElementById('groupSelect').value;
        if(!value) return alert("Vui lòng chọn Nhóm cần quét từ danh sách.");
    } else {
        value = document.getElementById('groupLinkInput').value.trim();
        if(!value) return alert("Vui lòng dán Link Zalo Group cần quét.");
    }

    statusEl.innerHTML = "⌛ Đang bắt đầu quét nhóm, vui lòng không tắt ứng dụng...";
    statusEl.style.color = "var(--primary)";
    document.getElementById('btnStartScan').disabled = true;

    const result = await api.scanGroup(sourceType, value, runAccount);
    
    if(result.success) {
        statusEl.innerHTML = "✅ Quét hoàn tất!";
        statusEl.style.color = "green";
        
        // Hiện block kết quả
        document.getElementById('scanResultsContainer').classList.remove('hidden');
        document.getElementById('scanCountResult').innerText = result.members.length;
        
        // Render vào Tab 3
        const listBody = document.getElementById('targetMemberList');
        listBody.innerHTML = ''; // Xoá trắng
        
        window.scrapedMembers = result.members; // Lưu mảng global

        result.members.forEach((m, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="text-center">
                    <input type="checkbox" class="target-member-cb" value="${m.id}" data-index="${index + 1}" checked>
                </td>
                <td class="text-center">${index + 1}</td>
                <td><b>${m.name}</b></td>
                <td style="font-family:monospace; font-size: 13px;">${m.id}</td>
            `;
            listBody.appendChild(tr);
        });

        updateSelectedCount();

    } else {
        statusEl.innerHTML = "❌ Lỗi quét nhóm: " + result.error;
        statusEl.style.color = "red";
    }
    document.getElementById('btnStartScan').disabled = false;
});

// Hàm cập nhật đếm số lượng người được chọn
function updateSelectedCount() {
    const checkedBoxes = document.querySelectorAll('.target-member-cb:checked');
    document.getElementById('selectedCountText').innerText = checkedBoxes.length;
}

// Bắt sự kiện tick tay thủ công trên table để cập nhật Label
document.getElementById('targetMemberList').addEventListener('change', (e) => {
    if(e.target && e.target.classList.contains('target-member-cb')) {
        updateSelectedCount();
    }
});

/** === TAB GỬI TIN NHẮN === */
// Dialog Hình ảnh
let selectedImgPath = '';
const elSelectedImagePath = document.getElementById('selectedImagePath');
const elBtnClearImage = document.getElementById('btnClearImage');

function updateImageSelectionUI() {
    if (selectedImgPath) {
        const filename = selectedImgPath.split('\\').pop().split('/').pop();
        elSelectedImagePath.innerText = filename;
        elBtnClearImage.classList.remove('hidden');
    } else {
        elSelectedImagePath.innerText = 'Chưa chọn file';
        elBtnClearImage.classList.add('hidden');
    }
}

document.getElementById('btnBrowseImage').addEventListener('click', async () => {
    const path = await api.openFileDialog();
    if(path) {
        selectedImgPath = path;
        updateImageSelectionUI();
    }
});

elBtnClearImage.addEventListener('click', () => {
    selectedImgPath = '';
    updateImageSelectionUI();
});

// Xử lý nút Chọn Thành Viên
document.getElementById('btnSelectAll').addEventListener('click', () => {
    document.querySelectorAll('.target-member-cb').forEach(cb => cb.checked = true);
    updateSelectedCount();
});

document.getElementById('btnDeselectAll').addEventListener('click', () => {
    document.querySelectorAll('.target-member-cb').forEach(cb => cb.checked = false);
    updateSelectedCount();
});

document.getElementById('btnSelectRange').addEventListener('click', () => {
    const start = parseInt(document.getElementById('rangeStartIndex').value) || 1;
    const end = parseInt(document.getElementById('rangeEndIndex').value) || window.scrapedMembers?.length || 1;
    
    document.querySelectorAll('.target-member-cb').forEach(cb => {
        const idx = parseInt(cb.getAttribute('data-index'));
        if (idx >= start && idx <= end) {
            cb.checked = true;
        } else {
            cb.checked = false;
        }
    });
    updateSelectedCount();
});

let isSpamRunning = false;
/** @type {Record<string, { paused: boolean, stopped: boolean, done: boolean }>} */
let accountSpamState = {};
/** @type {Map<string, HTMLElement>} */
const spamWrapByFilename = new Map();
/** @type {Map<string, HTMLElement>} */
const spamPaneByFilename = new Map();

/**
 * @param {HTMLElement} pane
 * @param {string} line
 * @param {'info'|'error'} [level]
 */
function appendCampaignLog(pane, line, level = 'info') {
    const row = document.createElement('div');
    row.className = 'log-line' + (level === 'error' ? ' log-line--err' : '');
    row.textContent = line;
    pane.appendChild(row);
    pane.scrollTop = pane.scrollHeight;
}

const elBtnStartSpam = document.getElementById('btnStartSpam');

api.onSpamAccountLog((payload) => {
    const filename = payload && payload.filename;
    const line = payload && payload.line;
    const level = (payload && payload.level) === 'error' ? 'error' : 'info';
    if (!filename || line == null || line === '') return;
    const pane = spamPaneByFilename.get(filename);
    if (!pane) return;
    appendCampaignLog(pane, line, level);
});

function setToolbarVisual(wrap, state) {
    const { paused, done } = state;
    const pause = wrap.querySelector('[data-spam-action="pause"]');
    const resume = wrap.querySelector('[data-spam-action="resume"]');
    const stop = wrap.querySelector('[data-spam-action="stop"]');
    if (!pause || !resume || !stop) return;
    [pause, resume, stop].forEach((el) => el.classList.remove('spam-ctrl-active', 'spam-ctrl-muted'));
    if (done) {
        pause.disabled = true;
        resume.disabled = true;
        stop.disabled = true;
        wrap.classList.add('toolbar-done');
        return;
    }
    wrap.classList.remove('toolbar-done');
    pause.disabled = paused;
    resume.disabled = !paused;
    stop.disabled = false;
    if (!paused) {
        pause.classList.add('spam-ctrl-active');
        resume.classList.add('spam-ctrl-muted');
        stop.classList.add('spam-ctrl-muted');
    } else {
        pause.classList.add('spam-ctrl-muted');
        resume.classList.add('spam-ctrl-active');
        stop.classList.add('spam-ctrl-active');
    }
}

function updateToolbarForFilename(filename) {
    const wrap = spamWrapByFilename.get(filename);
    const st = accountSpamState[filename];
    if (wrap && st) setToolbarVisual(wrap, st);
}

function resetSpamCampaignUI() {
    isSpamRunning = false;
    accountSpamState = {};
    spamWrapByFilename.clear();
    spamPaneByFilename.clear();
    elBtnStartSpam.disabled = false;
}

// Gửi Spam
elBtnStartSpam.addEventListener('click', async () => {
    const checkedAccounts = Array.from(document.querySelectorAll('input[name="dispatchAccFlag"]:checked')).map(cb => cb.value);
    if(checkedAccounts.length === 0) return alert("Phải chọn ít nhất 1 tài khoản gửi tin!");
    
    // Thu thập mảng target object đầy đủ (id, name, gender) thay vì chỉ id
    const targetMembers = Array.from(document.querySelectorAll('.target-member-cb:checked')).map(cb => {
        return window.scrapedMembers.find(m => m.id === cb.value);
    });

    if(targetMembers.length === 0) return alert("Bạn chưa chọn thành viên nào để nhận tin! Hãy quay lại danh sách.");

    const messageContent = document.getElementById('messageContent').value.trim();
    if(!messageContent) return alert("Vui lòng nhập nội dung tin nhắn!");

    const minDelay = parseInt(document.getElementById('minDelay').value) || 30;
    const maxDelay = parseInt(document.getElementById('maxDelay').value) || 60;
    
    // Giao diện Multi-Tab Tabs
    const logContainer = document.getElementById('dynamicLogsContainer');
    const tabsHeaders = document.getElementById('logTabsHeaders');
    const tabsContent = document.getElementById('logTabsContent');
    const logStatus = document.getElementById('spamStatusText');
    
    logContainer.classList.remove('hidden');
    tabsHeaders.innerHTML = '';
    tabsContent.innerHTML = '';
    logStatus.innerText = `Đang chạy ${checkedAccounts.length} luồng song song (mỗi account một khối người nhận)...`;
    logStatus.style.color = "#ffff00";

    isSpamRunning = true;
    accountSpamState = {};
    spamWrapByFilename.clear();
    spamPaneByFilename.clear();
    checkedAccounts.forEach((fn) => {
        accountSpamState[fn] = { paused: false, stopped: false, done: false };
    });

    const allAccounts = await api.getAccounts();
    /** @type {Record<string, string>} */
    const displayNameByFile = {};
    (allAccounts || []).forEach((a) => {
        displayNameByFile[a.filename] = (a.name && String(a.name).trim()) ? a.name : a.filename;
    });

    // Khởi tạo các Tab (mỗi luồng = 1 account, có thanh điều khiển riêng)
    checkedAccounts.forEach((filename, idx) => {
        const accLabel = displayNameByFile[filename] || filename;
        const btn = document.createElement('button');
        btn.className = 'log-tab-btn' + (idx === 0 ? ' active' : '');
        btn.innerText = accLabel;
        btn.setAttribute('data-wrap-target', `log_wrap_${idx}`);
        btn.onclick = () => {
            document.querySelectorAll('.log-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.log-pane-wrap').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`log_wrap_${idx}`).classList.add('active');
        };
        tabsHeaders.appendChild(btn);

        const wrap = document.createElement('div');
        wrap.className = 'log-pane-wrap' + (idx === 0 ? ' active' : '');
        wrap.id = `log_wrap_${idx}`;
        wrap.dataset.filename = filename;
        spamWrapByFilename.set(filename, wrap);

        const toolbar = document.createElement('div');
        toolbar.className = 'spam-control-row log-pane-toolbar';
        const label = document.createElement('span');
        label.className = 'log-pane-account-label';
        label.textContent = `${accLabel} (${filename})`;

        function mkSpamBtn(action, text, disabled, cls) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'spam-ctrl-btn spam-ctrl-' + action + ' ' + cls;
            b.setAttribute('data-filename', filename);
            b.setAttribute('data-spam-action', action);
            b.textContent = text;
            b.disabled = disabled;
            return b;
        }
        toolbar.appendChild(label);
        toolbar.appendChild(mkSpamBtn('pause', 'Tạm dừng', false, 'spam-ctrl-active'));
        toolbar.appendChild(mkSpamBtn('resume', 'Tiếp tục', true, 'spam-ctrl-muted'));
        toolbar.appendChild(mkSpamBtn('stop', 'Dừng hẳn', false, 'spam-ctrl-muted'));

        const pane = document.createElement('div');
        pane.className = 'log-pane';
        pane.id = `log_pane_${idx}`;
        pane.setAttribute('data-filename', filename);
        pane.innerText = `🔄 ${accLabel}: sẵn sàng gửi (khối người nhận gán cho tài khoản này)...\n`;
        spamPaneByFilename.set(filename, pane);

        wrap.appendChild(toolbar);
        wrap.appendChild(pane);
        tabsContent.appendChild(wrap);

        setToolbarVisual(wrap, accountSpamState[filename]);
    });

    elBtnStartSpam.disabled = true;

    const payload = {
        accountFilenames: checkedAccounts,
        targetMembers: targetMembers,
        messageContent,
        imagePath: selectedImgPath,
        minDelay,
        maxDelay
    };

    const res = await api.startSpam(payload);
    if(!res.success) {
        logStatus.innerText = "Lỗi khởi động Dispatcher: " + res.error;
        logStatus.style.color = "red";
        resetSpamCampaignUI();
    }
});

document.getElementById('logTabsContent').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-spam-action]');
    if (!btn || btn.disabled || !isSpamRunning) return;
    const filename = btn.getAttribute('data-filename');
    const action = btn.getAttribute('data-spam-action');
    const st = accountSpamState[filename];
    if (!st || st.done) return;

    api.spamControl({ filename, action });

    if (action === 'pause') {
        st.paused = true;
        updateToolbarForFilename(filename);
        const logStatus = document.getElementById('spamStatusText');
        logStatus.innerText = `⏸ Đã tạm dừng luồng: ${filename}`;
        logStatus.style.color = '#ffa500';
    } else if (action === 'resume') {
        st.paused = false;
        updateToolbarForFilename(filename);
        const logStatus = document.getElementById('spamStatusText');
        logStatus.innerText = `▶ Tiếp tục luồng: ${filename}`;
        logStatus.style.color = '#ffff00';
    } else if (action === 'stop') {
        st.stopped = true;
        updateToolbarForFilename(filename);
        const logStatus = document.getElementById('spamStatusText');
        logStatus.innerText = `⏹ Đang dừng luồng: ${filename}`;
        logStatus.style.color = '#ffa500';
    }
});

api.onSpamAccountFinished((filename) => {
    const st = accountSpamState[filename];
    if (st) st.done = true;
    updateToolbarForFilename(filename);
    const pane = spamPaneByFilename.get(filename);
    if (pane) {
        appendCampaignLog(pane, '✅ Luồng này đã kết thúc (hết danh sách hoặc đã dừng).', 'info');
    }
});

// Listeners status (Ngầm)
api.onSpamStatus((status, message) => {
    const logStatus = document.getElementById('spamStatusText');
    if(status === 'complete') {
        logStatus.innerText = "✅ " + message;
        logStatus.style.color = "#4af626";
        resetSpamCampaignUI();
    } else if (status === 'stopped') {
        logStatus.innerText = "⏹ " + message + " (mọi luồng đã dừng)";
        logStatus.style.color = "#ffa500";
        resetSpamCampaignUI();
    } else {
        logStatus.innerText = "❌ Lỗi tiến trình ngầm: " + message;
        logStatus.style.color = "red";
        resetSpamCampaignUI();
    }
});
