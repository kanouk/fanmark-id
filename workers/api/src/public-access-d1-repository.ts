import {
  formatPublicAccessNow,
  PublicAccessConfigurationError,
  PublicAccessUpstreamError,
  type PublicAccessRawRow,
  type PublicAccessRepository,
  type PublicProfileRawRow,
} from "./public-access";
import { isUuid } from "./availability";
import type { Env } from "./repository";

const SKIN_TONE_CODEPOINTS = new Set(["1F3FB", "1F3FC", "1F3FD", "1F3FE", "1F3FF"]);
const ISO_UTC_MICROSECOND_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

/**
 * Each public access lookup uses one projection statement after emoji input
 * normalization. The CTEs keep the base row, selected license, and all
 * public config fields on one D1 read snapshot. Counts and second-row values
 * make duplicate and tie states fail closed in the Worker instead of picking
 * an arbitrary row.
 */
function publicAccessProjectionSql(basePredicate: string, licensePredicate: string): string {
  return `
WITH matching_fanmarks AS (
  SELECT
    f.id,
    f.short_id AS shortId,
    f.user_input_fanmark AS userInputFanmark,
    f.emoji_ids AS emojiIds,
    f.status,
    ROW_NUMBER() OVER (ORDER BY f.id ASC) AS baseRank,
    COUNT(*) OVER () AS baseCount
  FROM fanmarks AS f
  WHERE f.status = 'active'
    AND ${basePredicate}
),
selected_base AS (
  SELECT *
  FROM matching_fanmarks
  WHERE baseRank = 1
),
active_licenses AS (
  SELECT
    fl.id,
    fl.fanmark_id AS fanmarkId,
    fl.display_fanmark AS displayFanmark,
    fl.status,
    fl.license_end AS licenseEnd,
    fl.grace_expires_at AS graceExpiresAt,
    fl.is_returned AS isReturned,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN fl.license_end IS NULL THEN 1 ELSE 0 END ASC,
        fl.license_end DESC,
        fl.id ASC
    ) AS licenseRank,
    COUNT(*) OVER () AS activeLicenseCount
  FROM fanmark_licenses AS fl
  JOIN selected_base AS b ON b.id = fl.fanmark_id
  WHERE fl.status = 'active'
    ${licensePredicate}
),
selected_license AS (
  SELECT *
  FROM active_licenses
  WHERE licenseRank = 1
),
basic_configs AS (
  SELECT
    license_id,
    COUNT(*) AS basicConfigCount,
    MAX(fanmark_name) AS fanmarkName,
    MAX(access_type) AS accessType
  FROM fanmark_basic_configs
  WHERE license_id = (SELECT id FROM selected_license)
  GROUP BY license_id
),
redirect_configs AS (
  SELECT
    license_id,
    COUNT(*) AS redirectConfigCount,
    MAX(target_url) AS targetUrl
  FROM fanmark_redirect_configs
  WHERE license_id = (SELECT id FROM selected_license)
  GROUP BY license_id
),
text_configs AS (
  SELECT
    license_id,
    COUNT(*) AS textConfigCount,
    MAX(content) AS textContent
  FROM fanmark_messageboard_configs
  WHERE license_id = (SELECT id FROM selected_license)
  GROUP BY license_id
),
password_configs AS (
  SELECT
    license_id,
    COUNT(*) AS passwordConfigCount,
    MAX(is_enabled) AS isEnabled
  FROM fanmark_password_configs
  WHERE license_id = (SELECT id FROM selected_license)
  GROUP BY license_id
)
SELECT
  b.id AS id,
  b.shortId AS shortId,
  b.userInputFanmark AS userInputFanmark,
  b.emojiIds AS emojiIds,
  b.status AS status,
  b.baseCount AS baseCount,
  COALESCE(l.activeLicenseCount, 0) AS activeLicenseCount,
  (
    SELECT second.licenseEnd
    FROM active_licenses AS second
    WHERE second.licenseRank = 2
  ) AS secondLicenseEnd,
  l.id AS licenseId,
  l.displayFanmark AS displayFanmark,
  CASE WHEN l.id IS NULL THEN NULL ELSE l.status END AS licenseStatus,
  l.licenseEnd AS licenseEnd,
  l.graceExpiresAt AS graceExpiresAt,
  l.isReturned AS isReturned,
  COALESCE(basic.basicConfigCount, 0) AS basicConfigCount,
  COALESCE(redirect.redirectConfigCount, 0) AS redirectConfigCount,
  COALESCE(textConfig.textConfigCount, 0) AS textConfigCount,
  COALESCE(password.passwordConfigCount, 0) AS passwordConfigCount,
  CASE
    WHEN password.isEnabled = 1 THEN NULL
    ELSE basic.fanmarkName
  END AS fanmarkName,
  COALESCE(basic.accessType, 'inactive') AS accessType,
  CASE
    WHEN password.isEnabled = 1 OR COALESCE(basic.accessType, 'inactive') <> 'redirect' THEN NULL
    ELSE redirect.targetUrl
  END AS targetUrl,
  CASE
    WHEN password.isEnabled = 1 OR COALESCE(basic.accessType, 'inactive') <> 'text' THEN NULL
    ELSE textConfig.textContent
  END AS textContent,
  COALESCE(password.isEnabled, 0) AS isPasswordProtected
FROM selected_base AS b
LEFT JOIN selected_license AS l ON 1 = 1
LEFT JOIN basic_configs AS basic ON basic.license_id = l.id
LEFT JOIN redirect_configs AS redirect ON redirect.license_id = l.id
LEFT JOIN text_configs AS textConfig ON textConfig.license_id = l.id
LEFT JOIN password_configs AS password ON password.license_id = l.id
`;
}

