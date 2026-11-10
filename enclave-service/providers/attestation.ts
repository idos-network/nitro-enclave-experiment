import { execFile } from "node:child_process";
import { SIGNING_PUBLIC_KEY_DER } from "./signing.ts";

/**
 * Attestation document (COSE_Sign1 CBOR) from the Nitro Secure Module, via nsm-attest
 * (kmstool/nsm-attest.c on libnsm). `public_key` carries the signing key, so a verifier
 * can tie the JWKS to the PCRs; `nonce` is the caller's freshness challenge.
 */
export function getAttestationDocument(nonce: Uint8Array): Promise<Buffer> {
  const args = [Buffer.from(nonce).toString("hex"), SIGNING_PUBLIC_KEY_DER.toString("hex")];

  return new Promise((resolve, reject) => {
    execFile("nsm-attest", args, { encoding: "buffer" }, (error, stdout) =>
      error ? reject(error) : resolve(stdout),
    );
  });
}
