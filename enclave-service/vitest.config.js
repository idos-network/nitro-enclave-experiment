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
      AWS_KMS_SIGNING_KEY_ARN: "arn:aws:kms:eu-central-1:000000000000:key/signing-test",
      SESSION_TOKENS: "session-token-one, session-token-two",
    },
    coverage: {
      include: [
        "providers/**/*.ts",
        "routes/**/*.ts",
        "middleware/**/*.ts",
        "utils/**/*.ts",
        "server.ts",
      ],
      exclude: ["node_modules/**", "test/**", "**/*.test.ts", "**/*.config.ts"],
      reporter: ["text", "html", "json-summary", "json"],
      provider: "v8",
      reportOnFailure: true,
    },
  },
});
