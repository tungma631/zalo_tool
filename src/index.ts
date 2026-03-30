import { AccountManager } from "./account";
import { scanGroupMembers } from "./scraper";
import { dispatchMessages } from "./dispatcher";
import * as readline from 'readline';

const accManager = new AccountManager();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const question = (query: string) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
    console.log("--- ZALO AUTOMATION TOOL ---");
    console.log("1. Đăng nhập tài khoản mới (Quét QR)");
    console.log("2. Quét thành viên từ Group ID");
    console.log("3. Chạy chiến dịch gửi tin nhắn");
    
    const choice = await question("Chọn tính năng: ");

    if (choice === "1") {
        await accManager.addAccount();
    } 
    else if (choice === "2") {
        await accManager.loadAllAccounts();
        const apis = Array.from(accManager.accounts.values());
        if (apis.length === 0) return console.log("Chưa có tài khoản nào!");
        
        const groupId = await question("Nhập Group ID cần quét: ") as string;
        await scanGroupMembers(apis[0], groupId);
    } 
    else if (choice === "3") {
        await accManager.loadAllAccounts();
        const apis = Array.from(accManager.accounts.values());
        
        console.log(`Đang có ${apis.length} tài khoản sẵn sàng.`);
        const start = parseInt(await question("Bắt đầu từ thành viên số: ") as string);
        const end = parseInt(await question("Đến thành viên số: ") as string);
        const msg = await question("Nội dung tin nhắn: ") as string;
        const img = await question("Đường dẫn ảnh (để trống nếu không gửi): ") as string;

        await dispatchMessages(apis, start, end, msg, img || undefined);
    }
    
    main(); // Quay lại menu
}

main();