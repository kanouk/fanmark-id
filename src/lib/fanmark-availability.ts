import { buildRecentFanmarksApiUrl, getRecentFanmarksApiBaseUrl } from './recent-fanmarks.ts';
export interface FanmarkAvailability {
    available: boolean;
    fanmark_id?: string | null;
    reason?: string | null;
    tier_level?: number | null;
    tier_display_name?: string | null;
    price?: number | null;
    license_days?: number | null;
    available_at?: string | null;
    blocking_status?: string | null;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const fail = () => new Error('Failed to determine fanmark availability');
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
export function parseFanmarkAvailability(value: unknown): FanmarkAvailability {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw fail();
    const raw = value as Record<string, unknown>;
    if (typeof raw.available !== 'boolean')
        throw fail();
    const result: FanmarkAvailability = { available: raw.available };
    for (const key of ['fanmark_id', 'reason', 'tier_display_name', 'available_at', 'blocking_status'] as const) {
        if (own(raw, key)) {
            if (raw[key] !== null && typeof raw[key] !== 'string')
                throw fail();
            result[key] = raw[key] as string | null;
        }
    }
    for (const key of ['tier_level', 'price', 'license_days'] as const) {
        if (own(raw, key)) {
            if (raw[key] !== null && (typeof raw[key] !== 'number' || !Number.isFinite(raw[key])))
                throw fail();
            result[key] = raw[key] as number | null;
        }
    }
    if (result.fanmark_id !== undefined && result.fanmark_id !== null && !uuid(result.fanmark_id))
        throw fail();
    if (result.available) {
        if (result.fanmark_id) {
            if (result.reason !== null || result.blocking_status !== null || result.available_at !== null)
                throw fail();
        }
        else {
            if (own(raw, 'reason') || own(raw, 'available_at') || own(raw, 'blocking_status'))
                throw fail();
            if (!Number.isInteger(result.tier_level) || result.tier_level! < 1 || result.tier_level! > 4 ||
                typeof result.tier_display_name !== 'string' || typeof result.price !== 'number' ||
                !(result.license_days === null || (Number.isSafeInteger(result.license_days) && result.license_days! >= 0)))
                throw fail();
        }
    }
    else if (result.reason === 'invalid_length' || result.reason === 'invalid_emoji_ids') {
        if (result.fanmark_id)
            throw fail();
    }
    else if (result.reason === 'taken' || result.reason === 'grace_period') {
        if (!uuid(result.fanmark_id) || result.blocking_status !== (result.reason === 'taken' ? 'active' : 'grace') ||
            (result.reason === 'taken' ? result.available_at !== null : typeof result.available_at !== 'string'))
            throw fail();
    }
    else
        throw fail();
    return result;
}
interface LoadOptions {
    apiBaseUrl?: string;
    fallback: () => Promise<unknown>;
    fetcher?: typeof fetch;
    timeoutMs?: number;
}
export async function loadFanmarkAvailability(emojiIds: string[], options: LoadOptions): Promise<FanmarkAvailability> {
    if (emojiIds.length < 1 || emojiIds.length > 5 || !emojiIds.every(uuid))
        throw fail();
    const base = options.apiBaseUrl === undefined ? getRecentFanmarksApiBaseUrl() : getRecentFanmarksApiBaseUrl(options.apiBaseUrl);
    if (!base)
        return parseFanmarkAvailability(await options.fallback());
    let endpoint: URL;
    try {
        endpoint = buildRecentFanmarksApiUrl(base);
    }
    catch {
        throw fail();
    }
    endpoint.pathname = '/api/fanmarks/availability';
    endpoint.search = '';
    const timeoutMs = options.timeoutMs ?? 5000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
        throw fail();
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail()); }, timeoutMs); });
    let closeReader: (() => void) | undefined;
    const work = async () => {
        const response = await (options.fetcher ?? fetch)(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ emojiIds }), credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
        });
        if (!response.ok || response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json')
            throw fail();
        if (!response.body)
            throw fail();
        const reader = response.body.getReader();
        closeReader = () => {
            try {
                void reader.cancel().catch(() => { });
            }
            catch { /* Already detached. */ }
            try {
                reader.releaseLock();
            }
            catch { /* Cleanup must not mask the error. */ }
        };
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
            while (true) {
                if (controller.signal.aborted || Date.now() >= deadline)
                    throw fail();
                const { done, value } = await reader.read();
                if (done)
                    break;
                size += value.byteLength;
                if (size > 16384)
                    throw fail();
                chunks.push(value);
            }
            const bytes = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
            if (payload?.schemaVersion !== 1)
                throw fail();
            return parseFanmarkAvailability(payload.result);
        }
        finally {
            closeReader();
        }
    };
    try {
        return await Promise.race([work(), timeout]);
    }
    catch {
        throw fail();
    }
    finally {
        clearTimeout(timer!);
        controller.abort();
        closeReader?.();
    }
}
