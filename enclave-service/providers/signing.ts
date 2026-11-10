import { createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { calculateJwkThumbprint } from "jose";
import { SIGNING_KEY } from "../env.ts";

// Ed25519 key generated once inside an attested enclave and unwrapped by scripts/run.ash.
// KMS Sign can't require an attestation, so a KMS key would be usable by the host role too.
const privateKey = createPrivateKey(Buffer.from(SIGNING_KEY, "base64"));
const publicKey = createPublicKey(privateKey);
const jwk = publicKey.export({ format: "jwk" });

// RFC 7638 thumbprint: the kid changes with the key, so verifiers refetch the JWKS
export const SIGNING_KID = await calculateJwkThumbprint(jwk);
export const SIGNING_PUBLIC_KEY_JWK = { ...jwk, kid: SIGNING_KID, use: "sig", alg: "EdDSA" };
// SubjectPublicKeyInfo DER, the `public_key` of the attestation document
export const SIGNING_PUBLIC_KEY_DER = publicKey.export({ type: "spki", format: "der" });

export function sign(payload: Uint8Array) {
  return cryptoSign(null, payload, privateKey);
}
