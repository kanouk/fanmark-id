import bcrypt from "bcryptjs";

const COOKIE_NAME = "__Host-fanmark_access";
const MAX_BODY_BYTES = 4096;
const PROOF_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_BCRYPT_COST = 10;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKIN_TONE_CODEPOINTS = new Set(["1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"]);
const DUMMY_BCRYPT_HASH =
  "$2b$10$EMIaSXLiF70qXWKgX4HYkuVEN64Td.KjBaV89Eef1aNvJCzvMe1qy";
const encoder = new TextEncoder();
const PUBLIC_SOCIAL_KEYS = new Set([
  "instagram", "tiktok", "x", "youtube", "bereal", "line", "threads", "bluesky",
  "github", "discord", "snapchat", "twitch", "facebook", "website",
]);
const PUBLIC_THEME_KEYS = new Set([
  "cover_image_url", "cover_image_dimensions", "cover_image_position",
  "profile_image_url", "theme_color", "button_style",
]);

let verificationTestHooks = {};

/**
 * Test-only synchronization hooks. The dedicated proof Worker exposes no
 * route for these hooks, and the default Worker never imports this module.
 */
export function setVerificationTestHooks(hooks = {}) {
  verificationTestHooks = hooks && typeof hooks === "object" ? hooks : {};
}

function nowMs(env) {
  if (typeof verificationTestHooks.now === "function") {
    const value = Number(verificationTestHooks.now());
    if (Number.isFinite(value)) return value;
  }
  return Date.now();
}

function iso6(value) {
  return new Date(value).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

function bytes(value) {
  return encoder.encode(value).byteLength;
}

function base64Url(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function hmacDigestHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    { name: "HMAC" },
    key,
    encoder.encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(env, label, value) {
  const secret = String(env.VERIFIED_ACCESS_SECRET || "");
  if (secret.length < 16) throw new Error("verification secret unavailable");
  return hmacDigestHex(secret, `${label}\0${value}`);
}

function errorResponse(request, env, status, code) {
  return jsonResponse(request, env, { error: code }, status);
}

function configuredOrigins(env) {
  const raw = String(env.VERIFIED_ACCESS_ORIGINS || env.VERIFIED_ACCESS_ORIGIN || "");
  return new Set(raw.split(",").map((origin) => origin.trim()).filter((origin) => {
    if (!origin || origin === "*") return false;
    try {
      const parsed = new URL(origin);
      return parsed.origin === origin && (
        parsed.protocol === "https:" ||
        (env.VERIFIED_ACCESS_TEST === "1" && parsed.hostname === "example.test")
      );
    } catch {
      return false;
    }
  }));
}

function corsHeaders(request, env) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    vary: "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin && configuredOrigins(env).has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
  }
  return headers;
}

function jsonResponse(request, env, body, status = 200, extraHeaders = {}) {
  const headers = corsHeaders(request, env);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function emptyResponse(request, env, status = 204, extraHeaders = {}) {
  const headers = corsHeaders(request, env);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  headers.delete("content-type");
  return new Response(null, { status, headers });
}

function originAllowed(request, env) {
  const origin = request.headers.get("Origin");
  if (request.method === "POST" || origin) {
    return typeof origin === "string" && configuredOrigins(env).has(origin);
  }
  // Fetch Metadata is the explicit same-origin signal for browser GETs that
  // omit Origin. Requests without either signal remain denied.
  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

async function readJson(request) {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new InputError("invalid_json");
  }
  if (!request.body) throw new InputError("invalid_json");
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        void reader.cancel();
        throw new InputError("invalid_json");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new InputError("invalid_json");
  }
}

class InputError extends Error {}

function normalizeShortId(value) {
  if (typeof value !== "string" || value.length === 0 || bytes(value) > 256) {
    throw new InputError("invalid_selector");
  }
  if (value.includes("/") || value.includes("\\") || value !== value.trim()) {
    throw new InputError("invalid_selector");
  }
  return value;
}

function normalizeLicenseId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new InputError("invalid_selector");
  }
  return value.toLowerCase();
}

function normalizeEmojiIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 5) {
    throw new InputError("invalid_selector");
  }
  const normalized = value.map((entry) => {
    if (typeof entry !== "string" || !UUID_PATTERN.test(entry)) {
      throw new InputError("invalid_selector");
    }
    return entry.toLowerCase();
  });
  return normalized;
}

function parseCodepoints(value) {
  if (typeof value !== "string") throw new InputError("invalid_selector");
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InputError("invalid_selector");
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new InputError("invalid_selector");
  }
  return parsed;
}

