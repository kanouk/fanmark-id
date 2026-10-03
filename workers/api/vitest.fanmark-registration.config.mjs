import { readFileSync } from "node:fs";
import { BUSINESS_MIGRATION_SEQUENCE } from "../../scripts/migration/business-migration-ledger.mjs";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const masterMigrations = [
  "0000_emoji_master.sql", "0001_emoji_master_release_staging.sql",
  "0002_emoji_master_release_activation.sql", "0004_reference_master_releases.sql",
  "0005_emoji_master_admin_guards.sql", "0006_reference_master_extension_prices.sql",
  "0007_release_audit_timestamps.sql", "0008_emoji_master_change_audits.sql",
];
const readMigrations = (directory, names) => names.map(name => ({
  name, sql: readFileSync(new URL(`${directory}/${name}`, import.meta.url), "utf8"),
}));

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.fanmark-registration-test.jsonc" } })],
  test: {
    include: ["./test/fanmark-registration-d1.test.ts", "./test/fanmark-registration-session.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    provide: {
      registrationBusinessMigrations: readMigrations("migrations-business", BUSINESS_MIGRATION_SEQUENCE),
      registrationMasterMigrations: readMigrations("migrations", masterMigrations),
    },
  },
});
