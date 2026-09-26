import { selectD1Database, type Env } from "./repository";
import type { StorageAuthResolver } from "./storage-r2";

const PATH = "/api/fanmarks/register";
const METHODS = "POST, OPTIONS";
const MAX_BODY_BYTES = 24 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ACCESS_TYPES = new Set(["inactive", "redirect", "text", "profile"]);
const SKIN_TONES = /[\u{1f3fb}-\u{1f3ff}]/gu;
const VARIATION_SELECTORS = /\uFE0F+/gu;

interface RegistrationInput {
  userInputFanmark: string;
  emojiIds: string[];
  normalizedEmojiIds?: string[];
  accessType: "inactive" | "redirect" | "text" | "profile";
  displayName?: string;
  defaultFanmarkName?: string;
  targetUrl?: string;
  textContent?: string;
  createProfile: boolean;
}

interface EmojiRow {
  id: unknown;
  emoji: unknown;
  codepoints: unknown;
}

interface FanmarkRow {
  id: unknown;
  short_id: unknown;
  user_input_fanmark: unknown;
  emoji_ids: unknown;
  normalized_emoji_ids: unknown;
  normalized_emoji: unknown;
  status: unknown;
  tier_level: unknown;
}

interface TierRow {
  tier_level: unknown;
  display_name: unknown;
  initial_license_days: unknown;
}

interface ActiveCatalogRow {
  release_version: unknown;
  expected_count: unknown;
  actual_count: unknown;
  status: unknown;
}

interface LicenseRow {
  id: unknown;
  status: unknown;
  grace_expires_at: unknown;
}

export class FanmarkRegistrationError extends Error {
  constructor(readonly code: string, readonly status: number, readonly publicMessage?: string) {
    super(code);
    this.name = "FanmarkRegistrationError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set("cache-control", "no-store");
  result.set("content-type", "application/json; charset=utf-8");
  result.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: result });
}

function corsHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("access-control-allow-credentials", "true");
  headers.set("vary", "Origin");
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new FanmarkRegistrationError("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new FanmarkRegistrationError("request_too_large", 413);
  }
  if (!request.body) throw new FanmarkRegistrationError("invalid_request", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new FanmarkRegistrationError("request_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new FanmarkRegistrationError("invalid_json", 400);
  }
}

function optionalString(value: unknown, maxLength: number, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new FanmarkRegistrationError(`invalid_${field}`, 400);
  }
  return value;
}

function parseInput(value: unknown): RegistrationInput {
  if (!isRecord(value)) throw new FanmarkRegistrationError("invalid_request", 400);
  if (typeof value.user_input_fanmark !== "string" || value.user_input_fanmark.length < 1 ||
      value.user_input_fanmark.length > 50 || !value.user_input_fanmark.trim()) {
    throw new FanmarkRegistrationError("invalid_user_input_fanmark", 400);
  }
  const emojiIds = value.emoji_ids;
  if (!Array.isArray(emojiIds) || emojiIds.length < 1 ||
      emojiIds.some((id) => typeof id !== "string" || !UUID.test(id))) {
    throw new FanmarkRegistrationError("invalid_emoji_ids", 400);
  }
  if (emojiIds.length > 5) {
    throw new FanmarkRegistrationError("invalid_emoji_count", 400, "Emoji combination must contain 1-5 emojis");
  }
  let normalizedEmojiIds: string[] | undefined;
  if (value.normalized_emoji_ids !== undefined && value.normalized_emoji_ids !== null) {
    if (!Array.isArray(value.normalized_emoji_ids) || value.normalized_emoji_ids.length !== emojiIds.length ||
        value.normalized_emoji_ids.some((id) => typeof id !== "string" || !UUID.test(id))) {
      throw new FanmarkRegistrationError("invalid_normalized_emoji_ids", 400);
    }
    normalizedEmojiIds = (value.normalized_emoji_ids as string[]).map((id) => id.toLowerCase());
  }
  const accessType = value.accessType === undefined ? "inactive" : value.accessType;
  if (typeof accessType !== "string" || !ACCESS_TYPES.has(accessType)) {
    throw new FanmarkRegistrationError("invalid_access_type", 400);
  }
  const targetUrl = optionalString(value.targetUrl, 2_000, "target_url");
  if (targetUrl !== undefined) {
    try {
      const parsed = new URL(targetUrl);
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) throw new Error();
    } catch {
      throw new FanmarkRegistrationError("invalid_target_url", 400);
    }
  }
  if (value.createProfile !== undefined && typeof value.createProfile !== "boolean") {
    throw new FanmarkRegistrationError("invalid_create_profile", 400);
  }
  return {
    userInputFanmark: value.user_input_fanmark,
    emojiIds: (emojiIds as string[]).map((id) => id.toLowerCase()),
    normalizedEmojiIds,
    accessType: accessType as RegistrationInput["accessType"],
    displayName: optionalString(value.displayName, 100, "display_name"),
    defaultFanmarkName: optionalString(value.defaultFanmarkName, 100, "default_fanmark_name"),
    targetUrl,
    textContent: optionalString(value.textContent, 5_000, "text_content"),
    createProfile: value.createProfile === true,
  };
}

