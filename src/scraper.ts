import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { API } from 'zca-js';
import { toZaloDmPeerId } from './zaloPeerId';

/**
 * Quét Group và Lưu file TXT
 * Hàm nhận vào instance Zalo (API) và groupId.
 * Gọi API của zca-js để lấy danh sách thành viên.
 * Sau khi có kết quả, lưu vào scraped_members.txt (mỗi id một dòng).
 */
export async function scanGroupMembers(zaloInstance: API, groupId: string): Promise<{id: string, name: string, gender?: number}[]> {
    try {
        console.log(`Đang quét thành viên của nhóm Zalo: ${groupId}...`);
        
        // Gọi API của zca-js để lấy Group Info
        const response = await (zaloInstance as any).getGroupInfo(groupId);

        if (!response || !response.gridInfoMap || !response.gridInfoMap[groupId]) {
            console.error("Không thể lấy dữ liệu nhóm. Có thể chưa join hoặc ID sai.");
            throw new Error("Không thể lấy dữ liệu nhóm. Có thể chưa join hoặc ID sai.");
        }

        const groupData = response.gridInfoMap[groupId];
        // memberIds là danh sách userID
        const memberIds = groupData.memVerList || groupData.memberIds || [];

        if (memberIds.length === 0) {
            console.log("Không tìm thấy userId hợp lệ từ nhóm.");
            throw new Error("Nhóm trống hoặc không thể lấy thành viên.");
        }

        // Lấy thông tin (Tên) của các userID này bằng chunks 100
        const chunkSize = 100;
        let enrichedMembers: {id: string, name: string, gender?: number}[] = [];
        
        console.log(`Bắt đầu lấy tên của ${memberIds.length} thành viên...`);
        for (let i = 0; i < memberIds.length; i += chunkSize) {
            const chunkIds = memberIds.slice(i, i + chunkSize);
            try {
                const profilesRes = await zaloInstance.getGroupMembersInfo(chunkIds);
                if (profilesRes && (profilesRes as any).profiles) {
                    const profiles = (profilesRes as any).profiles;
                    const chunkData = Object.keys(profiles).map((uid) => ({
                        id: toZaloDmPeerId(uid),
                        name: profiles[uid].displayName || profiles[uid].zaloName || "Người dùng Zalo",
                        gender: profiles[uid].gender // 0: nam, 1: nu
                    }));
                    enrichedMembers = enrichedMembers.concat(chunkData);
                } else {
                    enrichedMembers = enrichedMembers.concat(
                        chunkIds.map((id: string) => ({ id: toZaloDmPeerId(id), name: 'Người dùng Zalo', gender: -1 }))
                    );
                }
            } catch (e) {
                enrichedMembers = enrichedMembers.concat(
                    chunkIds.map((id: string) => ({ id: toZaloDmPeerId(id), name: 'Người dùng Zalo', gender: -1 }))
                );
            }
        }

        console.log(`Đã thu thập chi tiết ${enrichedMembers.length} thành viên. Xuất file TXT backup...`);

        const filePath = path.join(app.getPath('userData'), 'scraped_members.txt');
        const fileContent = enrichedMembers.map(m => `${m.id}|${m.name}|${m.gender}`).join('\n');
        fs.writeFileSync(filePath, fileContent, 'utf-8');

        return enrichedMembers;
    } catch (error: any) {
        console.error(`Lỗi trong quá trình quét UID thành viên nhóm ${groupId}:`, error.message);
        throw error;
    }
}

/**
 * Quét Group từ Link Zalo
 */
export async function scanGroupMembersByLink(zaloInstance: API, groupLink: string): Promise<{id: string, name: string, gender?: number}[]> {
    try {
        console.log(`Đang lấy dữ liệu (ảo) từ link nhóm Zalo: ${groupLink}...`);
        
        let memberPage = 1;
        let memberList: {id: string, name: string, gender?: number}[] = [];
        let hasMore = true;
        let groupId = "";

        while (hasMore) {
            console.log(`Đang cào dữ liệu trang ${memberPage}...`);
            const linkInfo = await (zaloInstance as any).getGroupLinkInfo({ link: groupLink, memberPage });
            
            if (!linkInfo || !linkInfo.groupId) {
                if (memberPage === 1) {
                    throw new Error("Không thể phân tích dữ liệu nhóm từ link này (Lỗi link hoặc server trả rỗng).");
                }
                break;
            }
            
            groupId = linkInfo.groupId;

            if (linkInfo.currentMems && linkInfo.currentMems.length > 0) {
                const pageMembers = linkInfo.currentMems
                    .filter((m: any) => m.id)
                    .map((m: any) => ({
                        id: toZaloDmPeerId(m.id),
                        name: m.dName || m.zaloName || "Người dùng Zalo",
                        gender: typeof m.gender !== 'undefined' ? m.gender : -1
                    }))
                    .filter((m: { id: string }) => m.id.length > 0);
                memberList = memberList.concat(pageMembers);
            }

            // check flag
            hasMore = linkInfo.hasMoreMember === 1;
            memberPage++;
            await new Promise(r => setTimeout(r, 500));
        }

        // Lọc trùng theo ID
        const uniqueIds = new Set();
        const finalMembers = [];
        for (const mem of memberList) {
            if (!uniqueIds.has(mem.id)) {
                uniqueIds.add(mem.id);
                finalMembers.push(mem);
            }
        }

        if (finalMembers.length === 0) {
            throw new Error("Nhóm không có ai hoặc Admin chặn hiển thị thành viên với người ngoài.");
        }

        console.log(`Đã thu thập ẩn danh thành công: Tổng cộng ${finalMembers.length} thành viên...`);

        const filePath = path.join(app.getPath('userData'), 'scraped_members.txt');
        fs.writeFileSync(filePath, finalMembers.map(m => m.id).join('\n'), 'utf-8');

        return finalMembers;
    } catch (error: any) {
        console.error(`Lỗi quá trình quét link từ bên ngoài:`, error.message);
        throw error;
    }
}
