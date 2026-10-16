import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["./test/reference-master-service-api.test.ts"],
    environment: "node",
    fileParallelism: false,
  },
});
