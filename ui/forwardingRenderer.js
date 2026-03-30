const fwdUi = {
    loginView: document.getElementById('forward-login-view'),
    mainView: document.getElementById('forward-main-view'),
    qrImg: document.getElementById('forward-qr-img'),
    loginStatus: document.getElementById('forward-login-status'),
    loginLoader: document.getElementById('forward-login-loader'),
    
    btnLogout: document.getElementById('forward-btn-logout'),
    btnSave: document.getElementById('forward-btn-save'),
    saveStatus: document.getElementById('forward-save-status'),
    unsavedWarning: document.getElementById('forward-unsaved-warning'),
    
    sourceList: document.getElementById('forward-source-list'),
    destList: document.getElementById('forward-dest-list'),
    sourceCount: document.getElementById('forward-source-count'),
    destCount: document.getElementById('forward-dest-count'),
    searchSource: document.getElementById('forward-search-source'),
    searchDest: document.getElementById('forward-search-dest'),

    btnSelectAllSource: document.getElementById('forward-btn-select-all-source'),
    btnUnselectAllSource: document.getElementById('forward-btn-unselect-all-source'),
    btnSelectAllDest: document.getElementById('forward-btn-select-all-dest'),
    btnUnselectAllDest: document.getElementById('forward-btn-unselect-all-dest'),
    
    logWindow: document.getElementById('forward-log-window'),
    btnClearLog: document.getElementById('forward-btn-clear-log')
};

let forwardAllGroups = [];
let forwardSourceSelection = new Set();
let forwardDestSelection = new Set();

function appendForwardLog(msg) {
    const time = new Date().toLocaleTimeString('vi-VN');
    const line = document.createElement('div');
    line.innerHTML = `<span class="time">[${time}]</span> ${msg}`;
    fwdUi.logWindow.appendChild(line);
    fwdUi.logWindow.scrollTop = fwdUi.logWindow.scrollHeight;
}

fwdUi.btnClearLog.addEventListener('click', () => {
    fwdUi.logWindow.innerHTML = '';
});

window.zaloAPI.onForwarderLog((msg) => {
    appendForwardLog(msg);
});

// --- AUTHENTICATION ---
async function startForwardAuth() {
    fwdUi.loginStatus.innerText = "Đang kiểm tra kết nối chuyển tiếp...";
    const success = await window.zaloAPI.forwarderLogin();
    if (success) {
        showForwardMainView();
    }
}

window.zaloAPI.onForwarderQr((base64Data) => {
    fwdUi.loginLoader.style.display = 'none';
    fwdUi.qrImg.style.display = 'block';
    fwdUi.qrImg.src = base64Data.startsWith('data:image') ? base64Data : `data:image/png;base64,${base64Data}`; 
    fwdUi.loginStatus.innerText = "Vui lòng quét mã QR để bắt đầu hệ thống tự chuyển tin!";
});

window.zaloAPI.onForwarderLoginSuccess(() => {
    showForwardMainView();
});

window.zaloAPI.onForwarderLoggedOut(() => {
    fwdUi.loginLoader.style.display = 'block';
    fwdUi.qrImg.style.display = 'none';
    fwdUi.mainView.style.display = 'none';
    fwdUi.loginView.style.display = 'flex';
    setTimeout(startForwardAuth, 1000); // Tự động quét lại QR
});

fwdUi.btnLogout.addEventListener('click', () => {
    if(confirm("Bạn có chắc chắn muốn đăng xuất tài khoản chuyển tiếp?")) {
        window.zaloAPI.forwarderLogout();
    }
});

async function showForwardMainView() {
    fwdUi.loginView.style.display = 'none';
    fwdUi.mainView.style.display = 'flex';
    
    appendForwardLog("Đang tải danh sách nhóm, vui lòng chờ...");
    
    const config = await window.zaloAPI.forwarderGetConfig();
    if (config.SOURCE_GROUP_IDS) config.SOURCE_GROUP_IDS.forEach(id => forwardSourceSelection.add(id));
    if (config.DESTINATION_GROUP_IDS) config.DESTINATION_GROUP_IDS.forEach(id => forwardDestSelection.add(id));
    
    forwardAllGroups = await window.zaloAPI.forwarderGetGroups();
    
    renderForwardList(forwardAllGroups, forwardSourceSelection, fwdUi.sourceList, fwdUi.sourceCount, 'source');
    renderForwardList(forwardAllGroups, forwardDestSelection, fwdUi.destList, fwdUi.destCount, 'dest');
}

