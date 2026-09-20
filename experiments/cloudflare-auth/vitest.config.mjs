import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["./test/**/*.test.mjs"],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
