import { reconcileBroadcastDeliveryRun } from "./broadcast-email-delivery-d1.ts";
import { selectD1Database, type Env } from "./repository.ts";
import { assertUtcMicrosecondTimestamp, toUtcMicrosecondTimestamp } from "./utc-timestamp.ts";

export const BROADCAST_EMAIL_WEBHOOK_PATH = "/api/webhooks/resend/broadcast-delivery";
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const EVENT_TYPES = new Set([
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
]);

type WebhookEvent = {
  eventId: string;
  emailId: string;
  eventType: string;
  bounceType: "Permanent" | "Transient" | "Undetermined" | null;
  providerCreatedAt: string;
};

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export function isBroadcastEmailWebhookPath(pathname: string): boolean {
  return pathname === BROADCAST_EMAIL_WEBHOOK_PATH;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function verifySignature(
  body: Uint8Array,
  id: string,
  timestamp: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  if (!/^whsec_[A-Za-z0-9+/_=-]{16,240}$/u.test(secret)) return false;
  const keyBytes = decodeBase64(secret.slice("whsec_".length));
  if (!keyBytes || keyBytes.byteLength < 16) return false;
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const prefix = new TextEncoder().encode(`${id}.${timestamp}.`);
  const signedPayload = new Uint8Array(prefix.length + body.length);
  signedPayload.set(prefix, 0);
  signedPayload.set(body, prefix.length);
  for (const item of signatureHeader.trim().split(/\s+/u)) {
    const [version, signature, extra] = item.split(",");
    if (version !== "v1" || !signature || extra !== undefined) continue;
    const signatureBytes = decodeBase64(signature);
    if (!signatureBytes) continue;
    try {
      if (await crypto.subtle.verify("HMAC", key, signatureBytes, signedPayload)) return true;
    } catch {
      // Try other v1 signatures in the header.
    }
  }
  return false;
}

async function readRawBody(request: Request): Promise<Uint8Array | null> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/u.test(declared) && Number(declared) > MAX_WEBHOOK_BODY_BYTES) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_WEBHOOK_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep event chronology separate from signed-at and email-creation timestamps. */
function providerTimestamp(value: unknown): string {
  if (typeof value !== "string") throw new RangeError("invalid_provider_timestamp");
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) throw new RangeError("invalid_provider_timestamp");
  const [, wall, fraction = "", zone] = match;
  // Validate the wall clock before Date can normalize impossible calendar days.
  assertUtcMicrosecondTimestamp(`${wall}.${fraction.slice(0, 6).padEnd(6, "0")}Z`);
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59 || zone === "-00:00")) {
    throw new RangeError("invalid_provider_timestamp");
  }
  const seconds = new Date(`${wall}.000${zone}`).toISOString().slice(0, 19);
  assertUtcMicrosecondTimestamp(`${seconds}.000000Z`);
  // Date converts only whole seconds; retain every provider fractional digit.
  return `${seconds}.${fraction.padEnd(6, "0")}Z`;
}

function parseEvent(body: Uint8Array, eventId: string): WebhookEvent | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    if (!record(parsed) || typeof parsed.type !== "string" || !EVENT_TYPES.has(parsed.type) || !record(parsed.data)) return null;
    const emailId = parsed.data.email_id;
    if (typeof emailId !== "string" || emailId.length < 1 || emailId.length > 256 || /[\r\n]/u.test(emailId)) return null;
    let bounceType: WebhookEvent["bounceType"] = null;
    if (parsed.type === "email.bounced" && record(parsed.data.bounce)) {
      const value = parsed.data.bounce.type;
      if (value === "Permanent" || value === "Transient" || value === "Undetermined") bounceType = value;
    }
    return { eventId, emailId, eventType: parsed.type, bounceType, providerCreatedAt: providerTimestamp(parsed.created_at) };
  } catch {
    return null;
  }
}

export async function handleBroadcastEmailWebhookRequest(
  request: Request,
  env: Env,
  clock: () => Date = () => new Date(),
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isBroadcastEmailWebhookPath(url.pathname)) return null;
  if (url.search || url.hash) return json({ error: "not_found" }, 404);
  if (request.method.toUpperCase() !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (env.BROADCAST_EMAIL_BACKEND?.trim() !== "d1" || env.BROADCAST_SEND_BACKEND?.trim() !== "d1" ||
      env.D1_TOPOLOGY?.trim() !== "split") return json({ error: "webhook_unavailable" }, 503);
  const secret = env.BROADCAST_WEBHOOK_SIGNING_SECRET?.trim();
  const businessDb = selectD1Database(env, "business");
  if (!secret || !businessDb) return json({ error: "webhook_unavailable" }, 503);

  const eventId = request.headers.get("svix-id")?.trim() ?? "";
  const timestamp = request.headers.get("svix-timestamp")?.trim() ?? "";
  const signature = request.headers.get("svix-signature")?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(eventId) || !/^\d{1,12}$/u.test(timestamp) || !signature || signature.length > 2048) {
    return json({ error: "invalid_webhook" }, 400);
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) ||
      Math.abs(Math.floor(clock().getTime() / 1000) - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS) {
    return json({ error: "invalid_webhook" }, 400);
  }
  const rawBody = await readRawBody(request);
  if (!rawBody) return json({ error: "invalid_webhook" }, 400);
  if (!(await verifySignature(rawBody, eventId, timestamp, signature, secret))) {
    return json({ error: "invalid_signature" }, 401);
  }
  const event = parseEvent(rawBody, eventId);
  if (!event) return json({ error: "invalid_webhook" }, 400);

  const now = toUtcMicrosecondTimestamp(clock());
  try {
    await businessDb.prepare(`INSERT INTO broadcast_delivery_webhook_events
      (id, provider_email_id, event_type, bounce_type, created_at, provider_created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`)
      .bind(event.eventId, event.emailId, event.eventType, event.bounceType, now, event.providerCreatedAt).run();
    const recipient = await businessDb.prepare(`SELECT run_id FROM broadcast_delivery_recipients
      WHERE provider_email_id = ? LIMIT 1`).bind(event.emailId).first<{ run_id?: unknown }>();
    if (typeof recipient?.run_id === "string") {
      await reconcileBroadcastDeliveryRun(businessDb, recipient.run_id, now);
    }
    return json({ received: true }, 200);
  } catch {
    return json({ error: "webhook_unavailable" }, 503);
  }
}