export const PUBLIC_ACCESS_BY_SHORT_SQL = publicAccessProjectionSql(
  "f.short_id = ?",
  "",
);

export const PUBLIC_ACCESS_BY_EMOJI_SQL = publicAccessProjectionSql(
  "f.normalized_emoji_ids = ?",
  "AND fl.license_end IS NOT NULL AND fl.license_end > ?",
);

export const PUBLIC_ACCESS_EMOJI_MASTER_BY_ID_SQL = `
  SELECT id, codepoints
  FROM emoji_master
  WHERE id IN (__ID_PLACEHOLDERS__)
`;

export const PUBLIC_ACCESS_EMOJI_MASTER_BY_CODEPOINTS_SQL = `
  SELECT id, codepoints
  FROM emoji_master
  WHERE codepoints IN (__CODEPOINT_PLACEHOLDERS__)
`;

export const PUBLIC_PROFILE_SQL = `
WITH password_configs AS (
  SELECT
    license_id,
    COUNT(*) AS passwordConfigCount,
    MAX(is_enabled) AS passwordEnabled
  FROM fanmark_password_configs
  WHERE license_id = ?
  GROUP BY license_id
),
eligible_licenses AS (
  SELECT
    fl.id AS licenseId,
    fl.license_end AS licenseEnd,
    fl.is_returned AS isReturned,
    COALESCE(password.passwordConfigCount, 0) AS passwordConfigCount,
    COALESCE(password.passwordEnabled, 0) AS passwordEnabled
  FROM fanmark_licenses AS fl
  JOIN fanmarks AS f ON f.id = fl.fanmark_id
  LEFT JOIN password_configs AS password ON password.license_id = fl.id
  WHERE fl.id = ?
    AND f.status = 'active'
    AND fl.status = 'active'
    AND fl.is_returned = 0
    AND (fl.license_end IS NULL OR fl.license_end > ?)
),
ordered_profiles AS (
  SELECT
    p.license_id AS licenseId,
    p.display_name AS displayNameSource,
    p.bio AS bioSource,
    p.social_links AS socialLinksSource,
    p.theme_settings AS themeSettingsSource,
    p.is_public AS isPublic,
    p.created_at AS createdAt,
    p.updated_at AS updatedAt,
    ROW_NUMBER() OVER (ORDER BY p.updated_at DESC, p.id ASC) AS profileRank,
    COUNT(*) OVER () AS profileCount
  FROM fanmark_profiles AS p
  JOIN eligible_licenses AS l ON l.licenseId = p.license_id
),
selected_profile AS (
  SELECT *
  FROM ordered_profiles
  WHERE profileRank = 1
)
SELECT
  p.licenseId AS licenseId,
  CASE WHEN COALESCE(l.passwordEnabled, 0) = 1 OR COALESCE(p.isPublic, 0) <> 1 THEN NULL ELSE p.displayNameSource END AS displayName,
  CASE WHEN COALESCE(l.passwordEnabled, 0) = 1 OR COALESCE(p.isPublic, 0) <> 1 THEN NULL ELSE p.bioSource END AS bio,
  CASE WHEN COALESCE(l.passwordEnabled, 0) = 1 OR COALESCE(p.isPublic, 0) <> 1 THEN NULL ELSE p.socialLinksSource END AS socialLinks,
  CASE WHEN COALESCE(l.passwordEnabled, 0) = 1 OR COALESCE(p.isPublic, 0) <> 1 THEN NULL ELSE p.themeSettingsSource END AS themeSettings,
  p.isPublic AS isPublic,
  p.createdAt AS createdAt,
  p.updatedAt AS updatedAt,
  p.profileCount AS profileCount,
  (
    SELECT second.updatedAt
    FROM ordered_profiles AS second
    WHERE second.profileRank = 2
  ) AS secondUpdatedAt,
  l.passwordConfigCount AS passwordConfigCount,
  l.passwordEnabled AS passwordEnabled,
  l.licenseEnd AS licenseEnd,
  l.isReturned AS isReturned
FROM selected_profile AS p
JOIN eligible_licenses AS l ON l.licenseId = p.licenseId
`;

