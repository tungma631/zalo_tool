const ui = {
    loginView: document.getElementById('login-view'),
    mainView: document.getElementById('main-view'),
    qrImg: document.getElementById('qr-img'),
    loginStatus: document.getElementById('login-status'),
    loginLoader: document.getElementById('login-loader'),
    
    btnLogout: document.getElementById('btn-logout'),
    btnSave: document.getElementById('btn-save'),
    saveStatus: document.getElementById('save-status'),
    unsavedWarning: document.getElementById('unsaved-warning'),
    
    sourceList: document.getElementById('source-list'),
    destList: document.getElementById('dest-list'),
    sourceCount: document.getElementById('source-count'),
    destCount: document.getElementById('dest-count'),
    searchSource: document.getElementById('search-source'),
    searchDest: document.getElementById('search-dest'),

    btnSelectAllSource: document.getElementById('btn-select-all-source'),
    btnUnselectAllSource: document.getElementById('btn-unselect-all-source'),
    btnSelectAllDest: document.getElementById('btn-select-all-dest'),
    btnUnselectAllDest: document.getElementById('btn-unselect-all-dest'),
    
    logWindow: document.getElementById('log-window'),
    btnClearLog: document.getElementById('btn-clear-log')
};

let allGroups = [];
let sourceSelection = new Set();
let destSelection = new Set();

function showErrorToast(msg) {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.top = '30px';
    toast.style.left = '50%';
    toast.style.transform = 'translate(-50%, 0)';
    toast.style.background = 'var(--danger)';
    toast.style.color = 'white';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '9999';
    toast.style.boxShadow = '0 8px 24px rgba(239, 68, 68, 0.4)';
    toast.style.fontWeight = 'bold';
    toast.style.transition = '0.3s';
    toast.innerText = msg;

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- LOGGING ---
function appendLog(msg) {
    const time = new Date().toLocaleTimeString('vi-VN');
    const line = document.createElement('div');
    line.innerHTML = `<span class="time">[${time}]</span> ${msg}`;
    ui.logWindow.appendChild(line);
    ui.logWindow.scrollTop = ui.logWindow.scrollHeight;
}

ui.btnClearLog.addEventListener('click', () => {
    ui.logWindow.innerHTML = '';
});

window.zaloAPI.onLog((msg) => {
    appendLog(msg);
});

// --- AUTHENTICATION ---
async function startAuth() {
    ui.loginStatus.innerText = "Đang kiểm tra kết nối bí mật...";
    const success = await window.zaloAPI.login();
    if (success) {
        showMainView();
    }
}

window.zaloAPI.onQR((base64Data) => {
    ui.loginLoader.style.display = 'none';
    ui.qrImg.style.display = 'block';
    
    // Gán trực tiếp chuỗi Base64 vào ảnh
    ui.qrImg.src = base64Data; 
    
    ui.loginStatus.innerText = "Vui lòng quét mã QR để bắt đầu!";
});

window.zaloAPI.onLoginSuccess(() => {
    showMainView();
});

window.zaloAPI.onLoggedOut(() => {
    window.location.reload();
});

ui.btnLogout.addEventListener('click', () => {
    if(confirm("Bạn có chắc chắn muốn đăng xuất?")) {
        window.zaloAPI.logout();
    }
});

// --- MAIN VIEW & GROUP LISTING ---
async function showMainView() {
    ui.loginView.style.display = 'none';
    ui.mainView.style.display = 'flex';
    
    appendLog("Đang tải danh sách nhóm, vui lòng chờ...");
    
    // Tải cấu hình cũ
    const config = await window.zaloAPI.getConfig();
    if (config.SOURCE_GROUP_IDS) config.SOURCE_GROUP_IDS.forEach(id => sourceSelection.add(id));
    if (config.DESTINATION_GROUP_IDS) config.DESTINATION_GROUP_IDS.forEach(id => destSelection.add(id));
    
    // Lấy dữ liệu group thực
    allGroups = await window.zaloAPI.getGroups();
    
    renderList(allGroups, sourceSelection, ui.sourceList, ui.sourceCount, 'source');
    renderList(allGroups, destSelection, ui.destList, ui.destCount, 'dest');
}

// --- HELPERS ---
function sortListDom(container, selectionSet) {
    const items = Array.from(container.children);
    items.sort((a, b) => {
        const idA = a.querySelector('input').value;
        const idB = b.querySelector('input').value;
        const aSelected = selectionSet.has(idA);
        const bSelected = selectionSet.has(idB);
        
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        
        const textA = a.querySelector('span').innerText;
        const textB = b.querySelector('span').innerText;
        return textA.localeCompare(textB, 'vi');
    });
    
    // Yêu cầu DOM render lại mảng theo vị trí mới
    items.forEach(item => container.appendChild(item));
}

function renderList(groups, selectionSet, container, countDisplay, type) {
    container.innerHTML = '';
    
    // Sort array: Selected first, then alphabetically
    const sortedGroups = [...groups].sort((a, b) => {
        const aSelected = selectionSet.has(a.id);
        const bSelected = selectionSet.has(b.id);
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return a.name.localeCompare(b.name, 'vi');
    });

    sortedGroups.forEach(group => {
        const div = document.createElement('label');
        div.className = 'group-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = group.id;
        checkbox.checked = selectionSet.has(group.id);
        
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                if (type === 'source' && destSelection.has(group.id)) {
                    showErrorToast("Nhóm này đã được chọn ở cột Đích. Không thể chọn trùng!");
                    e.target.checked = false;
                    return;
                }
                if (type === 'dest' && sourceSelection.has(group.id)) {
                    showErrorToast("Nhóm này đã được chọn ở cột Nguồn. Không thể chọn trùng!");
                    e.target.checked = false;
                    return;
                }
                selectionSet.add(group.id);
            } else {
                selectionSet.delete(group.id);
            }
            
            countDisplay.innerText = selectionSet.size;
            ui.unsavedWarning.style.display = 'inline-block';
            
            // Xếp lại ngay sau khi tick/bỏ tick
            sortListDom(container, selectionSet);
        });

        const span = document.createElement('span');
        span.innerText = group.name;
        span.title = group.name;

        div.appendChild(checkbox);
        div.appendChild(span);
        container.appendChild(div);
    });
    
    countDisplay.innerText = selectionSet.size;
}

