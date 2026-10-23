export const EMOJI_CATALOG_PAGE_SIZE = 500;
export const EMOJI_CATALOG_MAX_RECORDS = 10_000;
export const EMOJI_CATALOG_TIMEOUT_MS = 15_000;

const API_PATH = "/api/emoji/catalog";
const VERSION_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const CODEPOINT_RE = /^[0-9A-F]{4,6}$/;

export interface EmojiCatalogApiItem {
  id: string;
  emoji: string;
  shortName: string;
  keywords: string[];
  category: string | null;
  subcategory: string | null;
  codepoints: string[];
  sortOrder: number | null;
}

export interface EmojiCatalogApiRelease {
  version: string;
  items: EmojiCatalogApiItem[];
}

export interface EmojiCatalogLoadOptions {
  fetcher?: typeof fetch;
  pageSize?: number;
  timeoutMs?: number;
  version?: string;
}

export type EmojiCatalogApiErrorKind =
  | "configuration"
  | "http"
  | "invalid_response"
  | "network"
  | "timeout";

export class EmojiCatalogApiError extends Error {
  readonly kind: EmojiCatalogApiErrorKind;
  readonly status?: number;

  constructor(kind: EmojiCatalogApiErrorKind, status?: number) {
    super(kind === "http" && status ? `emoji catalog request failed (${status})` : `emoji catalog request ${kind}`);
    this.name = "EmojiCatalogApiError";
    this.kind = kind;
    this.status = status;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
}

function assertPageSize(pageSize: number): void {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > EMOJI_CATALOG_PAGE_SIZE) {
    throw new EmojiCatalogApiError("configuration");
  }
}

export function buildEmojiCatalogApiUrl(
  baseUrl: string,
  params: { version?: string; offset?: number; limit?: number } = {},
): URL {
  const rawUrl = baseUrl.trim();
  if (!rawUrl) throw new EmojiCatalogApiError("configuration");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new EmojiCatalogApiError("configuration");
  }

  const isAllowedProtocol =
    url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHostname(url.hostname));
  if (
    !isAllowedProtocol ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new EmojiCatalogApiError("configuration");
  }

  const limit = params.limit ?? EMOJI_CATALOG_PAGE_SIZE;
  const offset = params.offset ?? 0;
  assertPageSize(limit);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > EMOJI_CATALOG_MAX_RECORDS) {
    throw new EmojiCatalogApiError("configuration");
  }
  if (params.version !== undefined && !VERSION_RE.test(params.version)) {
    throw new EmojiCatalogApiError("configuration");
  }

  url.pathname = API_PATH;
  url.search = "";
  if (params.version !== undefined) url.searchParams.set("version", params.version);
  if (offset > 0) url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  url.hash = "";
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseItem(value: unknown): EmojiCatalogApiItem {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" || !UUID_RE.test(value.id) ||
    typeof value.emoji !== "string" || value.emoji.length === 0 ||
    typeof value.shortName !== "string" || value.shortName.length === 0 ||
    !Array.isArray(value.keywords) || value.keywords.some((keyword) => typeof keyword !== "string") ||
    !(value.category === null || typeof value.category === "string") ||
    !(value.subcategory === null || typeof value.subcategory === "string") ||
    !Array.isArray(value.codepoints) || value.codepoints.length === 0 ||
    value.codepoints.some((codepoint) => typeof codepoint !== "string" || !CODEPOINT_RE.test(codepoint)) ||
    !(value.sortOrder === null || Number.isSafeInteger(value.sortOrder))
  ) {
    throw new EmojiCatalogApiError("invalid_response");
  }

  return {
    id: value.id.toLowerCase(),
    emoji: value.emoji,
    shortName: value.shortName,
    keywords: value.keywords as string[],
    category: value.category as string | null,
    subcategory: value.subcategory as string | null,
    codepoints: value.codepoints as string[],
    sortOrder: value.sortOrder as number | null,
  };
}

interface ParsedPage {
  version: string;
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  items: EmojiCatalogApiItem[];
}

function parsePage(value: unknown, expectedOffset: number, pageSize: number): ParsedPage {
  if (
    !isRecord(value) || value.schemaVersion !== 1 ||
    typeof value.version !== "string" || !VERSION_RE.test(value.version) ||
    !Number.isSafeInteger(value.total) || (value.total as number) < 1 || (value.total as number) > EMOJI_CATALOG_MAX_RECORDS ||
    value.offset !== expectedOffset || value.limit !== pageSize ||
    !Array.isArray(value.items)
  ) {
    throw new EmojiCatalogApiError("invalid_response");
  }

  const total = value.total as number;
  const items = value.items.map(parseItem);
  const expectedLength = Math.min(pageSize, Math.max(0, total - expectedOffset));
  const expectedNextOffset = expectedOffset + expectedLength < total ? expectedOffset + expectedLength : null;
  if (
    items.length !== expectedLength ||
    !(value.nextOffset === null || Number.isSafeInteger(value.nextOffset)) ||
    value.nextOffset !== expectedNextOffset
  ) {
    throw new EmojiCatalogApiError("invalid_response");
  }

  return {
    version: value.version,
    total,
    offset: expectedOffset,
    limit: pageSize,
    nextOffset: expectedNextOffset,
    items,
  };
}

