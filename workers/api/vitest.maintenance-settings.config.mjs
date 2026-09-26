import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.maintenance-settings-test.jsonc" },
    }),
  ],
  test: {
    include: ["./test/maintenance-settings-d1.test.ts", "./test/lifecycle-settings-d1.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