function parseArray(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.every((item) => typeof item === "string") ? value : null;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed as string[] : null;
  } catch {
    return null;
  }
}

function parseCodepoints(value: unknown): string[] {
  const parsed = parseArray(value);
  if (!parsed || parsed.some((item) => !/^[0-9A-F]{4,6}$/u.test(item))) {
    throw new FanmarkRegistrationError("emoji_catalog_unavailable", 503);
  }
  return parsed;
}

function codepointKey(value: string[]): string {
  return JSON.stringify(value);
}

function compareEmoji(value: string): string {
  return value.normalize("NFC").replace(VARIATION_SELECTORS, "");
}

function microsecondTimestamp(date: Date): string {
  return date.toISOString().replace(/\.(\d{3})Z$/u, (_match, millis: string) => `.${millis}000Z`);
}

function computedLicenseEnd(now: Date, days: number | null): string | null {
  if (days === null) return null;
  if (!Number.isSafeInteger(days)) throw new FanmarkRegistrationError("fanmark_tier_unavailable", 503);
  const raw = new Date(now);
  raw.setUTCDate(raw.getUTCDate() + days);
  if (raw.getUTCHours() || raw.getUTCMinutes() || raw.getUTCSeconds() || raw.getUTCMilliseconds()) {
    raw.setUTCHours(0, 0, 0, 0);
    raw.setUTCDate(raw.getUTCDate() + 1);
  }
  return raw.toISOString();
}

function classifyTier(emojiIds: string[]): number {
  const count = emojiIds.length;
  const uniqueCount = new Set(emojiIds).size;
  if (count === 1) return 4;
  if (uniqueCount === 1 && count >= 2 && count <= 5) return 3;
  if (count >= 4) return 1;
  if (count === 3) return 2;
  if (count === 2) return 3;
  return 1;
}

function generateShortId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

