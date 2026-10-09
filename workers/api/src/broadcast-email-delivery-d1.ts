import { selectD1Database, type Env } from "./repository.ts";
import { toUtcMicrosecondTimestamp } from "./utc-timestamp.ts";

const SNAPSHOT_PAGE_SIZE = 50;
const SNAPSHOT_LEASE_MS = 5 * 60 * 1000;
const MAX_RECIPIENTS = 10_000;
const LANGUAGES = new Set(["en", "ja", "ko", "id"]);
const PLAN_TYPES = new Set(["free", "creator", "max", "business", "enterprise", "admin"]);

/** Receive late provider events while sending is paused; preserve existing configs. */
export function isBroadcastEmailWebhookEnabled(env: Env): boolean {
  return (env.BROADCAST_WEBHOOK_BACKEND ?? env.BROADCAST_SEND_BACKEND)?.trim() === "d1";
}

type RecipientFilter = {
  plan_types?: string[];
  languages?: string[];
  registered_after?: string;
  registered_before?: string;
};

type DeliveryRun = {
  id: string;
  broadcast_id: string;
  status: string;
  recipient_filter: string | null;
  last_auth_user_id: string | null;
  recipient_count: number;
  template_snapshot: string | null;
  created_at: string;
  snapshot_lease_token: string | null;
};

export type BroadcastSnapshotPageResult = {
  status: "disabled" | "idle" | "busy" | "page_committed" | "sending" | "failed";
  runId?: string;
  pageSize?: number;
  recipientCount?: number;
  reason?: "audience_too_large" | "invalid_snapshot" | "database_error";
};

export type BroadcastEmailDispatchResult = {
  status: "disabled" | "idle" | "processed" | "paused" | "completed" | "failed";
  runId?: string;
  processed?: number;
  sent?: number;
  retrying?: number;
  failed?: number;
  reason?: string;
};

type ResendMessage = { from: string; to: string; subject: string; html: string; idempotencyKey: string };
type ResendAttempt =
  | { kind: "accepted"; providerEmailId: string }
  | { kind: "retryable"; code: string }
  | { kind: "permanent"; code: string };

type DeliveryCandidate = {
  run_id: string;
  user_id: string;
  language: string;
  status: string;
  attempt_count: number;
  first_attempt_at: string | null;
  idempotency_expires_at: string | null;
  payload_fingerprint: string | null;
  last_error_code: string | null;
};

type DeliveryTemplateSnapshot = {
  broadcast: { id: string; emailType: string; subject: string; bodyText: string; recipientFilter?: RecipientFilter | null };
  templatesByLanguage: Record<string, { subject: string; body_text: string }>;
};

function parseFilter(value: string | null): RecipientFilter | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("invalid_snapshot");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("invalid_snapshot");
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).some((key) => !["plan_types", "languages", "registered_after", "registered_before"].includes(key))) {
    throw new Error("invalid_snapshot");
  }
  const filter: RecipientFilter = {};
  for (const key of ["plan_types", "languages"] as const) {
    const values = record[key];
    if (values === undefined) continue;
    const allowed = key === "plan_types" ? PLAN_TYPES : LANGUAGES;
    if (!Array.isArray(values) || values.length > allowed.size ||
        values.some((item) => typeof item !== "string" || !allowed.has(item))) throw new Error("invalid_snapshot");
    if (values.length) filter[key] = [...new Set(values as string[])];
  }
  for (const key of ["registered_after", "registered_before"] as const) {
    const date = record[key];
    if (date === undefined) continue;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
        new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) throw new Error("invalid_snapshot");
    filter[key] = date;
  }
  return Object.keys(filter).length ? filter : null;
}

function isD1ResultSuccessful(result: D1Result): boolean {
  return result.success && typeof result.meta?.changes === "number";
}

function buildSettingsQuery(userIds: string[], filter: RecipientFilter | null, businessDb: D1Database): D1PreparedStatement {
  const clauses = [`user_id IN (${userIds.map(() => "?").join(",")})`];
  const values: (string | number)[] = [...userIds];
  if (filter?.plan_types?.length) {
    clauses.push(`plan_type IN (${filter.plan_types.map(() => "?").join(",")})`);
    values.push(...filter.plan_types);
  }
  if (filter?.languages?.length) {
    clauses.push(`preferred_language IN (${filter.languages.map(() => "?").join(",")})`);
    values.push(...filter.languages);
  }
  if (filter?.registered_after) {
    clauses.push("created_at >= ?");
    values.push(filter.registered_after);
  }
  if (filter?.registered_before) {
    clauses.push("created_at <= ?");
    values.push(filter.registered_before);
  }
  return businessDb.prepare(`SELECT user_id, preferred_language FROM user_settings
    WHERE ${clauses.join(" AND ")}`).bind(...values);
}

function parseTemplateSnapshot(value: string | null, broadcastId: string): boolean {
  if (!value) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion !== 1 || typeof record.broadcast !== "object" || record.broadcast === null) return false;
    const broadcast = record.broadcast as Record<string, unknown>;
    if (broadcast.id !== broadcastId || typeof broadcast.subject !== "string" ||
        typeof broadcast.bodyText !== "string" || typeof broadcast.emailType !== "string") return false;
    if (typeof record.templatesByLanguage !== "object" || record.templatesByLanguage === null || Array.isArray(record.templatesByLanguage)) return false;
    const templates = record.templatesByLanguage as Record<string, unknown>;
    return [...LANGUAGES].every((language) => {
      const template = templates[language];
      return typeof template === "object" && template !== null && !Array.isArray(template) &&
        typeof (template as Record<string, unknown>).id === "string";
    });
  } catch {
    return false;
  }
}

