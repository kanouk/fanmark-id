import type { Env } from "./repository";

const PUBLIC_PREFIX = "/api/storage/public/";
const OBJECT_PREFIX = "/api/storage/object/";
const AVATAR_LIMIT = 1 * 1024 * 1024;
const COVER_LIMIT = 2 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const STORAGE_METHODS = "GET, HEAD, POST, DELETE, OPTIONS";

export type StorageAuthResult =
  | { available: true; userId: string | null }
  | { available: false };

export type StorageAuthResolver = (
  request: Request,
  env: Env,
) => Promise<StorageAuthResult>;

interface StorageRoute {
  kind: "public" | "object";
  bucketName: "avatars" | "cover-images";
  rawKeySegments: string[];
}

function jsonResponse(body: unknown, status: number, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function routeFor(url: URL): StorageRoute | null {
  const kind = url.pathname.startsWith(PUBLIC_PREFIX)
    ? "public"
    : url.pathname.startsWith(OBJECT_PREFIX)
      ? "object"
      : null;
  if (!kind) return null;

  const prefix = kind === "public" ? PUBLIC_PREFIX : OBJECT_PREFIX;
  const segments = url.pathname.slice(prefix.length).split("/");
  const bucketName = segments.shift();
  if (bucketName !== "avatars" && bucketName !== "cover-images") return null;
  return { kind, bucketName, rawKeySegments: segments };
}

function decodeKey(segments: string[]): string | null {
  if (segments.length < 2 || segments.length > 32 || segments.some((part) => !part)) return null;
  const decoded: string[] = [];
  for (const part of segments) {
    let value: string;
    try {
      value = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (
      value === "." ||
      value === ".." ||
      value.includes("/") ||
      value.includes("\\") ||
      value.includes("\0")
    ) return null;
    decoded.push(value);
  }
  return decoded.join("/");
}

function bucketFor(env: Env, bucketName: StorageRoute["bucketName"]): R2Bucket | undefined {
  return bucketName === "avatars" ? env.AVATARS_BUCKET : env.COVER_IMAGES_BUCKET;
}

function corsHeaders(request: Request, env: Env, withCredentials: boolean): Headers | null {
  const headers = new Headers();
  const origin = request.headers.get("Origin");
  if (!origin) return withCredentials ? null : headers;
  const allowedOrigins = new Set(
    (env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!allowedOrigins.has(origin)) return null;

  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", STORAGE_METHODS);
  headers.set("access-control-allow-headers", "content-type");
  headers.set("vary", "Origin");
  if (withCredentials) headers.set("access-control-allow-credentials", "true");
  return headers;
}

function imageMatchesType(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }
  if (contentType === "image/gif") {
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    return bytes.length >= 6 && (signature === "GIF87a" || signature === "GIF89a");
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12 &&
      String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  }
  if (contentType === "image/avif") {
    return bytes.length >= 12 &&
      String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" &&
      ["avif", "avis"].includes(String.fromCharCode(...bytes.subarray(8, 12)));
  }
  return false;
}

async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array | "too_large" | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return "too_large";
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return null;
  }

  if (total === 0) return null;
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function encodeKey(key: string): string {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export async function handleStorageRequest(
  request: Request,
  env: Env,
  resolveAuth: StorageAuthResolver,
): Promise<Response | null> {
  const url = new URL(request.url);
  const route = routeFor(url);
  if (!route) return null;

  const requestedMethod = request.method === "OPTIONS"
    ? request.headers.get("access-control-request-method")?.toUpperCase()
    : request.method;
  const isMutation = requestedMethod === "POST" || requestedMethod === "DELETE";
  const cors = corsHeaders(request, env, isMutation);
  if (!cors) return jsonResponse({ error: "forbidden_origin" }, 403);
  if (request.method === "OPTIONS") {
    cors.set("allow", STORAGE_METHODS);
    return new Response(null, { status: 204, headers: cors });
  }

  const allowedMethod = route.kind === "public"
    ? request.method === "GET" || request.method === "HEAD"
    : request.method === "POST" || request.method === "DELETE";
  if (!allowedMethod) {
    cors.set("allow", route.kind === "public" ? "GET, HEAD, OPTIONS" : "POST, DELETE, OPTIONS");
    return jsonResponse({ error: "method_not_allowed" }, 405, cors);
  }
  if (env.STORAGE_BACKEND !== "r2") {
    return jsonResponse({ error: "storage_unavailable" }, 503, cors);
  }
  const bucket = bucketFor(env, route.bucketName);
  if (!bucket) return jsonResponse({ error: "storage_unavailable" }, 503, cors);

  if (route.kind === "public") {
    const key = decodeKey(route.rawKeySegments);
    if (!key) return jsonResponse({ error: "invalid_object_path" }, 400, cors);
    try {
      if (request.method === "HEAD") {
        const object = await bucket.head(key);
        if (!object) return jsonResponse({ error: "object_not_found" }, 404, cors);
        const headers = new Headers(cors);
        object.writeHttpMetadata(headers);
        headers.set("cache-control", object.httpMetadata?.cacheControl ?? "public, max-age=3600");
        headers.set("content-length", String(object.size));
        headers.set("x-content-type-options", "nosniff");
        return new Response(null, { status: 200, headers });
      }
      const object = await bucket.get(key);
      if (!object) return jsonResponse({ error: "object_not_found" }, 404, cors);
      const headers = new Headers(cors);
      object.writeHttpMetadata(headers);
      headers.set("cache-control", object.httpMetadata?.cacheControl ?? "public, max-age=3600");
      headers.set("content-length", String(object.size));
      headers.set("x-content-type-options", "nosniff");
      return new Response(object.body, { status: 200, headers });
    } catch {
      return jsonResponse({ error: "storage_unavailable" }, 503, cors);
    }
  }

  const auth = await resolveAuth(request, env);
  if (!auth.available) return jsonResponse({ error: "auth_unavailable" }, 503, cors);
  if (!auth.userId) return jsonResponse({ error: "unauthorized" }, 401, cors);

  if (request.method === "POST") {
    if (route.rawKeySegments.length !== 0) {
      return jsonResponse({ error: "invalid_object_path" }, 400, cors);
    }
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
    const extension = ALLOWED_IMAGE_TYPES[contentType];
    if (!extension) return jsonResponse({ error: "unsupported_media_type" }, 415, cors);
    const limit = route.bucketName === "avatars" ? AVATAR_LIMIT : COVER_LIMIT;
    const declaredLength = request.headers.get("content-length");
    if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > limit) {
      return jsonResponse({ error: "file_too_large" }, 413, cors);
    }
    const bytes = await readBoundedBody(request, limit);
    if (bytes === "too_large") return jsonResponse({ error: "file_too_large" }, 413, cors);
    if (!bytes) return jsonResponse({ error: "empty_file" }, 400, cors);
    if (!imageMatchesType(bytes, contentType)) {
      return jsonResponse({ error: "invalid_image" }, 400, cors);
    }

    const key = `${auth.userId}/${crypto.randomUUID()}.${extension}`;
    try {
      await bucket.put(key, bytes, {
        httpMetadata: {
          contentType,
          cacheControl: "public, max-age=3600",
        },
      });
    } catch {
      return jsonResponse({ error: "storage_unavailable" }, 503, cors);
    }
    const publicUrl = new URL(`${PUBLIC_PREFIX}${route.bucketName}/${encodeKey(key)}`, url.origin);
    return jsonResponse({ path: key, publicUrl: publicUrl.toString() }, 201, cors);
  }

  const key = decodeKey(route.rawKeySegments);
  if (!key) return jsonResponse({ error: "invalid_object_path" }, 400, cors);
  if (!key.startsWith(`${auth.userId}/`)) {
    return jsonResponse({ error: "forbidden" }, 403, cors);
  }
  try {
    await bucket.delete(key);
    return new Response(null, { status: 204, headers: cors });
  } catch {
    return jsonResponse({ error: "storage_unavailable" }, 503, cors);
  }
}
