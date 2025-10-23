// biome-ignore-all lint/style/noNonNullAssertion: This is ok
export const GROUP_NAME = "entropy-service";
export const MONGO_URI = process.env.MONGO_URI!;
export const DB_PINOCCHIO_COLLECTION_NAME = "userPinocchioEntropy";
export const DB_NAME = "entropy";
export const JWT_PUBLIC_KEY = "./jwt_token_public.pem";
export const FLE_KMS_KEY_ID = process.env.KMS_FLE_ARN!;
export const FLE_KEY_ALIAS = "entropy-encryption-key";
export const AWS_REGION = process.env.AWS_REGION!;
