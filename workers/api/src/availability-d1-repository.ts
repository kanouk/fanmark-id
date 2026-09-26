import {
  AvailabilityConfigurationError,
  AvailabilityUpstreamError,
  formatAvailabilityNow,
  isUuid,
  sanitizeAvailabilityResult,
  type AvailabilityClock,
  type AvailabilityRepository,
  type AvailabilityResult,
} from "./availability";
import { selectD1Database, type Env } from "./repository";

const MAX_IDS = 5;
const SKIN_TONE_MODIFIERS = /[\u{1f3fb}-\u{1f3ff}]/gu;

interface EmojiMasterRow {
  id?: unknown;
  emoji?: unknown;
}

interface ActiveEmojiReleaseRow {
  release_version?: unknown;
  row_count?: unknown;
  status?: unknown;
}

interface FanmarkRow {
  id?: unknown;
}

interface TierRow {
  tier_level?: unknown;
  display_name?: unknown;
  initial_license_days?: unknown;
  price_cents?: unknown;
}

interface BlockingLicenseRow {
  status?: unknown;
  blocking_until?: unknown;
}

function assertSuccessfulD1Rows<T>(result: unknown): T[] {
  const runtimeResult = result as { success?: unknown; results?: unknown };
  if (runtimeResult.success !== true || !Array.isArray(runtimeResult.results)) {
    throw new AvailabilityUpstreamError();
  }
  return runtimeResult.results as T[];
}

function assertUuid(value: unknown): string {
  if (!isUuid(value)) throw new AvailabilityUpstreamError();
  return value;
}

function assertText(value: unknown): string {
  if (typeof value !== "string") throw new AvailabilityUpstreamError();
  return value;
}

function assertInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new AvailabilityUpstreamError();
  }
  return value;
}

function assertNullableInteger(value: unknown): number | null {
  if (value !== null && (typeof value !== "number" || !Number.isInteger(value))) {
    throw new AvailabilityUpstreamError();
  }
  return value as number | null;
}

function assertMoneyCents(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < -9_999_999_999 ||
    value > 9_999_999_999
  ) {
    throw new AvailabilityUpstreamError();
  }
  return value / 100;
}

function assertStringOrNull(value: unknown): string | null {
  if (value !== null && typeof value !== "string") throw new AvailabilityUpstreamError();
  return value as string | null;
}

function isValidIdList(emojiIds: string[]): boolean {
  return (
    emojiIds.length >= 1 &&
    emojiIds.length <= MAX_IDS &&
    emojiIds.every((emojiId) => isUuid(emojiId))
  );
}

export const AVAILABILITY_ACTIVE_RELEASE_SQL = `
  SELECT i.release_version, i.row_count, i.status
  FROM fanmark_emoji_master_active_release AS a
  JOIN fanmark_emoji_master_release_imports AS i
    ON i.release_version = a.release_version
  WHERE a.singleton_id = 1
`;
export const AVAILABILITY_MASTER_SQL =
  "SELECT id, emoji FROM fanmark_emoji_master_release_staging WHERE release_version = ? AND id IN (__ID_PLACEHOLDERS__)";
export const AVAILABILITY_FANMARK_SQL =
  "SELECT id FROM fanmarks WHERE normalized_emoji = ? LIMIT 1";
export const AVAILABILITY_TIER_SQL =
  "SELECT tier_level, display_name, initial_license_days, monthly_price_usd AS price_cents FROM fanmark_tiers WHERE tier_level = ? AND is_active = 1 LIMIT 1";
export const AVAILABILITY_BLOCKING_LICENSE_SQL = `
  SELECT
    status,
    CASE
      WHEN status = 'grace' THEN COALESCE(grace_expires_at, license_end)
      ELSE license_end
    END AS blocking_until
  FROM fanmark_licenses
  WHERE fanmark_id = ?
    AND (
      (status = 'active' AND (license_end IS NULL OR license_end > ?))
      OR (status = 'grace' AND COALESCE(grace_expires_at, license_end) > ?)
    )
  ORDER BY (blocking_until IS NULL) ASC, blocking_until ASC
  LIMIT 1
`;

function classifyTier(emojiIds: string[]): number {
  const count = emojiIds.length;
  const uniqueCount = new Set(emojiIds).size;
  if (count === 1) return 4;
  if (uniqueCount === 1 && count >= 2 && count <= 5) return 3;
  if (count >= 4) return 1;
  if (count === 3) return 2;
  if (count === 2) return 3;
  return 1;
}