async function validateCatalog(
  master: D1Database,
  input: RegistrationInput,
  business: D1Database,
): Promise<{ originalIds: string[]; normalizedIds: string[]; normalizedEmoji: string; tier: TierRow; }> {
  const activeCatalog = await master.prepare(`
    SELECT a.release_version,
      i.row_count AS expected_count,
      (SELECT COUNT(*) FROM fanmark_emoji_master_release_staging AS records
        WHERE records.release_version = a.release_version) AS actual_count,
      i.status
    FROM fanmark_emoji_master_active_release AS a
    JOIN fanmark_emoji_master_release_imports AS i ON i.release_version = a.release_version
    WHERE a.singleton_id = 1
  `).first<ActiveCatalogRow>();
  if (!activeCatalog || typeof activeCatalog.release_version !== "string" ||
      activeCatalog.status !== "ready" || !Number.isSafeInteger(activeCatalog.expected_count) ||
      activeCatalog.expected_count !== activeCatalog.actual_count ||
      (activeCatalog.expected_count as number) < 1 || (activeCatalog.expected_count as number) > 10_000) {
    throw new FanmarkRegistrationError("emoji_catalog_unavailable", 503);
  }
  const releaseVersion = activeCatalog.release_version;
  const placeholders = input.emojiIds.map(() => "?").join(",");
  const emojiResult = await master.prepare(
    `SELECT id, emoji, codepoints_json AS codepoints
      FROM fanmark_emoji_master_release_staging
      WHERE release_version = ? AND id IN (${placeholders})`,
  ).bind(releaseVersion, ...input.emojiIds).all<EmojiRow>();
  if (!Array.isArray(emojiResult.results)) {
    throw new FanmarkRegistrationError("emoji_catalog_unavailable", 503);
  }
  const rows = new Map<string, { emoji: string; codepoints: string[] }>();
  for (const row of emojiResult.results) {
    if (typeof row.id !== "string" || typeof row.emoji !== "string") {
      throw new FanmarkRegistrationError("emoji_catalog_unavailable", 503);
    }
    rows.set(row.id.toLowerCase(), { emoji: row.emoji, codepoints: parseCodepoints(row.codepoints) });
  }
  const ordered = input.emojiIds.map((id) => rows.get(id));
  if (ordered.some((row) => !row)) throw new FanmarkRegistrationError("emoji_not_found", 400);
  const originals = ordered as Array<{ emoji: string; codepoints: string[] }>;
  const cleanInput = input.userInputFanmark.replace(/\s/gu, "");
  if (compareEmoji(cleanInput) !== compareEmoji(originals.map((row) => row.emoji).join(""))) {
    throw new FanmarkRegistrationError("emoji_input_mismatch", 400);
  }
  const maxRow = await business.prepare(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'max_emoji_characters' AND is_public = 1 LIMIT 1",
  ).first<{ setting_value: unknown }>();
  const maxCount = maxRow && typeof maxRow.setting_value === "string" ? Number.parseInt(maxRow.setting_value, 10) : 5;
  if (input.emojiIds.length < 1 || (Number.isFinite(maxCount) && input.emojiIds.length > maxCount)) {
    throw new FanmarkRegistrationError("invalid_emoji_count", 400,
      `Emoji combination must contain 1-${maxCount} emojis`);
  }

  const normalizedCodepoints = originals.map((row) => [...row.codepoints]);
  // The Unicode code points are stored as ASCII hex; remove the five exact modifiers.
  for (const codepoints of normalizedCodepoints) {
    for (let index = codepoints.length - 1; index >= 0; index -= 1) {
      const point = Number.parseInt(codepoints[index], 16);
      if (point >= 0x1f3fb && point <= 0x1f3ff) codepoints.splice(index, 1);
    }
  }
  const candidates = [...new Set(normalizedCodepoints.map(codepointKey))];
  const candidateRows = candidates.length === 0 ? [] : (await master.prepare(
    `SELECT id, codepoints_json AS codepoints FROM fanmark_emoji_master_release_staging
      WHERE release_version = ? AND codepoints_json IN (${candidates.map(() => "?").join(",")})`,
  ).bind(releaseVersion, ...candidates).all<{ id: unknown; codepoints: unknown }>()).results;
  const byCodepoints = new Map<string, string[]>();
  for (const row of candidateRows) {
    if (typeof row.id !== "string") throw new FanmarkRegistrationError("emoji_catalog_unavailable", 503);
    const key = codepointKey(parseCodepoints(row.codepoints));
    const ids = byCodepoints.get(key) ?? [];
    ids.push(row.id.toLowerCase());
    byCodepoints.set(key, ids);
  }
  const normalizedIds = normalizedCodepoints.map((points) => {
    const ids = byCodepoints.get(codepointKey(points));
    if (!ids || ids.length !== 1) throw new FanmarkRegistrationError("emoji_normalization_unavailable", 400);
    return ids[0];
  });
  if (input.normalizedEmojiIds &&
      (input.normalizedEmojiIds.length !== normalizedIds.length || input.normalizedEmojiIds.some((id, index) => id !== normalizedIds[index]))) {
    throw new FanmarkRegistrationError("invalid_normalized_emoji_ids", 400);
  }

  const normalizedEmoji = cleanInput.replace(SKIN_TONES, "");
  const tierLevel = classifyTier(normalizedIds);
  const tier = await master.prepare(
    "SELECT tier_level, display_name, initial_license_days FROM fanmark_tiers WHERE tier_level = ? AND is_active = 1 LIMIT 1",
  ).bind(tierLevel).first<TierRow>();
  if (!tier || typeof tier.display_name !== "string" ||
      (tier.initial_license_days !== null && typeof tier.initial_license_days !== "number")) {
    throw new FanmarkRegistrationError("fanmark_tier_unavailable", 503);
  }
  return { originalIds: input.emojiIds, normalizedIds, normalizedEmoji, tier };
}

