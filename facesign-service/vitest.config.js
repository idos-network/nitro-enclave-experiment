import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    maxWorkers: 1,
    maxConcurrency: 1,
    environment: "node",
    setupFiles: ["./tests/utils/setup.ts"],
    coverage: {
      include: ["providers/**/*.ts", "routes/**/*.ts", "server.ts"],
      exclude: ["node_modules/**", "test/**", "**/*.test.ts", "**/*.config.ts"],
      reporter: ["text", "html", "json-summary", "json"],
      provider: "v8",
      reportOnFailure: true,
    },
  },
});
