import { generateKeyPairSync } from "node:crypto";

process.env.NODE_ENV ??= "test";
process.env.MONGO_URI ??= "mongodb://localhost:27017";
process.env.AWS_REGION ??= "eu-central-1";
process.env.FLE_MASTER_KEY ??= Buffer.alloc(96).toString("base64");
// Fresh Ed25519 key per run, the base64 PKCS#8 PEM shape scripts/run.ash hands over
process.env.SIGNING_KEY ??= Buffer.from(
  generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }),
).toString("base64");
process.env.BASE_URL = "https://test.root.com";
process.env.SESSION_TOKENS ??= "session-token-one, session-token-two";
