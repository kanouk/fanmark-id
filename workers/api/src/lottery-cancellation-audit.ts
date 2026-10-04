/** Pending rows and their intended audits are checked within the mutation batch.
 * A changed pre-read snapshot or a suppressed/altered audit aborts all effects.
 * Only server-selected scope columns and server-generated audit UUIDs enter SQL.
 */
export async function prepareLotteryCancellation(
  database: D1Database,
  scope: "license" | "user",
  scopeId: string,
  reason: "system" | "user_request",
  nowIso: string,
): Promise<{ before: D1PreparedStatement; insert: D1PreparedStatement; update: D1PreparedStatement; verify: D1PreparedStatement }> {
  const column = scope === "license" ? "license_id" : "user_id";
  const rows = await database.prepare(`
    SELECT id, user_id, fanmark_id, license_id, lottery_probability, applied_at, created_at, updated_at
    FROM fanmark_lottery_entries WHERE ${column} = ? AND entry_status = 'pending' ORDER BY id
  `).bind(scopeId).all<Record<string, unknown>>();
  if (!rows.success) throw new Error("lottery_cancellation_snapshot_unavailable");
  const snapshot = JSON.stringify(rows.results.map(row => ({ ...row, audit_id: crypto.randomUUID() })));
  const identity = `entry.id = json_extract(item.value, '$.id')
    AND entry.user_id = json_extract(item.value, '$.user_id')
    AND entry.fanmark_id = json_extract(item.value, '$.fanmark_id')
    AND entry.license_id = json_extract(item.value, '$.license_id')
    AND entry.lottery_probability = json_extract(item.value, '$.lottery_probability')
    AND entry.applied_at = json_extract(item.value, '$.applied_at')
    AND entry.created_at = json_extract(item.value, '$.created_at')`;
  return {
    before: database.prepare(`SELECT CASE WHEN
      (SELECT count(*) FROM fanmark_lottery_entries WHERE ${column} = ? AND entry_status = 'pending') = json_array_length(?)
      AND NOT EXISTS (SELECT 1 FROM json_each(?) AS item WHERE NOT EXISTS (
        SELECT 1 FROM fanmark_lottery_entries AS entry WHERE ${identity}
          AND entry.entry_status = 'pending' AND entry.updated_at = json_extract(item.value, '$.updated_at')
      )) THEN 1 ELSE json('lottery_cancellation_snapshot_changed') END AS verified`
    ).bind(scopeId, snapshot, snapshot),
    insert: database.prepare(`
      INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, metadata, created_at)
      SELECT json_extract(item.value, '$.audit_id'), entry.user_id, 'LOTTERY_ENTRY_STATUS_CHANGED',
        'fanmark_lottery_entry', entry.id,
        json_object('old_status', 'pending', 'new_status', 'cancelled', 'cancellation_reason', ?), ?
      FROM json_each(?) AS item JOIN fanmark_lottery_entries AS entry ON ${identity}
      WHERE entry.entry_status = 'pending'
    `).bind(reason, nowIso, snapshot),
    update: database.prepare(`UPDATE fanmark_lottery_entries
      SET entry_status = 'cancelled', cancelled_at = ?, cancellation_reason = ?, updated_at = ?
      WHERE ${column} = ? AND entry_status = 'pending'
        AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`
    ).bind(nowIso, reason, nowIso, scopeId, snapshot),
    verify: database.prepare(`SELECT CASE WHEN
      NOT EXISTS (SELECT 1 FROM fanmark_lottery_entries WHERE ${column} = ? AND entry_status = 'pending')
      AND NOT EXISTS (SELECT 1 FROM json_each(?) AS item WHERE NOT EXISTS (
        SELECT 1 FROM fanmark_lottery_entries AS entry JOIN audit_logs AS audit
          ON audit.id = json_extract(item.value, '$.audit_id')
        WHERE ${identity} AND entry.entry_status = 'cancelled' AND entry.cancelled_at = ?
          AND entry.cancellation_reason = ? AND entry.updated_at = ?
          AND audit.user_id = entry.user_id AND audit.action = 'LOTTERY_ENTRY_STATUS_CHANGED'
          AND audit.resource_type = 'fanmark_lottery_entry' AND audit.resource_id = entry.id
          AND audit.request_id IS NULL AND audit.created_at = ?
          AND json(audit.metadata) = json_object('old_status', 'pending', 'new_status', 'cancelled', 'cancellation_reason', ?)
      )) THEN 1 ELSE json('lottery_cancellation_audit_invariant_failed') END AS verified`
    ).bind(scopeId, snapshot, nowIso, reason, nowIso, nowIso, reason),
  };
}
