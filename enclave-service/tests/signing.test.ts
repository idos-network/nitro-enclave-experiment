import { createHash, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SIGNING_KID, SIGNING_PUBLIC_KEY_JWK, sign } from "../providers/signing.ts";

describe("enclave signing key", () => {
  it("signs verifiably under the published JWK", () => {
    const payload = Buffer.from("payload");
    const publicKey = createPublicKey({ key: SIGNING_PUBLIC_KEY_JWK, format: "jwk" });

    expect(verify(null, payload, publicKey, sign(payload))).toBe(true);
    expect(SIGNING_PUBLIC_KEY_JWK).toMatchObject({
      kty: "OKP",
      crv: "Ed25519",
      use: "sig",
      alg: "EdDSA",
    });
  });

  it("uses the RFC 7638 thumbprint as kid", () => {
    const { crv, kty, x } = SIGNING_PUBLIC_KEY_JWK;
    const thumbprint = createHash("sha256")
      .update(JSON.stringify({ crv, kty, x }))
      .digest("base64url");

    expect(SIGNING_KID).toBe(thumbprint);
  });
});