function readTemplateSnapshot(value: string | null, broadcastId: string): DeliveryTemplateSnapshot | null {
  if (!parseTemplateSnapshot(value, broadcastId) || !value) return null;
  try {
    const parsed = JSON.parse(value) as DeliveryTemplateSnapshot;
    if ([...LANGUAGES].some((language) => {
      const template = parsed.templatesByLanguage[language];
      return !template || typeof template.subject !== "string" || typeof template.body_text !== "string";
    })) return null;
    return parsed;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function buildBroadcastHtml(subject: string, body: string): string {
  const safeSubject = escapeHtml(subject);
  const safeBody = escapeHtml(body).replace(/\r\n|\r|\n/gu, "<br>");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeSubject}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#333;background:#f5f5f5;margin:0}.container{max-width:600px;margin:0 auto;padding:32px 16px}.card{background:#fff;border-radius:12px;padding:24px}.content{white-space:pre-wrap}.footer{margin-top:32px;padding-top:24px;border-top:1px solid #eee;color:#666;font-size:12px}</style></head><body><main class="container"><section class="card"><strong>Fanmark</strong><h1>${safeSubject}</h1><div class="content">${safeBody}</div><div class="footer">このメールは重要なサービス通知のため、配信停止はできません。</div></section></main></body></html>`;
}

function configuredPositiveInt(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/u.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : null;
}

function validDeliveryConfiguration(env: Env): boolean {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.RESEND_FROM_EMAIL?.trim();
  const webhookSecret = env.BROADCAST_WEBHOOK_SIGNING_SECRET?.trim();
  const authSecret = env.BETTER_AUTH_SECRET?.trim();
  return env.BROADCAST_SEND_BACKEND?.trim() === "d1" && env.BROADCAST_EMAIL_BACKEND?.trim() === "d1" &&
    isBroadcastEmailWebhookEnabled(env) &&
    env.D1_TOPOLOGY?.trim() === "split" && Boolean(selectD1Database(env, "business")) && Boolean(selectD1Database(env, "auth")) &&
    Boolean(apiKey && apiKey.length <= 512) &&
    Boolean(from && from.length <= 320 && from.includes("@") && !/[\r\n]/u.test(from)) &&
    validResendWebhookSecret(webhookSecret) &&
    Boolean(authSecret && authSecret.length >= 32) &&
    configuredPositiveInt(env.BROADCAST_SEND_BATCH_SIZE, 10, 25) !== null &&
    configuredPositiveInt(env.BROADCAST_SEND_MAX_ATTEMPTS, 5, 10) !== null;
}

function validResendWebhookSecret(value: string | undefined): boolean {
  if (!value || !/^whsec_[A-Za-z0-9+/_=-]{16,240}$/u.test(value)) return false;
  try {
    const encoded = value.slice("whsec_".length).replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = encoded.padEnd(encoded.length + ((4 - encoded.length % 4) % 4), "=");
    return atob(padded).length >= 16;
  } catch {
    return false;
  }
}

function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 320 && value === value.trim() &&
    !/[\r\n]/u.test(value) && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value);
}

function payloadFingerprint(message: ResendMessage, key: string): Promise<string> {
  const body = JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, html: message.html });
  return (async () => {
    const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(body)));
    return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  })();
}

async function readProviderJson(response: Response, maxBytes = 8192): Promise<Record<string, unknown> | null> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > maxBytes) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export async function sendBroadcastEmailViaResend(
  message: ResendMessage,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResendAttempt> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": message.idempotencyKey,
      },
      body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject, html: message.html }),
      signal: controller.signal,
    });
    const payload = await readProviderJson(response);
    if (response.ok) {
      return typeof payload?.id === "string" && payload.id.length > 0 && payload.id.length <= 256
        ? { kind: "accepted", providerEmailId: payload.id }
        : { kind: "retryable", code: "provider_unknown_result" };
    }
    const providerName = typeof payload?.name === "string" ? payload.name : "";
    if (response.status === 409 && providerName === "concurrent_idempotent_requests") {
      return { kind: "retryable", code: "provider_concurrent_request" };
    }
    if (response.status === 409) return { kind: "permanent", code: "provider_idempotency_conflict" };
    if (response.status === 429) return { kind: "retryable", code: "provider_rate_limited" };
    if (response.status >= 500) return { kind: "retryable", code: "provider_server_error" };
    return { kind: "permanent", code: "provider_rejected" };
  } catch {
    return { kind: "retryable", code: "provider_network_error" };
  } finally {
    clearTimeout(timeout);
  }
}

function errorCode(error: unknown): "invalid_snapshot" | "database_error" {
  return error instanceof Error && error.message === "invalid_snapshot" ? "invalid_snapshot" : "database_error";
}

