// Keep the source upsert/favorite/event effects in one Business D1 transaction.
// Snapshot values stay in SQLite JSON/text, including signed 64-bit counters.
const DISCOVERY = `json_object('id', id, 'emoji_ids', emoji_ids,
  'normalized_emoji_ids', normalized_emoji_ids, 'fanmark_id', fanmark_id,
  'availability_status', availability_status, 'first_seen_at', first_seen_at,
  'last_seen_at', last_seen_at, 'search_count', search_count, 'favorite_count', favorite_count)`;
const FAVORITE = `json_object('id', id, 'user_id', user_id, 'discovery_id', discovery_id,
  'fanmark_id', fanmark_id, 'normalized_emoji_ids', normalized_emoji_ids,
  'created_at', created_at, 'display_fanmark', display_fanmark)`;
const STATE = `SELECT
  (SELECT ${DISCOVERY} FROM fanmark_discoveries WHERE normalized_emoji_ids = ?) AS discovery,
  (SELECT ${FAVORITE} FROM fanmark_favorites WHERE user_id IS ? AND normalized_emoji_ids = ?) AS favorite`;

interface State {
  discovery: string | null;
  favorite: string | null;
}
type BindValue = string | number | null;
interface Expression { sql: string; bindings: BindValue[] }

async function attemptDiscoveryMutation(
  database: D1Database,
  input: {
    operation: "search" | "favorite_add" | "favorite_remove";
    userId: string | null;
    rawIds: string[];
    normalizedIds: string[];
    displayFanmark: string | null;
    now: string;
  },
  attemptsRemaining: number,
): Promise<boolean> {
  const { operation, userId, displayFanmark, now } = input;
  if ((operation === "search") !== (userId === null)) throw new Error("discovery_actor_invalid");
  const raw = JSON.stringify(input.rawIds), key = JSON.stringify(input.normalizedIds);
  const stateBindings = [key, userId, key];
  const previous = await database.prepare(STATE).bind(...stateBindings).first<State>();
  if (!previous) {
    throw new Error("discovery_state_unavailable");
  }
  const discoveryId: string = previous.discovery === null
    ? crypto.randomUUID() : JSON.parse(previous.discovery).id;
  const favoriteId = crypto.randomUUID();
  const changed = operation === "search" || (operation === "favorite_add" ? previous.favorite === null : previous.favorite !== null);
  const delta = changed ? 1 : 0;
  if (operation === "favorite_remove" && changed && previous.discovery === null) throw new Error("favorite_discovery_missing");

  function assertion(discovery: Expression, favorite: Expression): D1PreparedStatement {
    return database.prepare(`WITH expected AS
      (SELECT ${discovery.sql} AS discovery, ${favorite.sql} AS favorite), state AS (${STATE})
      SELECT CASE WHEN state.discovery IS expected.discovery AND state.favorite IS expected.favorite
        THEN 1 ELSE json('discovery_mutation_invariant_failed') END AS verified
      FROM expected, state`).bind(...discovery.bindings, ...favorite.bindings, ...stateBindings);
  }
  const originalDiscovery = { sql: "?", bindings: [previous.discovery] };
  const originalFavorite = { sql: "?", bindings: [previous.favorite] };
  const statements = [assertion(originalDiscovery, originalFavorite)];
  let expectedDiscovery: Expression = originalDiscovery;
  let expectedFavorite: Expression = originalFavorite;

  if (operation !== "favorite_remove") {
    const searchDelta = operation === "search" ? 1 : 0;
    statements.push(database.prepare(`INSERT INTO fanmark_discoveries
      (id, emoji_ids, normalized_emoji_ids, availability_status, first_seen_at, last_seen_at, search_count, favorite_count)
      VALUES (?, ?, ?, 'unknown', ?, ?, CAST(? AS INTEGER), 0)
      ON CONFLICT(normalized_emoji_ids) DO UPDATE SET emoji_ids = excluded.emoji_ids,
        last_seen_at = excluded.last_seen_at, search_count = fanmark_discoveries.search_count + CAST(? AS INTEGER)`)
      .bind(discoveryId, raw, key, now, now, searchDelta, searchDelta));
    expectedDiscovery = previous.discovery === null ? {
      sql: `json_object('id', ?, 'emoji_ids', ?, 'normalized_emoji_ids', ?, 'fanmark_id', NULL,
        'availability_status', 'unknown', 'first_seen_at', ?, 'last_seen_at', ?, 'search_count', CAST(? AS INTEGER), 'favorite_count', CAST(? AS INTEGER))`,
      bindings: [discoveryId, raw, key, now, now, searchDelta, operation === "favorite_add" ? delta : 0],
    } : {
      sql: `json_set(?, '$.emoji_ids', ?, '$.last_seen_at', ?,
        '$.search_count', json_extract(?, '$.search_count') + CAST(? AS INTEGER),
        '$.favorite_count', json_extract(?, '$.favorite_count') + CAST(? AS INTEGER))`,
      bindings: [previous.discovery, raw, now, previous.discovery, searchDelta,
        previous.discovery, operation === "favorite_add" ? delta : 0],
    };
  }
  if (operation === "favorite_add" && changed) {
    statements.push(database.prepare(`INSERT INTO fanmark_favorites
      (id, user_id, discovery_id, fanmark_id, normalized_emoji_ids, created_at, display_fanmark)
      SELECT ?, ?, d.id, d.fanmark_id, ?, ?, ? FROM fanmark_discoveries d
      WHERE d.id = ? AND d.normalized_emoji_ids = ?`)
      .bind(favoriteId, userId, key, now, displayFanmark, discoveryId, key));
    expectedFavorite = {
      sql: `json_object('id', ?, 'user_id', ?, 'discovery_id', ?, 'fanmark_id', json_extract(?, '$.fanmark_id'),
        'normalized_emoji_ids', ?, 'created_at', ?, 'display_fanmark', ?)`,
      bindings: [favoriteId, userId, discoveryId, previous.discovery, key, now, displayFanmark],
    };
  } else if (operation === "favorite_remove" && changed) {
    statements.push(database.prepare("DELETE FROM fanmark_favorites WHERE user_id = ? AND normalized_emoji_ids = ?")
      .bind(userId, key));
    expectedFavorite = { sql: "NULL", bindings: [] };
    expectedDiscovery = {
      sql: "json_set(?, '$.favorite_count', MAX(json_extract(?, '$.favorite_count') - 1, 0))",
      bindings: [previous.discovery, previous.discovery],
    };
  }
  if (changed) {
    statements.push(database.prepare(`INSERT INTO fanmark_events
      (event_type, user_id, discovery_id, normalized_emoji_ids, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(operation, userId, discoveryId, key, now));
    // last_insert_rowid() is the outer INSERT's receipt even when its trigger
    // inserts another row. Check the row before the transaction commits.
    statements.push(database.prepare(`SELECT CASE WHEN changes() = 1 AND EXISTS
      (SELECT 1 FROM fanmark_events WHERE id = last_insert_rowid() AND event_type = ?
        AND user_id IS ? AND discovery_id = ? AND normalized_emoji_ids = ? AND created_at = ?)
      AND (SELECT count(*) FROM fanmark_events WHERE id >= last_insert_rowid() AND normalized_emoji_ids = ?) = 1
      THEN 1 ELSE json('discovery_event_required') END AS verified`)
      .bind(operation, userId, discoveryId, key, now, key));
    if (operation !== "search") {
      statements.push(database.prepare(`UPDATE fanmark_discoveries SET favorite_count =
        ${operation === "favorite_add" ? "favorite_count + 1" : "MAX(favorite_count - 1, 0)"}
        WHERE id = ? AND normalized_emoji_ids = ?`).bind(discoveryId, key));
    }
  }
  statements.push(assertion(expectedDiscovery, expectedFavorite));
  if (changed) {
    statements.push(database.prepare(`SELECT CASE WHEN EXISTS
      (SELECT 1 FROM fanmark_events WHERE id = last_insert_rowid() AND event_type = ?
        AND user_id IS ? AND discovery_id = ? AND normalized_emoji_ids = ? AND created_at = ?)
      AND (SELECT count(*) FROM fanmark_events WHERE id >= last_insert_rowid() AND normalized_emoji_ids = ?) = 1
      THEN 1 ELSE json('discovery_event_required') END AS verified`)
      .bind(operation, userId, discoveryId, key, now, key));
  }
  let result: D1Result[];
  try {
    result = await database.batch(statements);
  } catch (error) {
    // Retry only a confirmed SQLite statement failure (the batch rolled back)
    // when this identity changed since preflight. Never retry an unknown ACK.
    if (attemptsRemaining > 0 && error instanceof Error && error.message.includes("SQLITE_ERROR")) {
      const current = await database.prepare(STATE).bind(...stateBindings).first<State>();
      if (current && (current.discovery !== previous.discovery || current.favorite !== previous.favorite)) {
        return attemptDiscoveryMutation(database, input, attemptsRemaining - 1);
      }
    }
    throw error;
  }
  if (result.some(row => row.success !== true)) throw new Error("discovery_batch_failed");
  return changed;
}

export async function mutateDiscovery(
  database: D1Database,
  input: Parameters<typeof attemptDiscoveryMutation>[1],
): Promise<boolean> {
  return attemptDiscoveryMutation(database, input, 2);
}
