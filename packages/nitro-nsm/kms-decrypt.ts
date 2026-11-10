import { execFileSync } from "node:child_process";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { getAttestationDocument } from "./index.ts";

/**
 * Opens KMS's CiphertextForRecipient: CMS EnvelopedData (BER) holding an AES-256-CBC key
 * wrapped with RSA-OAEP-SHA256 for the public key of the attestation document.
 */
export function unwrapEnvelope(envelope: Uint8Array, privateKey: KeyObject): Buffer {
  // openssl only reads the key from a file (Node's stdin pipe is a socket, /dev/stdin can't
  // be reopened). The key is single-use and the directory is 0700 in enclave RAM.
  const dir = mkdtempSync(join(tmpdir(), "kms-"));
  try {
    const keyFile = join(dir, "key.pem");
    writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });

    return execFileSync(
      "openssl",
      ["cms", "-decrypt", "-binary", "-inform", "DER", "-inkey", keyFile],
      { input: envelope },
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
}

/**
 * KMS Decrypt that only this enclave can read the answer of. The request carries the
 * enclave's attestation document as Recipient: KMS checks the hypervisor's signature, lets
 * the key policy require the EIF's PCRs (kms:RecipientAttestation:PCR0-2) and returns no
 * plaintext, only CiphertextForRecipient encrypted to the RSA key generated here. The host's
 * instance-role credentials still sign the call, but are useless without the attestation.
 */
export async function kmsDecrypt(ciphertext: Uint8Array): Promise<Buffer> {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  const { CiphertextForRecipient } = await new KMSClient().send(
    new DecryptCommand({
      CiphertextBlob: ciphertext,
      Recipient: {
        KeyEncryptionAlgorithm: "RSAES_OAEP_SHA_256",
        AttestationDocument: getAttestationDocument({
          publicKey: publicKey.export({ type: "spki", format: "der" }),
        }),
      },
    }),
  );

  if (!CiphertextForRecipient) {
    throw new Error("KMS returned no CiphertextForRecipient");
  }

  return unwrapEnvelope(CiphertextForRecipient, privateKey);
}

// CLI for the boot scripts (shared/kms.ash): base64 ciphertext in, base64 plaintext out,
// the same contract as `aws kms decrypt --query Plaintext`.
if (import.meta.main) {
  const ciphertext = process.argv[2];
  if (!ciphertext) {
    throw new Error("usage: node kms-decrypt.ts <base64 ciphertext>");
  }

  console.log((await kmsDecrypt(Buffer.from(ciphertext, "base64"))).toString("base64"));
}