/** Snapshot a single bounded Auth D1 page. The queue stores user IDs and language only. */
export async function snapshotBroadcastEmailDeliveryPage(
  env: Env,
  clock: () => Date = () => new Date(),
  createId: () => string = () => crypto.randomUUID(),
): Promise<BroadcastSnapshotPageResult> {
  const businessDb = selectD1Database(env, "business");
  const authDb = selectD1Database(env, "auth");
  if (env.BROADCAST_SEND_BACKEND?.trim() !== "d1" || env.BROADCAST_EMAIL_BACKEND?.trim() !== "d1" ||
      env.D1_TOPOLOGY?.trim() !== "split" || !businessDb || !authDb) return { status: "disabled" };

  const now = clock();
  const nowIso = toUtcMicrosecondTimestamp(now);
  const leaseExpiresAt = toUtcMicrosecondTimestamp(new Date(now.getTime() + SNAPSHOT_LEASE_MS));
  let claimedRunId: string | null = null;
  let claimedRun: DeliveryRun | null = null;
  let leaseToken: string | null = null;
  try {
    const candidate = await businessDb.prepare(`SELECT id FROM broadcast_delivery_runs
      WHERE status = 'snapshotting' AND
        (snapshot_lease_token IS NULL OR snapshot_lease_expires_at IS NULL OR snapshot_lease_expires_at <= ?)
      ORDER BY created_at, id LIMIT 1`).bind(nowIso).first<{ id?: unknown }>();
    if (!candidate || typeof candidate.id !== "string") return { status: "idle" };

    leaseToken = createId();
    claimedRunId = candidate.id;
    const claim = await businessDb.prepare(`UPDATE broadcast_delivery_runs
      SET snapshot_lease_token = ?, snapshot_lease_expires_at = ?
      WHERE id = ? AND status = 'snapshotting' AND
        (snapshot_lease_token IS NULL OR snapshot_lease_expires_at IS NULL OR snapshot_lease_expires_at <= ?)`)
      .bind(leaseToken, leaseExpiresAt, candidate.id, nowIso).run();
    if (!claim.success || claim.meta?.changes !== 1) return { status: "busy", runId: candidate.id };

    const run = await businessDb.prepare(`SELECT id, broadcast_id, status, recipient_filter, last_auth_user_id,
        recipient_count, template_snapshot, created_at, snapshot_lease_token
      FROM broadcast_delivery_runs WHERE id = ? AND snapshot_lease_token = ? LIMIT 1`)
      .bind(candidate.id, leaseToken).first<DeliveryRun>();
    if (!run || run.status !== "snapshotting" || run.snapshot_lease_token !== leaseToken) {
      return { status: "busy", runId: candidate.id };
    }
    claimedRun = run;
    if (!parseTemplateSnapshot(run.template_snapshot, run.broadcast_id)) {
      await failSnapshot(businessDb, run, leaseToken, nowIso, "invalid_snapshot");
      return { status: "failed", runId: run.id, reason: "invalid_snapshot" };
    }

    const filter = parseFilter(run.recipient_filter);
    const authPage = await authDb.prepare(`SELECT id FROM "user"
      WHERE id > ? AND createdAt <= ? AND trim(email) <> ''
      ORDER BY id LIMIT ?`).bind(run.last_auth_user_id ?? "", run.created_at, SNAPSHOT_PAGE_SIZE)
      .all<{ id?: unknown }>();
    if (!authPage.success || !Array.isArray(authPage.results)) throw new Error("database_error");

    if (authPage.results.length === 0) {
      const results = await businessDb.batch([
        businessDb.prepare(`UPDATE broadcast_delivery_runs
          SET status = 'sending', started_at = ?, snapshot_lease_token = NULL, snapshot_lease_expires_at = NULL
          WHERE id = ? AND status = 'snapshotting' AND snapshot_lease_token = ?`)
          .bind(nowIso, run.id, leaseToken),
        businessDb.prepare(`UPDATE broadcast_emails SET status = 'sending', total_recipients = ?, sent_count = 0,
            failed_count = 0, started_at = ?, completed_at = NULL, error_details = NULL, updated_at = ?
          WHERE id = ? AND status = 'scheduled' AND EXISTS (
            SELECT 1 FROM broadcast_delivery_runs WHERE id = ? AND status = 'sending')`)
          .bind(run.recipient_count, nowIso, nowIso, run.broadcast_id, run.id),
      ]);
      if (!results.every(isD1ResultSuccessful) || results[0].meta?.changes !== 1 || results[1].meta?.changes !== 1) {
        throw new Error("database_error");
      }
      return { status: "sending", runId: run.id, pageSize: 0, recipientCount: run.recipient_count };
    }

    const authUserIds = authPage.results.map((row) => row.id);
    if (authUserIds.some((id) => typeof id !== "string" || id.length < 1 || id.length > 128)) {
      throw new Error("invalid_snapshot");
    }
    const settings = await buildSettingsQuery(authUserIds as string[], filter, businessDb).all<{
      user_id?: unknown;
      preferred_language?: unknown;
    }>();
    if (!settings.success || !Array.isArray(settings.results)) throw new Error("database_error");
    const settingsByUserId = new Map<string, string>();
    for (const setting of settings.results) {
      if (typeof setting.user_id !== "string") throw new Error("invalid_snapshot");
      const language = typeof setting.preferred_language === "string" && LANGUAGES.has(setting.preferred_language)
        ? setting.preferred_language
        : "ja";
      settingsByUserId.set(setting.user_id, language);
    }
    const suppressions = await businessDb.prepare(`SELECT user_id FROM broadcast_delivery_suppressions
      WHERE user_id IN (${authUserIds.map(() => "?").join(",")})`)
      .bind(...authUserIds as string[]).all<{ user_id?: unknown }>();
    if (!suppressions.success || !Array.isArray(suppressions.results)) throw new Error("database_error");
    const suppressedUserIds = new Set(suppressions.results
      .map((row) => row.user_id)
      .filter((userId): userId is string => typeof userId === "string"));
    const hasFilter = filter !== null;
    const recipients = (authUserIds as string[])
      .filter((userId) => !suppressedUserIds.has(userId))
      .filter((userId) => !hasFilter || settingsByUserId.has(userId))
      .map((userId) => ({ userId, language: settingsByUserId.get(userId) ?? "ja" }));
    if (run.recipient_count + recipients.length > MAX_RECIPIENTS) {
      await failSnapshot(businessDb, run, leaseToken, nowIso, "audience_too_large");
      return { status: "failed", runId: run.id, reason: "audience_too_large", recipientCount: run.recipient_count };
    }
    const lastAuthUserId = authUserIds.at(-1);
    if (!lastAuthUserId) throw new Error("invalid_snapshot");
    const statements = recipients.map(({ userId, language }) => businessDb.prepare(`INSERT INTO broadcast_delivery_recipients
      (run_id, user_id, language, status, attempt_count, next_attempt_at, created_at, updated_at)
      SELECT ?, ?, ?, 'pending', 0, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM broadcast_delivery_runs
        WHERE id = ? AND status = 'snapshotting' AND snapshot_lease_token = ? AND last_auth_user_id IS ?)
        AND NOT EXISTS (SELECT 1 FROM broadcast_delivery_suppressions WHERE user_id = ?)
      ON CONFLICT (run_id, user_id) DO NOTHING`)
      .bind(run.id, userId, language, nowIso, nowIso, nowIso, run.id, leaseToken, run.last_auth_user_id, userId));
    statements.push(businessDb.prepare(`UPDATE broadcast_delivery_runs
      SET last_auth_user_id = ?, recipient_count = (
          SELECT COUNT(*) FROM broadcast_delivery_recipients WHERE run_id = ?),
          snapshot_lease_token = NULL, snapshot_lease_expires_at = NULL
      WHERE id = ? AND status = 'snapshotting' AND snapshot_lease_token = ?
        AND last_auth_user_id IS ?`)
      .bind(lastAuthUserId, run.id, run.id, leaseToken, run.last_auth_user_id));
    const results = await businessDb.batch(statements);
    const cursorUpdate = results.at(-1);
    if (!results.every(isD1ResultSuccessful) || cursorUpdate?.meta?.changes !== 1) throw new Error("database_error");
    const updatedRun = await businessDb.prepare("SELECT recipient_count FROM broadcast_delivery_runs WHERE id = ? LIMIT 1")
      .bind(run.id).first<{ recipient_count?: unknown }>();
    if (typeof updatedRun?.recipient_count !== "number") throw new Error("database_error");
    return { status: "page_committed", runId: run.id, pageSize: authUserIds.length, recipientCount: updatedRun.recipient_count };
  } catch (error) {
    const reason = errorCode(error);
    if (claimedRunId && leaseToken) {
      try {
        if (reason === "invalid_snapshot" && claimedRun) {
          await failSnapshot(businessDb, claimedRun, leaseToken, nowIso, "invalid_snapshot");
        } else {
          await businessDb.prepare(`UPDATE broadcast_delivery_runs
            SET snapshot_lease_token = NULL, snapshot_lease_expires_at = NULL
            WHERE id = ? AND status = 'snapshotting' AND snapshot_lease_token = ?`)
            .bind(claimedRunId, leaseToken).run();
        }
      } catch {
        // Keep the lease bounded; the next scheduled invocation can reclaim it after expiry.
      }
    }
    return { status: "failed", ...(claimedRunId ? { runId: claimedRunId } : {}), reason };
  }
}

