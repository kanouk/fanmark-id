import Stripe from "stripe";
import { buildPaidExtensionPriceMetadata } from "../../../supabase/functions/_shared/stripe-receipt-ingress/index.ts";
import { selectD1Database, type Env } from "./repository.ts";

const CHECKOUT_PATH = "/api/billing/extension-checkout";
const METHODS = "POST, OPTIONS";
const MAX_BODY_BYTES = 4 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const STRIPE_API_VERSION = "2025-08-27.basil";
const RECONCILIATION_WINDOW_MS = 20 * 60 * 60 * 1000;

interface LicenseRow {
  id: string;
  fanmark_id: string;
  tier_level: number;
  status: string;
}

interface PriceRow {
  release_version: string;
  release_status: string;
  row_count: number;
  actual_count: number;
  is_active: number;
  months: number;
  price_yen: number;
  stripe_price_id: string | null;
}

interface IntentRow {
  id: string;
  request_id: string;
  user_id: string;
  license_id: string;
  fanmark_id: string;
  tier_level: number;
  months: number;
  stripe_price_id: string;
  currency: string;
  expected_total_yen: number;
  allow_zero_total: number;
  livemode: number;
  stripe_checkout_session_id: string | null;
  stripe_session_status: string | null;
  stripe_payment_status: string | null;
  status: string;
  idempotency_safe_until: string;
}

interface StripeCheckoutSession {
  id: string;
  url: string | null;
  status: string | null;
  payment_status?: string | null;
}

interface StripeCheckoutClient {
  checkout: {
    sessions: {
      create(
        params: Stripe.Checkout.SessionCreateParams,
        options: Stripe.RequestOptions,
      ): Promise<StripeCheckoutSession>;
      retrieve(id: string): Promise<StripeCheckoutSession>;
    };
  };
}

export class StripeExtensionCheckoutD1Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "StripeExtensionCheckoutD1Error";
  }
}

export interface StripeExtensionCheckoutD1Dependencies {
  resolveUser(request: Request): Promise<string | null>;
  createStripeClient?(secret: string): StripeCheckoutClient;
  createId?(): string;
  now?(): Date;
}

export function isStripeExtensionCheckoutPath(pathname: string): boolean {
  return pathname === CHECKOUT_PATH;
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return headers;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
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

async function readBody(request: Request): Promise<{ licenseId: string; months: number; requestId: string }> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new StripeExtensionCheckoutD1Error("json_content_type_required", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new StripeExtensionCheckoutD1Error("request_too_large", 413);
  }
  if (!request.body) throw new StripeExtensionCheckoutD1Error("invalid_request", 400);
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
        throw new StripeExtensionCheckoutD1Error("request_too_large", 413);
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
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new StripeExtensionCheckoutD1Error("invalid_json", 400);
  }
  if (!isRecord(body) || Object.keys(body).length !== 3 ||
      Object.keys(body).some((key) => !["license_id", "months", "request_id"].includes(key)) ||
      typeof body.license_id !== "string" || !UUID.test(body.license_id) ||
      typeof body.request_id !== "string" || !UUID.test(body.request_id) ||
      !Number.isSafeInteger(body.months) || (body.months as number) < 1 || (body.months as number) > 12) {
    throw new StripeExtensionCheckoutD1Error("invalid_request", 400);
  }
  return {
    licenseId: body.license_id.toLowerCase(),
    months: body.months as number,
    requestId: body.request_id.toLowerCase(),
  };
}

function canonicalNow(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new StripeExtensionCheckoutD1Error("invalid_clock", 500);
  }
  return value.toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
}

function configuredStripeMode(secret: string): boolean {
  if (secret.startsWith("sk_live_")) return true;
  if (secret.startsWith("sk_test_")) return false;
  throw new StripeExtensionCheckoutD1Error("stripe_not_configured", 503);
}

function database(env: Env, role: "business" | "master"): D1Database {
  if (env.D1_TOPOLOGY?.trim() !== "split") {
    throw new StripeExtensionCheckoutD1Error("server_misconfigured", 503);
  }
  const selected = selectD1Database(env, role);
  if (!selected) throw new StripeExtensionCheckoutD1Error("checkout_unavailable", 503);
  return selected;
}

