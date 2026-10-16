import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.reference-master-d1-test.jsonc" },
    }),
  ],
  test: {
    include: ["./test/reference-master-d1-api.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
