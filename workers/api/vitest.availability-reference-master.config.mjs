import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.availability-reference-master-test.jsonc" },
    }),
  ],
  test: {
    include: ["./test/availability-reference-master.integration.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
