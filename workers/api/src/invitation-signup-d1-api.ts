import { selectD1Database, type Env } from "./repository";

const API_PREFIX = "/api/auth";
const ATTEMPT_LIFETIME_MS = 15 * 60 * 1000;
const PROCESSING_LEASE_MS = 2 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);

type SignupAttempt = {
  attempt_id: string;
  email_fingerprint: string;
  invitation_code_id: string | null;
  preferred_language: string;
  state: "reserved" | "auth_created" | "completed" | "released";
  auth_user_id: string | null;
  expires_at: string;
  verification_sent_at: string | null;
  processing_lease_until: string | null;
};

type AuthUserMarker = { id: string; email: string; emailVerified: number | boolean };

type AuthFlow = (
  path: string,
  body: Record<string, unknown>,
  signupCommandId: string,
) => Promise<Response>;

function json(body: unknown, status: number, headers: Headers): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function parseBooleanSetting(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^"([\s\S]*)"$/u, "$1").toLowerCase();
  if (["true", "1", "on"].includes(normalized)) return true;
  if (["false", "0", "off"].includes(normalized)) return false;
  return null;
}

export async function readInvitationSignupMode(database: D1Database | undefined): Promise<boolean | null> {
  if (!database) return null;
  try {
    const row = await database.prepare(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'invitation_mode' LIMIT 1",
    ).first<{ setting_value?: unknown }>();
    return parseBooleanSetting(row?.setting_value);
  } catch {
    return null;
  }
}

export async function isInvitationSignupSchemaReady(
  businessDatabase: D1Database | undefined,
  authDatabase: D1Database | undefined,
): Promise<boolean> {
  if (!businessDatabase || !authDatabase) return false;
  try {
    const attemptTable = await businessDatabase.prepare(
      "SELECT 1 AS ready FROM sqlite_master WHERE type = 'table' AND name = 'invitation_signup_attempts' LIMIT 1",
    ).first<{ ready: number }>();
    const authColumns = await authDatabase.prepare('PRAGMA table_info("user")').all<{ name: string }>();
    return Boolean(attemptTable?.ready) && Boolean(authColumns.results?.some((column) => column.name === "signupCommandId"));
  } catch {
    return false;
  }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) return null;
  if (!request.body) return null;

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
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function fingerprintEmail(secret: string, email: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`fanmark.invitation-signup.v1:${email}`),
  ));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function lookupInvitation(database: D1Database, code: string, now: string) {
  return database.prepare(`
    SELECT c.id, c.code, c.max_uses, c.used_count, c.expires_at, c.special_perks, c.is_active,
      (SELECT COUNT(*) FROM invitation_signup_attempts a
        WHERE a.invitation_code_id = c.id
          AND (a.state = 'auth_created' OR (a.state = 'reserved' AND julianday(a.expires_at) > julianday(?)))) AS reserved_count
    FROM invitation_codes c
    WHERE c.code = ? COLLATE NOCASE
    LIMIT 1
  `).bind(now, code).first<Record<string, unknown>>();
}

function invitationRemaining(row: Record<string, unknown> | null, now: string): number {
  if (!row || Number(row.is_active) !== 1) return 0;
  if (typeof row.expires_at === "string" && row.expires_at.length > 0) {
    const expiresAt = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.parse(now)) return 0;
  }
  const maxUses = Number(row.max_uses);
  const usedCount = Number(row.used_count);
  const reservedCount = Number(row.reserved_count);
  if (![maxUses, usedCount, reservedCount].every(Number.isSafeInteger)) return 0;
  return Math.max(0, maxUses - usedCount - reservedCount);
}

export async function handleInvitationCodeValidationRequest(
  request: Request,
  database: D1Database | undefined,
  mode: boolean | null,
  responseHeaders: Headers,
  clock: () => Date = () => new Date(),
): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") {
    return json({ error: "method_not_allowed" }, 405, responseHeaders);
  }
  if (!database || mode === null) return json({ error: "invitation_unavailable" }, 503, responseHeaders);
  const body = await readJsonObject(request);
  if (!body || typeof body.code !== "string") return json({ error: "invalid_request" }, 400, responseHeaders);
  const code = body.code.trim().toUpperCase();
  if (!code || code.length > 32) return json({ error: "invalid_request" }, 400, responseHeaders);

  try {
    const now = clock().toISOString();
    const row = await lookupInvitation(database, code, now);
    const remainingUses = invitationRemaining(row, now);
    let perks: Record<string, unknown> = {};
    if (typeof row?.special_perks === "string") {
      try {
        const parsed: unknown = JSON.parse(row.special_perks);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) perks = parsed as Record<string, unknown>;
      } catch {
        return json({ error: "invitation_unavailable" }, 503, responseHeaders);
      }
    }
    return json({
      isValid: remainingUses > 0,
      remainingUses,
      perks,
      invitationRequired: mode,
    }, 200, responseHeaders);
  } catch {
    return json({ error: "invitation_unavailable" }, 503, responseHeaders);
  }
}

