import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.waitlist-signup-test.jsonc" } })],
  test: {
    include: ["./test/waitlist-signup-d1.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