export function createD1AvailabilityRepository(
  env: Env,
  clock: AvailabilityClock = () => new Date(),
): AvailabilityRepository {
  const database = selectD1Database(env, "business");
  const masterDatabase = selectD1Database(env, "master");
  if (!database || !masterDatabase) throw new AvailabilityConfigurationError();

  return {
    async checkAvailability(emojiIds) {
      if (!isValidIdList(emojiIds)) throw new AvailabilityConfigurationError();
      const normalizedIds = emojiIds.map((emojiId) => emojiId.toLowerCase());

      try {
        const activeRelease = await masterDatabase
          .prepare(AVAILABILITY_ACTIVE_RELEASE_SQL)
          .first<ActiveEmojiReleaseRow>();
        if (
          !activeRelease ||
          typeof activeRelease.release_version !== "string" ||
          !/^[0-9a-f]{64}$/u.test(activeRelease.release_version) ||
          activeRelease.status !== "ready" ||
          typeof activeRelease.row_count !== "number" ||
          !Number.isSafeInteger(activeRelease.row_count) ||
          activeRelease.row_count < 1 ||
          activeRelease.row_count > 10_000
        ) {
          throw new AvailabilityUpstreamError();
        }

        const placeholders = normalizedIds.map(() => "?").join(", ");
        const masterResult = await masterDatabase
          .prepare(AVAILABILITY_MASTER_SQL.replace("__ID_PLACEHOLDERS__", placeholders))
          .bind(activeRelease.release_version, ...normalizedIds)
          .all<EmojiMasterRow>();
        const masterRows = assertSuccessfulD1Rows<EmojiMasterRow>(masterResult);
        const masterById = new Map<string, string>();
        for (const row of masterRows) {
          const id = assertUuid(row.id).toLowerCase();
          if (masterById.has(id)) throw new AvailabilityUpstreamError();
          masterById.set(id, assertText(row.emoji));
        }

        const resolvedEmojis = normalizedIds.map((emojiId) => masterById.get(emojiId));
        if (
          resolvedEmojis.some((emoji) => emoji === undefined || emoji.length === 0)
        ) {
          return { available: false, reason: "invalid_emoji_ids" };
        }

        const normalizedInput = resolvedEmojis.join("").replace(SKIN_TONE_MODIFIERS, "");
        if (normalizedInput.length === 0) {
          return { available: false, reason: "invalid_emoji_ids" };
        }

        const fanmark = await database
          .prepare(AVAILABILITY_FANMARK_SQL)
          .bind(normalizedInput)
          .first<FanmarkRow>();

        if (!fanmark) {
          const tierResult = await masterDatabase
            .prepare(AVAILABILITY_TIER_SQL)
            .bind(classifyTier(normalizedIds))
            .first<TierRow>();

          if (!tierResult) return { available: false, reason: "invalid_length" };
          const tier = sanitizeAvailabilityResult({
            available: true,
            tier_level: assertInteger(tierResult.tier_level),
            tier_display_name: assertText(tierResult.display_name),
            price: assertMoneyCents(tierResult.price_cents),
            license_days: assertNullableInteger(tierResult.initial_license_days),
          });
          return tier;
        }

        const fanmarkId = assertUuid(fanmark.id);
        const now = formatAvailabilityNow(clock());
        const blockingLicense = await database
          .prepare(AVAILABILITY_BLOCKING_LICENSE_SQL)
          .bind(fanmarkId, now, now)
          .first<BlockingLicenseRow>();

        if (!blockingLicense) {
          return sanitizeAvailabilityResult({
            available: true,
            fanmark_id: fanmarkId,
            reason: null,
            available_at: null,
            blocking_status: null,
          });
        }

        const status = assertText(blockingLicense.status);
        if (status !== "active" && status !== "grace") {
          throw new AvailabilityUpstreamError();
        }
        const blockingUntil = assertStringOrNull(blockingLicense.blocking_until);
        return sanitizeAvailabilityResult({
          available: false,
          fanmark_id: fanmarkId,
          reason: status === "grace" ? "grace_period" : "taken",
          available_at: status === "grace" ? blockingUntil : null,
          blocking_status: status,
        });
      } catch (error) {
        if (
          error instanceof AvailabilityConfigurationError ||
          error instanceof AvailabilityUpstreamError
        ) {
          throw error;
        }
        throw new AvailabilityUpstreamError();
      }
    },
  };
}
