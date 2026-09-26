import { isUuid } from "./availability";

export const PUBLIC_ACCESS_BODY_BYTES = 4_096;
export const PUBLIC_ACCESS_RESPONSE_BYTES = 64 * 1024;
export const PUBLIC_ACCESS_BODY_TIMEOUT_MS = 2_000;
export const PUBLIC_ACCESS_SHORT_ID_BYTES = 256;
export const PUBLIC_ACCESS_TEXT_BYTES = 16 * 1024;
export const PUBLIC_ACCESS_URL_BYTES = 2_048;
export const PUBLIC_ACCESS_PROFILE_JSON_BYTES = 16 * 1024;
export const PUBLIC_ACCESS_RESPONSE_STRING_BYTES = 4 * 1024;

const MAX_EMOJI_IDS = 5;
const MAX_EMOJI_DISPLAY_UNITS = 128;
const MAX_FANMARK_NAME_UNITS = 256;
const MAX_PROFILE_NAME_UNITS = 50;
const MAX_PROFILE_BIO_UNITS = 500;
const MAX_SOCIAL_LINKS = 32;
const MAX_THEME_KEYS = 8;
const MAX_PROFILE_URL_UNITS = 2_048;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_UTC_MICROSECOND_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const ACCESS_TYPES = new Set(["profile", "redirect", "text", "inactive"]);
const SOCIAL_KEYS = new Set([
  "instagram",
  "tiktok",
  "x",
  "youtube",
  "bereal",
  "line",
  "threads",
  "bluesky",
  "github",
  "discord",
  "snapchat",
  "twitch",
  "facebook",
  "website",
]);
const THEME_KEYS = new Set([
  "cover_image_url",
  "cover_image_dimensions",
  "cover_image_position",
  "profile_image_url",
  "theme_color",
  "button_style",
]);

export type PublicAccessRoute =
  | { kind: "short"; rawValue: string }
  | { kind: "emoji" }
  | { kind: "profile"; rawValue: string };

export interface PublicAccessRawRow {
  id: unknown;
  shortId: unknown;
  userInputFanmark: unknown;
  displayFanmark: unknown;
  emojiIds: unknown;
  fanmarkName: unknown;
  accessType: unknown;
  targetUrl: unknown;
  textContent: unknown;
  status: unknown;
  isPasswordProtected: unknown;
  licenseId: unknown;
  licenseStatus: unknown;
  licenseEnd: unknown;
  graceExpiresAt: unknown;
  isReturned: unknown;
}

