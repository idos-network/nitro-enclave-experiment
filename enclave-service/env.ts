// biome-ignore-all lint/style/noNonNullAssertion: This is ok
export const GROUP_NAME = "enclave-service";
export const MONGO_URI = process.env.MONGO_URI!;
export const DB_ENCLAVE_COLLECTION = "idOSEnclave";
export const DB_NAME = "enclave";
export const FLE_KMS_KEY_ID = process.env.AWS_KMS_FLE_ARN!;
export const FLE_KEY_ALIAS = "enclave-enclave-key";
export const AWS_REGION = process.env.AWS_REGION!;
export const SIGNING_KEY_KMS_KEY_ARN = process.env.AWS_KMS_SIGNING_KEY_ARN!;
export const SIGNING_KEY_KMS_KEY_ID = SIGNING_KEY_KMS_KEY_ARN.split("/")[1]; // just the key ID, not the full ARN
export const BASE_URL = process.env.BASE_URL!;
