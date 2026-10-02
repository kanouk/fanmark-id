const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const RESET_TABLES = Object.freeze([
  "fanmark_basic_configs", "fanmark_redirect_configs", "fanmark_messageboard_configs",
  "fanmark_password_configs", "fanmark_profiles", "fanmark_favorites", "fanmark_licenses", "fanmarks",
]);

export function buildResetCanaryDeleteGuards(runId, fixtureIds) {
  if (typeof runId !== "string" || !UUID.test(runId) || !fixtureIds ||
    Object.keys(fixtureIds).length !== RESET_TABLES.length ||
    RESET_TABLES.some(table => typeof fixtureIds[table] !== "string" || !UUID.test(fixtureIds[table]))) {
    throw new Error("admin_reset_canary_scope_invalid");
  }
  const prefix = `canary_admin_reset_${runId.toLowerCase().replaceAll("-", "")}_`;
  const triggerNames = RESET_TABLES.map(table => `${prefix}${table}`);
  return {
    triggerNames,
    createSql: RESET_TABLES.map((table, index) => `CREATE TRIGGER ${triggerNames[index]}
      BEFORE DELETE ON ${table} WHEN OLD.id <> '${fixtureIds[table].toLowerCase()}'
      BEGIN SELECT RAISE(ABORT, 'admin_reset_canary_row_scope_violation'); END;`).join("\n"),
    dropSql: triggerNames.map(name => `DROP TRIGGER IF EXISTS ${name};`).join("\n"),
  };
}

export function assertResetCanaryEmptyCounts(counts) {
  if (!counts || Object.keys(counts).length !== RESET_TABLES.length ||
    RESET_TABLES.some(table => counts[table] !== 0)) throw new Error("admin_reset_canary_target_not_empty");
}
