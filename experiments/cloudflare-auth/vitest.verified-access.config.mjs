import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.verified-access.jsonc" },
    }),
  ],
  test: {
    include: ["./test/verified-access.test.mjs"],
    fileParallelism: false,
    sequence: { concurrent: false },
    maxConcurrency: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
