import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import type { MessageContent, SendMessageResponse } from 'zca-js';
import { API, ThreadType } from 'zca-js';
import { toZaloDmPeerId } from './zaloPeerId';

type AttachmentInput = NonNullable<MessageContent['attachments']>;

function isInvalidParamsError(err: unknown): boolean {
    const msg = (err as any)?.message != null ? String((err as any).message) : '';
    return msg.includes('Tham số không hợp lệ') || msg.toLowerCase().includes('invalid');
}

/**
 * zca-js dùng Date.now() làm clientId ở nhiều API (sendMessage/uploadAttachment...).
 * Khi chạy nhiều luồng, 2 request có thể trùng mili-giây → server trả “Tham số không hợp lệ”.
 * Cơ chế này đảm bảo mỗi lần gọi API Zalo có timestamp tăng dần (>=1ms).
 */
let lastZaloApiTs = 0;
let zaloApiChain: Promise<void> = Promise.resolve();

async function ensureNextZaloApiTick(): Promise<void> {
    const now = Date.now();
    if (now <= lastZaloApiTs) {
        await delay((lastZaloApiTs - now) + 1);
    }
    lastZaloApiTs = Date.now();
}

async function withZaloApiTickLock<T>(fn: () => Promise<T>): Promise<T> {
    // Serialize only the "timestamp allocation", not toàn bộ workflow.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const prev = zaloApiChain;
    zaloApiChain = prev.then(() => gate).catch(() => gate);
    await prev;
    try {
        await ensureNextZaloApiTick();
        return await fn();
    } finally {
        release();
    }
}

async function sendMessageWithRetry(
    sender: API,
    payload: MessageContent,
    userId: string,
    maxAttempts: number,
    emit?: (line: string, level: 'info' | 'error') => void
): Promise<SendMessageResponse> {
    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await withZaloApiTickLock(() => sender.sendMessage(payload, userId, ThreadType.User));
        } catch (e: any) {
            lastErr = e;
            if (!isInvalidParamsError(e)) throw e;
            if (attempt < maxAttempts) {
                const backoffMs = 800 + Math.floor(Math.random() * 800) + (attempt - 1) * 1200;
                emit?.(`⚠ Tham số không hợp lệ → retry lần ${attempt + 1}/${maxAttempts} sau ${Math.ceil(backoffMs / 1000)}s`, 'error');
                await delay(backoffMs);
                continue;
            }
            throw e;
        }
    }
    throw lastErr;
}

/** Mỗi luồng một bản attachment (Buffer riêng), tránh tác động chéo khi upload song song. */
function forkAttachmentForStream(template: AttachmentInput | undefined): AttachmentInput | undefined {
    if (template == null) return undefined;
    const cloneOne = (src: AttachmentInput extends (infer U)[] ? U : AttachmentInput): AttachmentInput extends (infer U)[] ? never : AttachmentInput => {
        if (typeof src === 'string') return src as any;
        const o = src as { data?: Buffer; filename: `${string}.${string}`; metadata: Record<string, unknown> };
        if (!Buffer.isBuffer(o.data)) return src as any;
        return {
            data: Buffer.from(o.data),
            filename: o.filename,
            metadata: { ...o.metadata },
        } as any;
    };
    if (Array.isArray(template)) return template.map((x) => cloneOne(x as any)) as AttachmentInput;
    return cloneOne(template as any) as AttachmentInput;
}

async function warmupProfilesForAccount(
    sender: API,
    userIds: string[],
    emit?: (line: string, level: 'info' | 'error') => void
): Promise<void> {
    const ids = userIds.filter(Boolean);
    if (ids.length === 0) return;
    // zca-js getUserInfo sẽ tự append _0 và dùng phonebook_version/extraVer → giúp “mở” ngữ cảnh DM ở nhiều trường hợp.
    try {
        emit?.(`🧩 Warm-up hồ sơ (${ids.length} UID) trước khi gửi...`, 'info');
        await withZaloApiTickLock(() => (sender as any).getUserInfo(ids));
        emit?.(`🧩 Warm-up hồ sơ: OK`, 'info');
    } catch (e: any) {
        const msg = e?.message ? String(e.message) : 'lỗi không xác định';
        emit?.(`⚠ Warm-up hồ sơ thất bại (bỏ qua): ${msg}`, 'error');
    }
}

