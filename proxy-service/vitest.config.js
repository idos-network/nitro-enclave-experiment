import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    env: {
      NODE_ENV: "test",
      MONGO_URI: "mongodb://localhost:27017",
      AWS_REGION: "eu-central-1",
      FLE_MASTER_KEY: Buffer.alloc(96).toString("base64"),
      ARM_TOKENS: "arm-token-one, arm-token-two",
    },
    coverage: {
      include: ["providers/**/*.ts", "middleware/**/*.ts", "utils/**/*.ts", "server.ts"],
      exclude: ["node_modules/**", "test/**", "**/*.test.ts", "**/*.config.ts"],
      reporter: ["text", "html", "json-summary", "json"],
      provider: "v8",
      reportOnFailure: true,
    },
  },
});
