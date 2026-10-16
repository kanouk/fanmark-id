import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.static-assets.jsonc" },
    }),
  ],
  test: {
    include: ["./test/static-assets.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