async function readAttempt(database: D1Database, attemptId: string): Promise<SignupAttempt | null> {
  return database.prepare(`
    SELECT attempt_id, email_fingerprint, invitation_code_id, preferred_language,
      state, auth_user_id, expires_at, verification_sent_at, processing_lease_until
    FROM invitation_signup_attempts WHERE attempt_id = ? LIMIT 1
  `).bind(attemptId).first<SignupAttempt>();
}

async function readOpenAttemptByFingerprint(database: D1Database, fingerprint: string): Promise<SignupAttempt | null> {
  return database.prepare(`
    SELECT attempt_id, email_fingerprint, invitation_code_id, preferred_language,
      state, auth_user_id, expires_at, verification_sent_at, processing_lease_until
    FROM invitation_signup_attempts
    WHERE email_fingerprint = ? AND state IN ('reserved', 'auth_created')
    ORDER BY CASE state WHEN 'auth_created' THEN 0 ELSE 1 END, created_at DESC
    LIMIT 1
  `).bind(fingerprint).first<SignupAttempt>();
}

async function readAuthUser(database: D1Database, commandId: string): Promise<AuthUserMarker | null> {
  return database.prepare(`
    SELECT "id", "email", "emailVerified" FROM "user"
    WHERE "signupCommandId" = ? LIMIT 1
  `).bind(commandId).first<AuthUserMarker>();
}

async function releaseLease(database: D1Database, attemptId: string, token: string): Promise<void> {
  await database.prepare(`
    UPDATE invitation_signup_attempts
    SET processing_token = NULL, processing_lease_until = NULL, updated_at = ?
    WHERE attempt_id = ? AND processing_token = ? AND state IN ('reserved', 'auth_created')
  `).bind(new Date().toISOString(), attemptId, token).run();
}

async function createReservation(
  database: D1Database,
  input: {
    attemptId: string;
    fingerprint: string;
    invitationCodeId: string | null;
    language: string;
    now: string;
    expiresAt: string;
    invitationRequired: boolean;
  },
): Promise<boolean> {
  const codeSlot = input.invitationCodeId === null
    ? `? = 0`
    : `EXISTS (
        SELECT 1 FROM invitation_codes c
        WHERE c.id = ?
          AND c.is_active = 1
          AND (c.expires_at IS NULL OR julianday(c.expires_at) > julianday(?))
          AND c.used_count + (
            SELECT COUNT(*) FROM invitation_signup_attempts a
            WHERE a.invitation_code_id = c.id
              AND (a.state = 'auth_created' OR (a.state = 'reserved' AND julianday(a.expires_at) > julianday(?)))
          ) < c.max_uses
      )`;
  const codeBindings = input.invitationCodeId === null
    ? [input.invitationRequired ? 1 : 0]
    : [input.invitationCodeId, input.now, input.now];

  const results = await database.batch([
    database.prepare(`INSERT INTO invitation_signup_attempts
      (attempt_id, email_fingerprint, invitation_code_id, preferred_language, state,
       auth_user_id, created_at, updated_at, expires_at)
      SELECT ?, ?, ?, ?, 'reserved', NULL, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM invitation_signup_attempts
        WHERE email_fingerprint = ? AND state IN ('reserved', 'auth_created')
      )
      AND ${codeSlot}
      ON CONFLICT DO NOTHING`)
      .bind(
        input.attemptId,
        input.fingerprint,
        input.invitationCodeId,
        input.language,
        input.now,
        input.now,
        input.expiresAt,
        input.fingerprint,
        ...codeBindings,
      ),
  ]);
  return Number(results[0]?.meta?.changes) === 1;
}

function invitationError(status: number, code: string, headers: Headers): Response {
  return json({ error: code }, status, headers);
}

