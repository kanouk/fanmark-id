import Stripe from "stripe";
import { selectD1Database, type Env } from "./repository.ts";

const PLAN_CHANGE_PATH = "/api/billing/plan-change";
const METHODS = "POST, OPTIONS";
const MAX_BODY_BYTES = 2 * 1024;
const COMMAND_WINDOW_MS = 23 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/u;
const SUBSCRIPTION_ID = /^sub_[A-Za-z0-9_]+$/u;
const PRICE_ID = /^price_[A-Za-z0-9_]+$/u;
const STRIPE_API_VERSION = "2025-08-27.basil";
const PAID_PLANS = ["creator", "max", "business"] as const;
const PLAN_ORDER: Record<PaidPlanType, number> = { creator: 1, max: 2, business: 3 };
const PLAN_LIMITS: Record<PlanType, { key: string; fallback: number }> = {
  free: { key: "free_fanmarks_limit", fallback: 3 },
  creator: { key: "creator_fanmarks_limit", fallback: 10 },
  max: { key: "max_fanmarks_limit", fallback: 500 },
  business: { key: "business_fanmarks_limit", fallback: 50 },
};

type PaidPlanType = typeof PAID_PLANS[number];
type PlanType = "free" | PaidPlanType;

interface SubscriptionPrice {
  id: string;
  active?: boolean;
  livemode?: boolean;
  type?: string;
  currency?: string;
  recurring?: { interval?: string; interval_count?: number } | null;
}

interface StripeSubscription {
  id: string;
  status: string;
  livemode?: boolean;
  cancel_at_period_end?: boolean;
  customer: string | { id: string } | null;
  items?: { data?: Array<{ id: string; price: string | SubscriptionPrice }> };
  latest_invoice?: string | { payment_intent?: string | { status?: string } | null } | null;
}

interface StripePlanChangeClient {
  prices: { retrieve(id: string): Promise<SubscriptionPrice> };
  subscriptions: {
    retrieve(id: string, params?: Stripe.SubscriptionRetrieveParams): Promise<StripeSubscription>;
    update(
      id: string,
      params: Stripe.SubscriptionUpdateParams,
      options: Stripe.RequestOptions,
    ): Promise<StripeSubscription>;
    cancel(
      id: string,
      params: Stripe.SubscriptionCancelParams,
      options: Stripe.RequestOptions,
    ): Promise<StripeSubscription>;
  };
}

interface PlanChangeCommand extends Record<string, unknown> {
  request_id: string;
  user_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  from_plan_type: PaidPlanType;
  to_plan_type: PlanType;
  from_price_id: string;
  to_price_id: string | null;
  livemode: number;
  status: "prepared" | "requires_action" | "submitted";
  idempotency_safe_until: string;
}

interface CurrentBillingState {
  plan_type: unknown;
  stripe_customer_id: unknown;
  subscription_customer_id: unknown;
  stripe_subscription_id: unknown;
  price_id: unknown;
}

export class StripePlanChangeD1Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "StripePlanChangeD1Error";
  }
}

export interface StripePlanChangeD1Dependencies {
  resolveUser(request: Request): Promise<string | null>;
  createStripeClient?(secret: string): StripePlanChangeClient;
  now?(): Date;
}

export function isStripePlanChangePath(pathname: string): boolean {
  return pathname === PLAN_CHANGE_PATH;
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function originHeaders(request: Request, env: Env): Headers | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = new Set((env.CORS_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowed.has(origin)) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.protocol !== "https:" || env.BETTER_AUTH_URL?.trim() !== origin) return null;
  } catch {
    return null;
  }
  return new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-methods": METHODS,
    "access-control-allow-headers": "content-type",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "600",
    vary: "Origin",
  });
}

async function readRequest(request: Request): Promise<{ toPlan: PlanType; requestId: string }> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new StripePlanChangeD1Error("json_content_type_required", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new StripePlanChangeD1Error("request_too_large", 413);
  }
  if (!request.body) throw new StripePlanChangeD1Error("invalid_request", 400);
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
        throw new StripePlanChangeD1Error("request_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new StripePlanChangeD1Error("invalid_json", 400); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new StripePlanChangeD1Error("invalid_request", 400);
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 2 || Object.keys(body).some((key) => !["new_plan_type", "request_id"].includes(key)) ||
      !["free", ...PAID_PLANS].includes(String(body.new_plan_type)) ||
      typeof body.request_id !== "string" || !UUID.test(body.request_id)) {
    throw new StripePlanChangeD1Error("invalid_request", 400);
  }
  return { toPlan: body.new_plan_type as PlanType, requestId: body.request_id.toLowerCase() };
}

