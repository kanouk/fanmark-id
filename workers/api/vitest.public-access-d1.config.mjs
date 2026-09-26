import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.public-access-d1-test.jsonc" },
    }),
  ],
  test: {
    include: ["./test/public-access.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
