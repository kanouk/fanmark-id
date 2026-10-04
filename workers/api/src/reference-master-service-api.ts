import type { Env } from "./repository";

const ROUTE_PATH = "/api/internal/reference-masters/extension-price";
const RELEASE_VERSION_RE = /^[0-9a-f]{64}$/u;
const PRICE_ID_RE = /^price_[A-Za-z0-9]{1,128}$/u;
const SIGNATURE_RE = /^v1=([0-9a-f]{64})$/u;
const TIMESTAMP_RE = /^\d{10}$/u;
const MAX_CLOCK_SKEW_SECONDS = 60;

function masterDatabase(env: Env): D1Database | undefined {
  const topology = env.D1_TOPOLOGY?.trim();
  if (topology && topology !== "legacy" && topology !== "split") return undefined;
  if (topology === "split") return env.MASTER_DB;
  return env.MASTER_DB ?? env.FANMARK_DB;
}

interface ExtensionPriceRow {
  release_version?: unknown;
  expected_count?: unknown;
  actual_count?: unknown;
  tier_level?: unknown;
  months?: unknown;
  price_yen?: unknown;
  is_active?: unknown;
  stripe_price_id?: unknown;
  stripe_price_id_live?: unknown;
}

export interface PrivateExtensionPrice {
  schemaVersion: 1;
  releaseVersion: string;
  tierLevel: number;
  months: number;
  priceYen: number;
  isActive: boolean;
  stripePriceId: string | null;
}

export class ReferenceMasterServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, status: number) {
    super(code);
    this.name = "ReferenceMasterServiceError";
    this.code = code;
    this.status = status;
  }
}

