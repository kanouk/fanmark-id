import { selectD1Database, type Env } from "./repository.ts";

const VERSION_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;

export interface EmojiCatalogRecord {
  id: string;
  emoji: string;
  shortName: string;
  keywords: string[];
  category: string | null;
  subcategory: string | null;
  codepoints: string[];
  sortOrder: number | null;
}

export interface EmojiCatalogPageRequest {
  version: string | null;
  offset: number;
  limit: number;
}

export interface EmojiCatalogPage {
  version: string;
  total: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
  items: EmojiCatalogRecord[];
}

export class EmojiCatalogConfigurationError extends Error {
  constructor() {
    super("emoji catalog is not configured");
    this.name = "EmojiCatalogConfigurationError";
  }
}

export class EmojiCatalogUnavailableError extends Error {
  constructor() {
    super("emoji catalog is unavailable");
    this.name = "EmojiCatalogUnavailableError";
  }
}

export class EmojiCatalogUpstreamError extends Error {
  constructor() {
    super("emoji catalog read failed");
    this.name = "EmojiCatalogUpstreamError";
  }
}

function assertDatabase(env: Env): D1Database {
  if (env.EMOJI_CATALOG_BACKEND?.trim() !== "d1") {
    if (!env.EMOJI_CATALOG_BACKEND?.trim()) throw new EmojiCatalogUnavailableError();
    throw new EmojiCatalogConfigurationError();
  }
  const database = selectD1Database(env, "master");
  if (!database) throw new EmojiCatalogConfigurationError();
  return database;
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") throw new EmojiCatalogUpstreamError();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new EmojiCatalogUpstreamError();
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new EmojiCatalogUpstreamError();
  }
  return parsed;
}

function mapRecord(row: Record<string, unknown>): EmojiCatalogRecord {
  if (
    typeof row.id !== "string" || !UUID_RE.test(row.id) ||
    typeof row.emoji !== "string" || row.emoji.length === 0 ||
    typeof row.short_name !== "string" || row.short_name.length === 0 ||
    !(row.category === null || typeof row.category === "string") ||
    !(row.subcategory === null || typeof row.subcategory === "string") ||
    !(row.sort_order === null || Number.isSafeInteger(row.sort_order))
  ) {
    throw new EmojiCatalogUpstreamError();
  }
  const codepoints = parseStringArray(row.codepoints_json);
  if (!codepoints.length || codepoints.some((value) => !/^[0-9A-F]{4,6}$/.test(value))) {
    throw new EmojiCatalogUpstreamError();
  }
  return {
    id: row.id.toLowerCase(),
    emoji: row.emoji,
    shortName: row.short_name,
    keywords: parseStringArray(row.keywords_json),
    category: row.category,
    subcategory: row.subcategory,
    codepoints,
    sortOrder: row.sort_order as number | null,
  };
}

function assertD1Success<T>(result: D1Result<T>): T[] {
  if (!result || result.success !== true || !Array.isArray(result.results)) {
    throw new EmojiCatalogUpstreamError();
  }
  return result.results;
}

export function parseEmojiCatalogPageRequest(url: URL): EmojiCatalogPageRequest | null {
  const allowed = new Set(["version", "offset", "limit"]);
  const keys = new Set<string>();
  url.searchParams.forEach((_value, key) => keys.add(key));
  for (const key of keys) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) return null;
  }

  const version = url.searchParams.get("version");
  if (version !== null && !VERSION_RE.test(version)) return null;

  const rawOffset = url.searchParams.get("offset");
  const offset = rawOffset === null ? 0 : /^(?:0|[1-9][0-9]{0,4})$/.test(rawOffset) ? Number(rawOffset) : NaN;
  if (!Number.isSafeInteger(offset) || offset > 10000) return null;

  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 500 : /^(?:[1-9][0-9]{0,2})$/.test(rawLimit) ? Number(rawLimit) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) return null;
  return { version, offset, limit };
}

export function createEmojiMasterD1Repository(env: Env) {
  const database = assertDatabase(env);

  return {
    async readPage(page: EmojiCatalogPageRequest): Promise<EmojiCatalogPage> {
      if (page.version !== null && !VERSION_RE.test(page.version)) {
        throw new EmojiCatalogConfigurationError();
      }

      let version = page.version;
      if (version === null) {
        const active = await database
          .prepare(`
            SELECT release_version
            FROM fanmark_emoji_master_active_release
            WHERE singleton_id = 1
          `)
          .first<{ release_version?: unknown }>();
        if (!active || typeof active.release_version !== "string" || !VERSION_RE.test(active.release_version)) {
          throw new EmojiCatalogUnavailableError();
        }
        version = active.release_version;
      }

      const metadata = await database
        .prepare(`
          SELECT row_count, status
          FROM fanmark_emoji_master_release_imports
          WHERE release_version = ?
        `)
        .bind(version)
        .first<{ row_count?: unknown; status?: unknown }>();
      if (!metadata || metadata.status !== "ready") throw new EmojiCatalogUnavailableError();
      if (!Number.isSafeInteger(metadata.row_count) || (metadata.row_count as number) < 1) {
        throw new EmojiCatalogUpstreamError();
      }
      if ((metadata.row_count as number) > 10000) throw new EmojiCatalogUpstreamError();

      const result = await database
        .prepare(`
          SELECT ordinal, id, emoji, short_name, keywords_json, category,
                 subcategory, codepoints_json, sort_order
          FROM fanmark_emoji_master_release_staging
          WHERE release_version = ?
          ORDER BY ordinal
          LIMIT ? OFFSET ?
        `)
        .bind(version, page.limit, page.offset)
        .all<Record<string, unknown>>();
      const rows = assertD1Success(result);
      const total = metadata.row_count as number;
      const expectedLength = Math.min(page.limit, Math.max(0, total - page.offset));
      if (
        rows.length !== expectedLength ||
        rows.some((row, index) => row.ordinal !== page.offset + index + 1)
      ) {
        throw new EmojiCatalogUpstreamError();
      }

      const nextOffset = page.offset + rows.length < total ? page.offset + rows.length : null;
      return {
        version,
        total,
        offset: page.offset,
        limit: page.limit,
        nextOffset,
        items: rows.map(mapRecord),
      };
    },
  };
}
