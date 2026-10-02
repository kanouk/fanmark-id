import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const migrationDirectory = fileURLToPath(new URL("../../workers/api/migrations/", import.meta.url));
const businessMigrationDirectory = fileURLToPath(new URL("../../workers/api/migrations-business/", import.meta.url));
const expectedAuthMigrations = [
  "0003_better_auth_core.sql",
  "0007_auth_signup_command.sql",
  "0008_auth_user_suspension.sql",
].sort();
const authMigrationPattern = `migrations/{${expectedAuthMigrations.join(",")}}`;
const expectedMasterMigrations = [
  "0000_emoji_master.sql",
  "0001_emoji_master_release_staging.sql",
  "0002_emoji_master_release_activation.sql",
  "0003_better_auth_core.sql",
  "0004_reference_master_releases.sql",
  "0005_emoji_master_admin_guards.sql",
  "0006_reference_master_extension_prices.sql",
  "0007_release_audit_timestamps.sql",
  "0008_emoji_master_change_audits.sql",
].sort();
const masterMigrationPatterns = new Set([
  "migrations/{000[0-6]_*.sql,0007_release_audit_timestamps.sql,0008_emoji_master_change_audits.sql}",
  `migrations/{${expectedMasterMigrations.join(",")}}`,
]);
const availableMigrations = new Set(readdirSync(migrationDirectory));

function readConfig(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function selectedMasterMigrationNames(config, bindingName) {
  const binding = config.d1_databases?.find((database) => database.binding === bindingName);
  assert.ok(binding, `staging config must define ${bindingName}`);
  assert.equal(binding.migrations_dir, "migrations");
  if (binding.remote !== undefined) assert.equal(binding.remote, true);
  assert.ok(masterMigrationPatterns.has(binding.migrations_pattern), "Master migrations must use an approved selector");

  const match = binding.migrations_pattern.match(/^migrations\/\{([^{}]+)\}$/u);
  assert.ok(match, "Master migrations must use an explicit scoped pattern");
  const selected = [];
  for (const pattern of match[1].split(",")) {
    if (pattern === "000[0-6]_*.sql") {
      selected.push(...[...availableMigrations].filter((filename) => /^000[0-6]_.*\.sql$/u.test(filename)));
    } else {
      selected.push(pattern);
    }
  }
  return [...new Set(selected)].sort();
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

for (const [relativePath, bindingName] of [
  ["../../workers/api/wrangler.app-staging.jsonc", "MASTER_DB"],
  ["../../workers/api/wrangler.emoji-staging.jsonc", "FANMARK_DB"],
  ["../../workers/api/wrangler.emoji-api-staging.jsonc", "MASTER_DB"],
]) {
  test(`${relativePath} selects only approved master migrations`, () => {
    const selected = selectedMasterMigrationNames(readConfig(relativePath), bindingName);
    assert.deepEqual(selected, expectedMasterMigrations);
    for (const filename of selected) assert.ok(availableMigrations.has(filename), `${filename} must exist`);
    assert.ok(!selected.includes("0007_auth_signup_command.sql"));
    assert.ok(!selected.includes("0008_auth_user_suspension.sql"));
  });
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

test("D1 trigger migrations use Cloudflare-remote-safe formatting", () => {
  for (const directory of [migrationDirectory, businessMigrationDirectory]) {
    for (const filename of readdirSync(directory).filter((name) => name.endsWith(".sql"))) {
      const sql = readFileSync(`${directory}${filename}`, "utf8");
      assert.ok(!sql.includes("\r"), `${filename} must use LF line endings`);
      for (const line of sql.split("\n").filter((value) => /^\s*begin\s*$/iu.test(value))) {
        assert.equal(line.trim(), "BEGIN", `${filename} trigger blocks must use uppercase BEGIN`);
      }
    }
  }
});
