import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: { AUTH_FIXTURE: "auth-fixture" },
        workers: [
          {
            name: "auth-fixture",
            scriptPath: "./.wrangler/auth-fixture/test-fixture.js",
            modules: true,
            compatibilityDate: "2026-09-20",
            compatibilityFlags: ["nodejs_compat"],
            bindings: {
              BETTER_AUTH_URL: "http://example.test",
              BETTER_AUTH_SECRET: "synthetic-only-secret-32-characters-long",
            },
            // Miniflare shares an in-memory D1 database by database ID. Keep
            // this equal to wrangler.jsonc's synthetic database_id so the
            // test-only fixture sees the schema initialized by the main
            // Worker.
            d1Databases: {
              AUTH_DB: "00000000-0000-0000-0000-000000000001",
            },
          },
        ],
      },
    }),
  ],
  test: {
    include: ["./test/**/*.test.mjs"],
    exclude: ["./test/verified-access.test.mjs"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    globalSetup: ["./test/global-setup.mjs"],
  },
});
