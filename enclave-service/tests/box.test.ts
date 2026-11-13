import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import {
  box,
  boxOpen,
  isUsablePublicKey,
  keyPair,
  keyPairFromSecretKey,
  sharedKey,
} from "../providers/box.ts";

// Clients still use tweetnacl, so the native X25519 must agree with it byte for byte.
describe("native box", () => {
  const randomCase = () => ({
    mine: nacl.box.keyPair(),
    theirs: nacl.box.keyPair(),
    nonce: nacl.randomBytes(nacl.box.nonceLength),
    message: nacl.randomBytes(100),
  });
  const cases = Array.from({ length: 20 }, randomCase);

  it("derives the same public key as tweetnacl", () => {
    for (const { mine } of cases) {
      expect(keyPairFromSecretKey(mine.secretKey)).toEqual(mine);
    }
  });

  it("derives the same shared key and ciphertext as tweetnacl", () => {
    for (const { mine, theirs, nonce, message } of cases) {
      expect(sharedKey(theirs.publicKey, mine.secretKey)).toEqual(
        nacl.box.before(theirs.publicKey, mine.secretKey),
      );
      expect(box(message, nonce, theirs.publicKey, mine.secretKey)).toEqual(
        nacl.box(message, nonce, theirs.publicKey, mine.secretKey),
      );
    }
  });

  it("opens tweetnacl ciphertexts and is opened by tweetnacl", () => {
    const { mine, theirs, nonce, message } = randomCase();
    const fromClient = nacl.box(message, nonce, mine.publicKey, theirs.secretKey);
    expect(boxOpen(fromClient, nonce, theirs.publicKey, mine.secretKey)).toEqual(message);

    const generated = keyPair();
    const toClient = box(message, nonce, theirs.publicKey, generated.secretKey);
    expect(nacl.box.open(toClient, nonce, generated.publicKey, theirs.secretKey)).toEqual(message);
  });

  it("rejects tampered ciphertext, wrong-size keys and low-order keys", () => {
    const { mine, theirs, nonce, message } = randomCase();
    const sealed = box(message, nonce, theirs.publicKey, mine.secretKey);
    sealed[0] = (sealed[0] ?? 0) ^ 1;
    expect(boxOpen(sealed, nonce, mine.publicKey, theirs.secretKey)).toBeNull();

    expect(() => sharedKey(new Uint8Array(31), mine.secretKey)).toThrow(/public key size/);
    expect(() => keyPairFromSecretKey(new Uint8Array(31))).toThrow(/secret key size/);

    const lowOrder = [new Uint8Array(32), Uint8Array.of(1, ...new Uint8Array(31))];
    for (const key of lowOrder) {
      expect(isUsablePublicKey(key)).toBe(false);
      expect(() => sharedKey(key, mine.secretKey)).toThrow();
    }
    expect(isUsablePublicKey(theirs.publicKey)).toBe(true);
    expect(isUsablePublicKey(new Uint8Array(31))).toBe(false);
  });
});
