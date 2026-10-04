import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAuthSchemaEmpty,
  assertEmojiReleaseStateUnchanged,
  captureEmojiReleaseState,
} from "./emoji-master-release-remote-guards.mjs";

const AUTH_TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "twoFactor",
  "adminRole",
  "mfaAssurance",
  "mfaGeneration",
];

const ZERO_COUNTS = Object.fromEntries(AUTH_TABLES.slice(0, -1).map((table) => [table, 0]));

function makeDatabase({
  tables = AUTH_TABLES,
  authCounts = ZERO_COUNTS,
  generationRows = [{ id: 1, generation: 0 }],
  activeRows = [],
  activationRows = [],
} = {}) {
  const state = { tables, authCounts, generationRows, activeRows, activationRows };
  return {
    state,
    prepare(sql) {
      const statement = {
        bind(...bindings) {
          this.bindings = bindings;
          return this;
        },
        async all() {
          if (sql.includes("sqlite_master")) {
            return { success: true, results: state.tables.filter((table) => this.bindings.includes(table)).map((name) => ({ name })) };
          }
          if (sql.startsWith("SELECT (SELECT count(*)")) return { success: true, results: [state.authCounts] };
          if (sql.includes('FROM "mfaGeneration"')) return { success: true, results: state.generationRows };
          if (sql.includes("FROM fanmark_emoji_master_active_release")) return { success: true, results: state.activeRows };
          if (sql.includes("FROM fanmark_emoji_master_release_activations")) return { success: true, results: state.activationRows };
          throw new Error("unexpected_query");
        },
      };
      return statement;
    },
  };
}

test("accepts the applied, empty Better Auth schema with its generation singleton", async () => {
  assert.equal(await assertAuthSchemaEmpty(makeDatabase()), 8);
});

test("rejects missing auth tables and any user-owned auth rows", async () => {
  await assert.rejects(() => assertAuthSchemaEmpty(makeDatabase({ tables: AUTH_TABLES.slice(1) })), {
    message: "auth_schema_incomplete",
  });

  for (const table_name of AUTH_TABLES.slice(0, -1)) {
    const authCounts = { ...ZERO_COUNTS, [table_name]: 1 };
    await assert.rejects(() => assertAuthSchemaEmpty(makeDatabase({ authCounts })), {
      message: "auth_rows_present",
    });
  }
});

test("rejects a changed MFA generation and captures populated release state", async () => {
  await assert.rejects(() => assertAuthSchemaEmpty(makeDatabase({
    generationRows: [{ id: 1, generation: 1 }],
  })), { message: "auth_generation_not_empty" });

  const database = makeDatabase({
    activeRows: [{
      singleton_id: 1,
      release_version: "a".repeat(64),
      previous_release_version: null,
      activation_id: "activation-1",
      action: "promotion",
      generation: 1,
      updated_at: "2026-09-23 00:00:00",
    }],
    activationRows: [{
      activation_id: "activation-1",
      generation: 1,
      action: "promotion",
      from_version: null,
      to_version: "a".repeat(64),
      created_at: "2026-09-23 00:00:00",
    }],
  });
  const before = await captureEmojiReleaseState(database);
  assert.equal((await assertEmojiReleaseStateUnchanged(database, before)).activeRows.length, 1);

  database.state.activationRows[0].to_version = "b".repeat(64);
  await assert.rejects(() => assertEmojiReleaseStateUnchanged(database, before), {
    message: "emoji_release_state_changed",
  });
});