export interface PublicProfileRawRow {
  licenseId: unknown;
  displayName: unknown;
  bio: unknown;
  socialLinks: unknown;
  themeSettings: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PublicAccessRecord {
  id: string;
  shortId: string;
  userInputFanmark: string;
  displayFanmark: string | null;
  emojiIds: string[];
  fanmarkName: string;
  accessType: "profile" | "redirect" | "text" | "inactive";
  targetUrl: string | null;
  textContent: string | null;
  status: "active";
  isPasswordProtected: boolean;
  licenseId: string | null;
  licenseStatus: "active" | "grace" | "expired" | null;
  licenseEnd: string | null;
  graceExpiresAt: string | null;
  isReturned: boolean | null;
}

export interface PublicProfileRecord {
  licenseId: string;
  displayName: string | null;
  bio: string | null;
  socialLinks: Record<string, string>;
  themeSettings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PublicAccessResponse {
  schemaVersion: 1;
  id: string;
  shortId: string;
  userInputFanmark: string;
  displayFanmark: string | null;
  emojiIds: string[];
  accessState: "open" | "locked" | "unavailable";
  fanmarkName: string | null;
  accessType: "profile" | "redirect" | "text" | "inactive";
  targetUrl: string | null;
  textContent: string | null;
  status: "active";
  isPasswordProtected: boolean;
  licenseId: string | null;
  licenseStatus: "active" | "grace" | "expired" | null;
  licenseEnd: string | null;
  graceExpiresAt: string | null;
  isReturned: boolean | null;
}

export interface PublicProfileResponse {
  schemaVersion: 1;
  licenseId: string;
  displayName: string | null;
  bio: string | null;
  socialLinks: Record<string, string>;
  themeSettings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export class PublicAccessConfigurationError extends Error {
  constructor() {
    super("public access API is not configured");
    this.name = "PublicAccessConfigurationError";
  }
}

export class PublicAccessUnavailableError extends Error {
  constructor() {
    super("public access API is unavailable");
    this.name = "PublicAccessUnavailableError";
  }
}

export class PublicAccessUpstreamError extends Error {
  constructor() {
    super("public access source returned an invalid result");
    this.name = "PublicAccessUpstreamError";
  }
}

export class PublicAccessResponseTooLargeError extends Error {
  constructor() {
    super("public access response exceeds its bound");
    this.name = "PublicAccessResponseTooLargeError";
  }
}

export interface PublicAccessRepository {
  getByShortId(shortId: string): Promise<PublicAccessRawRow | null>;
  getByEmojiIds(emojiIds: string[], now: Date): Promise<PublicAccessRawRow | null>;
  getPublicProfile(licenseId: string, now: Date): Promise<PublicProfileRawRow | null>;
}

export function parsePublicAccessRoute(url: URL): PublicAccessRoute | null {
  const shortPrefix = "/api/fanmarks/access/short/";
  if (url.pathname.startsWith(shortPrefix)) {
    return { kind: "short", rawValue: url.pathname.slice(shortPrefix.length) };
  }

  if (url.pathname === "/api/fanmarks/access/emoji") return { kind: "emoji" };

  const profilePrefix = "/api/fanmarks/public-profile/";
  if (url.pathname.startsWith(profilePrefix)) {
    return { kind: "profile", rawValue: url.pathname.slice(profilePrefix.length) };
  }

  return null;
}

export function publicAccessAllowedMethods(route: PublicAccessRoute): string {
  return route.kind === "emoji" ? "POST, OPTIONS" : "GET, OPTIONS";
}

export function publicAccessAllowedHeaders(route: PublicAccessRoute): string | undefined {
  return route.kind === "emoji" ? "content-type" : undefined;
}

function textEncoderLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasControlOrPathSeparator(value: string): boolean {
  return /[\u0000-\u001f\u007f\\/]/u.test(value);
}

export function parsePublicAccessPathValue(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (
    decoded.length === 0 ||
    textEncoderLength(decoded) > PUBLIC_ACCESS_SHORT_ID_BYTES ||
    hasControlOrPathSeparator(decoded)
  ) {
    return null;
  }
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableString(value: unknown, maxBytes = PUBLIC_ACCESS_RESPONSE_STRING_BYTES): value is string | null {
  return value === null || (typeof value === "string" && textEncoderLength(value) <= maxBytes);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_UTC_MICROSECOND_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1 || year > 9999) return false;
  const millisecondTimestamp = `${value.slice(0, 19)}.${value.slice(20, 23)}Z`;
  const parsed = new Date(millisecondTimestamp);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === millisecondTimestamp;
}

function assertCanonicalTimestamp(value: unknown): string | null;
function assertCanonicalTimestamp(value: unknown, nullable: false): string;
function assertCanonicalTimestamp(value: unknown, nullable = true): string | null {
  if (value === null && nullable) return null;
  if (!isCanonicalTimestamp(value)) throw new PublicAccessUpstreamError();
  return value;
}

function assertString(value: unknown, maxBytes: number): string {
  if (typeof value !== "string" || textEncoderLength(value) > maxBytes) {
    throw new PublicAccessUpstreamError();
  }
  return value;
}

function assertStringUnits(value: unknown, maxUnits: number): string {
  if (typeof value !== "string" || value.length > maxUnits) {
    throw new PublicAccessUpstreamError();
  }
  return value;
}

function assertNullableBoundedString(value: unknown, maxBytes: number): string | null {
  if (!isNullableString(value, maxBytes)) throw new PublicAccessUpstreamError();
  return value;
}

function assertNullableBoundedUnits(value: unknown, maxUnits: number): string | null {
  if (value !== null && (typeof value !== "string" || value.length > maxUnits)) {
    throw new PublicAccessUpstreamError();
  }
  return value as string | null;
}

function assertBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new PublicAccessUpstreamError();
  return value;
}

function assertNullableBoolean(value: unknown): boolean | null {
  if (value !== null && typeof value !== "boolean") throw new PublicAccessUpstreamError();
  return value;
}

function assertLicenseStatus(value: unknown): "active" | "grace" | "expired" | null {
  if (value === null) return null;
  if (value !== "active" && value !== "grace" && value !== "expired") {
    throw new PublicAccessUpstreamError();
  }
  return value;
}

function assertEmojiIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_EMOJI_IDS) {
    throw new PublicAccessUpstreamError();
  }
  return value.map((candidate) => {
    if (!isUuid(candidate)) throw new PublicAccessUpstreamError();
    return candidate.toLowerCase();
  });
}

function assertAccessType(value: unknown): PublicAccessRecord["accessType"] {
  if (typeof value !== "string" || !ACCESS_TYPES.has(value)) {
    throw new PublicAccessUpstreamError();
  }
  return value as PublicAccessRecord["accessType"];
}

function assertSafeUrl(value: string): string {
  if (textEncoderLength(value) > PUBLIC_ACCESS_URL_BYTES || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new PublicAccessUpstreamError();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PublicAccessUpstreamError();
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    if (parsed.username || parsed.password || !parsed.hostname) throw new PublicAccessUpstreamError();
    return value;
  }
  if (parsed.protocol === "tel:" && parsed.hostname === "") return value;
  throw new PublicAccessUpstreamError();
}