async function normalizeEmojiSelector(env, emojiIds) {
  const database = env.D1_TOPOLOGY === "split"
    ? env.MASTER_DB
    : env.MASTER_DB || env.ACCESS_DB;
  if (!database) return null;
  const uniqueIds = [...new Set(emojiIds)];
  const idRows = await database.prepare(
    `SELECT id, codepoints FROM emoji_master WHERE id IN (${uniqueIds.map(() => "?").join(",")})`,
  ).bind(...uniqueIds).all();
  if (!idRows.success || idRows.results.length !== uniqueIds.length) return null;
  const codepointsById = new Map(idRows.results.map((row) => [String(row.id).toLowerCase(), parseCodepoints(row.codepoints)]));
  const normalizedCodepoints = emojiIds.map((id) => {
    const points = codepointsById.get(id);
    return points ? points.filter((point) => !SKIN_TONE_CODEPOINTS.has(point)) : null;
  });
  if (normalizedCodepoints.some((points) => points === null)) return null;
  const uniqueKeys = [...new Set(normalizedCodepoints.map((points) => JSON.stringify(points)))];
  const codepointRows = await database.prepare(
    `SELECT id, codepoints FROM emoji_master WHERE codepoints IN (${uniqueKeys.map(() => "?").join(",")})`,
  ).bind(...uniqueKeys).all();
  if (!codepointRows.success) return null;
  const normalizedByKey = new Map();
  for (const row of codepointRows.results) {
    const key = JSON.stringify(parseCodepoints(row.codepoints));
    if (normalizedByKey.has(key)) return null;
    normalizedByKey.set(key, String(row.id).toLowerCase());
  }
  const normalizedIds = normalizedCodepoints.map((points) => normalizedByKey.get(JSON.stringify(points)) || null);
  return normalizedIds.every(Boolean) ? normalizedIds : null;
}

function canonicalSelector(kind, value) {
  if (kind === "short") return value;
  if (kind === "emoji") return JSON.stringify(value);
  return value;
}

function validatePassword(body) {
  if (!hasExactKeys(body, ["password"]) || !/^\d{4}$/.test(body.password)) {
    throw new InputError("invalid_password");
  }
  return body.password;
}

function validateBcrypt(hash) {
  if (typeof hash !== "string") return false;
  const match = /^\$2([ab])\$(\d{2})\$[./A-Za-z0-9]{53}$/.exec(hash);
  return Boolean(match && Number(match[2]) <= MAX_BCRYPT_COST);
}

function targetEligible(target, nowIso, selectorKind) {
  if (!target) return false;
  if (
    !target.enabled ||
    target.hashScheme !== "bcrypt" ||
    target.credentialArtifactCount !== 1 ||
    target.passwordConfigCount !== 1 ||
    target.basicConfigCount !== 1
  ) return false;
  if (target.licenseStatus !== "active" || target.licenseReturned) return false;
  if (target.fanmarkStatus !== "active") return false;
  if (target.licenseExpiresAt && target.licenseExpiresAt <= nowIso) return false;
  if (target.accessType === "profile" && (!target.profilePublic || target.profileCount !== 1)) return false;
  if (selectorKind === "profile" && target.accessType !== "profile") return false;
  if (target.accessType === "redirect" && target.redirectConfigCount !== 1) return false;
  if (target.accessType === "text" && target.messageboardConfigCount !== 1) return false;
  if (!["profile", "redirect", "text"].includes(target.accessType)) return false;
  return true;
}

function rowToTarget(row) {
  if (!row) return null;
  return {
    licenseId: row.license_id,
    fanmarkId: row.fanmark_id,
    enabled: Number(row.enabled) === 1,
    hashScheme: row.hash_scheme,
    passwordHash: row.password_hash,
    credentialArtifactCount: Number(row.credential_artifact_count),
    passwordConfigCount: Number(row.password_config_count),
    accessType: row.access_type,
    basicConfigCount: Number(row.basic_config_count),
    redirectConfigCount: Number(row.redirect_config_count),
    messageboardConfigCount: Number(row.messageboard_config_count),
    profileCount: Number(row.profile_count),
    licenseStatus: row.license_status,
    licenseReturned: Number(row.license_returned) === 1,
    licenseExpiresAt: row.license_expires_at,
    fanmarkStatus: row.fanmark_status,
    profilePublic: Number(row.profile_public) === 1,
    profileName: row.profile_name,
    profileBio: row.profile_bio,
    profileSocialLinks: row.profile_social_links,
    profileThemeSettings: row.profile_theme_settings,
    targetUrl: row.target_url,
    textContent: row.text_content,
    passwordGeneration: Number(row.password_generation),
    accessGeneration: Number(row.access_generation),
    licenseIncarnation: Number(row.license_incarnation),
  };
}

const TARGET_CTES = `
  password_configs AS (
    SELECT license_id, COUNT(*) AS config_count,
      MAX(access_password) AS access_password,
      MAX(is_enabled) AS is_enabled
    FROM fanmark_password_configs
    GROUP BY license_id
  ),
  basic_configs AS (
    SELECT license_id, COUNT(*) AS config_count,
      MAX(access_type) AS access_type
    FROM fanmark_basic_configs
    GROUP BY license_id
  ),
  redirect_configs AS (
    SELECT license_id, COUNT(*) AS config_count,
      MAX(target_url) AS target_url
    FROM fanmark_redirect_configs
    GROUP BY license_id
  ),
  messageboard_configs AS (
    SELECT license_id, COUNT(*) AS config_count,
      MAX(content) AS content
    FROM fanmark_messageboard_configs
    GROUP BY license_id
  ),
  profile_configs AS (
    SELECT license_id, COUNT(*) AS config_count,
      MAX(is_public) AS is_public,
      MAX(display_name) AS display_name,
      MAX(bio) AS bio,
      MAX(social_links) AS social_links,
      MAX(theme_settings) AS theme_settings
    FROM fanmark_profiles
    GROUP BY license_id
  ),
  credential_evidence_rows AS (
    SELECT a.destination_license_id AS license_id, a.codec_id
    FROM credential_transform_artifacts AS a
    JOIN password_configs AS pc ON pc.license_id = a.destination_license_id
    JOIN fanmark_access_versions AS av ON av.license_id = a.destination_license_id
    JOIN fanmark_license_incarnations AS li ON li.license_id = a.destination_license_id
    WHERE a.state = 'reconciled'
      AND a.destination_relation = 'fanmark_password_configs'
      AND a.destination_column = 'access_password'
      AND a.enabled = pc.is_enabled
      AND a.destination_hash = pc.access_password
      AND a.license_incarnation = li.incarnation
      AND av.license_incarnation = li.incarnation
    UNION ALL
    SELECT r.license_id, r.codec_id
    FROM fanmark_password_runtime_evidence AS r
    JOIN password_configs AS pc ON pc.license_id = r.license_id
    JOIN fanmark_access_versions AS av ON av.license_id = r.license_id
    JOIN fanmark_license_incarnations AS li ON li.license_id = r.license_id
    WHERE r.enabled = pc.is_enabled
      AND r.password_generation = av.password_generation
      AND r.license_incarnation = li.incarnation
      AND av.license_incarnation = li.incarnation
  ),
  credential_artifacts AS (
    SELECT license_id, COUNT(*) AS artifact_count, MAX(codec_id) AS codec_id
    FROM credential_evidence_rows
    GROUP BY license_id
  )
`;

