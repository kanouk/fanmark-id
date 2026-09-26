import Stripe from "stripe";
import { selectD1Database, type Env } from "./repository.ts";

const PLAN_CHECKOUT_PATH = "/api/billing/plan-checkout";
const METHODS = "POST, OPTIONS";
const MAX_BODY_BYTES = 2 * 1024;
const MAX_RESPONSE_URL_LENGTH = 4096;
const COMMAND_WINDOW_MS = 23 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/u;
const CHECKOUT_SESSION_ID = /^cs_[A-Za-z0-9_]+$/u;
const PRICE_ID = /^price_[A-Za-z0-9_]+$/u;
const STRIPE_API_VERSION = "2025-08-27.basil";

export type PaidPlanType = "creator" | "max" | "business";

interface PlanCheckoutCommand extends Record<string, unknown> {
  request_id: string;
  user_id: string;
  plan_type: PaidPlanType;
  stripe_price_id: string;
  livemode: number;
  stripe_customer_id: string | null;
  stripe_checkout_session_id: string | null;
  status: "prepared" | "session_created";
  idempotency_safe_until: string;
}

interface PlanCustomerCommand extends Record<string, unknown> {
  user_id: string;
  stripe_customer_id: string | null;
  status: "pending" | "created";
  idempotency_safe_until: string;
}

interface StripePrice {
  id: string;
  active: boolean;
  livemode: boolean;
  type: string;
  currency: string;
  recurring?: { interval: string; interval_count: number } | null;
}

interface StripeCustomer {
  id: string;
}

interface StripeCheckoutSession {
  id: string;
  url: string | null;
  status: string | null;
  customer?: string | { id: string } | null;
}

interface StripePlanCheckoutClient {
  prices: { retrieve(id: string): Promise<StripePrice> };
  customers: {
    create(
      params: Stripe.CustomerCreateParams,
      options: Stripe.RequestOptions,
    ): Promise<StripeCustomer>;
  };
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

export class StripePlanCheckoutD1Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "StripePlanCheckoutD1Error";
  }
}

export interface StripePlanCheckoutD1Dependencies {
  resolveUser(request: Request): Promise<{ id: string; email: string } | null>;
  createStripeClient?(secret: string): StripePlanCheckoutClient;
  now?(): Date;
}

export function isStripePlanCheckoutPath(pathname: string): boolean {
  return pathname === PLAN_CHECKOUT_PATH;
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function allowedOrigin(request: Request, env: Env): { origin: string; headers: Headers } | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.origin !== origin || parsed.protocol !== "https:" || env.BETTER_AUTH_URL?.trim() !== origin) {
    return null;
  }
  return {
    origin,
    headers: new Headers({
      "access-control-allow-origin": origin,
      "access-control-allow-methods": METHODS,
      "access-control-allow-headers": "content-type",
      "access-control-allow-credentials": "true",
      "access-control-max-age": "600",
      vary: "Origin",
    }),
  };
}

async function readRequest(request: Request): Promise<{ planType: PaidPlanType; requestId: string }> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new StripePlanCheckoutD1Error("json_content_type_required", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new StripePlanCheckoutD1Error("request_too_large", 413);
  }
  if (!request.body) throw new StripePlanCheckoutD1Error("invalid_request", 400);

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
        throw new StripePlanCheckoutD1Error("request_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bodyBytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes)) as unknown;
  } catch {
    throw new StripePlanCheckoutD1Error("invalid_json", 400);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new StripePlanCheckoutD1Error("invalid_request", 400);
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || Object.keys(record).some((key) => !["plan_type", "request_id"].includes(key)) ||
      !["creator", "max", "business"].includes(String(record.plan_type)) ||
      typeof record.request_id !== "string" || !UUID.test(record.request_id)) {
    throw new StripePlanCheckoutD1Error("invalid_request", 400);
  }
  return {
    planType: record.plan_type as PaidPlanType,
    requestId: record.request_id.toLowerCase(),
  };
}

function stripeClient(secret: string): StripePlanCheckoutClient {
  return new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
    timeout: 10_000,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(),
  }) as unknown as StripePlanCheckoutClient;
}

function safeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RESPONSE_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com" && !url.username && !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}

function database(env: Env): D1Database {
  if (env.D1_TOPOLOGY?.trim() !== "split") throw new StripePlanCheckoutD1Error("server_misconfigured", 503);
  const selected = selectD1Database(env, "business");
  if (!selected) throw new StripePlanCheckoutD1Error("checkout_unavailable", 503);
  return selected;
}

