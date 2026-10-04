const AUTH_ROW_TABLES = Object.freeze([
  "user",
  "session",
  "account",
  "verification",
  "twoFactor",
  "adminRole",
  "mfaAssurance",
]);

const AUTH_SCHEMA_TABLES = Object.freeze([...AUTH_ROW_TABLES, "mfaGeneration"]);

const ACTIVE_COLUMNS = Object.freeze([
  "singleton_id",
  "release_version",
  "previous_release_version",
  "activation_id",
  "action",
  "generation",
  "updated_at",
]);

const ACTIVATION_COLUMNS = Object.freeze([
  "activation_id",
  "generation",
  "action",
  "from_version",
  "to_version",
  "created_at",
]);

function fail(code) {
  throw new Error(code);
}

async function readRows(database, sql, bindings = []) {
  let statement = database.prepare(sql);
  if (bindings.length) statement = statement.bind(...bindings);
  const result = await statement.all();
  if (!result || result.success !== true || !Array.isArray(result.results)) fail("d1_read_failed");
  return result.results;
}

function copyAndValidateRows(rows, columns) {
  return rows.map((row) => {
    if (!row || typeof row !== "object" || columns.some((column) => !(column in row))) {
      fail("emoji_release_state_invalid");
    }
    return Object.fromEntries(columns.map((column) => [column, row[column]]));
  });
}

export async function assertAuthSchemaEmpty(database) {
  const placeholders = AUTH_SCHEMA_TABLES.map(() => "?").join(", ");
  const tableRows = await readRows(
    database,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders}) ORDER BY name`,
    AUTH_SCHEMA_TABLES,
  );
  const foundTables = new Set(tableRows.map((row) => row.name));
  if (AUTH_SCHEMA_TABLES.some((table) => !foundTables.has(table))) fail("auth_schema_incomplete");

  const countExpressions = AUTH_ROW_TABLES.map((table) =>
    `(SELECT count(*) FROM "${table}") AS "${table}"`,
  ).join(", ");
  const countRows = await readRows(database, `SELECT ${countExpressions}`);
  if (countRows.length !== 1 || AUTH_ROW_TABLES.some((table) => countRows[0][table] !== 0)) {
    fail("auth_rows_present");
  }

  const generationRows = await readRows(database, 'SELECT id, generation FROM "mfaGeneration" ORDER BY id');
  if (generationRows.length !== 1 || generationRows[0].id !== 1 || generationRows[0].generation !== 0) {
    fail("auth_generation_not_empty");
  }
  return AUTH_SCHEMA_TABLES.length;
}

export async function captureEmojiReleaseState(database) {
  const activeRows = await readRows(
    database,
    "SELECT singleton_id, release_version, previous_release_version, activation_id, action, generation, updated_at " +
      "FROM fanmark_emoji_master_active_release ORDER BY singleton_id",
  );
  const activationRows = await readRows(
    database,
    "SELECT activation_id, generation, action, from_version, to_version, created_at " +
      "FROM fanmark_emoji_master_release_activations ORDER BY generation",
  );
  return {
    activeRows: copyAndValidateRows(activeRows, ACTIVE_COLUMNS),
    activationRows: copyAndValidateRows(activationRows, ACTIVATION_COLUMNS),
  };
}

export async function assertEmojiReleaseStateUnchanged(database, before) {
  const after = await captureEmojiReleaseState(database);
  if (JSON.stringify(after) !== JSON.stringify(before)) fail("emoji_release_state_changed");
  return after;
}
