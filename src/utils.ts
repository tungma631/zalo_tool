import sharp from "sharp";
import fs from "fs-extra";

/**
 * Hàm lấy metadata của ảnh (bắt buộc cho zca-js V2)
 * @param filePath Đường dẫn đến file ảnh
 */
export async function getImageMetadata(filePath: string) {
    try {
        const data = await fs.readFile(filePath);
        const metadata = await sharp(data).metadata();
        
        return {
            height: metadata.height || 0,
            width: metadata.width || 0,
            size: metadata.size || data.length,
        };
    } catch (error) {
        console.error("Lỗi khi đọc metadata ảnh:", error);
        return null;
    }
}

/**
 * Hàm tạo delay ngẫu nhiên
 */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Hàm Spintax đơn giản để trộn nội dung tin nhắn
 * Ví dụ: "{Chào|Hi|Hello} bạn" -> "Hi bạn"
 */
export function parseSpintax(text: string): string {
    return text.replace(/{([^{}]+)}/g, (match, options) => {
        const choices = options.split('|');
        return choices[Math.floor(Math.random() * choices.length)];
    });
}