async function fetchPage(
  url: URL,
  fetcher: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new EmojiCatalogApiError("http", response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new EmojiCatalogApiError("invalid_response");
    }
    return payload;
  } catch (error) {
    if (error instanceof EmojiCatalogApiError) throw error;
    if (controller.signal.aborted) throw new EmojiCatalogApiError("timeout");
    throw new EmojiCatalogApiError("network");
  } finally {
    clearTimeout(timeout);
  }
}

/** Revalidate persisted data with the same item/count/duplicate rules as HTTP. */
export function validateEmojiCatalogRelease(value: unknown, total: number): EmojiCatalogApiRelease {
  if (!isRecord(value) || typeof value.version !== 'string' || !VERSION_RE.test(value.version) ||
      !Number.isSafeInteger(total) || total < 1 || total > EMOJI_CATALOG_MAX_RECORDS ||
      !Array.isArray(value.items) || value.items.length !== total) throw new EmojiCatalogApiError('invalid_response');
  const items = value.items.map(parseItem);
  const ids = new Set(items.map(item => item.id));
  const emojis = new Set(items.map(item => item.emoji.normalize('NFC')));
  if (ids.size !== total || emojis.size !== total) throw new EmojiCatalogApiError('invalid_response');
  return { version: value.version, items };
}

/** Existing endpoint, one item: confirms the currently selected ready release. */
export async function loadEmojiCatalogMetadata(baseUrl: string, options: EmojiCatalogLoadOptions = {}) {
  const timeoutMs = options.timeoutMs ?? EMOJI_CATALOG_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new EmojiCatalogApiError('configuration');
  const page = parsePage(await fetchPage(buildEmojiCatalogApiUrl(baseUrl, { version: options.version, limit: 1 }),
    options.fetcher ?? fetch, timeoutMs), 0, 1);
  if (options.version !== undefined && options.version !== page.version) throw new EmojiCatalogApiError('invalid_response');
  return { version: page.version, total: page.total, firstItem: page.items[0] };
}

export async function loadEmojiCatalogFromWorker(
  baseUrl: string,
  options: EmojiCatalogLoadOptions = {},
): Promise<EmojiCatalogApiRelease> {
  const pageSize = options.pageSize ?? EMOJI_CATALOG_PAGE_SIZE;
  const timeoutMs = options.timeoutMs ?? EMOJI_CATALOG_TIMEOUT_MS;
  const fetcher = options.fetcher ?? fetch;
  assertPageSize(pageSize);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new EmojiCatalogApiError("configuration");
  }

  // Discover the active immutable release once, then load at most three pinned
  // pages at a time. Never install a partial or mixed-version catalog.
  const first = parsePage(await fetchPage(buildEmojiCatalogApiUrl(baseUrl, {
    version: options.version, limit: pageSize,
  }), fetcher, timeoutMs), 0, pageSize);
  const version = first.version;
  const total = first.total;
  if (options.version !== undefined && version !== options.version) {
    throw new EmojiCatalogApiError("invalid_response");
  }
  const pages: ParsedPage[] = [first];
  for (let offset = pageSize; offset < total; offset += pageSize * 3) {
    const offsets = [offset, offset + pageSize, offset + pageSize * 2].filter(value => value < total);
    pages.push(...await Promise.all(offsets.map(async value => {
      const page = parsePage(await fetchPage(buildEmojiCatalogApiUrl(baseUrl, {
        version, offset: value, limit: pageSize,
      }), fetcher, timeoutMs), value, pageSize);
      if (page.version !== version || page.total !== total) throw new EmojiCatalogApiError("invalid_response");
      return page;
    })));
  }
  const items: EmojiCatalogApiItem[] = [];
  const ids = new Set<string>();
  const emojis = new Set<string>();
  for (const page of pages) {
    for (const item of page.items) {
      const normalizedEmoji = item.emoji.normalize("NFC");
      if (ids.has(item.id) || emojis.has(normalizedEmoji)) throw new EmojiCatalogApiError("invalid_response");
      ids.add(item.id);
      emojis.add(normalizedEmoji);
      items.push(item);
    }
  }

  if (!version || total === undefined || items.length !== total) {
    throw new EmojiCatalogApiError("invalid_response");
  }
  return { version, items };
}
