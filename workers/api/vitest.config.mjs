import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["./test/**/*.test.ts"],
    exclude: [
      "./test/static-assets.test.ts",
      "./test/d1-repository.test.ts",
      "./test/availability-d1.test.ts",
      "./test/public-access.test.ts",
      "./test/emoji-catalog-api.test.ts",
      "./test/auth-d1.test.ts",
    ],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