function assertJsonByteBound(value: unknown, maxBytes: number): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new PublicAccessUpstreamError();
  }
  if (typeof serialized !== "string" || textEncoderLength(serialized) > maxBytes) {
    throw new PublicAccessUpstreamError();
  }
}

function sanitizeSocialLinks(value: unknown): Record<string, string> {
  if (value === null) return {};
  if (!isRecord(value) || Object.keys(value).length > MAX_SOCIAL_LINKS) {
    throw new PublicAccessUpstreamError();
  }
  const result: Record<string, string> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!SOCIAL_KEYS.has(key) || typeof candidate !== "string") {
      throw new PublicAccessUpstreamError();
    }
    if (candidate.length === 0) continue;
    result[key] = assertSafeUrl(assertString(candidate, MAX_PROFILE_URL_UNITS));
  }
  assertJsonByteBound(result, PUBLIC_ACCESS_PROFILE_JSON_BYTES);
  return result;
}

function sanitizeThemeSettings(value: unknown): Record<string, unknown> {
  if (value === null) return {};
  if (!isRecord(value) || Object.keys(value).length > MAX_THEME_KEYS) {
    throw new PublicAccessUpstreamError();
  }
  const result: Record<string, unknown> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!THEME_KEYS.has(key)) throw new PublicAccessUpstreamError();
    if (key === "cover_image_url" || key === "profile_image_url") {
      if (candidate === "") continue;
      result[key] = assertSafeUrl(assertString(candidate, MAX_PROFILE_URL_UNITS));
    } else if (key === "cover_image_dimensions") {
      if (!isRecord(candidate)) throw new PublicAccessUpstreamError();
      const width = candidate.width;
      const height = candidate.height;
      if (
        typeof width !== "number" || !Number.isInteger(width) || width < 1 || width > 10_000 ||
        typeof height !== "number" || !Number.isInteger(height) || height < 1 || height > 10_000
      ) {
        throw new PublicAccessUpstreamError();
      }
      result[key] = { width, height };
    } else if (key === "cover_image_position") {
      if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0 || candidate > 100) {
        throw new PublicAccessUpstreamError();
      }
      result[key] = candidate;
    } else if (key === "theme_color") {
      if (typeof candidate !== "string" || !/^#[0-9a-f]{3,8}$/i.test(candidate)) {
        throw new PublicAccessUpstreamError();
      }
      result[key] = candidate;
    } else if (key === "button_style") {
      result[key] = assertString(candidate, 64);
    }
  }
  assertJsonByteBound(result, PUBLIC_ACCESS_PROFILE_JSON_BYTES);
  return result;
}

