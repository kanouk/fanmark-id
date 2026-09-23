import {
  createSupabaseRecentFanmarksRepository,
  mapRecentFanmarkRows,
  RecentFanmarksConfigurationError,
  RecentFanmarksTimeoutError,
  RecentFanmarksUpstreamError,
  type Env,
} from "./repository";
import { createD1RecentFanmarksRepository } from "./d1-repository";
import {
  AvailabilityConfigurationError,
  AvailabilityTimeoutError,
  AvailabilityUpstreamError,
  parseAvailabilityRequest,
  sanitizeAvailabilityResult,
  type AvailabilityClock,
} from "./availability";
import { createD1AvailabilityRepository } from "./availability-d1-repository";
import { createSupabaseAvailabilityRepository } from "./availability-repository";
import { createD1PublicAccessRepository } from "./public-access-d1-repository";
import {
  createEmojiMasterD1Repository,
  EmojiCatalogConfigurationError,
  EmojiCatalogUnavailableError,
  EmojiCatalogUpstreamError,
  parseEmojiCatalogPageRequest,
} from "./emoji-master-d1-repository";
import {
  mapPublicAccessRow,
  mapPublicProfileRow,
  parsePublicAccessEmojiRequest,
  parsePublicAccessPathValue,
  parsePublicAccessRoute,
  PublicAccessConfigurationError,
  PublicAccessResponseTooLargeError,
  PublicAccessUnavailableError,
  PublicAccessUpstreamError,
  publicAccessAllowedHeaders,
  publicAccessAllowedMethods,
  serializePublicAccessBody,
  type PublicAccessRepository,
} from "./public-access";

const RECENT_ALLOWED_METHODS = "GET, OPTIONS";
const AVAILABILITY_ALLOWED_METHODS = "POST, OPTIONS";
const EMOJI_CATALOG_ALLOWED_METHODS = "GET, OPTIONS";
const AVAILABILITY_ALLOWED_HEADERS = "content-type";
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

function corsHeaders(
  request: Request,
  env: Env,
  allowedMethods: string,
  allowedHeaders?: string,
): { allowed: boolean; headers: Headers } {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return { allowed: true, headers };

  if (!parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS).has(origin)) {
    return { allowed: false, headers };
  }

  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", allowedMethods);
  if (allowedHeaders) headers.set("access-control-allow-headers", allowedHeaders);
  headers.set("vary", "Origin");
  return { allowed: true, headers };
}

function parseLimit(url: URL): number | null {
  const values = url.searchParams.getAll("limit");
  if (values.length === 0) return 20;
  if (values.length !== 1 || !/^(?:[1-9]|1[0-9]|20)$/.test(values[0])) return null;
  return Number(values[0]);
}

function createRecentFanmarksRepository(env: Env, outboundFetch: typeof fetch) {
  const configuredBackend = env.RECENT_FANMARKS_BACKEND?.trim();
  if (!configuredBackend) {
    return createSupabaseRecentFanmarksRepository(env, outboundFetch);
  }
  if (configuredBackend === "d1") {
    return createD1RecentFanmarksRepository(env);
  }
  // An explicit unknown value must not silently select another data source.
  throw new RecentFanmarksConfigurationError();
}

function createAvailabilityRepository(
  env: Env,
  outboundFetch: typeof fetch,
  clock: AvailabilityClock,
) {
  const configuredBackend = env.AVAILABILITY_BACKEND?.trim();
  if (!configuredBackend) {
    return createSupabaseAvailabilityRepository(env, outboundFetch);
  }
  if (configuredBackend === "d1") {
    return createD1AvailabilityRepository(env, clock);
  }
  throw new AvailabilityConfigurationError();
}

function createPublicAccessRepository(
  env: Env,
  publicAccessClock: () => Date,
): PublicAccessRepository {
  const configuredBackend = env.PUBLIC_ACCESS_BACKEND?.trim();
  if (!configuredBackend) throw new PublicAccessUnavailableError();
  if (configuredBackend === "d1") return createD1PublicAccessRepository(env, publicAccessClock);
  throw new PublicAccessConfigurationError();
}

function errorResponse(code: string, status: number, headers: Headers, extra?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  if (extra) {
    new Headers(extra).forEach((value, key) => responseHeaders.set(key, value));
  }
  return jsonResponse({ error: code }, status, responseHeaders);
}

