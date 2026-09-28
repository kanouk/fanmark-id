import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationDirectory = fileURLToPath(new URL("../../workers/api/migrations/", import.meta.url));
const expectedAuthMigrations = [
  "0003_better_auth_core.sql",
  "0007_auth_signup_command.sql",
  "0008_auth_user_suspension.sql",
].sort();
const authMigrationPattern = `migrations/{${expectedAuthMigrations.join(",")}}`;
const availableMigrations = new Set(readdirSync(migrationDirectory));

function readConfig(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function selectedAuthMigrationNames(config) {
  const binding = config.d1_databases?.find((database) => database.binding === "AUTH_DB");
  assert.ok(binding, "staging config must define AUTH_DB");
  assert.equal(binding.migrations_dir, "migrations");
  assert.equal(binding.remote, true);
  assert.equal(binding.migrations_pattern, authMigrationPattern);

  const match = binding.migrations_pattern.match(/^migrations\/\{([^{}]+)\}$/u);
  assert.ok(match, "Auth migrations must be an explicit brace allowlist");
  return match[1].split(",").sort();
}

for (const relativePath of [
  "../../workers/api/wrangler.app-staging.jsonc",
  "../../workers/api/wrangler.auth-staging.jsonc",
]) {
  test(`${relativePath} selects only Better Auth migrations`, () => {
    const selected = selectedAuthMigrationNames(readConfig(relativePath));
    assert.deepEqual(selected, expectedAuthMigrations);
    for (const filename of selected) assert.ok(availableMigrations.has(filename), `${filename} must exist`);
    assert.ok(!selected.includes("0007_release_audit_timestamps.sql"));
  });
}