function blockedGuardSql(alias = "f"): string {
  return `NOT EXISTS (
    SELECT 1 FROM fanmark_licenses AS active
    WHERE active.fanmark_id = ${alias}.id AND active.status = 'active'
  ) AND NOT EXISTS (
    SELECT 1 FROM fanmark_licenses AS grace
    WHERE grace.fanmark_id = ${alias}.id AND grace.status = 'grace'
      AND grace.grace_expires_at IS NOT NULL AND grace.grace_expires_at > ?
  ) AND NOT EXISTS (
    SELECT 1 FROM fanmark_licenses AS grace
    JOIN fanmark_lottery_entries AS pending ON pending.license_id = grace.id
    WHERE grace.fanmark_id = ${alias}.id AND grace.status = 'grace'
      AND grace.grace_expires_at IS NOT NULL AND grace.grace_expires_at <= ?
      AND pending.entry_status = 'pending'
  )`;
}

async function currentFanmark(db: D1Database, ids: string[], normalizedEmoji: string): Promise<FanmarkRow | null> {
  const row = await db.prepare(`
    SELECT id, short_id, user_input_fanmark, emoji_ids, normalized_emoji_ids,
      normalized_emoji, status, tier_level
    FROM fanmarks WHERE normalized_emoji_ids = ? OR normalized_emoji = ? LIMIT 2
  `).bind(JSON.stringify(ids), normalizedEmoji).all<FanmarkRow>();
  if (!Array.isArray(row.results)) throw new FanmarkRegistrationError("registration_unavailable", 503);
  if (row.results.length > 1) throw new FanmarkRegistrationError("fanmark_identity_conflict", 503);
  return row.results[0] ?? null;
}

async function explainConflict(db: D1Database, fanmark: FanmarkRow, now: string): Promise<void> {
  if (fanmark.status !== "active") throw new FanmarkRegistrationError("fanmark_inactive", 403);
  const result = await db.prepare(
    "SELECT id, status, grace_expires_at FROM fanmark_licenses WHERE fanmark_id = ? AND status IN ('active','grace') ORDER BY created_at DESC LIMIT 3",
  ).bind(fanmark.id).all<LicenseRow>();
  if (!Array.isArray(result.results)) throw new FanmarkRegistrationError("registration_unavailable", 503);
  if (result.results.length > 1) throw new FanmarkRegistrationError("license_state_conflict", 503);
  const license = result.results[0];
  if (license?.status === "active") throw new FanmarkRegistrationError("fanmark_taken", 409);
  if (license?.status === "grace" && typeof license.grace_expires_at === "string") {
    if (license.grace_expires_at > now) {
      const error = new FanmarkRegistrationError("grace_period", 409);
      (error as FanmarkRegistrationError & { available_at?: string }).available_at = license.grace_expires_at;
      throw error;
    }
    const pending = await db.prepare(
      "SELECT id FROM fanmark_lottery_entries WHERE license_id = ? AND entry_status = 'pending' LIMIT 1",
    ).bind(license.id).first<{ id: unknown }>();
    if (pending) {
      const error = new FanmarkRegistrationError("lottery_pending", 409);
      (error as FanmarkRegistrationError & { available_at?: string }).available_at = license.grace_expires_at;
      throw error;
    }
  }
}