export async function handleInvitationSignupRequest(
  request: Request,
  env: Env,
  invitationRequired: boolean | null,
  responseHeaders: Headers,
  invokeAuth: AuthFlow,
  clock: () => Date = () => new Date(),
): Promise<Response> {
  if (request.method.toUpperCase() !== "POST") return invitationError(405, "method_not_allowed", responseHeaders);
  const businessDb = selectD1Database(env, "business");
  const authDb = selectD1Database(env, "auth");
  const authSecret = env.BETTER_AUTH_SECRET?.trim() ?? "";
  if (
    env.INVITATION_SIGNUP_BACKEND?.trim() !== "d1" ||
    !businessDb ||
    !authDb ||
    invitationRequired === null ||
    authSecret.length < 32
  ) return invitationError(503, "signup_unavailable", responseHeaders);

  const body = await readJsonObject(request);
  if (!body) return invitationError(400, "invalid_request", responseHeaders);
  let commandId = typeof body.commandId === "string" ? body.commandId.toLowerCase() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const rawCode = body.invitationCode;
  const invitationCode = typeof rawCode === "string" && rawCode.trim()
    ? rawCode.trim().toUpperCase()
    : null;
  const language = typeof body.preferredLanguage === "string" && LANGUAGES.has(body.preferredLanguage)
    ? body.preferredLanguage
    : "ja";
  if (
    !UUID_V4.test(commandId) ||
    !EMAIL.test(email) || email.length > 254 ||
    password.length < 8 || password.length > 128 ||
    (invitationCode !== null && invitationCode.length > 32) ||
    (invitationRequired && !invitationCode)
  ) return invitationError(400, invitationRequired && !invitationCode ? "invitation_required" : "invalid_request", responseHeaders);

  const nowDate = clock();
  const now = nowDate.toISOString();
  let fingerprint: string;
  let claimedToken: string | null = null;
  try {
    fingerprint = await fingerprintEmail(authSecret, email);
  } catch {
    return invitationError(503, "signup_unavailable", responseHeaders);
  }

  try {
    const code = invitationCode ? await lookupInvitation(businessDb, invitationCode, now) : null;
    const invitationCodeId = typeof code?.id === "string" ? code.id : null;
    let attempt = await readAttempt(businessDb, commandId);
    if (!attempt) {
      const existingOpenAttempt = await readOpenAttemptByFingerprint(businessDb, fingerprint);
      if (existingOpenAttempt) {
        if (
          existingOpenAttempt.invitation_code_id !== invitationCodeId ||
          existingOpenAttempt.preferred_language !== language
        ) return invitationError(409, "signup_command_conflict", responseHeaders);

        if (existingOpenAttempt.state === "reserved" && Date.parse(existingOpenAttempt.expires_at) <= nowDate.getTime()) {
          let priorAuthUser: AuthUserMarker | null;
          try {
            priorAuthUser = await readAuthUser(authDb, existingOpenAttempt.attempt_id);
          } catch {
            return invitationError(503, "signup_recovery_unavailable", responseHeaders);
          }
          if (!priorAuthUser) {
            await businessDb.prepare(`UPDATE invitation_signup_attempts
              SET state = 'released', invitation_code_id = NULL, updated_at = ?
              WHERE attempt_id = ? AND state = 'reserved' AND julianday(expires_at) <= julianday(?)`)
              .bind(now, existingOpenAttempt.attempt_id, now).run();
          } else {
            commandId = existingOpenAttempt.attempt_id;
            attempt = existingOpenAttempt;
          }
        } else {
          commandId = existingOpenAttempt.attempt_id;
          attempt = existingOpenAttempt;
        }
      }
    }
    if (attempt) {
      if (
        attempt.email_fingerprint !== fingerprint ||
        attempt.invitation_code_id !== invitationCodeId ||
        attempt.preferred_language !== language
      ) return invitationError(409, "signup_command_conflict", responseHeaders);
      if (attempt.state === "completed") return json({ status: true }, 200, responseHeaders);
      if (attempt.state === "released") return invitationError(409, "signup_command_expired", responseHeaders);
    } else {
      if (invitationCode && invitationRemaining(code, now) < 1) {
        return invitationError(400, "invitation_invalid_or_full", responseHeaders);
      }
      if (invitationRequired && !invitationCodeId) {
        return invitationError(400, "invitation_invalid_or_full", responseHeaders);
      }
      const expiresAt = new Date(nowDate.getTime() + ATTEMPT_LIFETIME_MS).toISOString();
      try {
        await createReservation(businessDb, {
          attemptId: commandId,
          fingerprint,
          invitationCodeId,
          language,
          now,
          expiresAt,
          invitationRequired,
        });
      } catch {
        return invitationError(503, "signup_unavailable", responseHeaders);
      }
      attempt = await readAttempt(businessDb, commandId);
      if (!attempt) {
        return invitationError(409, "signup_email_or_invitation_unavailable", responseHeaders);
      }
      if (
        attempt.email_fingerprint !== fingerprint ||
        attempt.invitation_code_id !== invitationCodeId ||
        attempt.preferred_language !== language
      ) return invitationError(409, "signup_command_conflict", responseHeaders);
    }

    const processingToken = crypto.randomUUID();
    claimedToken = processingToken;
    const leaseUntil = new Date(nowDate.getTime() + PROCESSING_LEASE_MS).toISOString();
    const claim = await businessDb.prepare(`UPDATE invitation_signup_attempts
      SET processing_token = ?, processing_lease_until = ?, updated_at = ?
      WHERE attempt_id = ? AND state IN ('reserved', 'auth_created')
        AND (processing_lease_until IS NULL OR julianday(processing_lease_until) <= julianday(?))`)
      .bind(processingToken, leaseUntil, now, commandId, now).run();
    if (Number(claim.meta?.changes) !== 1) {
      const latest = await readAttempt(businessDb, commandId);
      return latest?.state === "completed"
        ? json({ status: true }, 200, responseHeaders)
        : json({ status: true, pending: true }, 202, responseHeaders);
    }

    let authUser: AuthUserMarker | null = null;
    if (attempt.state === "reserved" && Date.parse(attempt.expires_at) <= nowDate.getTime()) {
      try {
        authUser = await readAuthUser(authDb, commandId);
      } catch {
        await releaseLease(businessDb, commandId, processingToken);
        return invitationError(503, "signup_recovery_unavailable", responseHeaders);
      }
      if (!authUser) {
        await businessDb.prepare(`UPDATE invitation_signup_attempts
          SET state = 'released', invitation_code_id = NULL, processing_token = NULL,
              processing_lease_until = NULL, updated_at = ?
          WHERE attempt_id = ? AND processing_token = ? AND state = 'reserved'`)
          .bind(clock().toISOString(), commandId, processingToken).run();
        return invitationError(409, "signup_command_expired", responseHeaders);
      }
      const recovered = await businessDb.prepare(`UPDATE invitation_signup_attempts
        SET state = 'auth_created', auth_user_id = ?, updated_at = ?
        WHERE attempt_id = ? AND processing_token = ? AND state = 'reserved'`)
        .bind(authUser.id, clock().toISOString(), commandId, processingToken).run();
      if (Number(recovered.meta?.changes) !== 1) {
        await releaseLease(businessDb, commandId, processingToken);
        return invitationError(503, "signup_recovery_unavailable", responseHeaders);
      }
    }

    if (!authUser) {
      try {
        authUser = await readAuthUser(authDb, commandId);
      } catch {
        await releaseLease(businessDb, commandId, processingToken);
        return invitationError(503, "signup_recovery_unavailable", responseHeaders);
      }
    }

    if (!authUser) {
      let signupResponse: Response | null = null;
      try {
        signupResponse = await invokeAuth("/sign-up/email", {
          name: "fanmark.id user",
          email,
          password,
        }, commandId);
      } catch {
        // The next read distinguishes a lost acknowledgement after D1 commit
        // from an auth request that never created a user.
        try {
          authUser = await readAuthUser(authDb, commandId);
        } catch {
          await releaseLease(businessDb, commandId, processingToken);
          return invitationError(503, "signup_recovery_unavailable", responseHeaders);
        }
        if (!authUser) {
          await businessDb.prepare(`UPDATE invitation_signup_attempts
            SET state = 'released', invitation_code_id = NULL, processing_token = NULL,
                processing_lease_until = NULL, updated_at = ?
            WHERE attempt_id = ? AND processing_token = ? AND state = 'reserved'`)
            .bind(clock().toISOString(), commandId, processingToken).run();
          return invitationError(503, "signup_failed", responseHeaders);
        }
      }

      if (!authUser) {
        try {
          authUser = await readAuthUser(authDb, commandId);
        } catch {
          await releaseLease(businessDb, commandId, processingToken);
          return invitationError(503, "signup_recovery_unavailable", responseHeaders);
        }
        if (!authUser) {
          await businessDb.prepare(`UPDATE invitation_signup_attempts
            SET state = 'released', invitation_code_id = NULL, processing_token = NULL,
                processing_lease_until = NULL, updated_at = ?
            WHERE attempt_id = ? AND processing_token = ? AND state = 'reserved'`)
            .bind(clock().toISOString(), commandId, processingToken).run();
          // Better Auth intentionally returns the same shape for duplicate and
          // new email addresses when email verification is mandatory.
          return signupResponse?.ok === true
            ? json({ status: true }, 200, responseHeaders)
            : invitationError(400, "signup_failed", responseHeaders);
        }
      }
    }

    if (!authUser || authUser.email.trim().toLowerCase() !== email || !authUser.id) {
      await releaseLease(businessDb, commandId, processingToken);
      return invitationError(503, "signup_recovery_unavailable", responseHeaders);
    }

    const authCreated = await businessDb.prepare(`UPDATE invitation_signup_attempts
      SET state = 'auth_created', auth_user_id = ?, updated_at = ?
      WHERE attempt_id = ? AND state IN ('reserved', 'auth_created')
        AND email_fingerprint = ? AND processing_token = ?`)
      .bind(authUser.id, now, commandId, fingerprint, processingToken).run();
    if (Number(authCreated.meta?.changes) !== 1) {
      const latest = await readAttempt(businessDb, commandId);
      if (latest?.state === "completed") return json({ status: true }, 200, responseHeaders);
      await releaseLease(businessDb, commandId, processingToken);
      return invitationError(503, "signup_recovery_unavailable", responseHeaders);
    }

    const isVerified = authUser.emailVerified === true || Number(authUser.emailVerified) === 1;
    const currentAttempt = await readAttempt(businessDb, commandId);
    if (!isVerified && !currentAttempt?.verification_sent_at) {
      let verificationResponse: Response;
      try {
        verificationResponse = await invokeAuth("/send-verification-email", {
          email,
          callbackURL: `${env.BETTER_AUTH_URL?.trim() ?? ""}/`,
        }, commandId);
      } catch {
        await releaseLease(businessDb, commandId, processingToken);
        return invitationError(503, "verification_email_unavailable", responseHeaders);
      }
      if (!verificationResponse.ok) {
        await releaseLease(businessDb, commandId, processingToken);
        return invitationError(503, "verification_email_unavailable", responseHeaders);
      }
      await businessDb.prepare(`UPDATE invitation_signup_attempts
        SET verification_sent_at = ?, updated_at = ?
        WHERE attempt_id = ? AND state = 'auth_created' AND processing_token = ?`)
        .bind(clock().toISOString(), clock().toISOString(), commandId, processingToken).run();
    }

    const userId = authUser.id;
    const username = `user_${userId.slice(0, 8)}`;
    const completedAt = clock().toISOString();
    const result = await businessDb.batch([
      businessDb.prepare(`INSERT INTO user_settings
        (user_id, username, display_name, plan_type, preferred_language, created_at, updated_at,
         invited_by_code, requires_password_setup)
        SELECT a.auth_user_id, ?, ?, 'free', a.preferred_language, ?, ?, c.code, 0
        FROM invitation_signup_attempts a
        LEFT JOIN invitation_codes c ON c.id = a.invitation_code_id
        WHERE a.attempt_id = ? AND a.state = 'auth_created'
          AND a.auth_user_id = ? AND a.processing_token = ?`)
        .bind(username, username, completedAt, completedAt, commandId, userId, processingToken),
      businessDb.prepare(`UPDATE invitation_signup_attempts
        SET state = 'completed', updated_at = ?, processing_token = NULL, processing_lease_until = NULL
        WHERE attempt_id = ? AND state = 'auth_created' AND auth_user_id = ?
          AND processing_token = ?
          AND EXISTS (SELECT 1 FROM user_settings WHERE user_id = ?)`)
        .bind(completedAt, commandId, userId, processingToken, userId),
    ]);
    if (Number(result[0]?.meta?.changes) !== 1 || Number(result[1]?.meta?.changes) !== 1) {
      const latest = await readAttempt(businessDb, commandId);
      if (latest?.state === "completed") return json({ status: true }, 200, responseHeaders);
      await releaseLease(businessDb, commandId, processingToken);
      return invitationError(503, "signup_profile_unavailable", responseHeaders);
    }
    return json({ status: true }, 200, responseHeaders);
  } catch {
    try {
      if (claimedToken) await releaseLease(businessDb, commandId, claimedToken);
    } catch {
      // A later retry recovers through the durable command marker.
    }
    return invitationError(503, "signup_unavailable", responseHeaders);
  }
}

export function isInvitationCodeValidationPath(pathname: string): boolean {
  return pathname === `${API_PREFIX}/invitations/validate`;
}