function stripeClient(secret: string): StripePlanChangeClient {
  return new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
    timeout: 10_000,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(),
  }) as unknown as StripePlanChangeClient;
}

function database(env: Env): D1Database {
  if (env.D1_TOPOLOGY?.trim() !== "split") throw new StripePlanChangeD1Error("server_misconfigured");
  const selected = selectD1Database(env, "business");
  if (!selected) throw new StripePlanChangeD1Error("stripe_plan_change_unavailable");
  return selected;
}

function canonicalNow(date: Date): string {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new StripePlanChangeD1Error("server_misconfigured", 500);
  return date.toISOString().replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
}

async function readOne<T extends Record<string, unknown>>(
  db: D1Database,
  sql: string,
  values: unknown[],
  code: string,
): Promise<T> {
  const result = await db.prepare(sql).bind(...values).all<T>();
  if (!result.success) throw new StripePlanChangeD1Error(code);
  if (result.results.length !== 1) throw new StripePlanChangeD1Error(code, result.results.length === 0 ? 404 : 503);
  return result.results[0];
}

async function readPlanPrices(db: D1Database, livemode: boolean): Promise<Map<string, PaidPlanType>> {
  const prices = new Map<string, PaidPlanType>();
  const suffix = livemode ? "_live" : "";
  for (const plan of PAID_PLANS) {
    const rows = await db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 2")
      .bind(`${plan}_stripe_price_id${suffix}`).all<{ setting_value: unknown }>();
    if (!rows.success || rows.results.length > 1) throw new StripePlanChangeD1Error("stripe_price_unavailable");
    const priceId = rows.results[0]?.setting_value;
    if (priceId === null || priceId === undefined || priceId === "") continue;
    if (typeof priceId !== "string" || !PRICE_ID.test(priceId) || prices.has(priceId)) {
      throw new StripePlanChangeD1Error("stripe_price_mapping_invalid");
    }
    prices.set(priceId, plan);
  }
  return prices;
}

async function readTargetPrice(db: D1Database, plan: PaidPlanType, livemode: boolean): Promise<string> {
  const key = `${plan}_stripe_price_id${livemode ? "_live" : ""}`;
  const row = await readOne<{ setting_value: unknown }>(
    db,
    "SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 2",
    [key],
    "stripe_price_unavailable",
  );
  if (typeof row.setting_value !== "string" || !PRICE_ID.test(row.setting_value)) {
    throw new StripePlanChangeD1Error("stripe_price_unavailable");
  }
  return row.setting_value;
}

async function readLimit(db: D1Database, plan: PlanType): Promise<number> {
  const definition = PLAN_LIMITS[plan];
  const rows = await db.prepare("SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 2")
    .bind(definition.key).all<{ setting_value: unknown }>();
  if (!rows.success || rows.results.length > 1) throw new StripePlanChangeD1Error("plan_limit_unavailable");
  if (rows.results.length === 0) return definition.fallback;
  const configured = Number(rows.results[0]?.setting_value);
  if (!Number.isSafeInteger(configured) || configured < 0) throw new StripePlanChangeD1Error("plan_limit_unavailable");
  return configured;
}

async function assertWithinPlanLimit(db: D1Database, userId: string, plan: PlanType, now: string): Promise<void> {
  const [limit, countRow] = await Promise.all([
    readLimit(db, plan),
    db.prepare(`
      SELECT COUNT(*) AS count FROM fanmark_licenses
      WHERE user_id = ? AND status = 'active' AND (license_end IS NULL OR license_end > ?)
    `).bind(userId, now).first<{ count: unknown }>(),
  ]);
  if (!countRow || typeof countRow.count !== "number" || !Number.isSafeInteger(countRow.count) || countRow.count < 0) {
    throw new StripePlanChangeD1Error("plan_limit_unavailable");
  }
  if (countRow.count > limit) throw new StripePlanChangeD1Error("plan_limit_exceeded", 409);
}

function stripeCustomerId(value: StripeSubscription["customer"]): string | null {
  if (typeof value === "string") return value;
  return value && typeof value === "object" && typeof value.id === "string" ? value.id : null;
}