/** Mỗi tài khoản gửi một luồng riêng (đồng bộ với main qua mảng controls). */
export type SpamRunControl = {
    paused: boolean;
    stopped: boolean;
};

export type DispatchOptions = {
    /** Cùng thứ tự với `selectedAccounts` — mỗi phần tử điều khiển một luồng. */
    controls: SpamRunControl[];
    minDelaySec: number;
    maxDelaySec: number;
    /** Gọi khi một luồng account kết thúc (hết danh sách hoặc bị dừng). */
    onAccountFinished?: (accountIndex: number) => void;
    /** Cùng thứ tự với `selectedAccounts` — map log UI theo tab tài khoản. */
    accountFilenames?: string[];
    /** Một dòng log cho tab `filename` trong app (Electron IPC). */
    onAccountLog?: (filename: string, line: string, level: 'info' | 'error') => void;
    /**
     * Độ trễ gối đầu giữa các luồng khi bắt đầu (ms).
     * Ví dụ: 1500 → luồng 0 bắt đầu ngay, luồng 1 đợi 1.5s, luồng 2 đợi 3s...
     */
    staggerStartMs?: number;
    /**
     * Phase offset cố định theo từng luồng (giây) để tránh 2 luồng gửi cùng thời điểm.
     * Delay thực tế giữa 2 tin của luồng i sẽ là: randomDelaySec + i*phaseShiftSec
     */
    phaseShiftSec?: number;
};

/** Tin chữ trả về `message`; tin chỉ ảnh / caption kèm ảnh thường chỉ có `attachment`. */
function isSendResponseOk(res: SendMessageResponse): boolean {
    if (res.message != null) return true;
    return Array.isArray(res.attachment) && res.attachment.length > 0;
}

export type TargetRecipient = {
    id: string;
    name?: string;
    /** Theo dữ liệu Zalo từ scraper: 0 Nam, 1 Nữ, -1/khác: chưa rõ */
    gender?: number;
};

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitWhilePaused(control: SpamRunControl): Promise<void> {
    while (control.paused && !control.stopped) {
        await delay(100);
    }
}

async function interruptibleDelay(ms: number, control: SpamRunControl): Promise<void> {
    let elapsed = 0;
    const step = 50;
    while (elapsed < ms) {
        if (control.stopped) return;
        await waitWhilePaused(control);
        if (control.stopped) return;
        const chunk = Math.min(step, ms - elapsed);
        await delay(chunk);
        elapsed += chunk;
    }
}

function genderLabel(gender?: number): string {
    if (gender === 0) return 'Nam';
    if (gender === 1) return 'Nữ';
    return 'Không rõ';
}

export function personalizeMessage(template: string, member: TargetRecipient): string {
    const name = (member.name && member.name.trim()) ? member.name.trim() : 'bạn';
    const gender = genderLabel(member.gender);
    return template
        .replace(/@name/gi, name)
        .replace(/@gender/gi, gender);
}

/** Tên hiển thị trên log (ưu tiên tên Zalo; không có thì userId). */
function streamLogDisplayName(m: TargetRecipient): string {
    const name = m.name?.trim();
    if (name) return name;
    return String(m.id).trim();
}

function logStreamOutcome(
    streamOrd: number,
    streamTotal: number,
    target: TargetRecipient,
    ok: boolean,
    failureReason: string | undefined,
    emitUi?: (line: string, level: 'info' | 'error') => void
): void {
    const pos = `[${streamOrd}/${streamTotal}]`;
    const who = streamLogDisplayName(target);
    const line = ok ? `${pos}: Đã gửi: ${who}` : `${pos}: Thất bại: ${failureReason ?? 'lỗi không xác định'}`;
    if (ok) console.log(line);
    else console.error(line);
    emitUi?.(line, ok ? 'info' : 'error');
}

/**
 * Đọc ảnh một lần, dùng Buffer cho mọi luồng — tránh nhiều luồng cùng mở file (Windows) khiến upload bị kẹt.
 * GIF vẫn dùng đường dẫn (nhánh upload khác).
 */
