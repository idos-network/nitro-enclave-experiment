import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../providers/encryption.ts";
import { b64 } from "./helpers.ts";

describe("encrypt/decrypt", () => {
  it("round-trips a message between two key pairs", () => {
    const recipient = nacl.box.keyPair();
    const plaintext = "hello enclave service";
    const plaintextB64 = b64(Buffer.from(plaintext));

    const ciphertext = encrypt(plaintextB64, b64(recipient.publicKey));

    const recovered = decrypt(
      ciphertext.encrypted,
      ciphertext.nonce,
      ciphertext.publicKey,
      recipient.secretKey,
    );

    expect(recovered).toBe(plaintextB64);
    expect(Buffer.from(recovered, "base64").toString()).toBe(plaintext);
  });

  it("fails to decrypt with the wrong recipient key", () => {
    const recipient = nacl.box.keyPair();
    const impostor = nacl.box.keyPair();
    const plaintext = b64(Buffer.from("secret"));

    const ciphertext = encrypt(plaintext, b64(recipient.publicKey));

    expect(() =>
      decrypt(ciphertext.encrypted, ciphertext.nonce, ciphertext.publicKey, impostor.secretKey),
    ).toThrow(/Couldn't decrypt/);
  });
});
