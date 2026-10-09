export type StripePriceMode = "test" | "live" | "none";

export interface CloudflareExtensionPrice {
  schemaVersion: 1;
  releaseVersion: string;
  tierLevel: number;
  months: number;
  priceYen: number;
  isActive: boolean;
  stripePriceId: string | null;
}

export class CloudflareReferenceMasterError extends Error {
  readonly kind: "configuration" | "http" | "invalid_response" | "network" | "timeout";
  readonly status?: number;

  constructor(kind: CloudflareReferenceMasterError["kind"], status?: number) {
    super(kind === "http" && status
      ? `Cloudflare reference master request failed (${status})`
      : `Cloudflare reference master request ${kind}`);
    this.name = "CloudflareReferenceMasterError";
    this.kind = kind;
    this.status = status;
  }
}

interface FetchOptions {
  apiBaseUrl: string;
  secret: string;
  tierLevel: number;
  months: number;
  mode: StripePriceMode;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

const ROUTE_PATH = "/api/internal/reference-masters/extension-price";
const MAX_RESPONSE_BYTES = 8 * 1024;
const RELEASE_VERSION_RE = /^[0-9a-f]{64}$/u;
const PRICE_ID_RE = /^price_[A-Za-z0-9]{1,128}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CloudflareReferenceMasterError("configuration");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username || url.password || (url.pathname !== "" && url.pathname !== "/") || url.search || url.hash
  ) throw new CloudflareReferenceMasterError("configuration");
  url.pathname = "";
  return url;
}

function toHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseResponse(value: unknown, tierLevel: number, months: number, mode: StripePriceMode): CloudflareExtensionPrice {
  if (!isRecord(value)) throw new CloudflareReferenceMasterError("invalid_response");
  const expectedKeys = ["isActive", "months", "priceYen", "releaseVersion", "schemaVersion", "stripePriceId", "tierLevel"];
  const keys = Object.keys(value).sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new CloudflareReferenceMasterError("invalid_response");
  }
  const priceId = value.stripePriceId;
  if (
    value.schemaVersion !== 1 || typeof value.releaseVersion !== "string" || !RELEASE_VERSION_RE.test(value.releaseVersion) ||
    value.tierLevel !== tierLevel || value.months !== months ||
    !Number.isSafeInteger(value.priceYen) || Number(value.priceYen) < 0 || Number(value.priceYen) > 2_147_483_647 ||
    typeof value.isActive !== "boolean" ||
    (priceId !== null && (typeof priceId !== "string" || !PRICE_ID_RE.test(priceId))) ||
    (mode === "none" && priceId !== null)
  ) throw new CloudflareReferenceMasterError("invalid_response");
  return value as unknown as CloudflareExtensionPrice;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json" || !response.body) throw new CloudflareReferenceMasterError("invalid_response");
  if (!response.headers.get("cache-control")?.toLowerCase().split(",").some((item) => item.trim() === "no-store")) {
    await response.body.cancel();
    throw new CloudflareReferenceMasterError("invalid_response");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    await response.body.cancel();
    throw new CloudflareReferenceMasterError("invalid_response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new CloudflareReferenceMasterError("invalid_response");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof CloudflareReferenceMasterError) throw error;
    throw new CloudflareReferenceMasterError("invalid_response");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new CloudflareReferenceMasterError("invalid_response");
  }
}

export async function fetchCloudflareExtensionPrice(options: FetchOptions): Promise<CloudflareExtensionPrice> {
  if (
    typeof options.secret !== "string" || options.secret.length < 32 ||
    !Number.isSafeInteger(options.tierLevel) || options.tierLevel < 1 || options.tierLevel > 4 ||
    !Number.isSafeInteger(options.months) || options.months < 1 || options.months > 120 ||
    !["test", "live", "none"].includes(options.mode)
  ) throw new CloudflareReferenceMasterError("configuration");
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new CloudflareReferenceMasterError("configuration");
  }
  const baseUrl = resolveBaseUrl(options.apiBaseUrl);
  const endpoint = new URL(ROUTE_PATH, baseUrl);
  const timestamp = String(Math.floor((options.now?.() ?? Date.now()) / 1000));
  const canonicalQuery = `mode=${options.mode}&months=${options.months}&tier_level=${options.tierLevel}`;
  endpoint.search = canonicalQuery;
  const message = `GET\n${ROUTE_PATH}?${canonicalQuery}\n${timestamp}`;
  let signature: string;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(options.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    signature = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
  } catch {
    throw new CloudflareReferenceMasterError("configuration");
  }

  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-fanmark-service-timestamp": timestamp,
        "x-fanmark-service-signature": `v1=${signature}`,
      },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal,
    });
  } catch {
    if (signal.aborted) throw new CloudflareReferenceMasterError("timeout");
    throw new CloudflareReferenceMasterError("network");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new CloudflareReferenceMasterError("http", response.status);
  }
  return parseResponse(await readBoundedJson(response), options.tierLevel, options.months, options.mode);
}
