import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.admin-user-management-test.jsonc" } })],
  test: {
    include: ["./test/admin-user-management-d1.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
