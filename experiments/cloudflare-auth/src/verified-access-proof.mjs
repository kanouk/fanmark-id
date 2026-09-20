import bcrypt from "bcryptjs";

const COOKIE_NAME = "__Host-fanmark_access";
const MAX_BODY_BYTES = 4096;
const PROOF_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_BCRYPT_COST = 10;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUMMY_BCRYPT_HASH =
  "$2b$10$EMIaSXLiF70qXWKgX4HYkuVEN64Td.KjBaV89Eef1aNvJCzvMe1qy";
const encoder = new TextEncoder();

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

function corsHeaders(request, env) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  const origin = request.headers.get("Origin");
  if (origin === env.VERIFIED_ACCESS_ORIGIN) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
    headers.set("vary", "Origin");
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
    return origin === env.VERIFIED_ACCESS_ORIGIN;
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

function targetEligible(target, nowIso) {
  if (!target) return false;
  if (!target.enabled || target.hashScheme !== "bcrypt") return false;
  if (target.licenseStatus !== "active" || target.licenseReturned) return false;
  if (target.fanmarkStatus !== "active" || target.fanmarkReturned) return false;
  if (target.licenseExpiresAt && target.licenseExpiresAt <= nowIso) return false;
  if (target.fanmarkExpiresAt && target.fanmarkExpiresAt <= nowIso) return false;
  if (target.accessType === "profile" && !target.profilePublic) return false;
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
    accessType: row.access_type,
    licenseStatus: row.license_status,
    licenseReturned: Number(row.license_returned) === 1,
    licenseExpiresAt: row.license_expires_at,
    fanmarkStatus: row.fanmark_status,
    fanmarkReturned: Number(row.fanmark_returned) === 1,
    fanmarkExpiresAt: row.fanmark_expires_at,
    profilePublic: Number(row.profile_public) === 1,
    passwordGeneration: Number(row.password_generation),
    lifecycleGeneration: Number(row.lifecycle_generation),
  };
}

const TARGET_SELECT = `
  SELECT
    l."id" AS license_id,
    l."fanmark_id" AS fanmark_id,
    c."enabled" AS enabled,
    c."hash_scheme" AS hash_scheme,
    c."password_hash" AS password_hash,
    c."access_type" AS access_type,
    l."status" AS license_status,
    l."returned" AS license_returned,
    l."expires_at" AS license_expires_at,
    f."status" AS fanmark_status,
    f."returned" AS fanmark_returned,
    f."expires_at" AS fanmark_expires_at,
    p."is_public" AS profile_public,
    v."password_generation" AS password_generation,
    v."lifecycle_generation" AS lifecycle_generation
  FROM fanmark_licenses l
  JOIN fanmarks f ON f."id" = l."fanmark_id"
  LEFT JOIN fanmark_access_configs c ON c."license_id" = l."id"
  LEFT JOIN fanmark_profiles p ON p."license_id" = l."id"
  JOIN fanmark_access_versions v ON v."license_id" = l."id"
`;

async function resolveShort(db, shortId) {
  const result = await db.prepare(
    `${TARGET_SELECT} WHERE f."short_id" = ? LIMIT 2`,
  )
    .bind(shortId)
    .all();
  if (!result.success || result.results.length !== 1) return null;
  return rowToTarget(result.results[0]);
}

async function resolveEmoji(db, selectorKey) {
  const result = await db.prepare(
    `${TARGET_SELECT}
     JOIN fanmark_emoji_selectors e
       ON e."license_id" = l."id" AND e."fanmark_id" = f."id"
      AND e."selector_key" = ?
     LIMIT 2`,
  )
    .bind(selectorKey)
    .all();
  if (!result.success || result.results.length !== 1) return null;
  return rowToTarget(result.results[0]);
}