// --- SEARCH FUNCTIONALITY ---
function filterList(query, container) {
    const q = query.toLowerCase();
    const items = container.querySelectorAll('.group-item');
    items.forEach(item => {
        const text = item.querySelector('span').innerText.toLowerCase();
        item.style.display = text.includes(q) ? 'flex' : 'none';
    });
}

ui.searchSource.addEventListener('input', (e) => filterList(e.target.value, ui.sourceList));
ui.searchDest.addEventListener('input', (e) => filterList(e.target.value, ui.destList));

// --- SAVE CONFIG ---
ui.btnSave.addEventListener('click', async () => {
    const srcArray = Array.from(sourceSelection);
    const destArray = Array.from(destSelection);
    
    if (srcArray.length === 0 || destArray.length === 0) {
        showErrorToast("LƯU Ý: Vui lòng chọn ít nhất 1 nhóm nguồn và 1 nhóm đích.");
        return;
    }
    
    await window.zaloAPI.saveConfig(srcArray, destArray);
    
    // Ẩn cảnh báo
    ui.unsavedWarning.style.display = 'none';

    ui.saveStatus.innerText = "Cấu hình đã được lưu thành công!";
    ui.saveStatus.style.opacity = 1;
    setTimeout(() => { ui.saveStatus.style.opacity = 0; }, 3000);
});

// --- BULK SELECTION ACTIONS ---
function handleSelectAll(containerId, selectionSet, oppositeSet, type) {
    const container = document.getElementById(containerId);
    const items = container.querySelectorAll('.group-item');
    let addedCount = 0;
    
    items.forEach(item => {
        if (item.style.display !== 'none') {
            const checkbox = item.querySelector('input[type="checkbox"]');
            const groupId = checkbox.value;
            
            if (!checkbox.checked && !oppositeSet.has(groupId)) {
                checkbox.checked = true;
                selectionSet.add(groupId);
                addedCount++;
            }
        }
    });

    if (addedCount > 0) {
        ui.unsavedWarning.style.display = 'inline-block';
        if (type === 'source') ui.sourceCount.innerText = selectionSet.size;
        else ui.destCount.innerText = selectionSet.size;
        
        sortListDom(container, selectionSet);
    }
}

function handleUnselectAll(containerId, selectionSet, type) {
    const container = document.getElementById(containerId);
    const items = container.querySelectorAll('.group-item');
    let removedCount = 0;
    
    items.forEach(item => {
        if (item.style.display !== 'none') {
            const checkbox = item.querySelector('input[type="checkbox"]');
            const groupId = checkbox.value;
            
            if (checkbox.checked) {
                checkbox.checked = false;
                selectionSet.delete(groupId);
                removedCount++;
            }
        }
    });

    if (removedCount > 0) {
        ui.unsavedWarning.style.display = 'inline-block';
        if (type === 'source') ui.sourceCount.innerText = selectionSet.size;
        else ui.destCount.innerText = selectionSet.size;
        
        sortListDom(container, selectionSet);
    }
}

ui.btnSelectAllSource.addEventListener('click', () => handleSelectAll('source-list', sourceSelection, destSelection, 'source'));
ui.btnUnselectAllSource.addEventListener('click', () => handleUnselectAll('source-list', sourceSelection, 'source'));

ui.btnSelectAllDest.addEventListener('click', () => handleSelectAll('dest-list', destSelection, sourceSelection, 'dest'));
ui.btnUnselectAllDest.addEventListener('click', () => handleUnselectAll('dest-list', destSelection, 'dest'));

// START
startAuth();