async function preloadAttachment(
    imagePath: string | undefined
): Promise<MessageContent['attachments'] | undefined> {
    if (!imagePath || !fs.existsSync(imagePath)) return undefined;
    const ext = path.extname(imagePath).toLowerCase().slice(1);
    if (ext === 'gif') {
        return imagePath;
    }
    const data = await fs.promises.readFile(imagePath);
    const meta = await sharp(data).metadata();
    let fname = path.basename(imagePath);
    if (!fname.includes('.')) fname = `${fname}.jpg`;
    return {
        data,
        filename: fname as `${string}.${string}`,
        metadata: {
            totalSize: data.length,
            width: meta.width,
            height: meta.height,
        },
    };
}

/**
 * Mỗi luồng = một khối liên tiếp trong danh sách (STT 1..n, n+1..2n, …).
 * Nếu ít người hơn số tài khoản: vòng để không bị luồng cuối rỗng hoàn toàn.
 */
function splitTargetsForStreams(targets: TargetRecipient[], n: number): TargetRecipient[][] {
    if (n <= 0) return [];
    if (targets.length >= n) {
        const chunk = Math.ceil(targets.length / n);
        return Array.from({ length: n }, (_, i) => targets.slice(i * chunk, (i + 1) * chunk));
    }
    const buckets: TargetRecipient[][] = Array.from({ length: n }, () => []);
    targets.forEach((t, i) => buckets[i % n].push(t));
    return buckets;
}

/**
 * Nhiều luồng song song, mỗi account một danh sách người nhận và paused/stopped riêng.
 */