async function resolveProfile(db, licenseId) {
  const result = await db.prepare(
    `${TARGET_SELECT} WHERE l."id" = ? LIMIT 2`,
  )
    .bind(licenseId)
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
       (id, reservation_id, license_id, selector_hash, requester_hash, outcome, occurred_at, password_generation, lifecycle_generation)
       VALUES (?, ?, ?, ?, ?, 'blocked', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        reservationId,
        target?.licenseId || null,
        selectorHash,
        requesterHash,
        now,
        target?.passwordGeneration ?? null,
        target?.lifecycleGeneration ?? null,
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
       (id, reservation_id, license_id, selector_hash, requester_hash, outcome, occurred_at, password_generation, lifecycle_generation)
       SELECT ?, reservation_id, license_id, selector_hash, ?, ?, ?, ?, ?
       FROM fanmark_access_attempt_reservations
       WHERE reservation_id = ? AND outcome = ? AND finalization_id = ?`,
    ).bind(
      crypto.randomUUID(),
      reservation.requesterHash,
      outcome,
      now,
      target?.passwordGeneration ?? null,
      target?.lifecycleGeneration ?? null,
      reservation.reservationId,
      outcome,
      finalizationId,
    ),
  ]);
}

function selectorCondition(kind) {
  if (kind === "short") return `f."short_id" = ?`;
  if (kind === "emoji") {
    return `EXISTS (
      SELECT 1 FROM fanmark_emoji_selectors e
      WHERE e."selector_key" = ? AND e."license_id" = l."id" AND e."fanmark_id" = f."id"
    )`;
  }
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
    INSERT INTO fanmark_access_proofs
      (id, token_hash, finalization_id, selector_kind, selector_hash, fanmark_id, license_id,
       password_generation, lifecycle_generation, created_at, expires_at)
    SELECT ?, ?, r."finalization_id", ?, ?, f."id", l."id", v."password_generation", v."lifecycle_generation", ?, ?
    FROM fanmark_access_attempt_reservations r
    JOIN fanmark_licenses l ON l."id" = r."license_id"
    JOIN fanmarks f ON f."id" = l."fanmark_id"
    JOIN fanmark_access_configs c ON c."license_id" = l."id"
    JOIN fanmark_access_versions v ON v."license_id" = l."id"
    LEFT JOIN fanmark_profiles p ON p."license_id" = l."id"
    WHERE r."reservation_id" = ?
      AND r."outcome" = 'success'
      AND r."finalization_id" = ?
      AND r."reservation_expires_at" > ?
      AND r."selector_hash" = ?
      AND r."license_id" = ?
      AND l."status" = 'active' AND l."returned" = 0
      AND (l."expires_at" IS NULL OR l."expires_at" > ?)
      AND f."status" = 'active' AND f."returned" = 0
      AND (f."expires_at" IS NULL OR f."expires_at" > ?)
      AND c."enabled" = 1 AND c."hash_scheme" = 'bcrypt'
      AND c."access_type" = ?
      AND v."password_generation" = ?
      AND v."lifecycle_generation" = ?
      AND (${selectorCondition(selectorKind)})
      AND (c."access_type" <> 'profile' OR p."is_public" = 1)
  `;
  try {
    const results = await db.batch([
      db.prepare(
        `UPDATE fanmark_access_attempt_reservations
         SET outcome = 'success', finalization_id = ?, completed_at = ?
         WHERE reservation_id = ? AND outcome = 'reserved' AND reservation_expires_at > ?`,
      ).bind(finalizationId, now, reservation.reservationId, now),
      db.prepare(sql).bind(
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
        target.licenseId,
        iso6(now),
        iso6(now),
        target.accessType,
        target.passwordGeneration,
        target.lifecycleGeneration,
        selectorParam,
      ),
      db.prepare(
        `INSERT INTO fanmark_access_attempt_audit
         (id, reservation_id, license_id, selector_hash, requester_hash, outcome, occurred_at, password_generation, lifecycle_generation)
         SELECT ?, reservation_id, license_id, selector_hash, ?,
           CASE WHEN changes() = 1 THEN 'success' ELSE 'stale' END,
           ?, ?, ?
         FROM fanmark_access_attempt_reservations
         WHERE reservation_id = ? AND outcome = 'success' AND finalization_id = ?`,
      ).bind(
        crypto.randomUUID(),
        reservation.requesterHash,
        now,
        target.passwordGeneration,
        target.lifecycleGeneration,
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
  if (typeof value !== "string" || bytes(value) > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "tel:";
  } catch {
    return false;
  }
}

async function protectedProjection(env, request, selectorKind, canonical, target) {
  const token = parseCookie(request);
  if (!token || bytes(token) > 256) return null;
  const tokenHash = await sha256Hex(token);
  const selectorHash = await sha256Hex(`${selectorKind}\0${canonical}`);
  const now = nowMs(env);
  const nowIso = iso6(now);
  const sql = `
    WITH candidate AS (
      SELECT
        CASE WHEN pr."id" IS NOT NULL
          AND pr."expires_at" > ?
          AND pr."password_generation" = v."password_generation"
          AND pr."lifecycle_generation" = v."lifecycle_generation"
          AND pr."fanmark_id" = f."id"
          AND pr."license_id" = l."id"
          AND l."status" = 'active' AND l."returned" = 0
          AND (l."expires_at" IS NULL OR l."expires_at" > ?)
          AND f."status" = 'active' AND f."returned" = 0
          AND (f."expires_at" IS NULL OR f."expires_at" > ?)
          AND c."enabled" = 1 AND c."hash_scheme" = 'bcrypt'
          AND (c."access_type" <> 'profile' OR p."is_public" = 1)
          AND (${selectorCondition(selectorKind)})
          THEN 1 ELSE 0 END AS authorized,
        l."id" AS license_id,
        f."id" AS fanmark_id,
        c."access_type" AS access_type,
        c."target_url" AS target_url,
        c."text_content" AS text_content,
        p."profile_name" AS profile_name,
        p."bio" AS profile_bio,
        p."image_url" AS profile_image_url
      FROM fanmark_access_proofs pr
      JOIN fanmark_licenses l ON l."id" = pr."license_id"
      JOIN fanmarks f ON f."id" = l."fanmark_id"
      LEFT JOIN fanmark_access_configs c ON c."license_id" = l."id"
      LEFT JOIN fanmark_profiles p ON p."license_id" = l."id"
      JOIN fanmark_access_versions v ON v."license_id" = l."id"
      WHERE pr."token_hash" = ?
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
      CASE WHEN authorized = 1 AND access_type = 'profile' THEN profile_image_url END AS profile_image_url
    FROM candidate
  `;
  const params = [nowIso, nowIso, nowIso, selectorValue(selectorKind, canonical), tokenHash, selectorKind, selectorHash, nowIso];
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
  let canonical;
  let target;
  if (selectorKind === "short") {
    canonical = normalizeShortId(selectorInput);
    target = await resolveShort(env.ACCESS_DB, canonical);
  } else if (selectorKind === "emoji") {
    const ids = normalizeEmojiIds(body.emojiIds);
    if (!hasExactKeys(body, ["emojiIds", "password"])) throw new InputError("invalid_selector");
    canonical = canonicalSelector("emoji", ids);
    target = await resolveEmoji(env.ACCESS_DB, canonical);
  } else {
    canonical = normalizeLicenseId(selectorInput);
    target = await resolveProfile(env.ACCESS_DB, canonical);
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
      targetEligible(target, iso6(nowMs(env))) &&
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

async function fetchHandler(request, env) {
  const url = new URL(request.url);
  if (!originAllowed(request, env)) return errorResponse(request, env, 403, "origin_forbidden");
  if (request.method === "OPTIONS") {
    return emptyResponse(request, env, 204, {
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
    });
  }
  try {
    if (request.method === "POST" && url.pathname.startsWith("/api/fanmarks/access/short/") && url.pathname.endsWith("/verify-password")) {
      const prefix = "/api/fanmarks/access/short/";
      const value = decodeURIComponent(url.pathname.slice(prefix.length, -"/verify-password".length));
      return await verifyRoute(request, env, "short", value);
    }
    if (request.method === "POST" && url.pathname === "/api/fanmarks/access/emoji/verify-password") {
      const body = await readJson(request);
      if (!hasExactKeys(body, ["emojiIds", "password"])) throw new InputError("invalid_selector");
      const password = validatePassword({ password: body.password });
      const ids = normalizeEmojiIds(body.emojiIds);
      const canonical = canonicalSelector("emoji", ids);
      const target = await resolveEmoji(env.ACCESS_DB, canonical);
      return await verifyPasswordWithValue(request, env, "emoji", canonical, target, password);
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/fanmarks/public-profile/") && url.pathname.endsWith("/verify-password")) {
      const prefix = "/api/fanmarks/public-profile/";
      const value = decodeURIComponent(url.pathname.slice(prefix.length, -"/verify-password".length));
      return await verifyRoute(request, env, "profile", value);
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/fanmarks/access/short/") && url.pathname.endsWith("/protected")) {
      const prefix = "/api/fanmarks/access/short/";
      const value = normalizeShortId(decodeURIComponent(url.pathname.slice(prefix.length, -"/protected".length)));
      const row = await protectedProjection(env, request, "short", value, null);
      return row ? jsonResponse(request, env, projectionBody(row), 200) : errorResponse(request, env, 401, "access_denied");
    }
    if (request.method === "POST" && url.pathname === "/api/fanmarks/access/emoji/protected") {
      const body = await readJson(request);
      if (!hasExactKeys(body, ["emojiIds"])) throw new InputError("invalid_selector");
      const canonical = canonicalSelector("emoji", normalizeEmojiIds(body.emojiIds));
      const row = await protectedProjection(env, request, "emoji", canonical, null);
      return row ? jsonResponse(request, env, projectionBody(row), 200) : errorResponse(request, env, 401, "access_denied");
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/fanmarks/public-profile/") && url.pathname.endsWith("/protected")) {
      const prefix = "/api/fanmarks/public-profile/";
      const value = normalizeLicenseId(decodeURIComponent(url.pathname.slice(prefix.length, -"/protected".length)));
      const row = await protectedProjection(env, request, "profile", value, null);
      return row ? jsonResponse(request, env, projectionBody(row), 200) : errorResponse(request, env, 401, "access_denied");
    }
    return new Response("Not found", { status: 404 });
  } catch (error) {
    if (error instanceof InputError) return errorResponse(request, env, 400, error.message);
    return errorResponse(request, env, 503, "unavailable");
  }
}

function projectionBody(row) {
  const body = {
    fanmarkId: row.fanmark_id,
    licenseId: row.license_id,
    accessType: row.access_type,
  };
  if (row.access_type === "redirect") body.targetUrl = row.target_url;
  if (row.access_type === "text") body.textContent = row.text_content;
  if (row.access_type === "profile") {
    body.profile = {
      name: row.profile_name,
      bio: row.profile_bio,
      imageUrl: row.profile_image_url,
    };
  }
  return body;
}

export default { fetch: fetchHandler };