interface BaseFanmarkRow {
  id?: unknown;
  shortId?: unknown;
  userInputFanmark?: unknown;
  emojiIds?: unknown;
  status?: unknown;
}

interface EmojiMasterRow {
  id?: unknown;
  codepoints?: unknown;
}

interface PublicAccessProjectionRow extends BaseFanmarkRow {
  baseCount?: unknown;
  activeLicenseCount?: unknown;
  secondLicenseEnd?: unknown;
  licenseId?: unknown;
  displayFanmark?: unknown;
  licenseStatus?: unknown;
  licenseEnd?: unknown;
  graceExpiresAt?: unknown;
  isReturned?: unknown;
  basicConfigCount?: unknown;
  redirectConfigCount?: unknown;
  textConfigCount?: unknown;
  passwordConfigCount?: unknown;
  fanmarkName?: unknown;
  accessType?: unknown;
  targetUrl?: unknown;
  textContent?: unknown;
  isPasswordProtected?: unknown;
}

interface PublicProfileProjectionRow {
  licenseId?: unknown;
  displayName?: unknown;
  bio?: unknown;
  socialLinks?: unknown;
  themeSettings?: unknown;
  isPublic?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  profileCount?: unknown;
  secondUpdatedAt?: unknown;
  passwordConfigCount?: unknown;
  passwordEnabled?: unknown;
  licenseEnd?: unknown;
  isReturned?: unknown;
}

function assertD1Rows<T>(value: unknown): T[] {
  const result = value as { success?: unknown; results?: unknown };
  if (result.success === false || !Array.isArray(result.results)) {
    throw new PublicAccessUpstreamError();
  }
  return result.results as T[];
}

function oneOrNone<T>(rows: T[]): T | null {
  if (rows.length > 1) throw new PublicAccessUpstreamError();
  return rows[0] ?? null;
}