const TARGET_ROW_SELECT = `
  SELECT
    l."id" AS license_id,
    l."fanmark_id" AS fanmark_id,
    pc.is_enabled AS enabled,
    CASE WHEN ca.artifact_count = 1 AND ca.codec_id = 'bcryptjs@3.0.3' THEN 'bcrypt' END AS hash_scheme,
    pc.access_password AS password_hash,
    COALESCE(ca.artifact_count, 0) AS credential_artifact_count,
    COALESCE(pc.config_count, 0) AS password_config_count,
    COALESCE(bc.config_count, 0) AS basic_config_count,
    COALESCE(rc.config_count, 0) AS redirect_config_count,
    COALESCE(mc.config_count, 0) AS messageboard_config_count,
    COALESCE(p.config_count, 0) AS profile_count,
    bc.access_type AS access_type,
    rc.target_url AS target_url,
    mc.content AS text_content,
    p.display_name AS profile_name,
    p.bio AS profile_bio,
    p.social_links AS profile_social_links,
    p.theme_settings AS profile_theme_settings,
    l."status" AS license_status,
    l."is_returned" AS license_returned,
    l."license_end" AS license_expires_at,
    f."status" AS fanmark_status,
    p.is_public AS profile_public,
    v."password_generation" AS password_generation,
    v."access_generation" AS access_generation,
    i."incarnation" AS license_incarnation
  FROM fanmark_licenses l
  JOIN fanmarks f ON f."id" = l."fanmark_id"
  LEFT JOIN password_configs pc ON pc.license_id = l."id"
  LEFT JOIN basic_configs bc ON bc.license_id = l."id"
  LEFT JOIN redirect_configs rc ON rc.license_id = l."id"
  LEFT JOIN messageboard_configs mc ON mc.license_id = l."id"
  LEFT JOIN profile_configs p ON p.license_id = l."id"
  LEFT JOIN credential_artifacts ca ON ca.license_id = l."id"
  JOIN fanmark_access_versions v ON v."license_id" = l."id"
  JOIN fanmark_license_incarnations i ON i."license_id" = l."id"
`;

const TARGET_SELECT = `WITH ${TARGET_CTES} ${TARGET_ROW_SELECT}`;

async function resolveShort(db, shortId, nowIso) {
  const result = await db.prepare(
    `${TARGET_SELECT}
     WHERE f."short_id" = ? AND f."status" = 'active'
       AND l."status" = 'active' AND l."is_returned" = 0
       AND (l."license_end" IS NULL OR l."license_end" > ?)
     ORDER BY CASE WHEN l."license_end" IS NULL THEN 1 ELSE 0 END ASC,
       l."license_end" DESC, l."id" ASC
     LIMIT 2`,
  )
    .bind(shortId, nowIso)
    .all();
  if (!result.success || result.results.length === 0) return null;
  if (
    result.results.length > 1 &&
    result.results[0].license_expires_at === result.results[1].license_expires_at
  ) return null;
  return rowToTarget(result.results[0]);
}

async function resolveEmoji(db, selectorKey, nowIso) {
  const result = await db.prepare(
    `${TARGET_SELECT}
     WHERE f."normalized_emoji_ids" = ? AND f."status" = 'active'
       AND l."status" = 'active' AND l."is_returned" = 0
       AND l."license_end" IS NOT NULL AND l."license_end" > ?
     LIMIT 2`,
  )
    .bind(selectorKey, nowIso)
    .all();
  if (!result.success || result.results.length !== 1) return null;
  return rowToTarget(result.results[0]);
}

async function resolveProfile(db, licenseId, nowIso) {
  const result = await db.prepare(
    `${TARGET_SELECT}
     WHERE l."id" = ? AND f."status" = 'active'
       AND l."status" = 'active' AND l."is_returned" = 0
       AND (l."license_end" IS NULL OR l."license_end" > ?)
     LIMIT 2`,
  )
    .bind(licenseId, nowIso)
    .all();
  if (!result.success || result.results.length !== 1) return null;
  return rowToTarget(result.results[0]);
}

function parseCookie(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return rest.join("=");
  }
  return null;
}

