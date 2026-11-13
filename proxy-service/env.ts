// biome-ignore-all lint/style/noNonNullAssertion: This is ok
export const GROUP_NAME = "proxy-service";
export const MONGO_URI = process.env.MONGO_URI!;
export const DB_ARMED_COLLECTION = "idOSProxyArmed";
export const DB_NAME = "proxy";
export const FLE_KEY_ALIAS = "proxy-enclave-key";
// base64, 96 bytes: mongodb `local` KMS provider master key, see scripts/run.ash
export const FLE_MASTER_KEY = process.env.FLE_MASTER_KEY!;
// Bearer tokens allowed to call POST /arm (comma separated in config.env).
export const ARM_TOKENS = (process.env.ARM_TOKENS ?? "")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);
// How long a host JWS stays valid after its iat.
export const HOST_JWS_MAX_AGE = "5 minutes";
// The enclave has no NTP, so its clock drifts from the host's; iat is whole seconds.
export const HOST_JWS_CLOCK_TOLERANCE = "30 seconds";
export const UPSTREAM_TIMEOUT_MS = 30_000;
