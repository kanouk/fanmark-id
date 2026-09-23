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
      credentials: "omit",
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

export async function loadEmojiCatalogFromWorker(
  baseUrl: string,
  options: {
    fetcher?: typeof fetch;
    pageSize?: number;
    timeoutMs?: number;
  } = {},
): Promise<EmojiCatalogApiRelease> {
  const pageSize = options.pageSize ?? EMOJI_CATALOG_PAGE_SIZE;
  const timeoutMs = options.timeoutMs ?? EMOJI_CATALOG_TIMEOUT_MS;
  const fetcher = options.fetcher ?? fetch;
  assertPageSize(pageSize);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new EmojiCatalogApiError("configuration");
  }

  let version: string | undefined;
  let total: number | undefined;
  let offset = 0;
  const items: EmojiCatalogApiItem[] = [];
  const ids = new Set<string>();
  const emojis = new Set<string>();

  while (total === undefined || offset < total) {
    const url = buildEmojiCatalogApiUrl(baseUrl, { version, offset, limit: pageSize });
    const page = parsePage(await fetchPage(url, fetcher, timeoutMs), offset, pageSize);
    if (version !== undefined && page.version !== version) {
      throw new EmojiCatalogApiError("invalid_response");
    }
    if (total !== undefined && page.total !== total) {
      throw new EmojiCatalogApiError("invalid_response");
    }

    version = page.version;
    total = page.total;
    for (const item of page.items) {
      const normalizedEmoji = item.emoji.normalize("NFC");
      if (ids.has(item.id) || emojis.has(normalizedEmoji)) {
        throw new EmojiCatalogApiError("invalid_response");
      }
      ids.add(item.id);
      emojis.add(normalizedEmoji);
      items.push(item);
    }
    offset = page.nextOffset ?? total;
  }

  if (!version || total === undefined || items.length !== total) {
    throw new EmojiCatalogApiError("invalid_response");
  }
  return { version, items };
}