async function readEligibleLicense(
  business: D1Database,
  licenseId: string,
  userId: string,
  now: string,
): Promise<LicenseRow> {
  const rows = await business.prepare(`
    SELECT l.id, l.fanmark_id, f.tier_level, l.status
    FROM fanmark_licenses AS l
    JOIN fanmarks AS f ON f.id = l.fanmark_id
    WHERE l.id = ? AND l.user_id = ? AND l.status IN ('active', 'grace')
      AND l.license_end IS NOT NULL AND l.is_returned = 0 AND l.is_transferred = 0
      AND (l.transfer_locked_until IS NULL OR julianday(l.transfer_locked_until) <= julianday(?))
      AND NOT EXISTS (
        SELECT 1 FROM fanmark_transfer_requests AS tr
        WHERE tr.license_id = l.id AND tr.status IN ('pending', 'approved')
      )
    LIMIT 2
  `).bind(licenseId, userId, now).all<LicenseRow>();
  const matches = rows.results ?? [];
  if (matches.length !== 1 || !UUID.test(matches[0].id) || !UUID.test(matches[0].fanmark_id) ||
      !Number.isSafeInteger(matches[0].tier_level) || matches[0].tier_level < 1 ||
      !["active", "grace"].includes(matches[0].status)) {
    throw new StripeExtensionCheckoutD1Error("license_not_eligible", 403);
  }
  return matches[0];
}

const PLAN_LIMITS: Record<string, { key: string; fallback: number }> = {
  free: { key: "free_fanmarks_limit", fallback: 3 },
  creator: { key: "creator_fanmarks_limit", fallback: 10 },
  business: { key: "business_fanmarks_limit", fallback: 50 },
  enterprise: { key: "enterprise_fanmarks_limit", fallback: 100 },
  max: { key: "max_fanmarks_limit", fallback: 500 },
};

async function enforceGracePlanLimit(
  business: D1Database,
  userId: string,
  now: string,
): Promise<void> {
  const settings = await business.prepare(
    "SELECT plan_type FROM user_settings WHERE user_id = ? LIMIT 2",
  ).bind(userId).all<{ plan_type: string }>();
  if ((settings.results ?? []).length > 1) throw new StripeExtensionCheckoutD1Error("user_settings_ambiguous", 503);
  const planType = settings.results?.[0]?.plan_type ?? "free";
  if (planType === "admin") return;
  const plan = PLAN_LIMITS[planType] ?? PLAN_LIMITS.free;
  const configured = await business.prepare(
    "SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 2",
  ).bind(plan.key).all<{ setting_value: string }>();
  if ((configured.results ?? []).length > 1) throw new StripeExtensionCheckoutD1Error("plan_limit_ambiguous", 503);
  const rawLimit = configured.results?.[0]?.setting_value;
  const limit = rawLimit === undefined ? plan.fallback : Number.parseInt(rawLimit, 10);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new StripeExtensionCheckoutD1Error("plan_limit_invalid", 503);
  const count = await business.prepare(`
    SELECT COUNT(*) AS count FROM fanmark_licenses
    WHERE user_id = ? AND status = 'active'
      AND (license_end IS NULL OR julianday(license_end) > julianday(?))
  `).bind(userId, now).first<{ count: number }>();
  if (!count || !Number.isSafeInteger(count.count)) {
    throw new StripeExtensionCheckoutD1Error("active_license_count_unavailable", 503);
  }
  if (count.count >= limit) throw new StripeExtensionCheckoutD1Error("fanmark_limit_exceeded", 400);
}

async function readExtensionPrice(
  master: D1Database,
  tierLevel: number,
  months: number,
  livemode: boolean,
): Promise<{ priceId: string; priceYen: number }> {
  const rows = await master.prepare(`
    SELECT a.release_version, release.status AS release_status, manifest.row_count,
      (SELECT COUNT(*) FROM fanmark_extension_price_release_rows AS count_rows
        WHERE count_rows.release_version = a.release_version) AS actual_count,
      price.is_active, price.months, price.price_yen,
      CASE WHEN ? = 1 THEN price.stripe_price_id_live ELSE price.stripe_price_id END AS stripe_price_id
    FROM fanmark_reference_master_active_release AS a
    JOIN fanmark_reference_master_releases AS release
      ON release.release_version = a.release_version
    JOIN fanmark_reference_master_extension_price_manifests AS manifest
      ON manifest.release_version = a.release_version
    JOIN fanmark_extension_price_release_rows AS price
      ON price.release_version = a.release_version
    WHERE a.singleton_id = 1 AND price.tier_level = ? AND price.months = ?
    LIMIT 2
  `).bind(livemode ? 1 : 0, tierLevel, months).all<PriceRow>();
  const matches = rows.results ?? [];
  if (matches.length !== 1) throw new StripeExtensionCheckoutD1Error("extension_price_not_found", 404);
  const price = matches[0];
  if (price.release_status !== "ready" || price.row_count !== price.actual_count || price.is_active !== 1) {
    throw new StripeExtensionCheckoutD1Error("extension_price_unavailable", 503);
  }
  if (!Number.isSafeInteger(price.price_yen) || price.price_yen <= 0 || price.price_yen > 2_147_483_647 ||
      price.months !== months || typeof price.stripe_price_id !== "string" || !price.stripe_price_id.trim()) {
    throw new StripeExtensionCheckoutD1Error("extension_price_unavailable", 503);
  }
  return { priceId: price.stripe_price_id.trim(), priceYen: price.price_yen };
}