function assertUuid(value: unknown): string {
  if (!isUuid(value)) throw new PublicAccessUpstreamError();
  return value.toLowerCase();
}

function assertText(value: unknown): string {
  if (typeof value !== "string") throw new PublicAccessUpstreamError();
  return value;
}

function assertNullableText(value: unknown): string | null {
  if (value !== null && typeof value !== "string") throw new PublicAccessUpstreamError();
  return value as string | null;
}

function assertD1Boolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new PublicAccessUpstreamError();
}

function assertD1Count(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new PublicAccessUpstreamError();
  }
  return value;
}

function assertStatus(value: unknown, expected: string): void {
  if (value !== expected) throw new PublicAccessUpstreamError();
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") throw new PublicAccessUpstreamError();
  try {
    return JSON.parse(value);
  } catch {
    throw new PublicAccessUpstreamError();
  }
}

function parseStringArray(value: unknown): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) throw new PublicAccessUpstreamError();
  return parsed.map((candidate) => assertText(candidate));
}

function parseCodepoints(value: unknown): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.some((candidate) => typeof candidate !== "string")) {
    throw new PublicAccessUpstreamError();
  }
  return parsed as string[];
}

function codepointKey(value: string[]): string {
  return JSON.stringify(value);
}

function buildBaseRow(row: BaseFanmarkRow): {
  id: string;
  shortId: string;
  userInputFanmark: string;
  emojiIds: string[];
} {
  assertStatus(row.status, "active");
  return {
    id: assertUuid(row.id),
    shortId: assertText(row.shortId),
    userInputFanmark: assertText(row.userInputFanmark),
    emojiIds: parseStringArray(row.emojiIds).map((value) => assertUuid(value)),
  };
}

function assertNullableTimestamp(value: unknown): string | null {
  const timestamp = assertNullableText(value);
  if (timestamp !== null && !isCanonicalTimestamp(timestamp)) {
    throw new PublicAccessUpstreamError();
  }
  return timestamp;
}

function assertProfileTimestamp(value: unknown): string {
  const timestamp = assertText(value);
  if (!isCanonicalTimestamp(timestamp)) throw new PublicAccessUpstreamError();
  return timestamp;
}

