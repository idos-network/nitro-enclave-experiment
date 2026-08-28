import { createPublicKey } from "node:crypto";
import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { AWS_REGION, SIGNING_KEY_KMS_KEY_ARN, SIGNING_KEY_KMS_KEY_ID } from "../env.ts";

// One client + memoized credentials. A new KMSClient per call re-runs the
// provider chain (IMDS) and fails under load with "Could not load credentials from any providers".
const kms = new KMSClient({
  region: AWS_REGION,
  credentials: defaultProvider(),
});

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