function response(code: string, status: number, head: boolean): Response {
  return new Response(head ? null : JSON.stringify({ error: code }), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

function parseRequest(url: URL): { tierLevel: number; months: number; mode: "test" | "live" | "none"; canonicalQuery: string } | null {
  const allowedKeys = ["mode", "months", "tier_level"];
  const keys: string[] = [];
  url.searchParams.forEach((_value, key) => keys.push(key));
  keys.sort();
  if (url.pathname !== ROUTE_PATH || url.hash || keys.length !== 3 || keys.some((key, index) => key !== allowedKeys[index])) {
    return null;
  }
  const tierValues = url.searchParams.getAll("tier_level");
  const monthValues = url.searchParams.getAll("months");
  const modeValues = url.searchParams.getAll("mode");
  if (tierValues.length !== 1 || monthValues.length !== 1 || modeValues.length !== 1) return null;
  if (!/^[1-4]$/u.test(tierValues[0]) || !/^(?:[1-9]|[1-9]\d|1[01]\d|120)$/u.test(monthValues[0])) return null;
  if (modeValues[0] !== "test" && modeValues[0] !== "live" && modeValues[0] !== "none") return null;
  const tierLevel = Number(tierValues[0]);
  const months = Number(monthValues[0]);
  const mode = modeValues[0];
  const canonicalQuery = `mode=${mode}&months=${months}&tier_level=${tierLevel}`;
  return { tierLevel, months, mode, canonicalQuery };
}

async function verifySignature(
  request: Request,
  url: URL,
  secret: string,
  now: () => number,
): Promise<{ tierLevel: number; months: number; mode: "test" | "live" | "none" } | null> {
  const parsed = parseRequest(url);
  if (!parsed || request.method.toUpperCase() !== "GET" || request.headers.has("origin")) return null;
  const timestamp = request.headers.get("x-fanmark-service-timestamp") ?? "";
  const signature = request.headers.get("x-fanmark-service-signature") ?? "";
  const signatureMatch = SIGNATURE_RE.exec(signature);
  if (!TIMESTAMP_RE.test(timestamp) || !signatureMatch) return null;
  if (Math.abs(Math.floor(now() / 1000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) return null;

  const message = `GET\n${ROUTE_PATH}?${parsed.canonicalQuery}\n${timestamp}`;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const supplied = Uint8Array.from(signatureMatch[1].match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
    const valid = await crypto.subtle.verify("HMAC", key, supplied, new TextEncoder().encode(message));
    return valid ? { tierLevel: parsed.tierLevel, months: parsed.months, mode: parsed.mode } : null;
  } catch {
    return null;
  }
}

function validRow(
  row: ExtensionPriceRow,
  tierLevel: number,
  months: number,
  mode: "test" | "live" | "none",
): PrivateExtensionPrice | null {
  const selectedPriceId = mode === "test" ? row.stripe_price_id : mode === "live" ? row.stripe_price_id_live : null;
  if (
    typeof row.release_version !== "string" || !RELEASE_VERSION_RE.test(row.release_version) ||
    !Number.isSafeInteger(row.expected_count) || Number(row.expected_count) < 1 || Number(row.expected_count) > 64 ||
    !Number.isSafeInteger(row.actual_count) || row.actual_count !== row.expected_count ||
    row.tier_level !== tierLevel || row.months !== months ||
    !Number.isSafeInteger(row.price_yen) || Number(row.price_yen) < 0 || Number(row.price_yen) > 2_147_483_647 ||
    (row.is_active !== 0 && row.is_active !== 1) ||
    (selectedPriceId !== null && (typeof selectedPriceId !== "string" || !PRICE_ID_RE.test(selectedPriceId)))
  ) return null;

  return {
    schemaVersion: 1,
    releaseVersion: row.release_version,
    tierLevel,
    months,
    priceYen: Number(row.price_yen),
    isActive: row.is_active === 1,
    stripePriceId: selectedPriceId as string | null,
  };
}

export async function handleReferenceMasterServiceRequest(
  request: Request,
  env: Env,
  now: () => number = Date.now,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE_PATH) return null;
  const head = request.method.toUpperCase() === "HEAD";
  const secret = env.REFERENCE_MASTER_SERVICE_SECRET?.trim();
  if (!secret || secret.length < 32 || env.REFERENCE_MASTER_BACKEND?.trim() !== "d1") {
    return response("reference_master_service_unavailable", 503, head);
  }
  if (request.method.toUpperCase() !== "GET") return response("method_not_allowed", 405, head);

  const verified = await verifySignature(request, url, secret, now);
  if (!verified) return response("unauthorized", 401, head);

  const database = masterDatabase(env);
  if (!database) return response("reference_master_service_unavailable", 503, head);
  try {
    const query = `
      SELECT active.release_version,
             manifest.row_count AS expected_count,
             (SELECT count(*) FROM fanmark_extension_price_release_rows
               WHERE release_version = active.release_version) AS actual_count,
             price.tier_level, price.months, price.price_yen, price.is_active,
             price.stripe_price_id, price.stripe_price_id_live
      FROM fanmark_reference_master_active_release AS active
      JOIN fanmark_reference_master_releases AS release
        ON release.release_version = active.release_version AND release.status = 'ready'
      JOIN fanmark_reference_master_extension_price_manifests AS manifest
        ON manifest.release_version = active.release_version
      JOIN fanmark_extension_price_release_rows AS price
        ON price.release_version = active.release_version
      WHERE active.singleton_id = 1
        AND manifest.row_count = (SELECT count(*) FROM fanmark_extension_price_release_rows
                                  WHERE release_version = active.release_version)
        AND price.tier_level = ? AND price.months = ?
      LIMIT 2`;
    const result = await database.prepare(query).bind(verified.tierLevel, verified.months).all<ExtensionPriceRow>();
    if (!result || result.success !== true || !Array.isArray(result.results)) {
      return response("reference_master_service_unavailable", 503, head);
    }
    if (result.results.length === 0) return response("extension_price_not_found", 404, head);
    if (result.results.length !== 1) return response("reference_master_service_unavailable", 503, head);
    const projection = validRow(result.results[0], verified.tierLevel, verified.months, verified.mode);
    if (!projection) return response("reference_master_service_unavailable", 503, head);
    return new Response(head ? null : JSON.stringify(projection), {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return response("reference_master_service_unavailable", 503, head);
  }
}
