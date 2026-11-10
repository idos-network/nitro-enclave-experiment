// biome-ignore-all lint/style/noNonNullAssertion: This is ok
export const GROUP_NAME = "enclave-service";
export const MONGO_URI = process.env.MONGO_URI!;
export const DB_ENCLAVE_COLLECTION = "idOSEnclave";
export const DB_NAME = "enclave";
export const SESSION_TTL_SECONDS = 60 * 60; // 1hour
export const FLE_KEY_ALIAS = "enclave-enclave-key";
// base64, 96 bytes: mongodb `local` KMS provider master key, see scripts/run.ash
export const FLE_MASTER_KEY = process.env.FLE_MASTER_KEY!;
export const AWS_REGION = process.env.AWS_REGION!;
// base64 PKCS#8 PEM, Ed25519: session-signing key, see scripts/run.ash
export const SIGNING_KEY = process.env.SIGNING_KEY!;
export const BASE_URL = process.env.BASE_URL!;
// TEMPORARY (staging only): trust the audience JWT without verifying its signature.
export const SKIP_AUDIENCE_VERIFICATION = process.env.SKIP_AUDIENCE_VERIFICATION === "true";
// Bearer tokens allowed to call POST /session (comma separated in config.env).
export const SESSION_TOKENS = (process.env.SESSION_TOKENS ?? "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);