function subscriptionPriceId(subscription: StripeSubscription): string | null {
  const items = subscription.items?.data;
  if (!Array.isArray(items) || items.length !== 1) return null;
  const price = items[0]?.price;
  return typeof price === "string" ? price : price && typeof price.id === "string" ? price.id : null;
}

function needsPaymentAction(subscription: StripeSubscription): boolean {
  const latestInvoice = subscription.latest_invoice;
  if (!latestInvoice || typeof latestInvoice === "string") return false;
  const paymentIntent = latestInvoice.payment_intent;
  return Boolean(paymentIntent && typeof paymentIntent === "object" &&
    ["requires_action", "requires_payment_method", "requires_confirmation", "requires_source_action", "requires_source"]
      .includes(String(paymentIntent.status)));
}

async function readCurrentState(db: D1Database, userId: string): Promise<CurrentBillingState> {
  const profile = await readOne<{ plan_type: unknown; stripe_customer_id: unknown }>(
    db,
    "SELECT plan_type, stripe_customer_id FROM user_settings WHERE user_id = ? LIMIT 2",
    [userId],
    "billing_profile_unavailable",
  );
  const subscriptions = await db.prepare(`
    SELECT stripe_subscription_id, stripe_customer_id, price_id, status
    FROM user_subscriptions WHERE user_id = ? AND status = 'active' LIMIT 2
  `).bind(userId).all<{ stripe_subscription_id: unknown; stripe_customer_id: unknown; price_id: unknown; status: unknown }>();
  if (!subscriptions.success || subscriptions.results.length !== 1) {
    throw new StripePlanChangeD1Error(subscriptions.results.length > 1 ? "subscription_mapping_ambiguous" : "active_subscription_not_found", 409);
  }
  const row = subscriptions.results[0];
  if (typeof row.stripe_subscription_id !== "string" || !SUBSCRIPTION_ID.test(row.stripe_subscription_id) ||
      typeof row.stripe_customer_id !== "string" || !CUSTOMER_ID.test(row.stripe_customer_id) ||
      typeof row.price_id !== "string" || !PRICE_ID.test(row.price_id)) {
    throw new StripePlanChangeD1Error("subscription_mapping_invalid");
  }
  return {
    plan_type: profile.plan_type,
    stripe_customer_id: profile.stripe_customer_id,
    subscription_customer_id: row.stripe_customer_id,
    stripe_subscription_id: row.stripe_subscription_id,
    price_id: row.price_id,
  };
}

async function readCommand(db: D1Database, requestId: string): Promise<PlanChangeCommand | null> {
  const rows = await db.prepare(`
    SELECT request_id, user_id, stripe_subscription_id, stripe_customer_id, from_plan_type, to_plan_type,
           from_price_id, to_price_id, livemode, status, idempotency_safe_until
    FROM stripe_plan_change_commands WHERE request_id = ? LIMIT 2
  `).bind(requestId).all<PlanChangeCommand>();
  if (!rows.success || rows.results.length > 1) throw new StripePlanChangeD1Error("plan_change_command_unavailable");
  return rows.results[0] ?? null;
}

async function readOpenCommand(db: D1Database, userId: string): Promise<PlanChangeCommand | null> {
  const rows = await db.prepare(`
    SELECT request_id, user_id, stripe_subscription_id, stripe_customer_id, from_plan_type, to_plan_type,
           from_price_id, to_price_id, livemode, status, idempotency_safe_until
    FROM stripe_plan_change_commands WHERE user_id = ? AND status IN ('prepared', 'requires_action') LIMIT 2
  `).bind(userId).all<PlanChangeCommand>();
  if (!rows.success || rows.results.length > 1) throw new StripePlanChangeD1Error("plan_change_command_unavailable");
  return rows.results[0] ?? null;
}