function isCanonicalTimestamp(value: string): boolean {
  if (!ISO_UTC_MICROSECOND_PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  if (year < 1 || year > 9999) return false;
  const millisecondTimestamp = `${value.slice(0, 19)}.${value.slice(20, 23)}Z`;
  const parsed = new Date(millisecondTimestamp);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === millisecondTimestamp;
}

function assertLicenseSelection(row: PublicAccessProjectionRow, requireSingleLicense: boolean): void {
  const baseCount = assertD1Count(row.baseCount);
  if (baseCount !== 1) throw new PublicAccessUpstreamError();
  const activeLicenseCount = assertD1Count(row.activeLicenseCount);
  const secondLicenseEnd = assertNullableTimestamp(row.secondLicenseEnd);
  const selectedLicenseEnd = assertNullableTimestamp(row.licenseEnd);
  if (requireSingleLicense && activeLicenseCount > 1) {
    throw new PublicAccessUpstreamError();
  }
  if (activeLicenseCount > 1 && secondLicenseEnd === selectedLicenseEnd) {
    throw new PublicAccessUpstreamError();
  }
}

async function allRows<T>(database: D1Database, statement: string, ...bindings: unknown[]): Promise<T[]> {
  try {
    const result = await database.prepare(statement).bind(...bindings).all<T>();
    return assertD1Rows<T>(result);
  } catch (error) {
    if (error instanceof PublicAccessUpstreamError) throw error;
    throw new PublicAccessUpstreamError();
  }
}

async function normalizeEmojiIds(database: D1Database, emojiIds: string[]): Promise<string[] | null> {
  const uniqueIds = [...new Set(emojiIds)];
  const idPlaceholders = uniqueIds.map(() => "?").join(", ");
  const masterRows = await allRows<EmojiMasterRow>(
    database,
    PUBLIC_ACCESS_EMOJI_MASTER_BY_ID_SQL.replace("__ID_PLACEHOLDERS__", idPlaceholders),
    ...uniqueIds,
  );
  const masterById = new Map<string, string[]>();
  for (const row of masterRows) {
    const id = assertUuid(row.id);
    if (masterById.has(id)) throw new PublicAccessUpstreamError();
    masterById.set(id, parseCodepoints(row.codepoints));
  }

  const normalizedCodepointsByInput = emojiIds.map((id) => {
    const codepoints = masterById.get(id);
    if (!codepoints) return null;
    return codepoints.filter((codepoint) => !SKIN_TONE_CODEPOINTS.has(codepoint));
  });
  if (normalizedCodepointsByInput.some((codepoints) => codepoints === null)) return null;

  const uniqueCodepoints = [...new Set(normalizedCodepointsByInput.map((value) => codepointKey(value as string[])))];
  const codepointPlaceholders = uniqueCodepoints.map(() => "?").join(", ");
  const normalizedRows = await allRows<EmojiMasterRow>(
    database,
    PUBLIC_ACCESS_EMOJI_MASTER_BY_CODEPOINTS_SQL.replace("__CODEPOINT_PLACEHOLDERS__", codepointPlaceholders),
    ...uniqueCodepoints,
  );
  const normalizedByCodepoints = new Map<string, string>();
  for (const row of normalizedRows) {
    const key = codepointKey(parseCodepoints(row.codepoints));
    if (normalizedByCodepoints.has(key)) throw new PublicAccessUpstreamError();
    normalizedByCodepoints.set(key, assertUuid(row.id));
  }

  const normalizedIds: string[] = [];
  for (const codepoints of normalizedCodepointsByInput) {
    if (!codepoints) return null;
    const normalizedId = normalizedByCodepoints.get(codepointKey(codepoints));
    if (!normalizedId) return null;
    normalizedIds.push(normalizedId);
  }
  return normalizedIds;
}

function mapProjectionRow(row: PublicAccessProjectionRow, requireSingleLicense = false): PublicAccessRawRow {
  assertLicenseSelection(row, requireSingleLicense);
  const base = buildBaseRow(row);
  const activeLicenseCount = assertD1Count(row.activeLicenseCount);
  const basicConfigCount = assertD1Count(row.basicConfigCount);
  const redirectConfigCount = assertD1Count(row.redirectConfigCount);
  const textConfigCount = assertD1Count(row.textConfigCount);
  const passwordConfigCount = assertD1Count(row.passwordConfigCount);
  if (basicConfigCount > 1 || redirectConfigCount > 1 || textConfigCount > 1 || passwordConfigCount > 1) {
    throw new PublicAccessUpstreamError();
  }

  const licenseId = row.licenseId === null ? null : assertUuid(row.licenseId);
  const isPasswordProtected = assertD1Boolean(row.isPasswordProtected);
  const targetUrl = assertNullableText(row.targetUrl);
  const textContent = assertNullableText(row.textContent);
  const fanmarkName = assertNullableText(row.fanmarkName);
  const accessType = assertText(row.accessType);
  const licenseStatus = row.licenseStatus === null ? null : row.licenseStatus;
  const licenseEnd = assertNullableTimestamp(row.licenseEnd);
  const graceExpiresAt = assertNullableTimestamp(row.graceExpiresAt);
  const isReturned = row.isReturned === null ? null : assertD1Boolean(row.isReturned);

  if (licenseId === null) {
    if (activeLicenseCount !== 0 || isPasswordProtected || targetUrl !== null || textContent !== null) {
      throw new PublicAccessUpstreamError();
    }
    return {
      id: base.id,
      shortId: base.shortId,
      userInputFanmark: base.userInputFanmark,
      displayFanmark: null,
      emojiIds: base.emojiIds,
      fanmarkName: fanmarkName ?? base.userInputFanmark,
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

  if (activeLicenseCount < 1 || licenseStatus !== "active") throw new PublicAccessUpstreamError();
  return {
    id: base.id,
    shortId: base.shortId,
    userInputFanmark: base.userInputFanmark,
    displayFanmark: row.displayFanmark === null ? null : assertText(row.displayFanmark),
    emojiIds: base.emojiIds,
    fanmarkName,
    accessType,
    targetUrl,
    textContent,
    status: "active",
    isPasswordProtected,
    licenseId,
    licenseStatus: "active",
    licenseEnd,
    graceExpiresAt,
    isReturned,
  };
}

function mapProfileProjectionRow(row: PublicProfileProjectionRow): PublicProfileRawRow | null {
  const passwordConfigCount = assertD1Count(row.passwordConfigCount);
  if (passwordConfigCount > 1) throw new PublicAccessUpstreamError();
  const passwordEnabled = assertD1Boolean(row.passwordEnabled);
  const isPublic = assertD1Boolean(row.isPublic);
  const profileCount = assertD1Count(row.profileCount);
  const secondUpdatedAt = assertNullableTimestamp(row.secondUpdatedAt);
  const updatedAt = assertProfileTimestamp(row.updatedAt);
  if (profileCount > 1) throw new PublicAccessUpstreamError();
  if (!isPublic || passwordEnabled) return null;
  assertNullableTimestamp(row.licenseEnd);
  if (row.isReturned !== 0 && row.isReturned !== false) throw new PublicAccessUpstreamError();
  return {
    licenseId: assertUuid(row.licenseId),
    displayName: row.displayName === null ? null : assertText(row.displayName),
    bio: row.bio === null ? null : assertText(row.bio),
    socialLinks: row.socialLinks === null ? null : parseJson(row.socialLinks),
    themeSettings: row.themeSettings === null ? null : parseJson(row.themeSettings),
    createdAt: assertProfileTimestamp(row.createdAt),
    updatedAt,
  };
}

export function createD1PublicAccessRepository(
  env: Env,
  _clock: () => Date = () => new Date(),
): PublicAccessRepository {
  const database = env.FANMARK_DB;
  if (!database) throw new PublicAccessConfigurationError();

  return {
    async getByShortId(shortId) {
      try {
        const rows = await allRows<PublicAccessProjectionRow>(database, PUBLIC_ACCESS_BY_SHORT_SQL, shortId);
        const row = oneOrNone(rows);
        return row ? mapProjectionRow(row) : null;
      } catch (error) {
        if (error instanceof PublicAccessUpstreamError) throw error;
        throw new PublicAccessUpstreamError();
      }
    },

    async getByEmojiIds(emojiIds, now) {
      try {
        const normalizedIds = await normalizeEmojiIds(database, emojiIds);
        if (!normalizedIds) return null;
        const rows = await allRows<PublicAccessProjectionRow>(
          database,
          PUBLIC_ACCESS_BY_EMOJI_SQL,
          JSON.stringify(normalizedIds),
          formatPublicAccessNow(now),
        );
        const row = oneOrNone(rows);
        return row ? mapProjectionRow(row, true) : null;
      } catch (error) {
        if (error instanceof PublicAccessUpstreamError) throw error;
        throw new PublicAccessUpstreamError();
      }
    },

    async getPublicProfile(licenseId, now) {
      try {
        const rows = await allRows<PublicProfileProjectionRow>(
          database,
          PUBLIC_PROFILE_SQL,
          licenseId,
          licenseId,
          formatPublicAccessNow(now),
        );
        const row = oneOrNone(rows);
        return row ? mapProfileProjectionRow(row) : null;
      } catch (error) {
        if (error instanceof PublicAccessUpstreamError) throw error;
        throw new PublicAccessUpstreamError();
      }
    },
  };
}
