import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.auth-test.jsonc" },
    }),
  ],
  test: {
    include: ["./test/storage-r2-api.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
