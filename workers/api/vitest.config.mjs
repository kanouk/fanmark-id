import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["./test/**/*.test.ts"],
    exclude: [
      "./test/static-assets.test.ts",
      "./test/d1-repository.test.ts",
      "./test/availability-d1.test.ts",
      "./test/public-access.test.ts",
      "./test/emoji-catalog-api.test.ts",
      "./test/auth-d1.test.ts",
      "./test/reference-master-d1-api.test.ts",
      "./test/storage-r2-api.test.ts",
      "./test/verified-access-d1.test.ts",
      "./test/owned-fanmarks-d1.test.ts",
      "./test/availability-reference-master.integration.test.ts",
      "./test/profile-d1.test.ts",
      "./test/notifications-d1.test.ts",
      "./test/favorites-d1.test.ts",
      "./test/fanmark-profile-d1.test.ts",
      "./test/fanmark-details-d1.test.ts",
      "./test/fanmark-access-analytics-d1.test.ts",
      "./test/fanmark-registration-d1.test.ts",
      "./test/fanmark-settings-d1.test.ts",
      "./test/fanmark-lottery-d1.test.ts",
      "./test/fanmark-transfer-d1.test.ts",
      "./test/maintenance-settings-d1.test.ts",
      "./test/lifecycle-settings-d1.test.ts",
      "./test/notification-master-admin-d1.test.ts",
      "./test/invitation-admin-d1.test.ts",
      "./test/invitation-signup-d1.test.ts",
      "./test/availability-rules-admin-d1.test.ts",
      "./test/admin-user-management-d1.test.ts",
      "./test/admin-email-templates-d1.test.ts",
      "./test/system-settings-d1.test.ts",
    ],
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
