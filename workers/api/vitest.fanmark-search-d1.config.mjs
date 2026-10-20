import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { BUSINESS_MIGRATION_SEQUENCE } from "../../scripts/migration/business-migration-ledger.mjs";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.fanmark-search-test.jsonc" } })],
  test: {
    include: ["./test/fanmark-search-d1.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    provide: {
      businessSearchMigrations: BUSINESS_MIGRATION_SEQUENCE.map((name) => ({
        name, sql: readFileSync(new URL(`migrations-business/${name}`, import.meta.url), "utf8"),
      })),
    },
  },
});
