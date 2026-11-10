import { createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { calculateJwkThumbprint } from "jose";
import { SIGNING_KEY, SIGNING_KEY_PREVIOUS } from "../env.ts";

async function load(pemBase64: string) {
  const privateKey = createPrivateKey(Buffer.from(pemBase64, "base64"));
  const publicKey = createPublicKey(privateKey);
  const jwk = publicKey.export({ format: "jwk" });
  // RFC 7638 thumbprint: the kid changes with the key, so verifiers refetch the JWKS
  const kid = await calculateJwkThumbprint(jwk);

  return {
    privateKey,
    kid,
    jwk: { ...jwk, kid, use: "sig", alg: "EdDSA" },
    // SubjectPublicKeyInfo DER, the `public_key` of the attestation document
    der: publicKey.export({ type: "spki", format: "der" }),
  };
}

// Ed25519 keys generated once inside an attested enclave and unwrapped by scripts/run.ash.
// KMS Sign can't require an attestation, so a KMS key would be usable by the host role too.
const current = await load(SIGNING_KEY);
// After a rotation the previous key stays published, so sessions it signed still verify
const previous = SIGNING_KEY_PREVIOUS ? await load(SIGNING_KEY_PREVIOUS) : undefined;

export const SIGNING_KID = current.kid;
export const SIGNING_PUBLIC_KEY_JWK = current.jwk;
export const SIGNING_PUBLIC_KEY_DER = current.der;
export const SIGNING_JWKS = previous ? [current.jwk, previous.jwk] : [current.jwk];

export function sign(payload: Uint8Array) {
  return cryptoSign(null, payload, current.privateKey);
}
