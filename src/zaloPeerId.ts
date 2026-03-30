/**
 * UID dùng cho gửi tin 1-1 (ThreadType.User).
 * Dữ liệu nhóm / getGroupMembersInfo thường có dạng "<số>_<phiên bản>"; gửi SMS cần phần số thuần.
 */
export function toZaloDmPeerId(raw: unknown): string {
    if (raw == null) return '';
    let s = String(raw)
        .trim()
        .replace(/^\uFEFF/, '')
        .replace(/\u200b/g, '');
    if (!s) return s;
    // "2412..._0" hoặc "2412..._12"
    const suffixed = s.match(/^(\d{5,30})(?:_[0-9]+)?$/);
    if (suffixed) return suffixed[1];
    if (/^\d{5,30}$/.test(s)) return s;
    return s;
}
