import Stripe from "stripe";
import { selectD1Database, type Env } from "./repository.ts";

const PORTAL_PATH = "/api/billing/customer-portal";
const METHODS = "POST, OPTIONS";
const MAX_RESPONSE_URL_LENGTH = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CUSTOMER_ID = /^cus_[A-Za-z0-9]+$/u;
const STRIPE_API_VERSION = "2025-08-27.basil";

interface StripePortalClient {
  billingPortal: {
    sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }>;
    };
  };
}

export class StripeCustomerPortalD1Error extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
    this.name = "StripeCustomerPortalD1Error";
  }
}

export interface StripeCustomerPortalD1Dependencies {
  resolveUser(request: Request): Promise<string | null>;
  createStripeClient?(secret: string): StripePortalClient;
}

export function isStripeCustomerPortalPath(pathname: string): boolean {
  return pathname === PORTAL_PATH;
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
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.origin !== origin || parsed.protocol !== "https:") return null;
  const authUrl = env.BETTER_AUTH_URL?.trim();
  if (!authUrl || parsed.origin !== authUrl) return null;

  const headers = new Headers({
    "access-control-allow-origin": origin,
    "access-control-allow-methods": METHODS,
    "access-control-allow-headers": "content-type",
    "access-control-allow-credentials": "true",
    "access-control-max-age": "600",
    "vary": "Origin",
  });
  return headers;
}

function database(env: Env) {
  if (env.D1_TOPOLOGY?.trim() !== "split") {
    throw new StripeCustomerPortalD1Error("stripe_portal_unavailable", 503);
  }
  const result = selectD1Database(env, "business");
  if (!result) throw new StripeCustomerPortalD1Error("stripe_portal_unavailable", 503);
  return result;
}

function stripeClient(secret: string): StripePortalClient {
  return new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION,
    timeout: 10_000,
    maxNetworkRetries: 0,
    httpClient: Stripe.createFetchHttpClient(),
  }) as unknown as StripePortalClient;
}

function validatePortalUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_RESPONSE_URL_LENGTH) {
    throw new StripeCustomerPortalD1Error("stripe_portal_unavailable", 502);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("unsafe portal URL");
    }
  } catch {
    throw new StripeCustomerPortalD1Error("stripe_portal_unavailable", 502);
  }
  return value;
}

export async function handleStripeCustomerPortalD1Request(
  request: Request,
  env: Env,
  dependencies: StripeCustomerPortalD1Dependencies,
): Promise<Response | null> {
  const backend = env.STRIPE_CUSTOMER_PORTAL_BACKEND?.trim();
  if (!backend) return null;
  if (backend !== "d1") return json({ error: "server_misconfigured" }, 500);
  if (env.STRIPE_WEBHOOK_BACKEND?.trim() !== "d1" ||
      env.STRIPE_DISPATCH_BACKEND?.trim() !== "d1" ||
      !env.STRIPE_WEBHOOK_SECRET?.trim()) {
    return json({ error: "stripe_portal_not_ready" }, 503);
  }

  const headers = originHeaders(request, env);
  if (!headers) return json({ error: "origin_not_allowed" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") {
    headers.set("allow", METHODS);
    return json({ error: "method_not_allowed" }, 405, headers);
  }
  if (request.body) return json({ error: "invalid_request" }, 400, headers);
  if (env.AUTH_BACKEND?.trim() !== "better-auth") return json({ error: "server_misconfigured" }, 500, headers);

  let userId: string | null;
  try {
    userId = await dependencies.resolveUser(request);
  } catch {
    return json({ error: "auth_unavailable" }, 503, headers);
  }
  if (!userId || !UUID.test(userId)) return json({ error: "unauthenticated" }, 401, headers);

  const secret = env.STRIPE_SECRET_KEY?.trim() ?? "";
  const testSecret = env.STRIPE_SECRET_KEY_TEST?.trim() ?? "";
  const liveSecret = env.STRIPE_SECRET_KEY_LIVE?.trim() ?? "";
  const secretMatchesDispatchMode = secret.startsWith("sk_test_")
    ? secret === testSecret
    : secret.startsWith("sk_live_") && secret === liveSecret;
  if (!secretMatchesDispatchMode || !testSecret.startsWith("sk_test_") || !liveSecret.startsWith("sk_live_")) {
    return json({ error: "stripe_portal_not_ready" }, 503, headers);
  }

  let business: ReturnType<typeof database>;
  try {
    business = database(env);
  } catch (error) {
    const mapped = error instanceof StripeCustomerPortalD1Error ? error : null;
    return json({ error: mapped?.code ?? "stripe_portal_unavailable" }, mapped?.status ?? 503, headers);
  }

  try {
    const row = await business.prepare(
      "SELECT stripe_customer_id FROM user_settings WHERE user_id = ? LIMIT 2",
    ).bind(userId.toLowerCase()).all<{ stripe_customer_id: unknown }>();
    if (!row.success || row.results.length !== 1) {
      return json({ error: "stripe_customer_not_linked" }, 404, headers);
    }
    const customerId = row.results[0]?.stripe_customer_id;
    if (typeof customerId !== "string" || !CUSTOMER_ID.test(customerId)) {
      return json({ error: "stripe_customer_not_linked" }, 404, headers);
    }

    const origin = request.headers.get("Origin");
    if (!origin) return json({ error: "origin_not_allowed" }, 403, headers);
    const returnUrl = new URL("/plans", origin).href;
    const stripe = (dependencies.createStripeClient ?? stripeClient)(secret);
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    const url = validatePortalUrl(session?.url);
    return json({ url }, 200, headers);
  } catch (error) {
    if (error instanceof StripeCustomerPortalD1Error) {
      return json({ error: error.code }, error.status, headers);
    }
    return json({ error: "stripe_portal_unavailable" }, 502, headers);
  }
}