export function mapPublicAccessRow(row: PublicAccessRawRow): PublicAccessResponse {
  const id = assertString(row.id, PUBLIC_ACCESS_RESPONSE_STRING_BYTES);
  if (!isUuid(id)) throw new PublicAccessUpstreamError();
  const shortId = assertString(row.shortId, PUBLIC_ACCESS_SHORT_ID_BYTES);
  const userInputFanmark = assertStringUnits(row.userInputFanmark, MAX_EMOJI_DISPLAY_UNITS);
  const displayFanmark = assertNullableBoundedUnits(row.displayFanmark, MAX_EMOJI_DISPLAY_UNITS);
  const emojiIds = assertEmojiIds(row.emojiIds);
  const accessType = assertAccessType(row.accessType);
  const status = row.status;
  if (status !== "active") throw new PublicAccessUpstreamError();
  const licenseId = row.licenseId === null ? null : assertString(row.licenseId, PUBLIC_ACCESS_RESPONSE_STRING_BYTES);
  if (licenseId !== null && !isUuid(licenseId)) throw new PublicAccessUpstreamError();
  const licenseStatus = assertLicenseStatus(row.licenseStatus);
  const licenseEnd = assertCanonicalTimestamp(row.licenseEnd);
  const graceExpiresAt = assertCanonicalTimestamp(row.graceExpiresAt);
  const isReturned = assertNullableBoolean(row.isReturned);
  const isPasswordProtected = assertBoolean(row.isPasswordProtected);
  const fanmarkName = isPasswordProtected
    ? null
    : row.fanmarkName === null
      ? userInputFanmark
      : assertString(row.fanmarkName, MAX_FANMARK_NAME_UNITS);
  // Settings saves can leave an old redirect/text row when the access mode is
  // switched. Project only the active mode; stale inactive config is ignored.
  // Protected rows are redacted before any content is validated or returned.
  const targetUrl = !isPasswordProtected && accessType === "redirect" && row.targetUrl !== null
    ? assertSafeUrl(assertString(row.targetUrl, PUBLIC_ACCESS_URL_BYTES))
    : null;
  const textContent = !isPasswordProtected && accessType === "text" && row.textContent !== null
    ? assertNullableBoundedString(row.textContent, PUBLIC_ACCESS_TEXT_BYTES)
    : null;

  if (licenseId === null) {
    if (isPasswordProtected) {
      throw new PublicAccessUpstreamError();
    }
    return {
      schemaVersion: 1,
      id,
      shortId,
      userInputFanmark,
      displayFanmark,
      emojiIds,
      accessState: "unavailable",
      fanmarkName,
      accessType,
      targetUrl: null,
      textContent: null,
      status: "active",
      isPasswordProtected: false,
      licenseId: null,
      licenseStatus: null,
      licenseEnd: null,
      graceExpiresAt: null,
      isReturned: null,
    };
  }

  if (licenseStatus !== "active") throw new PublicAccessUpstreamError();
  if (isPasswordProtected) {
    return {
      schemaVersion: 1,
      id,
      shortId,
      userInputFanmark,
      displayFanmark,
      emojiIds,
      accessState: "locked",
      fanmarkName: null,
      accessType,
      targetUrl: null,
      textContent: null,
      status: "active",
      isPasswordProtected: true,
      licenseId,
      licenseStatus,
      licenseEnd,
      graceExpiresAt,
      isReturned,
    };
  }

  if (accessType !== "redirect" && targetUrl !== null) throw new PublicAccessUpstreamError();
  if (accessType !== "text" && textContent !== null) throw new PublicAccessUpstreamError();

  return {
    schemaVersion: 1,
    id,
    shortId,
    userInputFanmark,
    displayFanmark,
    emojiIds,
    accessState: "open",
    fanmarkName,
    accessType,
    targetUrl,
    textContent,
    status: "active",
    isPasswordProtected: false,
    licenseId,
    licenseStatus,
    licenseEnd,
    graceExpiresAt,
    isReturned,
  };
}

export function mapPublicProfileRow(row: PublicProfileRawRow): PublicProfileResponse {
  const licenseId = assertString(row.licenseId, PUBLIC_ACCESS_RESPONSE_STRING_BYTES);
  if (!isUuid(licenseId)) throw new PublicAccessUpstreamError();
  const displayName = row.displayName === null ? null : assertStringUnits(row.displayName, MAX_PROFILE_NAME_UNITS);
  const bio = row.bio === null ? null : assertStringUnits(row.bio, MAX_PROFILE_BIO_UNITS);
  const createdAt = assertCanonicalTimestamp(row.createdAt, false);
  const updatedAt = assertCanonicalTimestamp(row.updatedAt, false);
  return {
    schemaVersion: 1,
    licenseId,
    displayName,
    bio,
    socialLinks: sanitizeSocialLinks(row.socialLinks),
    themeSettings: sanitizeThemeSettings(row.themeSettings),
    createdAt,
    updatedAt,
  };
}

function cancelAndRelease(reader: ReadableStreamDefaultReader<Uint8Array>): void {
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
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > PUBLIC_ACCESS_BODY_BYTES) {
      return null;
    }
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  const deadline = Date.now() + PUBLIC_ACCESS_BODY_TIMEOUT_MS;
  try {
    while (true) {
      const chunk = await readChunkWithDeadline(reader, deadline);
      if (chunk === null) {
        cancelAndRelease(reader);
        return null;
      }
      if (chunk.done) break;
      if (!chunk.value) continue;
      totalLength += chunk.value.byteLength;
      if (totalLength > PUBLIC_ACCESS_BODY_BYTES) {
        cancelAndRelease(reader);
        return null;
      }
      chunks.push(chunk.value);
    }
  } catch {
    cancelAndRelease(reader);
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

export async function parsePublicAccessEmojiRequest(request: Request): Promise<string[] | null> {
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
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => key !== "emojiIds")) return null;
  if (!Array.isArray(parsed.emojiIds) || parsed.emojiIds.length < 1 || parsed.emojiIds.length > MAX_EMOJI_IDS) {
    return null;
  }
  if (!parsed.emojiIds.every((value) => isUuid(value))) return null;
  return parsed.emojiIds.map((value) => value.toLowerCase());
}

export function serializePublicAccessBody(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new PublicAccessUpstreamError();
  }
  if (textEncoderLength(serialized) > PUBLIC_ACCESS_RESPONSE_BYTES) {
    throw new PublicAccessResponseTooLargeError();
  }
  return serialized;
}

export function formatPublicAccessNow(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new PublicAccessConfigurationError();
  return date.toISOString().replace(/\.(\d{3})Z$/u, ".$1000Z");
}
