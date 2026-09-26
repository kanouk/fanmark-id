import {
  RecentFanmarksConfigurationError,
  RecentFanmarksUpstreamError,
  type Env,
  type RecentFanmarkRpcRow,
  type RecentFanmarksRepository,
} from "./repository";

export const D1_RECENT_FANMARKS_SQL = `
  SELECT
    fl.id AS license_id,
    fl.fanmark_id AS fanmark_id,
    f.short_id AS fanmark_short_id,
    fl.display_fanmark AS display_emoji,
    fl.created_at AS license_created_at
  FROM fanmark_licenses AS fl
  JOIN fanmarks AS f ON f.id = fl.fanmark_id
  WHERE fl.status = 'active'
  ORDER BY fl.created_at DESC
  LIMIT ?
`;

const MIN_RECENT_LIMIT = 1;
const MAX_RECENT_LIMIT = 20;

function isRecentLimit(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_RECENT_LIMIT && value <= MAX_RECENT_LIMIT;
}

export function createD1RecentFanmarksRepository(env: Env): RecentFanmarksRepository {
  const database = env.FANMARK_DB;
  if (!database) throw new RecentFanmarksConfigurationError();

  return {
    async listRecent(limit) {
      if (!isRecentLimit(limit)) throw new RecentFanmarksConfigurationError();

      try {
        const result = await database
          .prepare(D1_RECENT_FANMARKS_SQL)
          .bind(limit)
          .all<RecentFanmarkRpcRow>();
        const runtimeSuccess = (result as unknown as { success?: unknown }).success;
        if (runtimeSuccess === false || !Array.isArray(result.results)) {
          throw new RecentFanmarksUpstreamError();
        }
        return result.results;
      } catch (error) {
        if (
          error instanceof RecentFanmarksConfigurationError ||
          error instanceof RecentFanmarksUpstreamError
        ) {
          throw error;
        }
        // Do not expose SQLite/D1 details through the public Worker response.
        throw new RecentFanmarksUpstreamError();
      }
    },
  };
}