async function readIntent(
  business: D1Database,
  userId: string,
  requestId: string,
): Promise<IntentRow | null> {
  return await business.prepare(`
    SELECT id, request_id, user_id, license_id, fanmark_id, tier_level, months,
      stripe_price_id, currency, expected_total_yen, allow_zero_total, livemode,
      stripe_checkout_session_id, stripe_session_status, stripe_payment_status,
      status, idempotency_safe_until
    FROM stripe_extension_checkout_intents WHERE user_id = ? AND request_id = ?
    LIMIT 2
  `).bind(userId, requestId).first<IntentRow>();
}

function validateIntentRequest(
  intent: IntentRow,
  license: LicenseRow,
  requestId: string,
  userId: string,
  months: number,
  livemode: boolean,
): void {
  if (intent.request_id !== requestId || intent.user_id.toLowerCase() !== userId ||
      intent.license_id.toLowerCase() !== license.id.toLowerCase() ||
      intent.fanmark_id.toLowerCase() !== license.fanmark_id.toLowerCase() ||
      intent.tier_level !== license.tier_level || intent.months !== months ||
      intent.livemode !== (livemode ? 1 : 0)) {
    throw new StripeExtensionCheckoutD1Error("checkout_request_conflict", 409);
  }
  if (intent.currency !== "jpy" || intent.allow_zero_total !== 0 ||
      !Number.isSafeInteger(intent.expected_total_yen) || intent.expected_total_yen <= 0 ||
      typeof intent.stripe_price_id !== "string" || !intent.stripe_price_id.trim()) {
    throw new StripeExtensionCheckoutD1Error("checkout_intent_invalid", 503);
  }
}

async function beginIntent(
  business: D1Database,
  intent: {
    id: string;
    requestId: string;
    userId: string;
    license: LicenseRow;
    months: number;
    livemode: boolean;
    priceId: string;
    priceYen: number;
    now: string;
  },
): Promise<IntentRow> {
  const safeUntil = new Date(Date.parse(intent.now) + RECONCILIATION_WINDOW_MS)
    .toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
  await business.prepare(`
    INSERT INTO stripe_extension_checkout_intents (
      id, request_id, user_id, license_id, fanmark_id, tier_level, months,
      stripe_price_id, currency, expected_total_yen, allow_zero_total, livemode,
      stripe_checkout_session_id, stripe_session_status, stripe_payment_status,
      status, idempotency_safe_until, created_at, updated_at
    )
    SELECT ?, ?, ?, license.id, license.fanmark_id, fanmark.tier_level, ?, ?, 'jpy', ?, 0, ?,
      NULL, NULL, NULL, 'created', ?, ?, ?
    FROM fanmark_licenses AS license
    JOIN fanmarks AS fanmark ON fanmark.id = license.fanmark_id
    WHERE license.id = ? AND license.user_id = ? AND license.status IN ('active', 'grace')
      AND license.license_end IS NOT NULL AND license.is_returned = 0 AND license.is_transferred = 0
      AND fanmark.tier_level = ?
      AND (license.transfer_locked_until IS NULL OR julianday(license.transfer_locked_until) <= julianday(?))
      AND NOT EXISTS (
        SELECT 1 FROM fanmark_transfer_requests AS tr
        WHERE tr.license_id = license.id AND tr.status IN ('pending', 'approved')
      )
    ON CONFLICT(user_id, request_id) DO NOTHING
  `).bind(
    intent.id, intent.requestId, intent.userId, intent.months, intent.priceId,
    intent.priceYen, intent.livemode ? 1 : 0, safeUntil, intent.now, intent.now,
    intent.license.id, intent.userId, intent.license.tier_level, intent.now,
  ).run();
  const stored = await readIntent(business, intent.userId, intent.requestId);
  if (!stored) throw new StripeExtensionCheckoutD1Error("license_not_eligible", 403);
  validateIntentRequest(stored, intent.license, intent.requestId, intent.userId, intent.months, intent.livemode);
  return stored;
}

