import * as https from 'https';
import { Agent as UndiciAgent, fetch as undiciFetch } from 'undici';

type ImageMetaGetter = (filePath: string) => Promise<{ width: number; height: number; size: number }>;

/**
 * Mỗi phiên Zalo:
 * - `fetch` qua undici + **dispatcher riêng** (không dùng chung pool với fetch global / Electron).
 * - `agent` https giữ cho WebSocket (ws) trong zca-js — tách khỏi HTTP API.
 *
 * Trước đây mọi `fetch` có thể bỏ qua `https.Agent` → cookie/session trộn → "Tham số không hợp lệ" ở account thứ 2.
 */
export function createZaloSessionOptions(imageMetadataGetter: ImageMetaGetter) {
    const dispatcher = new UndiciAgent({
        keepAliveTimeout: 4_000,
        keepAliveMaxTimeout: 4_000,
    });

    const polyfill: typeof fetch = (input, init) => {
        const merged = { ...(init || {}) } as Record<string, unknown>;
        delete merged.agent;
        return undiciFetch(input as never, {
            ...merged,
            dispatcher,
        } as never) as unknown as Promise<Response>;
    };

    return {
        imageMetadataGetter,
        checkUpdate: false,
        agent: new https.Agent({
            keepAlive: false,
            maxSockets: 64,
        }),
        polyfill,
    };
}
