import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.emoji-catalog-d1-test.jsonc" },
    }),
  ],
  test: {
    include: ["./test/emoji-catalog-api.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