async function markReconciliationRequired(business: D1Database, intent: IntentRow, now: string): Promise<void> {
  await business.prepare(`
    UPDATE stripe_extension_checkout_intents SET status = 'reconciliation_required', updated_at = ?
    WHERE id = ? AND status = 'created' AND stripe_checkout_session_id IS NULL
      AND julianday(idempotency_safe_until) <= julianday(?)
  `).bind(now, intent.id, now).run();
}

function sessionUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
}

function stripeClient(secret: string): StripeCheckoutClient {
  return new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  }) as unknown as StripeCheckoutClient;
}

async function existingSessionResponse(
  stripe: StripeCheckoutClient,
  intent: IntentRow,
  headers: Headers,
): Promise<Response> {
  if (!intent.stripe_checkout_session_id) throw new StripeExtensionCheckoutD1Error("checkout_session_missing", 503);
  const session = await stripe.checkout.sessions.retrieve(intent.stripe_checkout_session_id);
  const url = session.id === intent.stripe_checkout_session_id && session.status === "open"
    ? sessionUrl(session.url)
    : null;
  if (!url) throw new StripeExtensionCheckoutD1Error("checkout_session_not_open", 409);
  return json({ url }, 200, headers);
}

async function createAndBindSession(
  business: D1Database,
  stripe: StripeCheckoutClient,
  intent: IntentRow,
  license: LicenseRow,
  origin: string,
  now: string,
  headers: Headers,
): Promise<Response> {
  const metadata = {
    type: "license_extension",
    fanmark_id: license.fanmark_id,
    license_id: license.id,
    user_id: intent.user_id,
    tier_level: String(intent.tier_level),
    months: String(intent.months),
    billing_intent_id: intent.id,
    price_id: intent.stripe_price_id,
    ...buildPaidExtensionPriceMetadata(intent.expected_total_yen),
  };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: intent.stripe_price_id, quantity: 1 }],
    success_url: `${origin}/dashboard?extension=success`,
    cancel_url: `${origin}/dashboard?extension=canceled`,
    metadata,
  }, { idempotencyKey: `fanmark-extension-checkout:${intent.id}` });
  const url = sessionUrl(session.url);
  if (!url || !session.id || session.status !== "open") {
    throw new StripeExtensionCheckoutD1Error("checkout_session_not_open", 502);
  }
  await business.prepare(`
    UPDATE stripe_extension_checkout_intents
    SET stripe_checkout_session_id = ?, stripe_session_status = ?, stripe_payment_status = ?,
        status = CASE WHEN status = 'created' THEN 'open' ELSE status END, updated_at = ?
    WHERE id = ? AND livemode = ?
      AND (stripe_checkout_session_id IS NULL OR stripe_checkout_session_id = ?)
      AND (stripe_checkout_session_id IS NOT NULL OR status = 'created')
  `).bind(
    session.id, session.status, session.payment_status ?? null, now,
    intent.id, intent.livemode, session.id,
  ).run();
  const bound = await business.prepare(`
    SELECT stripe_checkout_session_id, status FROM stripe_extension_checkout_intents WHERE id = ?
  `).bind(intent.id).first<{ stripe_checkout_session_id: string | null; status: string }>();
  if (bound?.stripe_checkout_session_id !== session.id) {
    throw new StripeExtensionCheckoutD1Error("checkout_session_binding_conflict", 503);
  }
  return json({ url }, 200, headers);
}

