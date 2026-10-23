import { buildEmojiCatalogApiUrl, loadEmojiCatalogFromWorker, loadEmojiCatalogMetadata,
  validateEmojiCatalogRelease, type EmojiCatalogApiRelease, type EmojiCatalogLoadOptions } from './emoji-catalog-worker.ts';

export const EMOJI_CATALOG_CACHE_DB = 'fanmark-public-emoji-catalog-v1';
export const EMOJI_CATALOG_CACHE_STORE = 'catalogs';
const STORAGE_TIMEOUT_MS = 750;
const MAX_PAYLOAD_CHARS = 4 * 1024 * 1024;

export interface EmojiCatalogStore {
  read(origin: string): Promise<unknown>;
  write(origin: string, value: unknown): Promise<void>;
}

/** One atomic public snapshot per API origin, separate from SW/private queries. */
export function createEmojiCatalogStore(): EmojiCatalogStore {
  function transaction(origin: string, mode: IDBTransactionMode, value?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let db: IDBDatabase | undefined, tx: IDBTransaction | undefined, settled = false, result: unknown;
      const finish = (failed: boolean) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (failed) { try { tx?.abort(); } catch { /* Already completed. */ } }
        db?.close();
        if (failed) reject(new Error('Public catalog storage unavailable'));
        else resolve(result);
      };
      const timer = setTimeout(() => finish(true), STORAGE_TIMEOUT_MS);
      try {
        const request = indexedDB.open(EMOJI_CATALOG_CACHE_DB, 1);
        request.onblocked = request.onerror = () => finish(true);
        request.onupgradeneeded = () => {
          if (settled) { request.transaction?.abort(); return; }
          request.result.createObjectStore(EMOJI_CATALOG_CACHE_STORE);
        };
        request.onsuccess = () => {
          if (settled) { request.result.close(); return; }
          db = request.result; db.onversionchange = () => db?.close();
          try {
            tx = db.transaction(EMOJI_CATALOG_CACHE_STORE, mode);
            const store = tx.objectStore(EMOJI_CATALOG_CACHE_STORE);
            const operation = mode === 'readonly' ? store.get(origin) : store.put(value, origin);
            operation.onsuccess = () => { result = operation.result; };
            tx.oncomplete = () => finish(false);
            tx.onerror = tx.onabort = () => finish(true);
          } catch { finish(true); }
        };
      } catch { finish(true); }
    });
  }
  return { read: origin => transaction(origin, 'readonly'),
    write: async (origin, value) => { await transaction(origin, 'readwrite', value); } };
}

async function checksum(payload: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function encodeCatalogSnapshot(origin: string, selection: string, release: EmojiCatalogApiRelease) {
  const payload = JSON.stringify({ origin, selection, total: release.items.length, ...release });
  if (payload.length > MAX_PAYLOAD_CHARS) throw new Error('Catalog snapshot too large');
  return { schemaVersion: 1, payload, checksum: await checksum(payload) };
}

export async function decodeCatalogSnapshot(value: unknown, origin: string, selection: string): Promise<EmojiCatalogApiRelease> {
  if (!value || typeof value !== 'object') throw new Error('Invalid catalog snapshot');
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.payload !== 'string' || record.payload.length > MAX_PAYLOAD_CHARS ||
      typeof record.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(record.checksum) ||
      await checksum(record.payload) !== record.checksum) throw new Error('Corrupt catalog snapshot');
  const payload = JSON.parse(record.payload);
  if (!payload || payload.origin !== origin || payload.selection !== selection) throw new Error('Catalog origin/selection mismatch');
  return validateEmojiCatalogRelease(payload, payload.total);
}

export async function loadReusableEmojiCatalog(baseUrl: string,
  options: EmojiCatalogLoadOptions & { store?: EmojiCatalogStore } = {}): Promise<EmojiCatalogApiRelease> {
  // URL/version validation precedes both storage and HTTP. Never share a cache
  // with another API origin or use a pinned snapshot as the active selection.
  const origin = buildEmojiCatalogApiUrl(baseUrl, { version: options.version }).origin;
  const selection = options.version ?? 'ready';
  const store = options.store ?? createEmojiCatalogStore();
  let cached: EmojiCatalogApiRelease | undefined;
  try { cached = await decodeCatalogSnapshot(await store.read(origin), origin, selection); } catch { /* Ordinary HTTP path. */ }
  let version = options.version;
  if (cached) {
    // Do not use an old snapshot when this check fails, including offline.
    const metadata = await loadEmojiCatalogMetadata(baseUrl, options);
    if (cached.version === metadata.version && cached.items.length === metadata.total &&
        JSON.stringify(cached.items[0]) === JSON.stringify(metadata.firstItem)) return cached;
    version = metadata.version;
  }
  const release = await loadEmojiCatalogFromWorker(baseUrl, { ...options, version });
  // Persistence never delays install or makes a usable network catalog fail.
  setTimeout(() => {
    void encodeCatalogSnapshot(origin, selection, release).then(snapshot => store.write(origin, snapshot)).catch(() => undefined);
  }, 0);
  return release;
}
