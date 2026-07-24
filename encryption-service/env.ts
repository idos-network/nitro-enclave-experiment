// biome-ignore-all lint/style/noNonNullAssertion: This is ok
export const GROUP_NAME = "encryption-service";
export const MONGO_URI = process.env.MONGO_URI!;
export const FACE_SIGN_ENCRYPTION_COLLECTION = "idOSEncryption";
export const DB_NAME = "encryption";
export const FLE_KMS_KEY_ID = process.env.AWS_KMS_FLE_ARN!;
export const FLE_KEY_ALIAS = "encryption-encryption-key";
export const AWS_REGION = process.env.AWS_REGION!;
export const SIGNING_KEY_KMS_KEY_ARN = process.env.AWS_KMS_SIGNING_KEY_ARN!;
export const SIGNING_KEY_KMS_KEY_ID = SIGNING_KEY_KMS_KEY_ARN.split("/")[1]; // just the key ID, not the full ARN
