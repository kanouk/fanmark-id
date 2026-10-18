import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.production-import-test.jsonc" } })],
  test: { include: ["./test/production-import-coordinator.test.ts"], fileParallelism: false, setupFiles: ["./test/setup.ts"] },
});
