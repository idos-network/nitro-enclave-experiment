import { createRequire } from "node:module";

interface Addon {
  getAttestationDoc(
    userData: Buffer | null,
    nonce: Buffer | null,
    publicKey: Buffer | null,
  ): Buffer;
}

// Built from src/lib.rs by the `nsm` stage of the service Dockerfile, Linux only. Loaded on
// first use, so this module still imports where the addon doesn't exist (tests, local runs).
let addon: Addon | undefined;

/**
 * Attestation document of the running enclave (COSE_Sign1 CBOR), signed by the Nitro
 * hypervisor. It carries the EIF's PCRs and echoes the given fields: `nonce` and `userData`
 * up to 512 bytes, `publicKey` up to 1024. Throws outside an enclave.
 */
export function getAttestationDocument(
  fields: { nonce?: Uint8Array; publicKey?: Uint8Array; userData?: Uint8Array } = {},
): Buffer {
  addon ??= createRequire(import.meta.url)("./nitro-nsm.node") as Addon;

  // NSM rejects empty byte strings, so an empty field is left out
  const bytes = (value?: Uint8Array) => (value?.length ? Buffer.from(value) : null);

  return addon.getAttestationDoc(
    bytes(fields.userData),
    bytes(fields.nonce),
    bytes(fields.publicKey),
  );
}
