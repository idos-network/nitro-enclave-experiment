import { createPublicKey } from "node:crypto";
import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { AWS_REGION, SIGNING_KEY_KMS_KEY_ARN, SIGNING_KEY_KMS_KEY_ID } from "../env.ts";

const PUBLIC_KEY_TTL_MS = 60_000;
let cachedPublicKey:
  | { jwk: Awaited<ReturnType<typeof fetchPublicKeyJWK>>; expiresAt: number }
  | undefined;
let inflight: Promise<Awaited<ReturnType<typeof fetchPublicKeyJWK>>> | undefined;

export async function getPublicKeyJWK() {
  if (cachedPublicKey && Date.now() < cachedPublicKey.expiresAt) {
    return cachedPublicKey.jwk;
  }

  inflight ??= fetchPublicKeyJWK().finally(() => {
    inflight = undefined;
  });

  return inflight;
}

async function fetchPublicKeyJWK() {
  const kms = new KMSClient({
    region: AWS_REGION,
  });

  const response = await kms.send(
    new GetPublicKeyCommand({
      KeyId: SIGNING_KEY_KMS_KEY_ARN,
    }),
  );

  if (!response.PublicKey) {
    throw new Error("No public key returned");
  }

  // KMS returns SubjectPublicKeyInfo DER; Node exports that as JWK.
  const jwk = createPublicKey({
    key: Buffer.from(response.PublicKey),
    format: "der",
    type: "spki",
  }).export({ format: "jwk" });

  const result = {
    ...jwk,
    kid: SIGNING_KEY_KMS_KEY_ID,
    use: "sig",
    alg: "EdDSA",
  };

  cachedPublicKey = { jwk: result, expiresAt: Date.now() + PUBLIC_KEY_TTL_MS };

  return result;
}

export async function sign(payload: Uint8Array<ArrayBufferLike>) {
  const kms = new KMSClient({
    region: AWS_REGION,
  });

  const response = await kms.send(
    new SignCommand({
      KeyId: SIGNING_KEY_KMS_KEY_ARN,
      Message: payload,
      SigningAlgorithm: "ED25519_SHA_512",
      MessageType: "RAW",
    }),
  );

  if (!response.Signature) {
    throw new Error("No signature returned");
  }

  return Buffer.from(response.Signature);
}
