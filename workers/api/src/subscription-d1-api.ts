import { selectD1Database, type Env } from "./repository.ts";
import type { StorageAuthResolver } from "./storage-r2.ts";

const SUBSCRIPTION_PATH = "/api/me/subscription";
const METHODS = "GET, OPTIONS";

interface SubscriptionRow extends Record<string, unknown> {
  status: unknown;
  product_id: unknown;
  current_period_start: unknown;
  current_period_end: unknown;
  amount: unknown;
  currency: unknown;
  interval: unknown;
  interval_count: unknown;
  cancel_at_period_end: unknown;
  payment_failure_at: unknown;
  next_payment_attempt: unknown;
  payment_failure_type: unknown;
}

export class SubscriptionD1ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 503) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "SubscriptionD1ApiError";
  }
}

function json(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
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

function database(env: Env): D1Database {
  if (env.SUBSCRIPTION_BACKEND?.trim() !== "d1" || env.AUTH_BACKEND?.trim() !== "better-auth") {
    throw new SubscriptionD1ApiError("subscription_unavailable");
  }
  const selected = selectD1Database(env, "business");
  if (!selected) throw new SubscriptionD1ApiError("server_misconfigured", 500);
  return selected;
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 256) throw new SubscriptionD1ApiError("subscription_unavailable");
  return value;
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new SubscriptionD1ApiError("subscription_unavailable");
  return value;
}

function projection(row: SubscriptionRow | null): Record<string, unknown> | null {
  if (!row) return null;
  const cancelAtPeriodEnd = row.cancel_at_period_end;
  if (cancelAtPeriodEnd !== null && cancelAtPeriodEnd !== undefined && cancelAtPeriodEnd !== 0 && cancelAtPeriodEnd !== 1) {
    throw new SubscriptionD1ApiError("subscription_unavailable");
  }
  return {
    status: nullableText(row.status),
    product_id: nullableText(row.product_id),
    current_period_start: nullableText(row.current_period_start),
    current_period_end: nullableText(row.current_period_end),
    amount: nullableInteger(row.amount),
    currency: nullableText(row.currency),
    interval: nullableText(row.interval),
    interval_count: nullableInteger(row.interval_count),
    cancel_at_period_end: cancelAtPeriodEnd === 1,
    payment_failure_at: nullableText(row.payment_failure_at),
    next_payment_attempt: nullableText(row.next_payment_attempt),
    payment_failure_type: nullableText(row.payment_failure_type),
  };
}

async function readSubscription(databaseBinding: D1Database, userId: string): Promise<Record<string, unknown> | null> {
  let result: D1Result<SubscriptionRow>;
  try {
    result = await databaseBinding.prepare(`
      SELECT status, product_id, current_period_start, current_period_end,
        amount, currency, interval, interval_count, cancel_at_period_end,
        payment_failure_at, next_payment_attempt, payment_failure_type
      FROM user_subscriptions
      WHERE user_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).bind(userId).all<SubscriptionRow>();
  } catch {
    throw new SubscriptionD1ApiError("subscription_unavailable");
  }
  if (!result.success || result.results.length > 1) throw new SubscriptionD1ApiError("subscription_unavailable");
  return projection(result.results[0] ?? null);
}

export function isSubscriptionPath(pathname: string): boolean {
  return pathname === SUBSCRIPTION_PATH;
}

export async function handleSubscriptionRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
): Promise<Response | null> {
  if (!isSubscriptionPath(new URL(request.url).pathname)) return null;
  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "forbidden_origin" }, 403);
  if (request.method === "OPTIONS") {
    headers.set("allow", METHODS);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (new URL(request.url).search) return json({ error: "invalid_request" }, 400, headers);

  let db: D1Database;
  try {
    db = database(env);
  } catch (error) {
    const failure = error instanceof SubscriptionD1ApiError ? error : new SubscriptionD1ApiError("subscription_unavailable");
    return json({ error: failure.code }, failure.status, headers);
  }
  const auth = await resolveAuth(request, env);
  if (!auth.available) return json({ error: "auth_unavailable" }, 503, headers);
  if (!auth.userId) return json({ error: "unauthorized" }, 401, headers);

  try {
    return json({ schemaVersion: 1, subscription: await readSubscription(db, auth.userId) }, 200, headers);
  } catch (error) {
    const failure = error instanceof SubscriptionD1ApiError ? error : new SubscriptionD1ApiError("subscription_unavailable");
    return json({ error: failure.code }, failure.status, headers);
  }
}
