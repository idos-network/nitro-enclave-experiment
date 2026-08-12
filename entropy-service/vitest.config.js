import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      include: ["providers/**/*.ts", "utils/**/*.ts", "server.ts"],
      exclude: ["node_modules/**", "test/**", "**/*.test.ts", "**/*.config.ts"],
      // json-summary is required by vitest-coverage-report-action, json adds per-file detail
      reporter: ["text", "json-summary", "json"],
      provider: "v8",
      reportOnFailure: true,
    },
  },
});
