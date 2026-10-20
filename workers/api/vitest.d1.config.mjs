import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.d1-test.jsonc" },
    }),
  ],
  test: {
    include: ["./test/d1-repository.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
