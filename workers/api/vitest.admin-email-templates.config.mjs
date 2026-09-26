import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.admin-email-templates-test.jsonc" } })],
  test: {
    include: ["./test/admin-email-templates-d1.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
