import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.broadcast-email-admin-test.jsonc" } })],
  test: {
    include: ["./test/broadcast-email-admin-d1.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