async function failSnapshot(
  businessDb: D1Database,
  run: DeliveryRun,
  leaseToken: string,
  now: string,
  code: "audience_too_large" | "invalid_snapshot",
): Promise<void> {
  const results = await businessDb.batch([
    businessDb.prepare(`UPDATE broadcast_delivery_runs
      SET status = 'failed', snapshot_lease_token = NULL, snapshot_lease_expires_at = NULL
      WHERE id = ? AND status = 'snapshotting' AND snapshot_lease_token = ?`)
      .bind(run.id, leaseToken),
    businessDb.prepare(`UPDATE broadcast_emails SET status = 'failed', error_details = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND status = 'scheduled' AND EXISTS (
        SELECT 1 FROM broadcast_delivery_runs WHERE id = ? AND status = 'failed')`)
      .bind(JSON.stringify({ code }), now, now, run.broadcast_id, run.id),
  ]);
  if (!results.every(isD1ResultSuccessful) || results[0].meta?.changes !== 1 || results[1].meta?.changes !== 1) {
    throw new Error("database_error");
  }
}

const RETRY_DELAY_MINUTES = [1, 5, 15, 60, 360] as const;
const UNCERTAIN_PROVIDER_CODES = new Set([
  "provider_concurrent_request",
  "provider_network_error",
  "provider_server_error",
  "provider_unknown_result",
]);