function canonicalNow(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new StripePlanCheckoutD1Error("server_misconfigured", 500);
  }
  return date.toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
}

async function readUnique<T extends Record<string, unknown>>(
  databaseBinding: D1Database,
  sql: string,
  values: unknown[],
  errorCode: string,
): Promise<T> {
  const result = await databaseBinding.prepare(sql).bind(...values).all<T>();
  if (!result.success) throw new StripePlanCheckoutD1Error(errorCode, 503);
  if (result.results.length !== 1) throw new StripePlanCheckoutD1Error(errorCode, result.results.length === 0 ? 404 : 503);
  return result.results[0];
}

async function readPlanPrice(
  business: D1Database,
  planType: PaidPlanType,
  livemode: boolean,
): Promise<string> {
  const suffix = livemode ? "_live" : "";
  const rows = await business.prepare(
    "SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 2",
  ).bind(`${planType}_stripe_price_id${suffix}`).all<{ setting_value: unknown }>();
  if (!rows.success || rows.results.length !== 1) {
    throw new StripePlanCheckoutD1Error("stripe_price_unavailable", rows.results.length > 1 ? 503 : 503);
  }
  const priceId = rows.results[0]?.setting_value;
  if (typeof priceId !== "string" || !PRICE_ID.test(priceId)) {
    throw new StripePlanCheckoutD1Error("stripe_price_unavailable", 503);
  }
  return priceId;
}

async function readCommand(
  business: D1Database,
  requestId: string,
): Promise<PlanCheckoutCommand | null> {
  const result = await business.prepare(
    "SELECT request_id, user_id, plan_type, stripe_price_id, livemode, stripe_customer_id, stripe_checkout_session_id, status, idempotency_safe_until FROM stripe_plan_checkout_commands WHERE request_id = ? LIMIT 2",
  ).bind(requestId).all<PlanCheckoutCommand>();
  if (!result.success || result.results.length > 1) throw new StripePlanCheckoutD1Error("checkout_unavailable", 503);
  return result.results[0] ?? null;
}

async function createOrReadCommand(
  business: D1Database,
  input: { requestId: string; userId: string; planType: PaidPlanType; priceId: string; livemode: boolean; now: string },
): Promise<PlanCheckoutCommand> {
  const safeUntil = new Date(Date.parse(input.now) + COMMAND_WINDOW_MS).toISOString()
    .replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
  const insertion = await business.prepare(`
    INSERT INTO stripe_plan_checkout_commands (
      request_id, user_id, plan_type, stripe_price_id, livemode,
      stripe_customer_id, stripe_checkout_session_id, status,
      idempotency_safe_until, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, 'prepared', ?, ?, ?)
    ON CONFLICT(request_id) DO NOTHING
  `).bind(input.requestId, input.userId, input.planType, input.priceId, input.livemode ? 1 : 0,
    safeUntil, input.now, input.now).run();
  if (!insertion.success) throw new StripePlanCheckoutD1Error("checkout_unavailable", 503);

  const stored = await readCommand(business, input.requestId);
  if (!stored) throw new StripePlanCheckoutD1Error("checkout_unavailable", 503);
  if (stored.user_id !== input.userId || stored.plan_type !== input.planType ||
      stored.stripe_price_id !== input.priceId || stored.livemode !== (input.livemode ? 1 : 0)) {
    throw new StripePlanCheckoutD1Error("request_id_conflict", 409);
  }
  if (Date.parse(stored.idempotency_safe_until) <= Date.parse(input.now)) {
    throw new StripePlanCheckoutD1Error("request_id_expired", 409);
  }
  return stored;
}

async function readCustomerCommand(business: D1Database, userId: string): Promise<PlanCustomerCommand | null> {
  const result = await business.prepare(`
    SELECT user_id, stripe_customer_id, status, idempotency_safe_until
    FROM stripe_plan_customer_commands WHERE user_id = ? LIMIT 2
  `).bind(userId).all<PlanCustomerCommand>();
  if (!result.success || result.results.length > 1) {
    throw new StripePlanCheckoutD1Error("stripe_customer_command_unavailable", 503);
  }
  return result.results[0] ?? null;
}