function baseDatabase(env: Env): D1Database {
  if (env.FANMARK_REGISTRATION_BACKEND?.trim() !== "d1") {
    throw new FanmarkRegistrationError("registration_unavailable", 503);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") throw new FanmarkRegistrationError("server_misconfigured", 500);
  const database = selectD1Database(env, "business");
  if (!database) throw new FanmarkRegistrationError("server_misconfigured", 500);
  return database;
}

async function register(
  request: Request,
  env: Env,
  db: D1Database,
  master: D1Database,
  userId: string,
  input: RegistrationInput,
  clock: () => Date,
): Promise<Response> {
  const validated = await validateCatalog(master, input, db);
  const nowDate = clock();
  const now = microsecondTimestamp(nowDate);
  const fanmark = await currentFanmark(db, validated.normalizedIds, validated.normalizedEmoji);
  if (fanmark) {
    if (fanmark.status !== "active") throw new FanmarkRegistrationError("fanmark_inactive", 403);
    try {
      const probe = await db.prepare(
        "SELECT id, status, grace_expires_at FROM fanmark_licenses WHERE fanmark_id = ? AND status IN ('active','grace') ORDER BY created_at DESC LIMIT 3",
      ).bind(fanmark.id).all<LicenseRow>();
      if (!Array.isArray(probe.results)) throw new FanmarkRegistrationError("registration_unavailable", 503);
      if (probe.results.length > 1) throw new FanmarkRegistrationError("license_state_conflict", 503);
      if (probe.results.length === 1) await explainConflict(db, fanmark, now);
    } catch (error) {
      if (error instanceof FanmarkRegistrationError) throw error;
      throw new FanmarkRegistrationError("registration_unavailable", 503);
    }
  }

  const fanmarkId = typeof fanmark?.id === "string" ? fanmark.id : crypto.randomUUID();
  let shortId = typeof fanmark?.short_id === "string" ? fanmark.short_id : "";
  if (!shortId) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = generateShortId();
      const exists = await db.prepare("SELECT id FROM fanmarks WHERE short_id = ? LIMIT 1").bind(candidate).first<{ id: unknown }>();
      if (!exists) { shortId = candidate; break; }
    }
    if (!shortId) throw new FanmarkRegistrationError("short_id_unavailable", 500);
  }
  const licenseId = crypto.randomUUID();
  const auditRequestId = crypto.randomUUID();
  const licenseDays = validated.tier.initial_license_days as number | null;
  const licenseEnd = computedLicenseEnd(nowDate, licenseDays);
  const inputIds = typeof fanmark?.emoji_ids === "string" ? parseArray(fanmark.emoji_ids) : null;
  const normalizedIds = typeof fanmark?.normalized_emoji_ids === "string" ? parseArray(fanmark.normalized_emoji_ids) : null;
  if (fanmark && ((fanmark.emoji_ids && !inputIds) || (fanmark.normalized_emoji_ids && !normalizedIds))) {
    throw new FanmarkRegistrationError("registration_unavailable", 503);
  }
  const storedEmojiIds = inputIds?.length ? inputIds : validated.originalIds;
  const storedNormalizedIds = normalizedIds?.length ? normalizedIds : validated.normalizedIds;
  const storedNormalizedEmoji = normalizedIds?.length && typeof fanmark?.normalized_emoji === "string"
    ? fanmark.normalized_emoji
    : validated.normalizedEmoji;
  const userInput = typeof fanmark?.user_input_fanmark === "string" ? fanmark.user_input_fanmark : input.userInputFanmark;
  const licenseGuard = blockedGuardSql("f");
  const statements: D1PreparedStatement[] = [];
  if (fanmark) {
    statements.push(db.prepare(`
      UPDATE fanmarks SET emoji_ids = ?, normalized_emoji_ids = ?, normalized_emoji = ?, tier_level = ?, updated_at = ?
      WHERE id = ? AND status = 'active' AND ${blockedGuardSql("fanmarks")}
    `).bind(JSON.stringify(storedEmojiIds), JSON.stringify(storedNormalizedIds), storedNormalizedEmoji,
      validated.tier.tier_level, now, fanmarkId, now, now));
  } else {
    statements.push(db.prepare(`
      INSERT INTO fanmarks (id, user_input_fanmark, normalized_emoji, short_id, status, created_at, updated_at,
        emoji_ids, normalized_emoji_ids, tier_level)
      SELECT ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM fanmarks WHERE normalized_emoji_ids = ? OR normalized_emoji = ?)
      ON CONFLICT DO NOTHING
    `).bind(fanmarkId, input.userInputFanmark, validated.normalizedEmoji, shortId, now, now,
      JSON.stringify(validated.originalIds), JSON.stringify(validated.normalizedIds), validated.tier.tier_level,
      JSON.stringify(validated.normalizedIds), validated.normalizedEmoji));
  }
  statements.push(db.prepare(`
    INSERT INTO fanmark_licenses
      (id, fanmark_id, user_id, license_start, license_end, status, is_initial_license, created_at, updated_at,
       grace_expires_at, display_fanmark)
    SELECT ?, f.id, ?, ?, ?, 'active', 1, ?, ?, NULL, ?
    FROM fanmarks AS f
    WHERE f.id = ? AND f.status = 'active' AND ${licenseGuard}
  `).bind(licenseId, userId, now, licenseEnd, now, now, input.userInputFanmark, fanmarkId, now, now));

  const chosenName = input.displayName || input.defaultFanmarkName || null;
  statements.push(db.prepare(`
    INSERT INTO fanmark_basic_configs (license_id, fanmark_name, access_type, created_at, updated_at)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)
    ON CONFLICT(license_id) DO UPDATE SET fanmark_name = excluded.fanmark_name,
      access_type = excluded.access_type, updated_at = excluded.updated_at
  `).bind(licenseId, chosenName, input.accessType, now, now, licenseId));
  if (input.accessType === "redirect" && input.targetUrl) {
    statements.push(db.prepare(`
      INSERT INTO fanmark_redirect_configs (license_id, target_url, created_at, updated_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)
      ON CONFLICT(license_id) DO UPDATE SET target_url = excluded.target_url, updated_at = excluded.updated_at
    `).bind(licenseId, input.targetUrl, now, now, licenseId));
  }
  if (input.accessType === "text" && input.textContent) {
    statements.push(db.prepare(`
      INSERT INTO fanmark_messageboard_configs (license_id, content, created_at, updated_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)
      ON CONFLICT(license_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).bind(licenseId, input.textContent, now, now, licenseId));
  }
  if (input.createProfile) {
    statements.push(db.prepare(`
      INSERT INTO fanmark_profiles (license_id, display_name, bio, is_public, created_at, updated_at)
      SELECT ?, ?, ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)
      ON CONFLICT(license_id) DO NOTHING
    `).bind(licenseId, input.displayName ?? null,
      `Welcome to ${(input.displayName || input.userInputFanmark)}'s profile!`, now, now, licenseId));
  }
  const metadata = {
    user_input_fanmark: input.userInputFanmark,
    normalized_emoji: validated.normalizedEmoji,
    emoji_ids: storedEmojiIds,
    normalized_emoji_ids: storedNormalizedIds,
    short_id: shortId,
    access_type: input.accessType,
    display_name: input.displayName ?? null,
    create_profile: input.createProfile,
    tier_level: validated.tier.tier_level,
    tier_display_name: validated.tier.display_name,
    initial_license_days: licenseDays,
  };
  statements.push(db.prepare(`
    INSERT INTO audit_logs (user_id, action, resource_type, resource_id, request_id, metadata, created_at)
    SELECT ?, 'register_fanmark', 'fanmark', ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM fanmark_licenses WHERE id = ?)
  `).bind(userId, fanmarkId, auditRequestId, JSON.stringify(metadata), now, licenseId));
  try {
    await db.batch(statements);
  } catch {
    throw new FanmarkRegistrationError("registration_unavailable", 503);
  }

  const license = await db.prepare("SELECT id FROM fanmark_licenses WHERE id = ? AND fanmark_id = ? AND user_id = ?")
    .bind(licenseId, fanmarkId, userId).first<{ id: unknown }>();
  if (!license) {
    const current = await currentFanmark(db, validated.normalizedIds, validated.normalizedEmoji);
    if (current) await explainConflict(db, current, now);
    throw new FanmarkRegistrationError("fanmark_taken", 409);
  }
  const saved = await db.prepare("SELECT id, short_id, user_input_fanmark, emoji_ids, normalized_emoji_ids FROM fanmarks WHERE id = ?")
    .bind(fanmarkId).first<FanmarkRow>();
  if (!saved || typeof saved.id !== "string" || typeof saved.short_id !== "string" ||
      typeof saved.user_input_fanmark !== "string") throw new FanmarkRegistrationError("registration_unavailable", 503);
  const returnedIds = parseArray(saved.emoji_ids);
  const returnedNormalizedIds = parseArray(saved.normalized_emoji_ids);
  if (!returnedIds || !returnedNormalizedIds) throw new FanmarkRegistrationError("registration_unavailable", 503);
  return json({
    success: true,
    fanmark: {
      id: saved.id,
      user_input_fanmark: saved.user_input_fanmark,
      display_fanmark: input.userInputFanmark,
      emoji_ids: returnedIds,
      normalized_emoji_ids: returnedNormalizedIds,
      short_id: saved.short_id,
      canonical_url: `/a/${saved.short_id}`,
      display_url: `/emoji/${encodeURIComponent(saved.user_input_fanmark)}`,
      tier_level: validated.tier.tier_level,
      tier_display_name: validated.tier.display_name,
      initial_license_days: licenseDays,
    },
  }, 201);
}

