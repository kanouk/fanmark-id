/** Read-only remote check against independently built native local schemas.
 * Not a data import verifier: this deliberately requires only migration seed rows.
 */
import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { createProductionRemoteD1 } from "./production-remote-d1.mjs";
import { fileURLToPath } from "node:url";
import { Miniflare } from "../../workers/api/node_modules/miniflare/dist/src/index.js";
import { businessMigrationStatements } from "./business-runtime-import-schema.mjs";
import { BUSINESS_MIGRATION_SEQUENCE } from "./business-migration-ledger.mjs";
import { isD1ProviderObject } from "./d1-provider-objects.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const run = promisify(execFile), digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const authFiles = ["0003_better_auth_core.sql", "0007_auth_signup_command.sql", "0008_auth_user_suspension.sql", "0009_auth_oauth_signup.sql"];
const masterFiles = ["0000_emoji_master.sql", "0001_emoji_master_release_staging.sql", "0002_emoji_master_release_activation.sql", "0003_better_auth_core.sql", "0004_reference_master_releases.sql", "0005_emoji_master_admin_guards.sql", "0006_reference_master_extension_prices.sql", "0007_release_audit_timestamps.sql", "0008_emoji_master_change_audits.sql"];
const inventorySql = "SELECT type,name,sql FROM sqlite_master WHERE substr(name,1,7)<>'sqlite_' AND type IN ('table','index','view','trigger') ORDER BY type,name";
const objects = rows => rows.filter(r => !isD1ProviderObject(r.type, r.name)).map(r => ({ type: r.type, name: r.name, sql: r.sql }));
let phase = "configuration";
try {
  const config = JSON.parse(await readFile(new URL("../../workers/api/wrangler.production-schema.jsonc", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../../docs/migration/production-resources.json", import.meta.url), "utf8"));
  if (config.account_id !== "bfc2890741f0b3fb236e2d755b6c9adc" || config.account_id !== manifest.accountId || config.main || config.routes || config.assets || config.workers_dev !== false || config.preview_urls !== false || config.d1_databases?.length !== 3) throw Error("config_rejected");
  if (digest(config.d1_databases.map(r => r.binding).sort()) !== digest(["AUTH_DB", "FANMARK_DB", "MASTER_DB"])) throw Error("binding_rejected");
  phase = "remote-authentication";
  const auth = JSON.parse((await run("./workers/api/node_modules/.bin/wrangler", ["auth", "token", "--profile", "fanmark-staging-inapp", "--json"], {
    cwd: root, timeout: 90000, maxBuffer: 1024 * 1024,
  })).stdout);
  const reports = [];
  for (const binding of config.d1_databases) {
    const expected = manifest.d1.find(r => r.binding === binding.binding);
    if (!expected || binding.database_id !== expected.id || binding.database_name !== expected.name || !expected.name.startsWith("fanmark-production-")) throw Error("binding_rejected");
    const database = createProductionRemoteD1({ token: auth.token, target: {
      accountId: manifest.accountId, databaseId: expected.id, databaseName: expected.name,
      createdAt: expected.createdAt, targetIncarnation: randomUUID(),
    } });
    phase = "remote-identity";
    await database.verifyProductionTarget();
    const files = binding.binding === "AUTH_DB" ? authFiles : binding.binding === "MASTER_DB" ? masterFiles : BUSINESS_MIGRATION_SEQUENCE;
    const directory = binding.binding === "FANMARK_DB" ? "migrations-business" : "migrations";
    if (binding.migrations_dir !== directory) throw Error("migration_directory_rejected");
    if (directory === "migrations-business" && digest((await readdir(new URL(`../../workers/api/${directory}/`, import.meta.url))).filter(f => f.endsWith(".sql")).sort()) !== digest([...files].sort())) throw Error("business_files_rejected");
    const query = async sql => {
      const result = await database.prepare(sql).all();
      if (result.success !== true || result.meta.rows_written !== 0) throw Error("read_rejected");
      return result.results;
    };
    phase = "local-runtime";
    const mf = new Miniflare({ workers: [{ config: { name: "production-schema-comparison", type: "worker", compatibilityDate: "2026-09-18",
      env: { DB: { type: "d1", name: "production-schema-comparison" } },
      manifest: { mainModule: "index.js", modules: { "index.js": { type: "esm", contents: "export default {fetch(){return new Response('local')}}" } } },
    } }] });
    try {
      const db = await mf.getD1Database("DB"), fileHashes = [];
      for (const name of files) {
        phase = "local-schema";
        const sql = await readFile(new URL(`../../workers/api/${directory}/${name}`, import.meta.url), "utf8");
        fileHashes.push({ name, sha256: createHash("sha256").update(sql).digest("hex") });
        await db.batch(businessMigrationStatements(sql).map(s => db.prepare(s)));
      }
      phase = "schema-comparison";
      const local = objects((await db.prepare(inventorySql).all()).results), remote = objects(await query(inventorySql));
      if (digest(local) !== digest(remote)) throw Error(`schema_mismatch_${binding.binding}`);
      const names = local.filter(r => r.type === "table").map(r => r.name);
      if (names.some(n => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))) throw Error("table_name_rejected");
      const countSql = "SELECT " + names.map(n => `(SELECT count(*) FROM "${n}") AS "${n}"`).join(",");
      phase = "seed-local";
      const localCounts = (await db.prepare(countSql).all()).results;
      phase = "seed-remote";
      const remoteCounts = await query(countSql);
      if (digest(localCounts) !== digest(remoteCounts)) throw Error(`seed_only_check_failed_${binding.binding}`);
      phase = "ledger-comparison";
      const ledger = await query("SELECT name FROM d1_migrations ORDER BY id");
      if (digest(ledger.map(r => r.name)) !== digest(files)) throw Error(`ledger_mismatch_${binding.binding}`);
      phase = "foreign-keys";
      if ((await query("PRAGMA foreign_key_check")).length !== 0) throw Error("foreign_key_failed");
      reports.push({ binding: binding.binding, databaseId: expected.id, migrationCount: files.length, tableCount: names.length,
        objectCount: local.length, schemaSha256: digest(local), migrationFiles: fileHashes,
        exactSchemaMatch: true, exactMigrationLedger: true, onlyMigrationSeedRows: true, foreignKeyViolations: 0 });
    } finally { await mf.dispose(); }
  }
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), accountId: config.account_id, verification: "remote-read-only-vs-native-local", databases: reports, productionReady: false, usersImported: false, sourceFrozen: false, domainChanged: false }, null, 2));
} catch (e) {
  const known = ["config_rejected", "binding_rejected", "incarnation_rejected", "migration_directory_rejected", "business_files_rejected", "read_rejected", "table_name_rejected", "foreign_key_failed"];
  console.error(known.includes(e.message) || /^(schema_mismatch|seed_only_check_failed|ledger_mismatch)_(AUTH_DB|MASTER_DB|FANMARK_DB)$/.test(e.message) ? e.message : `production_schema_readback_failed_at_${phase}`); process.exitCode = 1;
}
