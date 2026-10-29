// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