async function acquireReservation(env, target, selectorHash, request) {
  const db = env.ACCESS_DB;
  const now = nowMs(env);
  const policy = await db.prepare(
    "SELECT window_ms, max_attempts, reservation_ms FROM fanmark_access_rate_policy WHERE id = 1",
  ).first();
  if (!policy) throw new Error("rate policy unavailable");
  const windowMs = Number(policy.window_ms);
  const windowId = Math.floor(now / windowMs);
  const windowStarted = windowId * windowMs;
  const windowExpires = windowStarted + windowMs;
  const reservationExpires = Math.min(windowExpires, now + Number(policy.reservation_ms));
  if (reservationExpires <= now) return { blocked: true };
  const requesterAddress =
    typeof verificationTestHooks.requestAddress === "function"
      ? verificationTestHooks.requestAddress(request)
      : request.headers.get("CF-Connecting-IP") || "shared";
  const requesterHash = await hmacHex(env, "requester", requesterAddress);
  const resourceHash = await hmacHex(
    env,
    "resource",
    target?.licenseId || `unknown:${selectorHash}`,
  );
  const reservationId = crypto.randomUUID();
  const seed = (kind, hash) =>
    db.prepare(
      `INSERT OR IGNORE INTO fanmark_access_rate_limits
       (bucket_kind, bucket_hash, window_id, window_started_at, window_expires_at, attempt_count, failure_count, cooldown_until, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 0, NULL, ?)`,
    ).bind(kind, hash, windowId, windowStarted, windowExpires, now);
  const roll = (kind, hash) =>
    db.prepare(
      `UPDATE fanmark_access_rate_limits
       SET window_id = ?, window_started_at = ?, window_expires_at = ?,
           attempt_count = 0, failure_count = 0,
           cooldown_until = CASE
             WHEN cooldown_until IS NOT NULL AND cooldown_until > ? THEN cooldown_until
             ELSE NULL
           END,
           updated_at = ?
       WHERE bucket_kind = ? AND bucket_hash = ? AND window_id < ?`,
    ).bind(windowId, windowStarted, windowExpires, windowStarted, now, kind, hash, windowId);
  try {
    // Window rollover must commit separately from reservation admission. If a
    // carried cooldown blocks the next-window reservation, the admission
    // batch rolls back, but the new window and its carried cooldown must stay
    // durable for subsequent requests.
    await db.batch([
      roll("requester", requesterHash),
      roll("resource", resourceHash),
    ]);
    await db.batch([
      seed("requester", requesterHash),
      seed("resource", resourceHash),
      db.prepare(
        `INSERT INTO fanmark_access_attempt_reservations
         (reservation_id, requester_bucket_hash, resource_bucket_hash, license_id,
          selector_hash, window_id, reserved_at, reservation_expires_at, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved')`,
      ).bind(
        reservationId,
        requesterHash,
        resourceHash,
        target?.licenseId || null,
        selectorHash,
        windowId,
        now,
        reservationExpires,
      ),
    ]);
    return {
      blocked: false,
      reservationId,
      requesterHash,
      resourceHash,
      windowId,
      reservationExpires,
    };
  } catch (error) {
    if (!String(error?.message || error).includes("reservation blocked")) throw error;
    await db.prepare(
      `INSERT INTO fanmark_access_attempt_audit
       (id, reservation_id, license_id, selector_hash, requester_hash, outcome, occurred_at,
        password_generation, access_generation, license_incarnation)
       VALUES (?, ?, ?, ?, ?, 'blocked', ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        reservationId,
        target?.licenseId || null,
        selectorHash,
        requesterHash,
        now,
        target?.passwordGeneration ?? null,
        target?.accessGeneration ?? null,
        target?.licenseIncarnation ?? null,
      )
      .run();
    return { blocked: true };
  }
}

async function finalizeFailure(env, reservation, target, selectorHash) {
  const db = env.ACCESS_DB;
  const now = nowMs(env);
  const outcome = now >= reservation.reservationExpires ? "expired" : "failure";
  const finalizationId = crypto.randomUUID();
  await db.batch([
    db.prepare(
      `UPDATE fanmark_access_attempt_reservations
       SET outcome = ?, finalization_id = ?, completed_at = ?
       WHERE reservation_id = ? AND outcome = 'reserved'`,
    ).bind(outcome, finalizationId, now, reservation.reservationId),
    db.prepare(
      `INSERT INTO fanmark_access_attempt_audit
       (id, reservation_id, license_id, selector_hash, requester_hash, outcome, occurred_at,
        password_generation, access_generation, license_incarnation)
       SELECT ?, reservation_id, license_id, selector_hash, ?, ?, ?, ?, ?, ?
       FROM fanmark_access_attempt_reservations
       WHERE reservation_id = ? AND outcome = ? AND finalization_id = ?`,
    ).bind(
      crypto.randomUUID(),
      reservation.requesterHash,
      outcome,
      now,
      target?.passwordGeneration ?? null,
      target?.accessGeneration ?? null,
      target?.licenseIncarnation ?? null,
      reservation.reservationId,
      outcome,
      finalizationId,
    ),
  ]);
}

function selectorCondition(kind) {
  if (kind === "short") return `f."short_id" = ?`;
  if (kind === "emoji") return `f."normalized_emoji_ids" = ?`;
  return `l."id" = ?`;
}

function selectorValue(kind, canonical) {
  return canonical;
}

async function finalizeSuccess(env, reservation, target, selectorKind, canonical, selectorHash, tokenHash) {
  const db = env.ACCESS_DB;
  const now = nowMs(env);
  const createdAt = iso6(now);
  const expiresAt = iso6(now + PROOF_MAX_AGE_MS);
  const proofId = crypto.randomUUID();
  const finalizationId = crypto.randomUUID();
  const selectorParam = selectorValue(selectorKind, canonical);
  const sql = `
    WITH ${TARGET_CTES},
    current_target AS (
      ${TARGET_ROW_SELECT}
      WHERE l."id" = ?
        AND f."status" = 'active'
        AND l."status" = 'active' AND l."is_returned" = 0
        AND (
          (? = 'emoji' AND l."license_end" IS NOT NULL AND l."license_end" > ?)
          OR (? <> 'emoji' AND (l."license_end" IS NULL OR l."license_end" > ?))
        )
        AND (${selectorCondition(selectorKind)})
        AND (
          ? <> 'short' OR NOT EXISTS (
            SELECT 1 FROM fanmark_licenses AS other
            WHERE other."fanmark_id" = l."fanmark_id"
              AND other."id" <> l."id"
              AND other."status" = 'active' AND other."is_returned" = 0
              AND (other."license_end" IS NULL OR other."license_end" > ?)
              AND (
                (other."license_end" IS NOT NULL AND l."license_end" IS NULL)
                OR (other."license_end" IS NOT NULL AND l."license_end" IS NOT NULL
                    AND other."license_end" > l."license_end")
                OR other."license_end" IS l."license_end"
              )
          )
        )
        AND (
          ? <> 'emoji' OR (
            (SELECT COUNT(*) FROM fanmarks AS matching
              WHERE matching."status" = 'active'
                AND matching."normalized_emoji_ids" = ?) = 1
            AND (SELECT COUNT(*) FROM fanmark_licenses AS matching_license
              JOIN fanmarks AS matching_fanmark ON matching_fanmark."id" = matching_license."fanmark_id"
              WHERE matching_fanmark."status" = 'active'
                AND matching_fanmark."normalized_emoji_ids" = ?
                AND matching_license."status" = 'active'
                AND matching_license."is_returned" = 0
                AND matching_license."license_end" IS NOT NULL
                AND matching_license."license_end" > ?) = 1
          )
        )
    )
    INSERT INTO fanmark_access_proofs
      (id, token_hash, finalization_id, selector_kind, selector_hash, fanmark_id, license_id,
       password_generation, access_generation, license_incarnation, created_at, expires_at)
    SELECT ?, ?, r."finalization_id", ?, ?, t.fanmark_id, t.license_id,
      t.password_generation, t.access_generation, t.license_incarnation, ?, ?
    FROM fanmark_access_attempt_reservations r
    JOIN current_target t ON t.license_id = r.license_id
    WHERE r."reservation_id" = ?
      AND r."outcome" = 'success'
      AND r."finalization_id" = ?
      AND r."reservation_expires_at" > ?
      AND r."selector_hash" = ?
      AND r."license_id" = t.license_id
      AND t.enabled = 1 AND t.hash_scheme = 'bcrypt'
      AND t.credential_artifact_count = 1 AND t.password_config_count = 1
      AND t.basic_config_count = 1 AND t.access_type = ?
      AND (? <> 'profile' OR t.access_type = 'profile')
      AND t.password_generation = ?
      AND t.access_generation = ?
      AND t.license_incarnation = ?
      AND (t.access_type <> 'profile' OR (t.profile_public = 1 AND t.profile_count = 1))
      AND (t.access_type <> 'redirect' OR t.redirect_config_count = 1)
      AND (t.access_type <> 'text' OR t.messageboard_config_count = 1)
  `;
  try {
    const results = await db.batch([
      db.prepare(
        `UPDATE fanmark_access_attempt_reservations
         SET outcome = 'success', finalization_id = ?, completed_at = ?
         WHERE reservation_id = ? AND outcome = 'reserved' AND reservation_expires_at > ?`,
      ).bind(finalizationId, now, reservation.reservationId, now),
      db.prepare(sql).bind(
        target.licenseId,
        selectorKind,
        iso6(now),
        selectorKind,
        iso6(now),
        selectorParam,
        selectorKind,
        iso6(now),
        selectorKind,
        selectorParam,
        selectorParam,
        iso6(now),
        proofId,
        tokenHash,
        selectorKind,
        selectorHash,
        createdAt,
        expiresAt,
        reservation.reservationId,
        finalizationId,
        now,
        selectorHash,
        target.accessType,
        selectorKind,
        target.passwordGeneration,
        target.accessGeneration,
        target.licenseIncarnation,
      ),
      db.prepare(
        `INSERT INTO fanmark_access_attempt_audit
         (id, reservation_id, license_id, selector_hash, requester_hash, outcome, occurred_at,
          password_generation, access_generation, license_incarnation)
         SELECT ?, reservation_id, license_id, selector_hash, ?,
           CASE WHEN changes() = 1 THEN 'success' ELSE 'stale' END,
           ?, ?, ?, ?
         FROM fanmark_access_attempt_reservations
         WHERE reservation_id = ? AND outcome = 'success' AND finalization_id = ?`,
      ).bind(
        crypto.randomUUID(),
        reservation.requesterHash,
        now,
        target.passwordGeneration,
        target.accessGeneration,
        target.licenseIncarnation,
        reservation.reservationId,
        finalizationId,
      ),
      db.prepare(
        `UPDATE fanmark_access_attempt_reservations
         SET outcome = 'stale'
         WHERE reservation_id = ? AND finalization_id = ? AND outcome = 'success'
           AND NOT EXISTS (SELECT 1 FROM fanmark_access_proofs WHERE id = ?)`,
      ).bind(reservation.reservationId, finalizationId, proofId),
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) {
      await finalizeFailure(env, reservation, target, selectorHash);
      return false;
    }
    const proofInsert = results[1];
    return Number(proofInsert?.meta?.changes || 0) === 1;
  } catch (error) {
    if (String(error?.message || error).includes("reservation expired")) {
      await finalizeFailure(env, reservation, target, selectorHash);
      return false;
    }
    throw error;
  }
}

async function comparePassword(env, password, target, reservation) {
  const candidateHash = target && validateBcrypt(target.passwordHash)
    ? target.passwordHash
    : DUMMY_BCRYPT_HASH;
  const comparePromise = bcrypt.compare(password, candidateHash);
  if (typeof verificationTestHooks.duringCompare === "function") {
    await verificationTestHooks.duringCompare({
      reservationId: reservation.reservationId,
      licenseId: target?.licenseId || null,
      comparePromise,
    });
  }
  return comparePromise;
}

function validUrl(value) {
  if (typeof value !== "string" || bytes(value) > 2048 || /[\u0000-\u0020\u007f]/u.test(value)) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return !parsed.username && !parsed.password && Boolean(parsed.hostname);
    }
    return parsed.protocol === "tel:" && parsed.hostname === "";
  } catch {
    return false;
  }
}

async function protectedProjection(env, request, selectorKind, canonical) {
  const token = parseCookie(request);
  if (!token || bytes(token) > 256) return null;
  const tokenHash = await sha256Hex(token);
  const selectorHash = await sha256Hex(`${selectorKind}\0${canonical}`);
  const now = nowMs(env);
  const nowIso = iso6(now);
  const sql = `
    WITH ${TARGET_CTES},
    current_matches AS (
      ${TARGET_ROW_SELECT}
      WHERE (${selectorCondition(selectorKind)})
        AND f."status" = 'active'
        AND l."status" = 'active' AND l."is_returned" = 0
        AND (
          (? = 'emoji' AND l."license_end" IS NOT NULL AND l."license_end" > ?)
          OR (? <> 'emoji' AND (l."license_end" IS NULL OR l."license_end" > ?))
        )
    ),
    ranked_targets AS (
      SELECT current_matches.*,
        ROW_NUMBER() OVER (
          ORDER BY CASE WHEN license_expires_at IS NULL THEN 1 ELSE 0 END ASC,
            license_expires_at DESC, license_id ASC
        ) AS selection_rank,
        COUNT(*) OVER () AS selection_count,
        LEAD(license_expires_at) OVER (
          ORDER BY CASE WHEN license_expires_at IS NULL THEN 1 ELSE 0 END ASC,
            license_expires_at DESC, license_id ASC
        ) AS second_license_end
      FROM current_matches
    ),
    current_target AS (
      SELECT * FROM ranked_targets
      WHERE selection_rank = 1
        AND (? <> 'emoji' OR selection_count = 1)
        AND (selection_count = 1 OR second_license_end IS NOT license_expires_at)
    ),
    candidate AS (
      SELECT
        CASE WHEN pr."id" IS NOT NULL
          AND pr."expires_at" > ?
          AND pr."password_generation" = t.password_generation
          AND pr."access_generation" = t.access_generation
          AND pr."license_incarnation" = t.license_incarnation
          AND pr."fanmark_id" = t.fanmark_id
          AND pr."license_id" = t.license_id
          AND t.enabled = 1 AND t.hash_scheme = 'bcrypt'
          AND t.credential_artifact_count = 1 AND t.password_config_count = 1
          AND t.basic_config_count = 1
          AND (t.access_type <> 'profile' OR (t.profile_public = 1 AND t.profile_count = 1))
          AND (t.access_type <> 'redirect' OR t.redirect_config_count = 1)
          AND (t.access_type <> 'text' OR t.messageboard_config_count = 1)
          AND (? <> 'profile' OR t.access_type = 'profile')
          THEN 1 ELSE 0 END AS authorized,
        t.license_id AS license_id,
        t.fanmark_id AS fanmark_id,
        t.access_type AS access_type,
        t.target_url AS target_url,
        t.text_content AS text_content,
        t.profile_name AS profile_name,
        t.profile_bio AS profile_bio,
        t.profile_social_links AS profile_social_links,
        t.profile_theme_settings AS profile_theme_settings
      FROM current_target t
      LEFT JOIN fanmark_access_proofs pr
        ON pr."license_id" = t.license_id
       AND pr."fanmark_id" = t.fanmark_id
       AND pr."token_hash" = ?
       AND pr."selector_kind" = ?
       AND pr."selector_hash" = ?
       AND pr."expires_at" > ?
      LIMIT 2
    )
    SELECT authorized, license_id, fanmark_id,
      CASE WHEN authorized = 1 THEN access_type END AS access_type,
      CASE WHEN authorized = 1 AND access_type = 'redirect' THEN target_url END AS target_url,
      CASE WHEN authorized = 1 AND access_type = 'text' THEN text_content END AS text_content,
      CASE WHEN authorized = 1 AND access_type = 'profile' THEN profile_name END AS profile_name,
      CASE WHEN authorized = 1 AND access_type = 'profile' THEN profile_bio END AS profile_bio,
      CASE WHEN authorized = 1 AND access_type = 'profile' THEN profile_social_links END AS profile_social_links,
      CASE WHEN authorized = 1 AND access_type = 'profile' THEN profile_theme_settings END AS profile_theme_settings
    FROM candidate
  `;
  const params = [
    selectorValue(selectorKind, canonical),
    selectorKind,
    nowIso,
    selectorKind,
    nowIso,
    selectorKind,
    nowIso,
    selectorKind,
    tokenHash,
    selectorKind,
    selectorHash,
    nowIso,
  ];
  const result = await env.ACCESS_DB.prepare(sql).bind(...params).all();
  if (!result.success || result.results.length !== 1 || Number(result.results[0].authorized) !== 1) {
    return null;
  }
  const row = result.results[0];
  if (row.access_type === "redirect" && !validUrl(row.target_url)) return null;
  if (row.access_type !== "redirect" && row.access_type !== "text" && row.access_type !== "profile") return null;
  return row;
}

async function verifyRoute(request, env, selectorKind, selectorInput) {
  const body = await readJson(request);
  const password = validatePassword(body);
  const nowIso = iso6(nowMs(env));
  let canonical;
  let target;
  if (selectorKind === "short") {
    canonical = normalizeShortId(selectorInput);
    target = await resolveShort(env.ACCESS_DB, canonical, nowIso);
  } else if (selectorKind === "emoji") {
    const ids = normalizeEmojiIds(body.emojiIds);
    if (!hasExactKeys(body, ["emojiIds", "password"])) throw new InputError("invalid_selector");
    const normalizedIds = await normalizeEmojiSelector(env, ids);
    canonical = canonicalSelector("emoji", normalizedIds || ids);
    target = normalizedIds ? await resolveEmoji(env.ACCESS_DB, canonical, nowIso) : null;
  } else {
    canonical = normalizeLicenseId(selectorInput);
    target = await resolveProfile(env.ACCESS_DB, canonical, nowIso);
  }
  return verifyPasswordWithValue(request, env, selectorKind, canonical, target, password);
}

async function verifyPasswordWithValue(request, env, selectorKind, canonical, target, password) {
  const selectorHash = await sha256Hex(`${selectorKind}\0${canonical}`);
  const reservation = await acquireReservation(env, target, selectorHash, request);
  if (reservation.blocked) return errorResponse(request, env, 401, "access_denied");
  let compared;
  try {
    compared = await comparePassword(env, password, target, reservation);
  } catch {
    await finalizeFailure(env, reservation, target, selectorHash);
    throw new Error("password comparison unavailable");
  }
  const allowed = Boolean(
    compared &&
      targetEligible(target, iso6(nowMs(env)), selectorKind) &&
      validateBcrypt(target?.passwordHash),
  );
  if (!allowed) {
    await finalizeFailure(env, reservation, target, selectorHash);
    return errorResponse(request, env, 401, "access_denied");
  }
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const proofSaved = await finalizeSuccess(
    env,
    reservation,
    target,
    selectorKind,
    canonical,
    selectorHash,
    tokenHash,
  );
  if (!proofSaved) return errorResponse(request, env, 401, "access_denied");
  return emptyResponse(request, env, 204, {
    "set-cookie": `${COOKIE_NAME}=${token}; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax`,
  });
}

function parseVerifiedRoute(pathname) {
  let match = /^\/api\/fanmarks\/access\/short\/([^/]+)\/(verify-password|protected)$/u.exec(pathname);
  if (match) return { selectorKind: "short", value: match[1], operation: match[2], method: match[2] === "verify-password" ? "POST" : "GET" };
  match = /^\/api\/fanmarks\/public-profile\/([^/]+)\/(verify-password|protected)$/u.exec(pathname);
  if (match) return { selectorKind: "profile", value: match[1], operation: match[2], method: match[2] === "verify-password" ? "POST" : "GET" };
  match = /^\/api\/fanmarks\/access\/emoji\/(verify-password|protected)$/u.exec(pathname);
  if (match) return { selectorKind: "emoji", operation: match[1], method: "POST" };
  return null;
}

function decodePathValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new InputError("invalid_selector");
  }
}

async function fetchHandler(request, env) {
  const url = new URL(request.url);
  if (!originAllowed(request, env)) return errorResponse(request, env, 403, "origin_forbidden");
  const route = parseVerifiedRoute(url.pathname);
  if (!route) return errorResponse(request, env, 404, "not_found");
  if (request.method === "OPTIONS") {
    const allow = `${route.method}, OPTIONS`;
    return emptyResponse(request, env, 204, {
      allow,
      "access-control-allow-methods": allow,
      ...(route.method === "POST" ? { "access-control-allow-headers": "Content-Type" } : {}),
    });
  }
  if (request.method !== route.method) {
    const response = errorResponse(request, env, 405, "method_not_allowed");
    response.headers.set("allow", `${route.method}, OPTIONS`);
    return response;
  }
  try {
    if (route.operation === "verify-password") {
      if (route.selectorKind === "emoji") {
        const body = await readJson(request);
        if (!hasExactKeys(body, ["emojiIds", "password"])) throw new InputError("invalid_selector");
        const password = validatePassword({ password: body.password });
        const ids = normalizeEmojiIds(body.emojiIds);
        const normalizedIds = await normalizeEmojiSelector(env, ids);
        const canonical = canonicalSelector("emoji", normalizedIds || ids);
        const target = normalizedIds
          ? await resolveEmoji(env.ACCESS_DB, canonical, iso6(nowMs(env)))
          : null;
        return await verifyPasswordWithValue(request, env, "emoji", canonical, target, password);
      }
      return await verifyRoute(request, env, route.selectorKind, decodePathValue(route.value));
    }

    if (route.selectorKind === "emoji") {
      const body = await readJson(request);
      if (!hasExactKeys(body, ["emojiIds"])) throw new InputError("invalid_selector");
      const ids = normalizeEmojiIds(body.emojiIds);
      const normalizedIds = await normalizeEmojiSelector(env, ids);
      if (!normalizedIds) return errorResponse(request, env, 401, "access_denied");
      const canonical = canonicalSelector("emoji", normalizedIds);
      const row = await protectedProjection(env, request, "emoji", canonical);
      return row ? jsonResponse(request, env, projectionBody(row), 200) : errorResponse(request, env, 401, "access_denied");
    }

    const value = decodePathValue(route.value);
    const canonical = route.selectorKind === "short" ? normalizeShortId(value) : normalizeLicenseId(value);
    const row = await protectedProjection(env, request, route.selectorKind, canonical);
    return row ? jsonResponse(request, env, projectionBody(row), 200) : errorResponse(request, env, 401, "access_denied");
  } catch (error) {
    if (error instanceof InputError) return errorResponse(request, env, 400, error.message);
    return errorResponse(request, env, 503, "unavailable");
  }
}

function projectionBody(row) {
  if (typeof row.fanmark_id !== "string" || typeof row.license_id !== "string") {
    throw new Error("invalid protected projection");
  }
  const body = {
    fanmarkId: row.fanmark_id,
    licenseId: row.license_id,
    accessType: row.access_type,
  };
  if (row.access_type === "redirect") {
    if (!validUrl(row.target_url)) throw new Error("invalid protected projection");
    body.targetUrl = row.target_url;
  }
  if (row.access_type === "text") {
    if (typeof row.text_content !== "string" || bytes(row.text_content) > 16 * 1024) {
      throw new Error("invalid protected projection");
    }
    body.textContent = row.text_content;
  }
  if (row.access_type === "profile") {
    if (
      (row.profile_name !== null && (typeof row.profile_name !== "string" || row.profile_name.length > 50)) ||
      (row.profile_bio !== null && (typeof row.profile_bio !== "string" || row.profile_bio.length > 500))
    ) throw new Error("invalid protected projection");
    body.profile = {
      name: row.profile_name,
      bio: row.profile_bio,
      socialLinks: sanitizeProfileSocialLinks(row.profile_social_links),
      themeSettings: sanitizeProfileTheme(row.profile_theme_settings),
    };
  }
  if (bytes(JSON.stringify(body)) > 64 * 1024) throw new Error("invalid protected projection");
  return body;
}

function parseProfileObject(value) {
  if (value === null) return {};
  if (typeof value !== "string" || bytes(value) > 16 * 1024) throw new Error("invalid profile projection");
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("invalid profile projection");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid profile projection");
  return parsed;
}

function safeProfileUrl(value) {
  if (typeof value !== "string" || bytes(value) > 2048 || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new Error("invalid profile projection");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("invalid profile projection");
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    if (parsed.username || parsed.password || !parsed.hostname) throw new Error("invalid profile projection");
    return value;
  }
  if (parsed.protocol === "tel:" && parsed.hostname === "") return value;
  throw new Error("invalid profile projection");
}

function sanitizeProfileSocialLinks(value) {
  const parsed = parseProfileObject(value);
  if (Object.keys(parsed).length > 32) throw new Error("invalid profile projection");
  const result = {};
  for (const [key, candidate] of Object.entries(parsed)) {
    if (!PUBLIC_SOCIAL_KEYS.has(key) || typeof candidate !== "string") throw new Error("invalid profile projection");
    if (candidate.length > 2048) throw new Error("invalid profile projection");
    if (candidate !== "") result[key] = safeProfileUrl(candidate);
  }
  return result;
}

function sanitizeProfileTheme(value) {
  const parsed = parseProfileObject(value);
  if (Object.keys(parsed).length > 8) throw new Error("invalid profile projection");
  const result = {};
  for (const [key, candidate] of Object.entries(parsed)) {
    if (!PUBLIC_THEME_KEYS.has(key)) throw new Error("invalid profile projection");
    if (key === "cover_image_url" || key === "profile_image_url") {
      if (candidate !== "") result[key] = safeProfileUrl(candidate);
    } else if (key === "cover_image_dimensions") {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("invalid profile projection");
      const { width, height } = candidate;
      if (!Number.isInteger(width) || width < 1 || width > 10_000 || !Number.isInteger(height) || height < 1 || height > 10_000) {
        throw new Error("invalid profile projection");
      }
      result[key] = { width, height };
    } else if (key === "cover_image_position") {
      if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0 || candidate > 100) {
        throw new Error("invalid profile projection");
      }
      result[key] = candidate;
    } else if (key === "theme_color") {
      if (typeof candidate !== "string" || !/^#[0-9a-f]{3,8}$/iu.test(candidate)) throw new Error("invalid profile projection");
      result[key] = candidate;
    } else if (key === "button_style") {
      if (typeof candidate !== "string" || bytes(candidate) > 64) throw new Error("invalid profile projection");
      result[key] = candidate;
    }
  }
  return result;
}

export function isVerifiedAccessPath(pathname) {
  return parseVerifiedRoute(pathname) !== null;
}

export function handleVerifiedAccessRequest(request, env) {
  return fetchHandler(request, env);
}

export default { fetch: fetchHandler };
