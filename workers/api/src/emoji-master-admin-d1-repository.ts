import { selectD1Database, type Env } from "./repository";

const API_PATH = "/api/admin/emoji-master";
const UUID_RE = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu;
const RELEASE_RE = /^[0-9a-f]{64}$/;
const CODEPOINT_RE = /^[0-9A-F]{4,6}$/;
const PAGE_SIZES = new Set([25, 50, 100]);
const MAX_SEARCH_LENGTH = 120;
const MAX_IMPORT_ROWS = 100;

export interface EmojiMasterAdminInput {
  emoji: string;
  shortName: string;
  keywords: string[];
  category: string | null;
  subcategory: string | null;
  codepoints: string[];
  sortOrder: number | null;
}

export interface EmojiMasterAdminItem extends EmojiMasterAdminInput {
  id: string;
  updatedAt: string;
  releaseProtected: boolean;
}

export interface EmojiMasterAdminPage {
  schemaVersion: 1;
  activeReleaseVersion: string | null;
  page: number;
  pageSize: number;
  total: number;
  items: EmojiMasterAdminItem[];
}

export type EmojiMasterAdminRoute =
  | { kind: "list" }
  | { kind: "import" }
  | { kind: "item"; id: string };

export class EmojiMasterAdminError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "EmojiMasterAdminError";
  }
}

function fail(code: string, status = 400): never {
  throw new EmojiMasterAdminError(code, status);
}

export function isEmojiMasterAdminPath(url: URL): boolean {
  return url.pathname === API_PATH || url.pathname.startsWith(`${API_PATH}/`);
}

export function parseEmojiMasterAdminRoute(url: URL): EmojiMasterAdminRoute | null {
  if (url.pathname === API_PATH) return { kind: "list" };
  if (url.pathname === `${API_PATH}/import`) return { kind: "import" };
  const match = /^\/api\/admin\/emoji-master\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/iu.exec(url.pathname);
  if (!match || !UUID_RE.test(match[1])) return null;
  return { kind: "item", id: match[1].toLowerCase() };
}

function databaseFor(env: Env): D1Database {
  if (env.EMOJI_MASTER_ADMIN_BACKEND?.trim() !== "d1") {
    if (!env.EMOJI_MASTER_ADMIN_BACKEND?.trim()) fail("emoji_master_admin_unavailable", 503);
    fail("server_misconfigured", 500);
  }
  const database = selectD1Database(env, "master");
  if (!database) fail("server_misconfigured", 500);
  return database;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) {
    fail("invalid_request");
  }
}

function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && value.trim().length === 0)) {
    fail("invalid_emoji_record");
  }
  return value;
}

function stringArray(value: unknown, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value) || value.length > maximumItems) fail("invalid_emoji_record");
  return value.map((item) => text(item, maximumLength));
}

function validateCodepointSequence(emoji: string, codepoints: string[]): void {
  if (
    codepoints.length === 0 || codepoints.some((value) => !CODEPOINT_RE.test(value)) ||
    new Set(codepoints).size !== codepoints.length
  ) {
    fail("invalid_emoji_record");
  }
  const actual = [...emoji].map((character) =>
    character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
  );
  if (actual.length !== codepoints.length || actual.some((value, index) => value !== codepoints[index])) {
    fail("emoji_codepoints_mismatch");
  }
}

function parseInput(value: unknown): EmojiMasterAdminInput {
  if (!isRecord(value)) fail("invalid_request");
  exactKeys(
    value,
    ["emoji", "shortName", "keywords", "category", "subcategory", "codepoints", "sortOrder"],
    ["emoji", "shortName", "keywords", "category", "subcategory", "codepoints", "sortOrder"],
  );
  const emoji = text(value.emoji, 64);
  const shortName = text(value.shortName, 256);
  const keywords = stringArray(value.keywords, 128, 128);
  const category = value.category === null ? null : text(value.category, 128, true);
  const subcategory = value.subcategory === null ? null : text(value.subcategory, 128, true);
  const codepoints = stringArray(value.codepoints, 16, 6);
  validateCodepointSequence(emoji, codepoints);
  const sortOrder = value.sortOrder;
  if (sortOrder !== null && (!Number.isSafeInteger(sortOrder) || (sortOrder as number) < -2_147_483_648 || (sortOrder as number) > 2_147_483_647)) {
    fail("invalid_emoji_record");
  }
  return { emoji, shortName, keywords, category, subcategory, codepoints, sortOrder: sortOrder as number | null };
}

function parsePagination(url: URL): { page: number; pageSize: number; search: string } {
  const allowed = new Set(["page", "pageSize", "search"]);
  const keys = new Set<string>();
  url.searchParams.forEach((_value, key) => keys.add(key));
  if ([...keys].some((key) => !allowed.has(key)) || [...keys].some((key) => url.searchParams.getAll(key).length !== 1)) {
    fail("invalid_request");
  }
  const rawPage = url.searchParams.get("page") ?? "1";
  const rawPageSize = url.searchParams.get("pageSize") ?? "50";
  if (!/^[1-9][0-9]{0,3}$/u.test(rawPage) || !/^(?:25|50|100)$/u.test(rawPageSize)) fail("invalid_request");
  const page = Number(rawPage);
  const pageSize = Number(rawPageSize);
  if (!PAGE_SIZES.has(pageSize) || (page - 1) * pageSize > 10_000) fail("invalid_request");
  const search = (url.searchParams.get("search") ?? "").trim();
  if (search.length > MAX_SEARCH_LENGTH || search.includes("\0")) fail("invalid_request");
  return { page, pageSize, search };
}