async function readCustomerMapping(business: D1Database, userId: string): Promise<unknown> {
  const result = await business.prepare(
    "SELECT stripe_customer_id FROM user_settings WHERE user_id = ? LIMIT 2",
  ).bind(userId).all<{ stripe_customer_id: unknown }>();
  if (!result.success || result.results.length !== 1) {
    throw new StripePlanCheckoutD1Error("stripe_customer_mapping_unavailable", 503);
  }
  return result.results[0]?.stripe_customer_id;
}

async function persistCustomerLink(
  business: D1Database,
  userId: string,
  customerId: string,
  now: string,
): Promise<void> {
  const results = await business.batch([
    business.prepare(`
      UPDATE stripe_plan_customer_commands
      SET stripe_customer_id = ?, status = 'created', updated_at = ?
      WHERE user_id = ? AND status = 'pending'
        AND (stripe_customer_id IS NULL OR stripe_customer_id = ?)
    `).bind(customerId, now, userId, customerId),
    business.prepare(`
      UPDATE user_settings SET stripe_customer_id = ?, updated_at = ?
      WHERE user_id = ? AND (stripe_customer_id IS NULL OR stripe_customer_id = ?)
    `).bind(customerId, now, userId, customerId),
  ]);
  if (results.some((result) => !result.success)) {
    throw new StripePlanCheckoutD1Error("stripe_customer_mapping_unavailable", 503);
  }
  const [command, mappedCustomerId] = await Promise.all([
    readCustomerCommand(business, userId),
    readCustomerMapping(business, userId),
  ]);
  if (!command || command.status !== "created" || command.stripe_customer_id !== customerId || mappedCustomerId !== customerId) {
    throw new StripePlanCheckoutD1Error("stripe_customer_mapping_conflict", 409);
  }
}