export async function handleStripeExtensionCheckoutD1Request(
  request: Request,
  env: Env,
  dependencies: StripeExtensionCheckoutD1Dependencies,
): Promise<Response | null> {
  const backend = env.STRIPE_EXTENSION_CHECKOUT_BACKEND?.trim();
  if (!backend) return null;
  if (backend !== "d1") return json({ error: "server_misconfigured" }, 500);
  if (env.STRIPE_WEBHOOK_BACKEND?.trim() !== "d1" ||
      env.STRIPE_DISPATCH_BACKEND?.trim() !== "d1" ||
      !env.STRIPE_WEBHOOK_SECRET?.trim()) {
    return json({ error: "stripe_checkout_not_ready" }, 503);
  }
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS") {
    headers.set("access-control-max-age", "600");
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "server_misconfigured" }, 500, headers);
  let userId: string | null;
  try {
    userId = await dependencies.resolveUser(request);
  } catch {
    return json({ error: "auth_unavailable" }, 503, headers);
  }
  if (!userId || !UUID.test(userId)) return json({ error: "unauthenticated" }, 401, headers);
  userId = userId.toLowerCase();

  let body: Awaited<ReturnType<typeof readBody>>;
  try {
    body = await readBody(request);
  } catch (error) {
    if (error instanceof StripeExtensionCheckoutD1Error) {
      return json({ error: error.code }, error.status, headers);
    }
    return json({ error: "invalid_request" }, 400, headers);
  }

  let business: D1Database;
  let master: D1Database;
  let secret: string;
  let livemode: boolean;
  let now: string;
  try {
    business = database(env, "business");
    master = database(env, "master");
    secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
    if (!secret) throw new StripeExtensionCheckoutD1Error("stripe_not_configured", 503);
    livemode = configuredStripeMode(secret);
    now = canonicalNow(dependencies.now?.() ?? new Date());
  } catch (error) {
    const mapped = error instanceof StripeExtensionCheckoutD1Error ? error : null;
    return json({ error: mapped?.code ?? "checkout_unavailable" }, mapped?.status ?? 503, headers);
  }

  try {
    const license = await readEligibleLicense(business, body.licenseId, userId, now);
    if (license.status === "grace") await enforceGracePlanLimit(business, userId, now);
    let intent = await readIntent(business, userId, body.requestId);
    if (intent) {
      validateIntentRequest(intent, license, body.requestId, userId, body.months, livemode);
    } else {
      const price = await readExtensionPrice(master, license.tier_level, body.months, livemode);
      const createId = dependencies.createId ?? (() => crypto.randomUUID());
      const id = createId();
      if (!UUID.test(id)) throw new StripeExtensionCheckoutD1Error("intent_id_invalid", 500);
      intent = await beginIntent(business, {
        id: id.toLowerCase(),
        requestId: body.requestId,
        userId,
        license,
        months: body.months,
        livemode,
        priceId: price.priceId,
        priceYen: price.priceYen,
        now,
      });
    }

    if (intent.stripe_checkout_session_id) {
      return await existingSessionResponse(
        (dependencies.createStripeClient ?? stripeClient)(secret), intent, headers,
      );
    }
    const safeUntil = Date.parse(intent.idempotency_safe_until);
    if (!Number.isFinite(safeUntil)) throw new StripeExtensionCheckoutD1Error("checkout_intent_invalid", 503);
    if (intent.status !== "created" || safeUntil <= Date.parse(now)) {
      await markReconciliationRequired(business, intent, now);
      throw new StripeExtensionCheckoutD1Error("checkout_intent_reconciliation_required", 409);
    }
    if (request.headers.get("Origin")) {
      const origin = request.headers.get("Origin") as string;
      if (headers.get("access-control-allow-origin") !== origin) {
        throw new StripeExtensionCheckoutD1Error("origin_not_allowed", 403);
      }
    }
    const baseOrigin = request.headers.get("Origin") ?? env.BETTER_AUTH_URL;
    if (!baseOrigin) throw new StripeExtensionCheckoutD1Error("checkout_origin_unavailable", 503);
    const parsedOrigin = new URL(baseOrigin);
    if (parsedOrigin.origin !== baseOrigin || parsedOrigin.protocol !== "https:") {
      throw new StripeExtensionCheckoutD1Error("checkout_origin_unavailable", 503);
    }
    return await createAndBindSession(
      business,
      (dependencies.createStripeClient ?? stripeClient)(secret),
      intent,
      license,
      parsedOrigin.origin,
      now,
      headers,
    );
  } catch (error) {
    if (error instanceof StripeExtensionCheckoutD1Error) {
      return json({ error: error.code }, error.status, headers);
    }
    return json({ error: "checkout_unavailable" }, 503, headers);
  }
}