async function persistNewCommand(
  db: D1Database,
  input: {
    requestId: string; userId: string; subscriptionId: string; customerId: string;
    fromPlan: PaidPlanType; toPlan: PlanType; fromPriceId: string; toPriceId: string | null;
    livemode: boolean; now: string;
  },
): Promise<PlanChangeCommand> {
  const safeUntil = new Date(Date.parse(input.now) + COMMAND_WINDOW_MS).toISOString()
    .replace(/\.(\d{3})Z$/u, (_match, fraction: string) => `.${fraction}000Z`);
  let insertFailed = false;
  let ownerSlotConflict = false;
  try {
    const inserted = await db.prepare(`
      INSERT INTO stripe_plan_change_commands (
        request_id, user_id, stripe_subscription_id, stripe_customer_id, from_plan_type, to_plan_type,
        from_price_id, to_price_id, livemode, status, idempotency_safe_until, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?)
      ON CONFLICT(request_id) DO NOTHING
    `).bind(input.requestId, input.userId, input.subscriptionId, input.customerId, input.fromPlan,
      input.toPlan, input.fromPriceId, input.toPriceId, input.livemode ? 1 : 0, safeUntil, input.now, input.now).run();
    insertFailed = !inserted.success;
  } catch (error) {
    insertFailed = true;
    ownerSlotConflict = String(error).includes("stripe_plan_change_commands.user_id");
  }
  const command = await readCommand(db, input.requestId);
  if (command) {
    if (command.user_id !== input.userId || command.stripe_subscription_id !== input.subscriptionId ||
        command.stripe_customer_id !== input.customerId || command.from_plan_type !== input.fromPlan ||
        command.to_plan_type !== input.toPlan || command.from_price_id !== input.fromPriceId ||
        command.to_price_id !== input.toPriceId || command.livemode !== (input.livemode ? 1 : 0)) {
      throw new StripePlanChangeD1Error("request_id_conflict", 409);
    }
    return command;
  }
  const open = await readOpenCommand(db, input.userId);
  if (open) throw new StripePlanChangeD1Error("plan_change_in_progress", 409);
  if (ownerSlotConflict) throw new StripePlanChangeD1Error("plan_change_sync_pending", 409);
  if (insertFailed) throw new StripePlanChangeD1Error("plan_change_command_unavailable");
  throw new StripePlanChangeD1Error("plan_change_command_unavailable");
}

async function setCommandStatus(db: D1Database, command: PlanChangeCommand, status: PlanChangeCommand["status"], now: string): Promise<void> {
  const result = await db.prepare(`
    UPDATE stripe_plan_change_commands SET status = ?, updated_at = ? WHERE request_id = ? AND user_id = ?
  `).bind(status, now, command.request_id, command.user_id).run();
  if (!result.success) throw new StripePlanChangeD1Error("plan_change_command_unavailable");
  const stored = await readCommand(db, command.request_id);
  if (!stored || stored.status !== status || stored.user_id !== command.user_id) {
    throw new StripePlanChangeD1Error("plan_change_command_unavailable");
  }
}

function responseForCommand(command: PlanChangeCommand, headers: Headers): Response {
  return json({
    success: true,
    updated: command.status === "submitted",
    pending: true,
    ...(command.status === "requires_action" ? { requires_action: true } : {}),
  }, 200, headers);
}

async function performStripeChange(
  db: D1Database,
  stripe: StripePlanChangeClient,
  command: PlanChangeCommand,
  subscription: StripeSubscription,
  currentPriceId: string,
  livemode: boolean,
  now: string,
): Promise<PlanChangeCommand> {
  if (subscription.id !== command.stripe_subscription_id || stripeCustomerId(subscription.customer) !== command.stripe_customer_id ||
      subscription.livemode !== livemode || subscription.status !== "active") {
    throw new StripePlanChangeD1Error("stripe_subscription_mismatch", 409);
  }
  const items = subscription.items?.data;
  const item = Array.isArray(items) && items.length === 1 ? items[0] : null;
  if (!item || subscriptionPriceId(subscription) !== currentPriceId || currentPriceId !== command.from_price_id) {
    throw new StripePlanChangeD1Error("stripe_subscription_mismatch", 409);
  }

  if (command.to_plan_type === "free") {
    const canceled = await stripe.subscriptions.cancel(command.stripe_subscription_id, {}, {
      idempotencyKey: `fanmark-plan-change:${command.request_id}`,
    });
    if (canceled.id !== command.stripe_subscription_id || canceled.status !== "canceled" ||
        stripeCustomerId(canceled.customer) !== command.stripe_customer_id || canceled.livemode !== livemode) {
      throw new StripePlanChangeD1Error("stripe_subscription_change_invalid", 502);
    }
    await setCommandStatus(db, command, "submitted", now);
    return { ...command, status: "submitted" };
  }

  const updated = await stripe.subscriptions.update(command.stripe_subscription_id, {
    cancel_at_period_end: false,
    items: [{ id: item.id, price: command.to_price_id! }],
    proration_behavior: PLAN_ORDER[command.to_plan_type] > PLAN_ORDER[command.from_plan_type]
      ? "create_prorations"
      : "none",
    billing_cycle_anchor: "now",
    payment_behavior: "default_incomplete",
    expand: ["latest_invoice.payment_intent"],
  }, { idempotencyKey: `fanmark-plan-change:${command.request_id}` });
  if (updated.id !== command.stripe_subscription_id || stripeCustomerId(updated.customer) !== command.stripe_customer_id ||
      updated.livemode !== livemode || subscriptionPriceId(updated) !== command.to_price_id) {
    throw new StripePlanChangeD1Error("stripe_subscription_change_invalid", 502);
  }
  const status = updated.status === "active" && !needsPaymentAction(updated) ? "submitted" : "requires_action";
  await setCommandStatus(db, command, status, now);
  return { ...command, status };
}