function publicAccessJsonResponse(body: unknown, status: number, headers: Headers): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", JSON_CONTENT_TYPE);
  return new Response(serializePublicAccessBody(body), { status, headers: responseHeaders });
}

async function fetchStaticAsset(request: Request, assets: Fetcher): Promise<Response> {
  const response = await assets.fetch(request);
  const isNavigation =
    request.method === "GET" &&
    (request.headers.get("Sec-Fetch-Mode") === "navigate" ||
      request.headers.get("Accept")?.includes("text/html") === true);
  if (
    response.status === 404 &&
    isNavigation
  ) {
    // Keep SPA fallback limited to browser navigations. A missing script,
    // stylesheet, or other asset must remain a real non-HTML 404.
    return assets.fetch(
      new Request(new URL("/index.html", request.url), {
        method: "GET",
        headers: request.headers,
      }),
    );
  }
  return response;
}

export async function handleRequest(
  request: Request,
  env: Env,
  outboundFetch: typeof fetch = fetch,
  availabilityClock: AvailabilityClock = () => new Date(),
  publicAccessClock: () => Date = () => new Date(),
): Promise<Response> {
  const url = new URL(request.url);
  const routeHeaders = baseHeaders();

  // Static Assets owns files and the Worker applies the navigation fallback.
  // API paths stay in this Worker so an unknown API error can never be
  // rewritten to index.html.
  if (!url.pathname.startsWith("/api/") && url.pathname !== "/api" && env.ASSETS) {
    return fetchStaticAsset(request, env.ASSETS);
  }

  const publicAccessRoute = parsePublicAccessRoute(url);
  const isEmojiCatalogRoute = url.pathname === "/api/emoji/catalog";
  if (
    url.pathname !== "/api/fanmarks/recent" &&
    url.pathname !== "/api/fanmarks/availability" &&
    !isEmojiCatalogRoute &&
    !publicAccessRoute
  ) {
    return errorResponse("not_found", 404, routeHeaders);
  }

  const isAvailabilityRoute = url.pathname === "/api/fanmarks/availability";
  const isRecentRoute = url.pathname === "/api/fanmarks/recent";
  const allowedMethods = publicAccessRoute
    ? publicAccessAllowedMethods(publicAccessRoute)
    : isEmojiCatalogRoute
      ? EMOJI_CATALOG_ALLOWED_METHODS
      : isAvailabilityRoute
        ? AVAILABILITY_ALLOWED_METHODS
        : RECENT_ALLOWED_METHODS;
  const cors = corsHeaders(
    request,
    env,
    allowedMethods,
    publicAccessRoute
      ? publicAccessAllowedHeaders(publicAccessRoute)
      : isAvailabilityRoute
        ? AVAILABILITY_ALLOWED_HEADERS
        : undefined,
  );
  if (!cors.allowed) {
    return errorResponse("forbidden_origin", 403, routeHeaders);
  }

  const method = request.method.toUpperCase();
  const responseHeaders = new Headers(routeHeaders);
  cors.headers.forEach((value, key) => responseHeaders.set(key, value));

  if (method === "OPTIONS") {
    responseHeaders.set("allow", allowedMethods);
    return emptyResponse(204, responseHeaders);
  }

  if (publicAccessRoute) {
    if (publicAccessRoute.kind === "emoji") {
      if (method !== "POST") {
        responseHeaders.set("allow", allowedMethods);
        return errorResponse("method_not_allowed", 405, responseHeaders);
      }
      const emojiIds = await parsePublicAccessEmojiRequest(request);
      if (!emojiIds) return errorResponse("invalid_request", 400, responseHeaders);
      try {
        const repository = createPublicAccessRepository(env, publicAccessClock);
        const row = await repository.getByEmojiIds(emojiIds, publicAccessClock());
        if (!row) return errorResponse("not_found", 404, responseHeaders);
        return publicAccessJsonResponse(mapPublicAccessRow(row), 200, responseHeaders);
      } catch (error) {
        if (error instanceof PublicAccessUnavailableError) {
          return errorResponse("public_access_unavailable", 503, responseHeaders);
        }
        if (error instanceof PublicAccessConfigurationError) {
          return errorResponse("server_misconfigured", 500, responseHeaders);
        }
        if (error instanceof PublicAccessResponseTooLargeError || error instanceof PublicAccessUpstreamError) {
          return errorResponse("upstream_unavailable", 502, responseHeaders);
        }
        return errorResponse("upstream_unavailable", 502, responseHeaders);
      }
    }

    if (method !== "GET") {
      responseHeaders.set("allow", allowedMethods);
      return errorResponse("method_not_allowed", 405, responseHeaders);
    }

    try {
      const repository = createPublicAccessRepository(env, publicAccessClock);
      if (publicAccessRoute.kind === "short") {
        const shortId = parsePublicAccessPathValue(publicAccessRoute.rawValue);
        if (!shortId) return errorResponse("invalid_request", 400, responseHeaders);
        const row = await repository.getByShortId(shortId);
        if (!row) return errorResponse("not_found", 404, responseHeaders);
        return publicAccessJsonResponse(mapPublicAccessRow(row), 200, responseHeaders);
      }

      const licenseId = parsePublicAccessPathValue(publicAccessRoute.rawValue);
      if (!licenseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(licenseId)) {
        return errorResponse("invalid_request", 400, responseHeaders);
      }
      const row = await repository.getPublicProfile(licenseId.toLowerCase(), publicAccessClock());
      if (!row) return errorResponse("not_found", 404, responseHeaders);
      return publicAccessJsonResponse(mapPublicProfileRow(row), 200, responseHeaders);
    } catch (error) {
      if (error instanceof PublicAccessUnavailableError) {
        return errorResponse("public_access_unavailable", 503, responseHeaders);
      }
      if (error instanceof PublicAccessConfigurationError) {
        return errorResponse("server_misconfigured", 500, responseHeaders);
      }
      if (error instanceof PublicAccessResponseTooLargeError || error instanceof PublicAccessUpstreamError) {
        return errorResponse("upstream_unavailable", 502, responseHeaders);
      }
      return errorResponse("upstream_unavailable", 502, responseHeaders);
    }
  }

  if (isEmojiCatalogRoute) {
    if (method !== "GET") {
      responseHeaders.set("allow", allowedMethods);
      return errorResponse("method_not_allowed", 405, responseHeaders);
    }
    const pageRequest = parseEmojiCatalogPageRequest(url);
    if (!pageRequest) return errorResponse("invalid_request", 400, responseHeaders);
    try {
      const repository = createEmojiMasterD1Repository(env);
      const page = await repository.readPage(pageRequest);
      return jsonResponse({ schemaVersion: 1, ...page }, 200, responseHeaders);
    } catch (error) {
      if (error instanceof EmojiCatalogUnavailableError) {
        return errorResponse("emoji_catalog_unavailable", 503, responseHeaders);
      }
      if (error instanceof EmojiCatalogConfigurationError) {
        return errorResponse("server_misconfigured", 500, responseHeaders);
      }
      if (error instanceof EmojiCatalogUpstreamError) {
        return errorResponse("upstream_unavailable", 502, responseHeaders);
      }
      return errorResponse("upstream_unavailable", 502, responseHeaders);
    }
  }

  if (isAvailabilityRoute) {
    if (method !== "POST") {
      responseHeaders.set("allow", allowedMethods);
      return errorResponse("method_not_allowed", 405, responseHeaders);
    }

    const emojiIds = await parseAvailabilityRequest(request);
    if (!emojiIds) return errorResponse("invalid_request", 400, responseHeaders);

    try {
      const repository = createAvailabilityRepository(env, outboundFetch, availabilityClock);
      const result = await repository.checkAvailability(emojiIds);
      return jsonResponse(
        { schemaVersion: 1, result: sanitizeAvailabilityResult(result) },
        200,
        responseHeaders,
      );
    } catch (error) {
      if (error instanceof AvailabilityConfigurationError) {
        return errorResponse("server_misconfigured", 500, responseHeaders);
      }
      if (error instanceof AvailabilityTimeoutError) {
        return errorResponse("upstream_timeout", 504, responseHeaders);
      }
      if (error instanceof AvailabilityUpstreamError) {
        return errorResponse("upstream_unavailable", 502, responseHeaders);
      }
      return errorResponse("upstream_unavailable", 502, responseHeaders);
    }
  }

  if (!isRecentRoute || method !== "GET") {
    responseHeaders.set("allow", allowedMethods);
    return errorResponse("method_not_allowed", 405, responseHeaders);
  }

  const limit = parseLimit(url);
  if (limit === null) return errorResponse("invalid_limit", 400, responseHeaders);

  try {
    const repository = createRecentFanmarksRepository(env, outboundFetch);
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