function parseJsonArray(value: unknown, maximum: number): string[] {
  if (typeof value !== "string") fail("emoji_master_read_failed", 503);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail("emoji_master_read_failed", 503);
  }
  if (!Array.isArray(parsed) || parsed.length > maximum || parsed.some((item) => typeof item !== "string")) {
    fail("emoji_master_read_failed", 503);
  }
  return parsed;
}

function mapItem(row: Record<string, unknown>): EmojiMasterAdminItem {
  if (
    typeof row.id !== "string" || !UUID_RE.test(row.id) ||
    typeof row.emoji !== "string" || typeof row.short_name !== "string" ||
    !(row.category === null || typeof row.category === "string") ||
    !(row.subcategory === null || typeof row.subcategory === "string") ||
    !(row.sort_order === null || Number.isSafeInteger(row.sort_order)) ||
    typeof row.updated_at !== "string"
  ) fail("emoji_master_read_failed", 503);
  return {
    id: row.id.toLowerCase(),
    emoji: row.emoji,
    shortName: row.short_name,
    keywords: parseJsonArray(row.keywords, 128),
    category: row.category,
    subcategory: row.subcategory,
    codepoints: parseJsonArray(row.codepoints, 16),
    sortOrder: row.sort_order as number | null,
    updatedAt: row.updated_at,
    releaseProtected: row.release_protected === 1,
  };
}

function assertD1Rows<T>(result: D1Result<T>): T[] {
  if (!result || result.success !== true || !Array.isArray(result.results)) fail("emoji_master_read_failed", 503);
  return result.results;
}

function bindIfNeeded(statement: D1PreparedStatement, bindings: (string | number | null)[]): D1PreparedStatement {
  return bindings.length > 0 ? statement.bind(...bindings) : statement;
}

function queryFilter(search: string): { where: string; bindings: string[] } {
  if (!search) return { where: "", bindings: [] };
  return {
    where: "WHERE instr(lower(short_name), lower(?)) > 0 OR instr(emoji, ?) > 0",
    bindings: [search, search],
  };
}

async function activeVersion(database: D1Database): Promise<string | null> {
  const row = await database.prepare(
    "SELECT release_version FROM fanmark_emoji_master_active_release WHERE singleton_id = 1",
  ).first<{ release_version?: unknown }>();
  if (row === null) return null;
  if (typeof row.release_version !== "string" || !RELEASE_RE.test(row.release_version)) fail("emoji_master_read_failed", 503);
  return row.release_version;
}

