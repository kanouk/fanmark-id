import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.auth-recovery-test.jsonc" } })],
  test: {
    include: ["./test/auth-recovery-d1.test.ts"],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
    provide: {
      authRecoveryMigrations: ["0003_better_auth_core.sql", "0007_auth_signup_command.sql",
        "0008_auth_user_suspension.sql", "0009_auth_oauth_signup.sql"].map(name => ({
        name, sql: readFileSync(new URL(`migrations/${name}`, import.meta.url), "utf8"),
      })),
    },
  },
});
