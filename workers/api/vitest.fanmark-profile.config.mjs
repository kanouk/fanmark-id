import { readFileSync } from "node:fs";
import { BUSINESS_MIGRATION_SEQUENCE } from "../../scripts/migration/business-migration-ledger.mjs";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.fanmark-profile-test.jsonc" } })],
  test: {
    include: ["./test/fanmark-profile-d1.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    provide: {
      businessProfileMigrations: BUSINESS_MIGRATION_SEQUENCE.map(name => ({
        name, sql: readFileSync(new URL(`migrations-business/${name}`, import.meta.url), "utf8"),
      })),
    },
  },
});