function errorCodeForStorage(value: string): string {
  return /^[A-Za-z0-9_-]{1,80}$/u.test(value) ? value : "provider_failed";
}

async function updateRecipient(
  businessDb: D1Database,
  runId: string,
  userId: string,
  leaseToken: string,
  status: "sent" | "pending" | "failed" | "needs_review",
  now: string,
  options: { providerEmailId?: string; errorCode?: string; nextAttemptAt?: string } = {},
): Promise<boolean> {
  const result = await businessDb.prepare(`UPDATE broadcast_delivery_recipients
    SET status = ?,
        provider_email_id = COALESCE(?, provider_email_id),
        last_error_code = ?,
        next_attempt_at = COALESCE(?, next_attempt_at),
        lease_token = NULL,
        lease_expires_at = NULL,
        updated_at = ?
    WHERE run_id = ? AND user_id = ? AND status = 'sending' AND lease_token = ?`)
    .bind(status, options.providerEmailId ?? null, options.errorCode ? errorCodeForStorage(options.errorCode) : null,
      options.nextAttemptAt ?? null, now, runId, userId, leaseToken).run();
  return result.success && result.meta?.changes === 1;
}

async function markNeedsReview(
  businessDb: D1Database,
  runId: string,
  userId: string,
  leaseToken: string,
  now: string,
  code: string,
): Promise<void> {
  const errorCode = errorCodeForStorage(code);
  const results = await businessDb.batch([
    businessDb.prepare(`UPDATE broadcast_delivery_recipients
      SET status = 'needs_review', last_error_code = ?, lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE run_id = ? AND user_id = ? AND status = 'sending' AND lease_token = ?`)
      .bind(errorCode, now, runId, userId, leaseToken),
    businessDb.prepare(`UPDATE broadcast_delivery_runs SET status = 'needs_review'
      WHERE id = ? AND status = 'sending'`)
      .bind(runId),
  ]);
  if (!results.every(isD1ResultSuccessful)) throw new Error("database_error");
}

export async function reconcileBroadcastDeliveryRun(
  businessDb: D1Database,
  runId: string,
  now: string,
): Promise<{ status: string; sent: number; failed: number }> {
  const runInfo = await businessDb.prepare(`SELECT broadcast_id, requested_by, template_snapshot
      FROM broadcast_delivery_runs WHERE id = ? LIMIT 1`)
    .bind(runId).first<{ broadcast_id?: unknown; requested_by?: unknown; template_snapshot?: unknown }>();
  if (typeof runInfo?.broadcast_id !== "string" || typeof runInfo.requested_by !== "string") throw new Error("database_error");
  const row = await businessDb.prepare(`SELECT
      SUM(CASE WHEN status IN ('sent', 'delivered') THEN 1 ELSE 0 END) AS sent_count,
      SUM(CASE WHEN status IN ('failed', 'bounced', 'suppressed') THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN status IN ('pending', 'sending') THEN 1 ELSE 0 END) AS outstanding_count,
      SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) AS review_count,
      COUNT(*) AS recipient_count
    FROM broadcast_delivery_recipients WHERE run_id = ?`).bind(runId).first<{
      sent_count?: unknown;
      failed_count?: unknown;
      outstanding_count?: unknown;
      review_count?: unknown;
      recipient_count?: unknown;
    }>();
  if (!row) throw new Error("database_error");
  const sent = Number(row.sent_count) || 0;
  const failed = Number(row.failed_count) || 0;
  const outstanding = Number(row.outstanding_count) || 0;
  const review = Number(row.review_count) || 0;
  const total = Number(row.recipient_count) || 0;
  const status = review > 0 ? "needs_review" : outstanding > 0 ? "sending" : failed > 0 && sent === 0 ? "failed" : "completed";
  const completedAt = status === "completed" || status === "failed" ? now : null;
  const errorDetails = review > 0
    ? JSON.stringify({ code: "needs_review" })
    : failed > 0
      ? JSON.stringify({ code: "delivery_failed" })
      : null;
  const completedSnapshot = readTemplateSnapshot(
    typeof runInfo.template_snapshot === "string" ? runInfo.template_snapshot : null,
    runInfo.broadcast_id,
  );
  const results = await businessDb.batch([
    businessDb.prepare(`UPDATE broadcast_delivery_runs
      SET status = ?, completed_at = COALESCE(?, completed_at)
      WHERE id = ? AND status IN ('sending', 'needs_review', 'completed', 'failed')`)
      .bind(status, completedAt, runId),
    businessDb.prepare(`UPDATE broadcast_emails
      SET status = ?, total_recipients = ?, sent_count = ?, failed_count = ?,
          completed_at = COALESCE(?, completed_at), error_details = ?, updated_at = ?
      WHERE id = ? AND EXISTS (
        SELECT 1 FROM broadcast_delivery_runs WHERE id = ? AND status = ?)`)
      .bind(status === "needs_review" ? "sending" : status, total, sent, failed,
        completedAt, errorDetails, now, runInfo.broadcast_id, runId, status),
    businessDb.prepare(`INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT ?, ?, 'BROADCAST_EMAIL_SENT', 'broadcast_email', ?, ?, ?
      WHERE ? IN ('completed', 'failed')
        AND EXISTS (SELECT 1 FROM broadcast_delivery_runs WHERE id = ? AND status IN ('completed', 'failed'))
      ON CONFLICT (id) DO NOTHING`)
      .bind(`broadcast-delivery/${runId}`, runInfo.requested_by, runInfo.broadcast_id,
        JSON.stringify({ total_recipients: total, sent_count: sent, failed_count: failed,
          email_type: completedSnapshot?.broadcast.emailType ?? null,
          recipient_filter_present: Boolean(completedSnapshot?.broadcast.recipientFilter) }),
        now, status, runId),
  ]);
  if (!results.every(isD1ResultSuccessful)) throw new Error("database_error");
  return { status, sent, failed };
}