export function isFanmarkRegistrationPath(pathname: string): boolean {
  return pathname === PATH;
}

function publicErrorMessage(code: string): string {
  const messages: Record<string, string> = {
    authentication_required: "Authentication required",
    auth_unavailable: "Authentication is temporarily unavailable",
    fanmark_inactive: "This emoji pattern is not active and cannot be registered",
    fanmark_taken: "This emoji combination is already taken",
    grace_period: "This fanmark is in grace period and cannot be acquired yet",
    lottery_pending: "Lottery pending. Please wait for the result.",
    invalid_user_input_fanmark: "Emoji combination is required or too long",
    invalid_emoji_ids: "Valid emoji IDs are required to register a fanmark",
    emoji_not_found: "Emoji not found in master",
    emoji_input_mismatch: "Emoji input does not match emoji IDs",
    invalid_emoji_count: "Emoji combination must contain 1-5 emojis",
    invalid_normalized_emoji_ids: "Normalized emoji IDs do not match the emoji sequence",
    invalid_access_type: "Invalid access type",
    invalid_target_url: "Only valid HTTP and HTTPS URLs are allowed",
    invalid_display_name: "Display name is too long",
    invalid_default_fanmark_name: "Default fanmark name is too long",
    invalid_text_content: "Text content is too long",
    invalid_create_profile: "Invalid profile option",
    invalid_request: "Invalid registration request",
    invalid_json: "Invalid JSON request",
    json_content_type_required: "JSON content type required",
    request_too_large: "Registration request is too large",
  };
  return messages[code] ?? "Fanmark registration is temporarily unavailable";
}

export async function handleFanmarkRegistrationRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
  clock: () => Date = () => new Date(),
): Promise<Response> {
  const headers = corsHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  if (request.method.toUpperCase() === "OPTIONS") {
    headers.set("allow", METHODS);
    return new Response(null, { status: 204, headers });
  }
  if (request.method.toUpperCase() !== "POST") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  try {
    const db = baseDatabase(env);
    const master = selectD1Database(env, "master");
    if (!master) throw new FanmarkRegistrationError("server_misconfigured", 500);
    const auth = await resolveAuth(request, env);
    if (!auth.available) throw new FanmarkRegistrationError("auth_unavailable", 503);
    if (!auth.userId) throw new FanmarkRegistrationError("authentication_required", 401);
    const input = parseInput(await readBody(request));
    return await register(request, env, db, master, auth.userId, input, clock).then((response) => {
      const merged = new Headers(response.headers);
      headers.forEach((value, key) => merged.set(key, value));
      return new Response(response.body, { status: response.status, headers: merged });
    });
  } catch (error) {
    const mapped = error instanceof FanmarkRegistrationError
      ? error
      : new FanmarkRegistrationError("registration_unavailable", 503);
    const body: Record<string, unknown> = {
      error: mapped.publicMessage ?? publicErrorMessage(mapped.code),
      error_code: mapped.code,
    };
    const availableAt = (mapped as FanmarkRegistrationError & { available_at?: string }).available_at;
    if (availableAt) {
      body.available_at = availableAt;
      body.type = mapped.code;
    }
    return json(body, mapped.status, headers);
  }
}
