import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.recovery-writer-drain-test.jsonc" } })],
  test: { include: ["./test/recovery-writer-drain.test.ts"], fileParallelism: false, setupFiles: ["./test/setup.ts"] },
});
