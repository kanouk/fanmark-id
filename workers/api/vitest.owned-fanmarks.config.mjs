import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.owned-fanmarks-test.jsonc" },
    }),
  ],
  test: {
    include: ["./test/owned-fanmarks-d1.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
