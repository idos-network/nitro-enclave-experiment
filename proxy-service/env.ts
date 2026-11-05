// biome-ignore-all lint/style/noNonNullAssertion: This is ok
export const GROUP_NAME = "proxy-service";
export const MONGO_URI = process.env.MONGO_URI!;
export const DB_ARMED_COLLECTION = "idOSProxyArmed";
export const DB_NAME = "proxy";
export const FLE_KMS_KEY_ID = process.env.AWS_KMS_FLE_ARN!;
export const FLE_KEY_ALIAS = "proxy-enclave-key";
export const AWS_REGION = process.env.AWS_REGION!;
// Bearer tokens allowed to call POST /arm (comma separated in config.env).
export const ARM_TOKENS = (process.env.ARM_TOKENS ?? "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);
// How long a host JWS stays valid after its iat.
export const HOST_JWS_MAX_AGE = "5 minutes";
export const UPSTREAM_TIMEOUT_MS = 30_000;