export async function dispatchMessages(
    selectedAccounts: API[],
    targetBuckets: TargetRecipient[][],
    messageContent: string,
    imagePath: string | undefined,
    options: DispatchOptions
): Promise<void> {
    const { controls, minDelaySec, maxDelaySec, onAccountFinished, onAccountLog } = options;
    const accountFilenames = options.accountFilenames ?? [];
    const minSec = Math.max(1, minDelaySec);
    const maxSec = Math.max(minSec, maxDelaySec);
    const staggerStartMs = Math.max(0, Number(options.staggerStartMs ?? 1200));
    const phaseShiftSec = Math.max(0, Number(options.phaseShiftSec ?? 5));

    if (onAccountLog && accountFilenames.length !== selectedAccounts.length) {
        throw new Error('accountFilenames phải cùng độ dài với số tài khoản khi bật onAccountLog.');
    }

    if (targetBuckets.reduce((sum, b) => sum + b.length, 0) === 0) {
        console.log("Không có thành viên nào được chọn để gửi tin.");
        return;
    }

    if (selectedAccounts.length === 0) {
        console.error("Lỗi: Không có tài khoản Zalo (API instances) nào được chọn sẵn sàng gửi.");
        return;
    }

    if (controls.length !== selectedAccounts.length) {
        throw new Error(`Số điều khiển luồng (${controls.length}) không khớp số tài khoản (${selectedAccounts.length}).`);
    }

    const n = selectedAccounts.length;
    const buckets = targetBuckets;
    const sharedAttachment = await preloadAttachment(imagePath);

    const totalTargets = buckets.reduce((acc, b) => acc + b.length, 0);
    console.log(
        `[Bắt đầu] ${totalTargets} thành viên → ${n} luồng song song. Phân bổ: ${buckets.map((b, i) => `[${i}]${b.length}`).join(', ')}.`
    );

    // Chia luồng hoàn toàn: không chuyển khối user qua account khác.

    const accountExecutions = selectedAccounts.map(async (_, index): Promise<number> => {
        const control = controls[index];
        const slice = buckets[index];
        const sender = selectedAccounts[index];
        const streamFilename = accountFilenames[index];

        const emitForStream = (line: string, level: 'info' | 'error' = 'info') => {
            if (streamFilename && onAccountLog) onAccountLog(streamFilename, line, level);
        };

        const warmupMs = index * staggerStartMs;
        if (warmupMs > 0) {
            const warmLine = `độ trễ gối đầu ${Math.ceil(warmupMs / 1000)}s (đợi trước khi bắt đầu gửi)`;
            console.log(warmLine);
            emitForStream(warmLine, 'info');
            await delay(warmupMs);
        }

        if (slice.length === 0) {
            const emptyMsg = `[Luồng ${index + 1}/${n}] Không có người nhận được gán (bỏ qua gửi).`;
            console.warn(emptyMsg);
            emitForStream(emptyMsg, 'error');
            onAccountFinished?.(index);
            return 0;
        }

        const startMsg = `[Luồng ${index + 1}/${n}] ${slice.length} người trong luồng này.`;
        console.log(startMsg);
        emitForStream(startMsg, 'info');

        // Warm-up: mô phỏng hành vi “account dùng để quét” (thường đã gọi getGroupMembersInfo/getUserInfo),
        // giúp giảm "Tham số không hợp lệ" cho account chỉ gửi.
        const warmSample = slice
            .slice(0, Math.min(20, slice.length))
            .map((t) => toZaloDmPeerId(t.id))
            .filter((id) => id && /^\d{5,30}$/.test(id));
        if (warmSample.length > 0) {
            await warmupProfilesForAccount(sender, warmSample, (line, level) => emitForStream(line, level));
        }

        let localSuccess = 0;
        const streamTotal = slice.length;

        try {
            for (let i = 0; i < slice.length; i++) {
                const target = slice[i];
                const streamOrd = i + 1;
                const isLastInStream = i === slice.length - 1;

                await waitWhilePaused(control);
                if (control.stopped) break;

                const userId = toZaloDmPeerId(target.id);
                if (!userId || !/^\d{5,30}$/.test(userId)) {
                    logStreamOutcome(
                        streamOrd,
                        streamTotal,
                        target,
                        false,
                        `bỏ qua — userId không hợp lệ sau chuẩn hóa: "${target.id}"`,
                        emitForStream
                    );
                    continue;
                }
                const personalized = personalizeMessage(messageContent, target);

                const payload: MessageContent = { msg: personalized };
                const attach = forkAttachmentForStream(sharedAttachment as AttachmentInput | undefined);
                if (attach) {
                    payload.attachments = attach;
                }
                if (!personalized.trim() && !payload.attachments) {
                    logStreamOutcome(
                        streamOrd,
                        streamTotal,
                        target,
                        false,
                        'bỏ qua — không có nội dung chữ và không có ảnh hợp lệ',
                        emitForStream
                    );
                } else {
                    try {
                        const sendResult = await sendMessageWithRetry(
                            sender,
                            payload,
                            String(userId),
                            3,
                            (line, level) => emitForStream(line, level)
                        );
                        if (!isSendResponseOk(sendResult)) {
                            throw new Error(
                                'phản hồi rỗng (không có message/attachment), kiểm tra session hoặc thử lại'
                            );
                        }
                        localSuccess++;
                        logStreamOutcome(streamOrd, streamTotal, target, true, undefined, emitForStream);
                    } catch (err: any) {
                        const reason = (err?.message && String(err.message).trim()) ? String(err.message).trim() : 'lỗi không xác định';
                        logStreamOutcome(streamOrd, streamTotal, target, false, reason, emitForStream);
                    }
                }

                if (control.stopped) break;
                if (isLastInStream) break;

                const randomDelaySec = Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;
                const desync = index * phaseShiftSec;
                const totalDelaySec = randomDelaySec + desync;
                const pauseLine = `đang tạm dừng ${totalDelaySec}s`;
                console.log(pauseLine);
                emitForStream(pauseLine, 'info');
                await interruptibleDelay(totalDelaySec * 1000, control);
            }
            return localSuccess;
        } finally {
            onAccountFinished?.(index);
        }
    });

    const perStreamCounts = await Promise.all(accountExecutions);
    const successCount = perStreamCounts.reduce((a, b) => a + b, 0);

    const allStopped = controls.length > 0 && controls.every(c => c.stopped);

    if (allStopped) {
        console.log(`[Dừng] Mọi luồng đã dừng. Đã gửi thành công ${successCount} tin.`);
        return;
    }

    if (successCount === 0) {
        throw new Error(
            'Không gửi được tin nào (mọi lần đều lỗi). Với ảnh: cần sharp + imageMetadataGetter (đã cấu hình). Với người lạ: tin có thể nằm trong Tin nhắn chờ của người nhận.'
        );
    }

    console.log(`[Hoàn thành] Đã gửi thành công ${successCount} tin trên ${n} luồng.`);
}