async function ensureStripeCustomer(
  business: D1Database,
  stripe: StripePlanCheckoutClient,
  user: { id: string; email: string },
  existingId: unknown,
  now: string,
): Promise<string> {
  if (typeof existingId === "string" && CUSTOMER_ID.test(existingId)) {
    const linkedCommand = await readCustomerCommand(business, user.id);
    if (linkedCommand?.status === "created" && linkedCommand.stripe_customer_id !== existingId) {
      throw new StripePlanCheckoutD1Error("stripe_customer_mapping_conflict", 409);
    }
    if (linkedCommand?.status === "pending") {
      await persistCustomerLink(business, user.id, existingId, now);
    }
    return existingId;
  }
  if (existingId !== null && existingId !== undefined && existingId !== "") {
    throw new StripePlanCheckoutD1Error("stripe_customer_mapping_invalid", 503);
  }

  const safeUntil = new Date(Date.parse(now) + COMMAND_WINDOW_MS).toISOString()
    .replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
  const inserted = await business.prepare(`
    INSERT INTO stripe_plan_customer_commands (
      user_id, stripe_customer_id, status, idempotency_safe_until, created_at, updated_at
    ) VALUES (?, NULL, 'pending', ?, ?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).bind(user.id, safeUntil, now, now).run();
  if (!inserted.success) throw new StripePlanCheckoutD1Error("stripe_customer_command_unavailable", 503);
  const command = await readCustomerCommand(business, user.id);
  if (!command) throw new StripePlanCheckoutD1Error("stripe_customer_command_unavailable", 503);
  if (command.user_id !== user.id) throw new StripePlanCheckoutD1Error("stripe_customer_command_conflict", 409);

  if (command.status === "created") {
    const customerId = command.stripe_customer_id;
    if (!customerId || !CUSTOMER_ID.test(customerId)) {
      throw new StripePlanCheckoutD1Error("stripe_customer_command_invalid", 503);
    }
    await business.prepare(`
      UPDATE user_settings SET stripe_customer_id = ?, updated_at = ?
      WHERE user_id = ? AND (stripe_customer_id IS NULL OR stripe_customer_id = ?)
    `).bind(customerId, now, user.id, customerId).run();
    if (await readCustomerMapping(business, user.id) !== customerId) {
      throw new StripePlanCheckoutD1Error("stripe_customer_mapping_conflict", 409);
    }
    return customerId;
  }

  if (Date.parse(command.idempotency_safe_until) <= Date.parse(now)) {
    throw new StripePlanCheckoutD1Error("stripe_customer_reconciliation_required", 409);
  }

  const knownMapping = await readCustomerMapping(business, user.id);
  if (typeof knownMapping === "string" && CUSTOMER_ID.test(knownMapping)) {
    await persistCustomerLink(business, user.id, knownMapping, now);
    return knownMapping;
  }
  if (knownMapping !== null && knownMapping !== undefined && knownMapping !== "") {
    throw new StripePlanCheckoutD1Error("stripe_customer_mapping_invalid", 503);
  }

  const created = await stripe.customers.create({
    email: user.email,
    metadata: { user_id: user.id },
  }, { idempotencyKey: `fanmark-plan-customer:${user.id}` });
  if (!created || typeof created.id !== "string" || !CUSTOMER_ID.test(created.id)) {
    throw new StripePlanCheckoutD1Error("stripe_customer_unavailable", 502);
  }
  await persistCustomerLink(business, user.id, created.id, now);
  return created.id;
}

function sessionCustomerId(value: StripeCheckoutSession["customer"]): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

async function responseForExistingSession(
  stripe: StripePlanCheckoutClient,
  command: PlanCheckoutCommand,
  headers: Headers,
): Promise<Response> {
  const sessionId = command.stripe_checkout_session_id;
  const customerId = command.stripe_customer_id;
  if (!sessionId || !CHECKOUT_SESSION_ID.test(sessionId) || !customerId || !CUSTOMER_ID.test(customerId)) {
    throw new StripePlanCheckoutD1Error("checkout_session_unavailable", 503);
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const url = session.id === sessionId && session.status === "open" && sessionCustomerId(session.customer) === customerId
    ? safeCheckoutUrl(session.url)
    : null;
  if (!url) throw new StripePlanCheckoutD1Error("checkout_session_not_open", 409);
  return json({ url }, 200, headers);
}

async function persistSession(
  business: D1Database,
  command: PlanCheckoutCommand,
  customerId: string,
  sessionId: string,
  now: string,
): Promise<void> {
  const update = await business.prepare(`
    UPDATE stripe_plan_checkout_commands
    SET stripe_customer_id = ?, stripe_checkout_session_id = ?, status = 'session_created', updated_at = ?
    WHERE request_id = ? AND user_id = ? AND stripe_customer_id = ? AND status IN ('prepared', 'session_created')
  `).bind(customerId, sessionId, now, command.request_id, command.user_id, customerId).run();
  if (!update.success) throw new StripePlanCheckoutD1Error("checkout_command_unavailable", 503);
  const stored = await readCommand(business, command.request_id);
  if (!stored || stored.user_id !== command.user_id || stored.stripe_customer_id !== customerId ||
      stored.stripe_checkout_session_id !== sessionId || stored.status !== "session_created") {
    throw new StripePlanCheckoutD1Error("checkout_command_conflict", 409);
  }
}

export async function handleStripePlanCheckoutD1Request(
  request: Request,
  env: Env,
  dependencies: StripePlanCheckoutD1Dependencies,
): Promise<Response | null> {
  const backend = env.STRIPE_PLAN_CHECKOUT_BACKEND?.trim();
  if (!backend) return null;
  if (backend !== "d1") return json({ error: "server_misconfigured" }, 500);

  if (env.STRIPE_WEBHOOK_BACKEND?.trim() !== "d1" || env.STRIPE_DISPATCH_BACKEND?.trim() !== "d1" ||
      !env.STRIPE_WEBHOOK_SECRET?.trim()) {
    return json({ error: "stripe_checkout_not_ready" }, 503);
  }

  const allowed = allowedOrigin(request, env);
  if (!allowed) return json({ error: "origin_not_allowed" }, 403);
  const { origin, headers } = allowed;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "server_misconfigured" }, 500, headers);

  let body: { planType: PaidPlanType; requestId: string };
  try {
    body = await readRequest(request);
  } catch (error) {
    const failure = error instanceof StripePlanCheckoutD1Error ? error : new StripePlanCheckoutD1Error("invalid_request", 400);
    return json({ error: failure.code }, failure.status, headers);
  }

  let user: { id: string; email: string } | null;
  try {
    user = await dependencies.resolveUser(request);
  } catch {
    return json({ error: "auth_unavailable" }, 503, headers);
  }
  if (!user || !UUID.test(user.id) || typeof user.email !== "string" || user.email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(user.email)) {
    return json({ error: "unauthenticated" }, 401, headers);
  }
  user = { id: user.id.toLowerCase(), email: user.email.trim() };

  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const testSecret = env.STRIPE_SECRET_KEY_TEST?.trim() ?? "";
  const liveSecret = env.STRIPE_SECRET_KEY_LIVE?.trim() ?? "";
  const livemode = secret.startsWith("sk_live_");
  const secretMatchesDispatchMode = livemode ? secret === liveSecret : secret.startsWith("sk_test_") && secret === testSecret;
  if (!secretMatchesDispatchMode || !testSecret.startsWith("sk_test_") || !liveSecret.startsWith("sk_live_")) {
    return json({ error: "stripe_checkout_not_ready" }, 503, headers);
  }

  let business: D1Database;
  try {
    business = database(env);
  } catch (error) {
    const failure = error instanceof StripePlanCheckoutD1Error ? error : new StripePlanCheckoutD1Error("checkout_unavailable", 503);
    return json({ error: failure.code }, failure.status, headers);
  }

  try {
    const settings = await readUnique<{ plan_type: string; stripe_customer_id: unknown }>(
      business,
      "SELECT plan_type, stripe_customer_id FROM user_settings WHERE user_id = ? LIMIT 2",
      [user.id],
      "billing_profile_unavailable",
    );
    if (settings.plan_type !== "free") throw new StripePlanCheckoutD1Error("paid_plan_already_active", 409);

    const priceId = await readPlanPrice(business, body.planType, livemode);
    const now = canonicalNow((dependencies.now ?? (() => new Date()))());
    const command = await createOrReadCommand(business, {
      requestId: body.requestId,
      userId: user.id,
      planType: body.planType,
      priceId,
      livemode,
      now,
    });
    const stripe = (dependencies.createStripeClient ?? stripeClient)(secret);

    if (command.status === "session_created") {
      return await responseForExistingSession(stripe, command, headers);
    }

    const price = await stripe.prices.retrieve(priceId);
    if (!price || price.id !== priceId || price.active !== true || price.livemode !== livemode ||
        price.type !== "recurring" || price.currency !== "jpy" ||
        price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) {
      throw new StripePlanCheckoutD1Error("stripe_price_mismatch", 503);
    }

    const customerId = await ensureStripeCustomer(business, stripe, user, settings.stripe_customer_id, now);
    if (command.stripe_customer_id && command.stripe_customer_id !== customerId) {
      throw new StripePlanCheckoutD1Error("checkout_command_conflict", 409);
    }
    const customerCommand = await business.prepare(`
      UPDATE stripe_plan_checkout_commands SET stripe_customer_id = ?, updated_at = ?
      WHERE request_id = ? AND user_id = ? AND (stripe_customer_id IS NULL OR stripe_customer_id = ?)
    `).bind(customerId, now, command.request_id, user.id, customerId).run();
    if (!customerCommand.success) throw new StripePlanCheckoutD1Error("checkout_command_unavailable", 503);
    const rechecked = await business.prepare(
      "SELECT plan_type, stripe_customer_id FROM user_settings WHERE user_id = ? LIMIT 2",
    ).bind(user.id).all<{ plan_type: string; stripe_customer_id: unknown }>();
    if (!rechecked.success || rechecked.results.length !== 1 || rechecked.results[0]?.plan_type !== "free" ||
        rechecked.results[0]?.stripe_customer_id !== customerId) {
      throw new StripePlanCheckoutD1Error("billing_profile_changed", 409);
    }

    const metadata = {
      user_id: user.id,
      plan_type: body.planType,
      billing_command_id: body.requestId,
    };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/plans?checkout=success`,
      cancel_url: `${origin}/plans?checkout=canceled`,
      metadata,
      subscription_data: { metadata },
    }, { idempotencyKey: `fanmark-plan-checkout:${body.requestId}` });
    const url = safeCheckoutUrl(session?.url);
    if (!session || typeof session.id !== "string" || !CHECKOUT_SESSION_ID.test(session.id) ||
        session.status !== "open" || sessionCustomerId(session.customer) !== customerId || !url) {
      throw new StripePlanCheckoutD1Error("stripe_checkout_session_invalid", 502);
    }
    await persistSession(business, command, customerId, session.id, now);
    return json({ url }, 200, headers);
  } catch (error) {
    const failure = error instanceof StripePlanCheckoutD1Error
      ? error
      : new StripePlanCheckoutD1Error("stripe_checkout_unavailable", 502);
    return json({ error: failure.code }, failure.status, headers);
  }
}