function sortForwardListDom(container, selectionSet) {
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
    items.forEach(item => container.appendChild(item));
}

function renderForwardList(groups, selectionSet, container, countDisplay, type) {
    container.innerHTML = '';
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
                if (type === 'source' && forwardDestSelection.has(group.id)) {
                    alert("Nhóm này đã được chọn ở cột Đích. Không thể chọn trùng!");
                    e.target.checked = false;
                    return;
                }
                if (type === 'dest' && forwardSourceSelection.has(group.id)) {
                    alert("Nhóm này đã được chọn ở cột Nguồn. Không thể chọn trùng!");
                    e.target.checked = false;
                    return;
                }
                selectionSet.add(group.id);
            } else {
                selectionSet.delete(group.id);
            }
            
            countDisplay.innerText = selectionSet.size;
            fwdUi.unsavedWarning.style.display = 'inline-block';
            sortForwardListDom(container, selectionSet);
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

function filterForwardList(query, container) {
    const q = query.toLowerCase();
    const items = container.querySelectorAll('.group-item');
    items.forEach(item => {
        const text = item.querySelector('span').innerText.toLowerCase();
        item.style.display = text.includes(q) ? 'flex' : 'none';
    });
}

fwdUi.searchSource.addEventListener('input', (e) => filterForwardList(e.target.value, fwdUi.sourceList));
fwdUi.searchDest.addEventListener('input', (e) => filterForwardList(e.target.value, fwdUi.destList));

fwdUi.btnSave.addEventListener('click', async () => {
    const srcArray = Array.from(forwardSourceSelection);
    const destArray = Array.from(forwardDestSelection);
    
    if (srcArray.length === 0 || destArray.length === 0) {
        alert("LƯU Ý: Vui lòng chọn ít nhất 1 nhóm nguồn và 1 nhóm đích.");
        return;
    }
    
    await window.zaloAPI.forwarderSaveConfig(srcArray, destArray);
    fwdUi.unsavedWarning.style.display = 'none';
    fwdUi.saveStatus.innerText = "Cấu hình chuyển tiếp Auto đã lưu thành công!";
    fwdUi.saveStatus.style.opacity = 1;
    setTimeout(() => { fwdUi.saveStatus.style.opacity = 0; }, 3000);
});

function handleFwdSelectAll(containerId, selectionSet, oppositeSet, type) {
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
        fwdUi.unsavedWarning.style.display = 'inline-block';
        if (type === 'source') fwdUi.sourceCount.innerText = selectionSet.size;
        else fwdUi.destCount.innerText = selectionSet.size;
        sortForwardListDom(container, selectionSet);
    }
}

function handleFwdUnselectAll(containerId, selectionSet, type) {
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
        fwdUi.unsavedWarning.style.display = 'inline-block';
        if (type === 'source') fwdUi.sourceCount.innerText = selectionSet.size;
        else fwdUi.destCount.innerText = selectionSet.size;
        sortForwardListDom(container, selectionSet);
    }
}

fwdUi.btnSelectAllSource.addEventListener('click', () => handleFwdSelectAll('forward-source-list', forwardSourceSelection, forwardDestSelection, 'source'));
fwdUi.btnUnselectAllSource.addEventListener('click', () => handleFwdUnselectAll('forward-source-list', forwardSourceSelection, 'source'));
fwdUi.btnSelectAllDest.addEventListener('click', () => handleFwdSelectAll('forward-dest-list', forwardDestSelection, forwardSourceSelection, 'dest'));
fwdUi.btnUnselectAllDest.addEventListener('click', () => handleFwdUnselectAll('forward-dest-list', forwardDestSelection, 'dest'));

// Khởi chạy được quản lý bởi window.initZaloApp() trong renderer.js
// startForwardAuth();
