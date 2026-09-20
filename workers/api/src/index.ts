import {
  createSupabaseRecentFanmarksRepository,
  mapRecentFanmarkRows,
  RecentFanmarksConfigurationError,
  RecentFanmarksTimeoutError,
  RecentFanmarksUpstreamError,
  type Env,
} from "./repository";

const ALLOWED_METHODS = "GET, OPTIONS";
const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

function baseHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": JSON_CONTENT_TYPE,
  });
}

function jsonResponse(body: unknown, status: number, extraHeaders?: HeadersInit): Response {
  const headers = baseHeaders();
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function emptyResponse(status: number, extraHeaders?: HeadersInit): Response {
  const headers = baseHeaders();
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  headers.delete("content-type");
  return new Response(null, { status, headers });
}

function parseAllowedOrigins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request: Request, env: Env): { allowed: boolean; headers: Headers } {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return { allowed: true, headers };

  if (!parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS).has(origin)) {
    return { allowed: false, headers };
  }

  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", ALLOWED_METHODS);
  headers.set("vary", "Origin");
  return { allowed: true, headers };
}

function parseLimit(url: URL): number | null {
  const values = url.searchParams.getAll("limit");
  if (values.length === 0) return 20;
  if (values.length !== 1 || !/^(?:[1-9]|1[0-9]|20)$/.test(values[0])) return null;
  return Number(values[0]);
}

function errorResponse(code: string, status: number, headers: Headers, extra?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  if (extra) {
    new Headers(extra).forEach((value, key) => responseHeaders.set(key, value));
  }
  return jsonResponse({ error: code }, status, responseHeaders);
}

export async function handleRequest(
  request: Request,
  env: Env,
  outboundFetch: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const routeHeaders = baseHeaders();

  if (url.pathname !== "/api/fanmarks/recent") {
    return errorResponse("not_found", 404, routeHeaders);
  }

  const cors = corsHeaders(request, env);
  if (!cors.allowed) {
    return errorResponse("forbidden_origin", 403, routeHeaders);
  }

  const method = request.method.toUpperCase();
  const responseHeaders = new Headers(routeHeaders);
  cors.headers.forEach((value, key) => responseHeaders.set(key, value));

  if (method === "OPTIONS") {
    responseHeaders.set("allow", ALLOWED_METHODS);
    return emptyResponse(204, responseHeaders);
  }

  if (method !== "GET") {
    responseHeaders.set("allow", ALLOWED_METHODS);
    return errorResponse("method_not_allowed", 405, responseHeaders);
  }

  const limit = parseLimit(url);
  if (limit === null) return errorResponse("invalid_limit", 400, responseHeaders);

  try {
    const repository = createSupabaseRecentFanmarksRepository(env, outboundFetch);
    const rows = await repository.listRecent(limit);
    return jsonResponse(mapRecentFanmarkRows(rows, limit), 200, responseHeaders);
  } catch (error) {
    if (error instanceof RecentFanmarksConfigurationError) {
      return errorResponse("server_misconfigured", 500, responseHeaders);
    }
    if (error instanceof RecentFanmarksTimeoutError) {
      return errorResponse("upstream_timeout", 504, responseHeaders);
    }
    if (error instanceof RecentFanmarksUpstreamError) {
      return errorResponse("upstream_unavailable", 502, responseHeaders);
    }
    return errorResponse("upstream_unavailable", 502, responseHeaders);
  }
}

const worker = {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;

export default worker;