export function createEmojiMasterAdminD1Repository(env: Env) {
  const database = databaseFor(env);

  async function getById(id: string): Promise<EmojiMasterAdminItem> {
    const result = await database.prepare(`
      SELECT id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order, updated_at,
        CASE WHEN EXISTS (
          SELECT 1
          FROM fanmark_emoji_master_release_staging AS released
          JOIN fanmark_emoji_master_release_imports AS release
            ON release.release_version = released.release_version
          WHERE release.status = 'ready' AND released.id = emoji_master.id
        ) THEN 1 ELSE 0 END AS release_protected
      FROM emoji_master WHERE id = ? LIMIT 1
    `).bind(id.toLowerCase()).first<Record<string, unknown>>();
    if (!result) fail("emoji_not_found", 404);
    return mapItem(result);
  }

  return {
    async list(url: URL): Promise<EmojiMasterAdminPage> {
      const { page, pageSize, search } = parsePagination(url);
      const { where, bindings } = queryFilter(search);
      const offset = (page - 1) * pageSize;
      try {
        const [countRow, activeReleaseVersion, itemResult] = await Promise.all([
          bindIfNeeded(database.prepare(`SELECT count(*) AS total FROM emoji_master ${where}`), bindings)
            .first<{ total?: unknown }>(),
          activeVersion(database),
          database.prepare(`
            SELECT id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order, updated_at,
              CASE WHEN EXISTS (
                SELECT 1
                FROM fanmark_emoji_master_release_staging AS released
                JOIN fanmark_emoji_master_release_imports AS release
                  ON release.release_version = released.release_version
                WHERE release.status = 'ready' AND released.id = emoji_master.id
              ) THEN 1 ELSE 0 END AS release_protected
            FROM emoji_master
            ${where}
            ORDER BY (sort_order IS NOT NULL), sort_order, emoji COLLATE BINARY
            LIMIT ? OFFSET ?
          `).bind(...bindings, pageSize, offset).all<Record<string, unknown>>(),
        ]);
        const items = assertD1Rows(itemResult).map(mapItem);
        if (!countRow || !Number.isSafeInteger(countRow.total) || (countRow.total as number) < 0) fail("emoji_master_read_failed", 503);
        return {
          schemaVersion: 1,
          activeReleaseVersion,
          page,
          pageSize,
          total: countRow.total as number,
          items,
        };
      } catch (error) {
        if (error instanceof EmojiMasterAdminError) throw error;
        fail("emoji_master_read_failed", 503);
      }
    },

    async create(value: unknown): Promise<EmojiMasterAdminItem> {
      const input = parseInput(value);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        const result = await database.prepare(
          `INSERT INTO emoji_master (id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, input.emoji, input.shortName, JSON.stringify(input.keywords), input.category,
          input.subcategory, JSON.stringify(input.codepoints), input.sortOrder, now).run();
        if (result?.success !== true || result.meta?.changes !== 1) fail("emoji_master_write_failed", 503);
        return await getById(id);
      } catch (error) {
        if (error instanceof EmojiMasterAdminError) throw error;
        if (String(error).includes("UNIQUE constraint")) fail("emoji_conflict", 409);
        fail("emoji_master_write_failed", 503);
      }
    },

    async update(id: string, expectedUpdatedAt: unknown, value: unknown): Promise<EmojiMasterAdminItem> {
      if (!UUID_RE.test(id) || typeof expectedUpdatedAt !== "string" || expectedUpdatedAt.length > 64) fail("invalid_request");
      const expectedTime = Date.parse(expectedUpdatedAt);
      if (!Number.isFinite(expectedTime)) fail("invalid_request");
      const input = parseInput(value);
      const now = new Date(Math.max(Date.now(), expectedTime + 1)).toISOString();
      try {
        const result = await database.prepare(
          `UPDATE emoji_master
           SET emoji = ?, short_name = ?, keywords = ?, category = ?, subcategory = ?, codepoints = ?, sort_order = ?, updated_at = ?
           WHERE id = ? AND updated_at = ?`,
        ).bind(input.emoji, input.shortName, JSON.stringify(input.keywords), input.category,
          input.subcategory, JSON.stringify(input.codepoints), input.sortOrder, now, id.toLowerCase(), expectedUpdatedAt).run();
        if (result?.success !== true) fail("emoji_master_write_failed", 503);
        if (result.meta?.changes !== 1) {
          const exists = await database.prepare("SELECT id FROM emoji_master WHERE id = ? LIMIT 1")
            .bind(id.toLowerCase()).first();
          fail(exists ? "emoji_edit_conflict" : "emoji_not_found", exists ? 409 : 404);
        }
        return await getById(id);
      } catch (error) {
        if (error instanceof EmojiMasterAdminError) throw error;
        if (String(error).includes("emoji_master_released_identity_immutable")) fail("emoji_identity_release_protected", 409);
        if (String(error).includes("UNIQUE constraint")) fail("emoji_conflict", 409);
        fail("emoji_master_write_failed", 503);
      }
    },

    async import(recordsValue: unknown): Promise<{ importedCount: number }> {
      if (!Array.isArray(recordsValue) || recordsValue.length < 1 || recordsValue.length > MAX_IMPORT_ROWS) {
        fail("invalid_import_batch");
      }
      const records = recordsValue.map(parseInput);
      if (new Set(records.map((record) => record.emoji)).size !== records.length) fail("duplicate_import_emoji");
      const now = new Date().toISOString();
      const sql = `INSERT INTO emoji_master (id, emoji, short_name, keywords, category, subcategory, codepoints, sort_order, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(emoji) DO UPDATE SET
          short_name = excluded.short_name,
          keywords = excluded.keywords,
          category = excluded.category,
          subcategory = excluded.subcategory,
          codepoints = excluded.codepoints,
          sort_order = excluded.sort_order,
          updated_at = CASE
            WHEN julianday(excluded.updated_at) > julianday(emoji_master.updated_at) THEN excluded.updated_at
            ELSE strftime('%Y-%m-%dT%H:%M:%fZ', emoji_master.updated_at, '+0.001 seconds')
          END`;
      try {
        const results = await database.batch(records.map((record) => database.prepare(sql).bind(
          crypto.randomUUID(), record.emoji, record.shortName, JSON.stringify(record.keywords), record.category,
          record.subcategory, JSON.stringify(record.codepoints), record.sortOrder, now,
        )));
        if (results.some((result) => result?.success !== true)) fail("emoji_master_write_failed", 503);
        return { importedCount: records.length };
      } catch (error) {
        if (error instanceof EmojiMasterAdminError) throw error;
        if (String(error).includes("emoji_master_released_identity_immutable")) fail("emoji_identity_release_protected", 409);
        if (String(error).includes("UNIQUE constraint")) fail("emoji_conflict", 409);
        fail("emoji_master_write_failed", 503);
      }
    },

    async delete(_id: string): Promise<never> {
      fail("emoji_deletion_requires_release_review", 409);
    },

    getById,
  };
}

export const EMOJI_MASTER_ADMIN_MAX_IMPORT_ROWS = MAX_IMPORT_ROWS;