export async function handleStripePlanChangeD1Request(
  request: Request,
  env: Env,
  dependencies: StripePlanChangeD1Dependencies,
): Promise<Response | null> {
  const backend = env.STRIPE_PLAN_CHANGE_BACKEND?.trim();
  if (!backend) return null;
  if (backend !== "d1") return json({ error: "server_misconfigured" }, 500);
  if (env.STRIPE_WEBHOOK_BACKEND?.trim() !== "d1" || env.STRIPE_DISPATCH_BACKEND?.trim() !== "d1" ||
      !env.STRIPE_WEBHOOK_SECRET?.trim()) return json({ error: "stripe_plan_change_not_ready" }, 503);
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "server_misconfigured" }, 500, headers);

  let body: { toPlan: PlanType; requestId: string };
  try { body = await readRequest(request); }
  catch (error) {
    const failure = error instanceof StripePlanChangeD1Error ? error : new StripePlanChangeD1Error("invalid_request", 400);
    return json({ error: failure.code }, failure.status, headers);
  }
  let userId: string | null;
  try { userId = await dependencies.resolveUser(request); }
  catch { return json({ error: "auth_unavailable" }, 503, headers); }
  if (!userId || !UUID.test(userId)) return json({ error: "unauthenticated" }, 401, headers);
  userId = userId.toLowerCase();

  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const testSecret = env.STRIPE_SECRET_KEY_TEST?.trim() ?? "";
  const liveSecret = env.STRIPE_SECRET_KEY_LIVE?.trim() ?? "";
  const livemode = secret.startsWith("sk_live_");
  if (!(livemode ? secret === liveSecret : secret.startsWith("sk_test_") && secret === testSecret) ||
      !testSecret.startsWith("sk_test_") || !liveSecret.startsWith("sk_live_")) {
    return json({ error: "stripe_plan_change_not_ready" }, 503, headers);
  }
  let db: D1Database;
  try { db = database(env); }
  catch (error) {
    const failure = error instanceof StripePlanChangeD1Error ? error : new StripePlanChangeD1Error("stripe_plan_change_unavailable");
    return json({ error: failure.code }, failure.status, headers);
  }

  try {
    const now = canonicalNow((dependencies.now ?? (() => new Date()))());
    const stripe = (dependencies.createStripeClient ?? stripeClient)(secret);
    const existing = await readCommand(db, body.requestId);
    if (existing) {
      if (existing.user_id !== userId || existing.to_plan_type !== body.toPlan || existing.livemode !== (livemode ? 1 : 0)) {
        throw new StripePlanChangeD1Error("request_id_conflict", 409);
      }
      if (existing.status === "submitted") return responseForCommand(existing, headers);
      const subscription = await stripe.subscriptions.retrieve(existing.stripe_subscription_id, {
        expand: ["items.data.price", "latest_invoice.payment_intent"],
      });
      if (subscription.id !== existing.stripe_subscription_id ||
          stripeCustomerId(subscription.customer) !== existing.stripe_customer_id || subscription.livemode !== livemode) {
        throw new StripePlanChangeD1Error("stripe_subscription_mismatch", 409);
      }
      const livePriceId = subscriptionPriceId(subscription);
      if (existing.to_plan_type === "free" && subscription.status === "canceled") {
        await setCommandStatus(db, existing, "submitted", now);
        return responseForCommand({ ...existing, status: "submitted" }, headers);
      }
      if (existing.to_plan_type !== "free" && subscription.status === "active" && livePriceId === existing.to_price_id &&
          !needsPaymentAction(subscription)) {
        await setCommandStatus(db, existing, "submitted", now);
        return responseForCommand({ ...existing, status: "submitted" }, headers);
      }
      if (existing.status === "requires_action") return responseForCommand(existing, headers);
      if (Date.parse(existing.idempotency_safe_until) <= Date.parse(now)) {
        throw new StripePlanChangeD1Error("plan_change_reconciliation_required", 409);
      }
      return responseForCommand(await performStripeChange(db, stripe, existing, subscription,
        existing.from_price_id, livemode, now), headers);
    }

    const current = await readCurrentState(db, userId);
    if (typeof current.stripe_customer_id !== "string" || !CUSTOMER_ID.test(current.stripe_customer_id) ||
        current.stripe_customer_id !== current.stripe_customer_id.trim() ||
        current.subscription_customer_id !== current.stripe_customer_id) {
      throw new StripePlanChangeD1Error("stripe_customer_mapping_invalid", 409);
    }
    const currentPlan = current.plan_type;
    if (typeof currentPlan !== "string" || !PAID_PLANS.includes(currentPlan as PaidPlanType)) {
      throw new StripePlanChangeD1Error("paid_subscription_required", 409);
    }
    const subscription = await stripe.subscriptions.retrieve(String(current.stripe_subscription_id), {
      expand: ["items.data.price", "latest_invoice.payment_intent"],
    });
    const prices = await readPlanPrices(db, livemode);

    const open = await readOpenCommand(db, userId);
    if (open) {
      if (open.to_plan_type === "free") {
        const priorSubscription = await stripe.subscriptions.retrieve(open.stripe_subscription_id);
        if (priorSubscription.id !== open.stripe_subscription_id ||
            stripeCustomerId(priorSubscription.customer) !== open.stripe_customer_id ||
            priorSubscription.livemode !== livemode || priorSubscription.status !== "canceled") {
          throw new StripePlanChangeD1Error("plan_change_in_progress", 409);
        }
        await setCommandStatus(db, open, "submitted", now);
      } else if (subscription.status === "active" &&
          subscriptionPriceId(subscription) === open.to_price_id && !needsPaymentAction(subscription) &&
          current.plan_type === open.to_plan_type && current.price_id === open.to_price_id) {
        await setCommandStatus(db, open, "submitted", now);
      } else {
        const code = open.status === "requires_action" && needsPaymentAction(subscription)
          ? "plan_change_payment_required"
          : "plan_change_in_progress";
        throw new StripePlanChangeD1Error(code, 409);
      }
    }

    const currentPriceId = String(current.price_id);
    if (!PRICE_ID.test(currentPriceId) || prices.get(currentPriceId) !== currentPlan ||
        typeof current.stripe_subscription_id !== "string" || !SUBSCRIPTION_ID.test(current.stripe_subscription_id) ||
        subscription.id !== current.stripe_subscription_id || stripeCustomerId(subscription.customer) !== current.stripe_customer_id ||
        subscription.livemode !== livemode || subscription.status !== "active" ||
        subscriptionPriceId(subscription) !== currentPriceId || needsPaymentAction(subscription)) {
      throw new StripePlanChangeD1Error("stripe_subscription_mismatch", 409);
    }
    if (body.toPlan === currentPlan) throw new StripePlanChangeD1Error("plan_unchanged", 409);
    const targetPrice = body.toPlan === "free" ? null : await readTargetPrice(db, body.toPlan, livemode);
    if (targetPrice) {
      const target = await stripe.prices.retrieve(targetPrice);
      if (target.id !== targetPrice || target.active !== true || target.livemode !== livemode || target.type !== "recurring" ||
          target.currency !== "jpy" || target.recurring?.interval !== "month" || target.recurring.interval_count !== 1) {
        throw new StripePlanChangeD1Error("stripe_price_mismatch");
      }
    }
    await assertWithinPlanLimit(db, userId, body.toPlan, now);
    const command = await persistNewCommand(db, {
      requestId: body.requestId, userId, subscriptionId: String(current.stripe_subscription_id),
      customerId: String(current.stripe_customer_id), fromPlan: currentPlan as PaidPlanType, toPlan: body.toPlan,
      fromPriceId: currentPriceId, toPriceId: targetPrice, livemode, now,
    });
    const result = await performStripeChange(db, stripe, command, subscription, currentPriceId, livemode, now);
    return responseForCommand(result, headers);
  } catch (error) {
    const failure = error instanceof StripePlanChangeD1Error
      ? error
      : new StripePlanChangeD1Error("stripe_plan_change_unavailable", 502);
    return json({ error: failure.code }, failure.status, headers);
  }
}
