export const MAX_AVAILABILITY_BODY_BYTES = 4_096;
export const MAX_AVAILABILITY_EMOJI_IDS = 5;
export const MAX_AVAILABILITY_RESPONSE_BYTES = 16_384;
export const AVAILABILITY_BODY_TIMEOUT_MS = 2_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AvailabilityResult {
  available: boolean;
  fanmark_id?: string | null;
  reason?: string | null;
  tier_level?: number | null;
  tier_display_name?: string | null;
  price?: number | null;
  license_days?: number | null;
  available_at?: string | null;
  blocking_status?: string | null;
}

export interface AvailabilityPayload {
  schemaVersion: 1;
  result: AvailabilityResult;
}

export interface AvailabilityRepository {
  checkAvailability(emojiIds: string[]): Promise<AvailabilityResult>;
}

export type AvailabilityClock = () => Date;

export class AvailabilityConfigurationError extends Error {
  constructor() {
    super("availability API is not configured");
    this.name = "AvailabilityConfigurationError";
  }
}

export class AvailabilityUpstreamError extends Error {
  constructor() {
    super("availability upstream request failed");
    this.name = "AvailabilityUpstreamError";
  }
}

export class AvailabilityTimeoutError extends Error {
  constructor() {
    super("availability upstream request timed out");
    this.name = "AvailabilityTimeoutError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value));
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assignIfPresent(
  source: Record<string, unknown>,
  target: AvailabilityResult,
  key: keyof AvailabilityResult,
  valid: (value: unknown) => boolean,
): void {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return;
  const value = source[key];
  if (!valid(value)) throw new AvailabilityUpstreamError();
  (target as unknown as Record<string, unknown>)[key] = value;
}

/**
 * Keep the public response to the fields documented by the availability
 * contract. Supabase and D1 both pass through this shape validator.
 */
export function sanitizeAvailabilityResult(value: unknown): AvailabilityResult {
  if (!isRecord(value) || typeof value.available !== "boolean") {
    throw new AvailabilityUpstreamError();
  }

  const result: AvailabilityResult = { available: value.available };
  assignIfPresent(value, result, "fanmark_id", (candidate) =>
    candidate === null || isUuid(candidate),
  );
  assignIfPresent(value, result, "reason", isNullableString);
  assignIfPresent(
    value,
    result,
    "tier_level",
    (candidate) =>
      isNullableInteger(candidate) &&
      (candidate === null || (candidate >= 1 && candidate <= 4)),
  );
  assignIfPresent(value, result, "tier_display_name", isNullableString);
  assignIfPresent(value, result, "price", isNullableFiniteNumber);
  assignIfPresent(
    value,
    result,
    "license_days",
    (candidate) =>
      isNullableInteger(candidate) &&
      (candidate === null || candidate >= 0),
  );
  assignIfPresent(value, result, "available_at", isNullableString);
  assignIfPresent(value, result, "blocking_status", isNullableString);

  // The RPC has four deliberately narrow result variants. Requiring the
  // fields belonging to one variant keeps a malformed upstream object from
  // being presented as a valid availability decision.
  if (result.available) {
    if (hasOwn(value, "fanmark_id")) {
      if (!isUuid(result.fanmark_id) || result.reason !== null || result.available_at !== null || result.blocking_status !== null) {
        throw new AvailabilityUpstreamError();
      }
      if (
        hasOwn(value, "tier_level") ||
        hasOwn(value, "tier_display_name") ||
        hasOwn(value, "price") ||
        hasOwn(value, "license_days")
      ) {
        throw new AvailabilityUpstreamError();
      }
      if (!hasOwn(value, "reason") || !hasOwn(value, "available_at") || !hasOwn(value, "blocking_status")) {
        throw new AvailabilityUpstreamError();
      }
    } else {
      if (
        !hasOwn(value, "tier_level") ||
        !hasOwn(value, "tier_display_name") ||
        !hasOwn(value, "price") ||
        !hasOwn(value, "license_days") ||
        result.tier_level === null ||
        result.tier_display_name === null ||
        result.price === null
      ) {
        throw new AvailabilityUpstreamError();
      }
      if (
        hasOwn(value, "reason") ||
        hasOwn(value, "available_at") ||
        hasOwn(value, "blocking_status")
      ) {
        throw new AvailabilityUpstreamError();
      }
    }
  } else {
    if (!hasOwn(value, "reason") || typeof result.reason !== "string") {
      throw new AvailabilityUpstreamError();
    }
    if (result.reason === "invalid_emoji_ids" || result.reason === "invalid_length") {
      if (
        hasOwn(value, "fanmark_id") ||
        hasOwn(value, "tier_level") ||
        hasOwn(value, "tier_display_name") ||
        hasOwn(value, "price") ||
        hasOwn(value, "license_days") ||
        hasOwn(value, "available_at") ||
        hasOwn(value, "blocking_status")
      ) {
        throw new AvailabilityUpstreamError();
      }
    } else if (result.reason === "taken" || result.reason === "grace_period") {
      if (
        !hasOwn(value, "fanmark_id") ||
        !isUuid(result.fanmark_id) ||
        !hasOwn(value, "blocking_status") ||
        result.blocking_status !== (result.reason === "taken" ? "active" : "grace") ||
        !hasOwn(value, "available_at") ||
        (result.reason === "taken" ? result.available_at !== null : typeof result.available_at !== "string")
      ) {
        throw new AvailabilityUpstreamError();
      }
      if (
        hasOwn(value, "tier_level") ||
        hasOwn(value, "tier_display_name") ||
        hasOwn(value, "price") ||
        hasOwn(value, "license_days")
      ) {
        throw new AvailabilityUpstreamError();
      }
    } else {
      throw new AvailabilityUpstreamError();
    }
  }
  return result;
}

async function cancelAndRelease(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  // A hostile or broken stream is allowed to ignore cancellation. Do not
  // await it on the request path; releasing the lock lets the Worker finish
  // while the platform cleans up the body in the background.
  void reader.cancel().catch(() => undefined);
  reader.releaseLock();
}

async function readChunkWithDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadline: number,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), remaining);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readBoundedBody(request: Request): Promise<string | null> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) return null;
    if (parsedLength > MAX_AVAILABILITY_BODY_BYTES) return null;
  }

  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  const deadline = Date.now() + AVAILABILITY_BODY_TIMEOUT_MS;
  try {
    while (true) {
      const chunk = await readChunkWithDeadline(reader, deadline);
      if (chunk === null) {
        await cancelAndRelease(reader);
        return null;
      }
      const { done, value } = chunk;
      if (done) break;
      if (!value) continue;
      totalLength += value.byteLength;
      if (totalLength > MAX_AVAILABILITY_BODY_BYTES) {
        await cancelAndRelease(reader);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    await cancelAndRelease(reader);
    return null;
  }
  reader.releaseLock();

  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function parseAvailabilityRequest(request: Request): Promise<string[] | null> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return null;

  const body = await readBoundedBody(request);
  if (body === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || Object.keys(parsed).some((key) => key !== "emojiIds")) {
    return null;
  }
  if (!Array.isArray(parsed.emojiIds)) return null;
  if (
    parsed.emojiIds.length < 1 ||
    parsed.emojiIds.length > MAX_AVAILABILITY_EMOJI_IDS ||
    !parsed.emojiIds.every(isUuid)
  ) {
    return null;
  }

  // UUIDs are case-insensitive in PostgreSQL. D1 stores the imported UUID
  // spelling as text, so canonicalize case without changing order/repetition.
  return parsed.emojiIds.map((id) => id.toLowerCase());
}

export function formatAvailabilityNow(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new AvailabilityConfigurationError();
  // Source timestamps are imported as fixed-width UTC microsecond text. Date
  // supplies milliseconds, so pad rather than parse through a lower-precision
  // SQLite datetime function.
  return date.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}