async function eligibleDeliveryCandidate(
  businessDb: D1Database,
  runId: string,
  now: string,
): Promise<DeliveryCandidate | null> {
  return await businessDb.prepare(`SELECT recipient.run_id, recipient.user_id, recipient.language,
      recipient.status, recipient.attempt_count, recipient.first_attempt_at,
      recipient.idempotency_expires_at, recipient.payload_fingerprint, recipient.last_error_code
    FROM broadcast_delivery_recipients AS recipient
    WHERE recipient.run_id = ?
      AND ((recipient.status = 'pending' AND recipient.next_attempt_at <= ?)
        OR (recipient.status = 'sending' AND recipient.lease_expires_at <= ?))
      AND NOT EXISTS (SELECT 1 FROM broadcast_delivery_suppressions WHERE user_id = recipient.user_id)
    ORDER BY recipient.next_attempt_at, recipient.user_id LIMIT 1`)
    .bind(runId, now, now).first<DeliveryCandidate>();
}

/** Deliver one bounded Cron batch. Addresses stay transient in the Worker and are never logged or queued. */
export async function dispatchBroadcastEmailDeliveryBatch(
  env: Env,
  clock: () => Date = () => new Date(),
  fetchImpl: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  createId: () => string = () => crypto.randomUUID(),
): Promise<BroadcastEmailDispatchResult> {
  const businessDb = selectD1Database(env, "business");
  const authDb = selectD1Database(env, "auth");
  const batchSize = configuredPositiveInt(env.BROADCAST_SEND_BATCH_SIZE, 10, 25);
  const maxAttempts = configuredPositiveInt(env.BROADCAST_SEND_MAX_ATTEMPTS, 5, 10);
  if (!validDeliveryConfiguration(env) || !businessDb || !authDb || batchSize === null || maxAttempts === null) {
    return { status: "disabled" };
  }

  const initialNow = clock();
  const initialIso = toUtcMicrosecondTimestamp(initialNow);
  try {
    const run = await businessDb.prepare(`SELECT run.id, run.broadcast_id, run.template_snapshot
      FROM broadcast_delivery_runs AS run
      WHERE run.status = 'sending' AND (
        NOT EXISTS (SELECT 1 FROM broadcast_delivery_recipients AS recipient
          WHERE recipient.run_id = run.id AND recipient.status IN ('pending', 'sending', 'needs_review'))
        OR EXISTS (SELECT 1 FROM broadcast_delivery_recipients AS recipient
          WHERE recipient.run_id = run.id
            AND ((recipient.status = 'pending' AND recipient.next_attempt_at <= ?)
              OR (recipient.status = 'sending' AND recipient.lease_expires_at <= ?))
            AND NOT EXISTS (SELECT 1 FROM broadcast_delivery_suppressions WHERE user_id = recipient.user_id))
      ) ORDER BY run.started_at, run.id LIMIT 1`)
      .bind(initialIso, initialIso).first<{ id?: unknown; broadcast_id?: unknown; template_snapshot?: unknown }>();
    if (!run || typeof run.id !== "string" || typeof run.broadcast_id !== "string") return { status: "idle" };
    const snapshot = readTemplateSnapshot(typeof run.template_snapshot === "string" ? run.template_snapshot : null, run.broadcast_id);
    if (!snapshot) {
      await businessDb.prepare(`UPDATE broadcast_delivery_runs SET status = 'needs_review' WHERE id = ? AND status = 'sending'`)
        .bind(run.id).run();
      await reconcileBroadcastDeliveryRun(businessDb, run.id, initialIso);
      return { status: "paused", runId: run.id, reason: "invalid_snapshot" };
    }

    let processed = 0;
    let sent = 0;
    let retrying = 0;
    let failed = 0;
    for (let index = 0; index < batchSize; index += 1) {
      const now = clock();
      const nowIso = toUtcMicrosecondTimestamp(now);
      const candidate = await eligibleDeliveryCandidate(businessDb, run.id, nowIso);
      if (!candidate) break;

      const expiresAt = candidate.idempotency_expires_at ? Date.parse(candidate.idempotency_expires_at) : NaN;
      const hasPriorAttempt = candidate.attempt_count > 0 || candidate.first_attempt_at !== null;
      if (hasPriorAttempt && (!Number.isFinite(expiresAt) || expiresAt <= now.getTime())) {
        const token = createId();
        const claimed = await businessDb.prepare(`UPDATE broadcast_delivery_recipients
          SET status = 'sending', lease_token = ?, lease_expires_at = ?
          WHERE run_id = ? AND user_id = ? AND status = ? AND
            ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_expires_at <= ?))
            AND NOT EXISTS (SELECT 1 FROM broadcast_delivery_suppressions WHERE user_id = ?)`)
          .bind(token, toUtcMicrosecondTimestamp(new Date(now.getTime() + 2 * 60 * 1000)), run.id, candidate.user_id,
            candidate.status, nowIso, nowIso, candidate.user_id).run();
        if (claimed.success && claimed.meta?.changes === 1) {
          await markNeedsReview(businessDb, run.id, candidate.user_id, token, nowIso, "idempotency_window_expired");
          await reconcileBroadcastDeliveryRun(businessDb, run.id, nowIso);
          return { status: "paused", runId: run.id, processed, sent, retrying, failed, reason: "idempotency_window_expired" };
        }
        continue;
      }

      if (candidate.attempt_count >= maxAttempts) {
        if (candidate.status === "sending" ||
            (candidate.last_error_code !== null && UNCERTAIN_PROVIDER_CODES.has(candidate.last_error_code))) {
          const token = createId();
          const claimed = await businessDb.prepare(`UPDATE broadcast_delivery_recipients
            SET status = 'sending', lease_token = ?, lease_expires_at = ?
            WHERE run_id = ? AND user_id = ? AND status = ?
              AND ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_expires_at <= ?))`)
            .bind(token, toUtcMicrosecondTimestamp(new Date(now.getTime() + 2 * 60 * 1000)), run.id,
              candidate.user_id, candidate.status, nowIso, nowIso).run();
          if (claimed.success && claimed.meta?.changes === 1) {
            await markNeedsReview(businessDb, run.id, candidate.user_id, token, nowIso, "attempt_limit_uncertain");
            await reconcileBroadcastDeliveryRun(businessDb, run.id, nowIso);
            return { status: "paused", runId: run.id, processed, sent, retrying, failed, reason: "attempt_limit_uncertain" };
          }
          continue;
        }
        const update = await businessDb.prepare(`UPDATE broadcast_delivery_recipients
          SET status = 'failed', last_error_code = 'attempt_limit_reached', updated_at = ?
          WHERE run_id = ? AND user_id = ? AND status = 'pending' AND attempt_count >= ?`)
          .bind(nowIso, run.id, candidate.user_id, maxAttempts).run();
        if (update.success && update.meta?.changes === 1) {
          processed += 1;
          failed += 1;
        }
        continue;
      }

      const leaseToken = createId();
      const leaseExpiresAt = toUtcMicrosecondTimestamp(new Date(now.getTime() + 2 * 60 * 1000));
      const claim = await businessDb.prepare(`UPDATE broadcast_delivery_recipients
        SET status = 'sending', attempt_count = attempt_count + 1,
            first_attempt_at = COALESCE(first_attempt_at, ?),
            idempotency_expires_at = COALESCE(idempotency_expires_at, ?),
            lease_token = ?, lease_expires_at = ?, updated_at = ?
        WHERE run_id = ? AND user_id = ? AND status = ?
          AND ((status = 'pending' AND next_attempt_at <= ?) OR (status = 'sending' AND lease_expires_at <= ?))
          AND NOT EXISTS (SELECT 1 FROM broadcast_delivery_suppressions WHERE user_id = ?)`)
        .bind(nowIso, toUtcMicrosecondTimestamp(new Date(now.getTime() + 24 * 60 * 60 * 1000)), leaseToken,
          leaseExpiresAt, nowIso, run.id, candidate.user_id, candidate.status, nowIso, nowIso, candidate.user_id).run();
      if (!claim.success || claim.meta?.changes !== 1) continue;
      const claimedRow = await businessDb.prepare(`SELECT attempt_count, payload_fingerprint
        FROM broadcast_delivery_recipients WHERE run_id = ? AND user_id = ? AND lease_token = ? LIMIT 1`)
        .bind(run.id, candidate.user_id, leaseToken).first<{ attempt_count?: unknown; payload_fingerprint?: unknown }>();
      if (!claimedRow || typeof claimedRow.attempt_count !== "number") continue;

      const identity = await authDb.prepare(`SELECT email FROM "user" WHERE id = ? LIMIT 1`)
        .bind(candidate.user_id).first<{ email?: unknown }>();
      if (!isValidEmail(identity?.email)) {
        const hasEarlierPayload = typeof claimedRow.payload_fingerprint === "string";
        if (hasEarlierPayload) {
          await markNeedsReview(businessDb, run.id, candidate.user_id, leaseToken, nowIso, "auth_identity_changed");
          await reconcileBroadcastDeliveryRun(businessDb, run.id, nowIso);
          return { status: "paused", runId: run.id, processed, sent, retrying, failed, reason: "auth_identity_changed" };
        }
        if (await updateRecipient(businessDb, run.id, candidate.user_id, leaseToken, "failed", nowIso,
          { errorCode: "auth_email_unavailable" })) {
          processed += 1;
          failed += 1;
        }
        continue;
      }

      const template = snapshot.templatesByLanguage[candidate.language] ?? snapshot.templatesByLanguage.ja;
      if (!template || typeof candidate.language !== "string" || !LANGUAGES.has(candidate.language)) {
        await markNeedsReview(businessDb, run.id, candidate.user_id, leaseToken, nowIso, "invalid_snapshot");
        await reconcileBroadcastDeliveryRun(businessDb, run.id, nowIso);
        return { status: "paused", runId: run.id, processed, sent, retrying, failed, reason: "invalid_snapshot" };
      }
      const subject = snapshot.broadcast.subject.trim() || template.subject;
      const body = snapshot.broadcast.bodyText.trim() || template.body_text;
      const message: ResendMessage = {
        from: env.RESEND_FROM_EMAIL!.trim(),
        to: identity.email,
        subject,
        html: buildBroadcastHtml(subject, body),
        idempotencyKey: `broadcast/${run.id}/${candidate.user_id}`,
      };
      const fingerprint = await payloadFingerprint(message, env.BETTER_AUTH_SECRET!.trim());
      if (typeof claimedRow.payload_fingerprint === "string" && claimedRow.payload_fingerprint !== fingerprint) {
        await markNeedsReview(businessDb, run.id, candidate.user_id, leaseToken, nowIso, "payload_changed_after_attempt");
        await reconcileBroadcastDeliveryRun(businessDb, run.id, nowIso);
        return { status: "paused", runId: run.id, processed, sent, retrying, failed, reason: "payload_changed_after_attempt" };
      }
      if (claimedRow.payload_fingerprint === null || claimedRow.payload_fingerprint === undefined) {
        const storedFingerprint = await businessDb.prepare(`UPDATE broadcast_delivery_recipients
          SET payload_fingerprint = ?, updated_at = ?
          WHERE run_id = ? AND user_id = ? AND status = 'sending' AND lease_token = ?
            AND payload_fingerprint IS NULL`)
          .bind(fingerprint, nowIso, run.id, candidate.user_id, leaseToken).run();
        if (!storedFingerprint.success || storedFingerprint.meta?.changes !== 1) continue;
      }
      const canSend = await businessDb.prepare(`SELECT 1 AS ready
        FROM broadcast_delivery_recipients AS recipient
        WHERE recipient.run_id = ? AND recipient.user_id = ? AND recipient.status = 'sending'
          AND recipient.lease_token = ?
          AND NOT EXISTS (SELECT 1 FROM broadcast_delivery_suppressions WHERE user_id = recipient.user_id)
        LIMIT 1`).bind(run.id, candidate.user_id, leaseToken).first<{ ready?: unknown }>();
      if (canSend?.ready !== 1) continue;

      const attempt = await sendBroadcastEmailViaResend(message, env.RESEND_API_KEY!.trim(), fetchImpl);
      if (attempt.kind === "accepted") {
        try {
          await updateRecipient(businessDb, run.id, candidate.user_id, leaseToken, "sent", nowIso,
            { providerEmailId: attempt.providerEmailId });
          processed += 1;
          sent += 1;
        } catch {
          await markNeedsReview(businessDb, run.id, candidate.user_id, leaseToken, nowIso, "provider_id_conflict");
          await reconcileBroadcastDeliveryRun(businessDb, run.id, nowIso);
          return { status: "paused", runId: run.id, processed, sent, retrying, failed, reason: "provider_id_conflict" };
        }
      } else if (attempt.kind === "permanent") {
        if (await updateRecipient(businessDb, run.id, candidate.user_id, leaseToken, "failed", nowIso,
          { errorCode: attempt.code })) {
          processed += 1;
          failed += 1;
        }
      } else {
        const attemptCount = Number(claimedRow.attempt_count);
        if (attemptCount >= maxAttempts && UNCERTAIN_PROVIDER_CODES.has(attempt.code)) {
          await markNeedsReview(businessDb, run.id, candidate.user_id, leaseToken, nowIso, "attempt_limit_uncertain");
          await reconcileBroadcastDeliveryRun(businessDb, run.id, nowIso);
          return { status: "paused", runId: run.id, processed, sent, retrying, failed, reason: "attempt_limit_uncertain" };
        }
        const exhausted = attemptCount >= maxAttempts;
        const delayMinutes = RETRY_DELAY_MINUTES[Math.min(attemptCount - 1, RETRY_DELAY_MINUTES.length - 1)];
        if (await updateRecipient(businessDb, run.id, candidate.user_id, leaseToken,
          exhausted ? "failed" : "pending", nowIso, {
            errorCode: exhausted ? "attempt_limit_reached" : attempt.code,
            nextAttemptAt: exhausted ? undefined : toUtcMicrosecondTimestamp(new Date(now.getTime() + delayMinutes * 60_000)),
          })) {
          processed += 1;
          if (exhausted) failed += 1;
          else retrying += 1;
        }
      }
      if (index + 1 < batchSize) await pause(600);
    }

    const reconciled = await reconcileBroadcastDeliveryRun(businessDb, run.id, toUtcMicrosecondTimestamp(clock()));
    if (reconciled.status === "completed" || reconciled.status === "failed") {
      return { status: reconciled.status, runId: run.id, processed, sent: reconciled.sent, retrying, failed: reconciled.failed };
    }
    return { status: "processed", runId: run.id, processed, sent: reconciled.sent, retrying, failed: reconciled.failed };
  } catch {
    return { status: "failed", reason: "broadcast_delivery_unavailable" };
  }
}
