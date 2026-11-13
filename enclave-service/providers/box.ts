import { createPrivateKey, createPublicKey, diffieHellman } from "node:crypto";
import nacl, { type BoxKeyPair } from "tweetnacl";

// nacl.box with the X25519 step done by OpenSSL. tweetnacl's pure-JS scalarmult costs ~1 ms
// and was over half the enclave's CPU under load; the XSalsa20-Poly1305 part stays tweetnacl,
// so ciphertexts are byte-identical to nacl.box (tests/box.test.ts checks that).

// DER headers that wrap a raw 32-byte X25519 key (RFC 8410)
const PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const SIGMA = new TextEncoder().encode("expand 32-byte k");
const ZERO_NONCE = new Uint8Array(16);
const KEY_LENGTH = 32;

// lowlevel is exported by tweetnacl but missing from its typings
const { crypto_core_hsalsa20 } = (
  nacl as unknown as {
    lowlevel: {
      crypto_core_hsalsa20(out: Uint8Array, inp: Uint8Array, k: Uint8Array, c: Uint8Array): void;
    };
  }
).lowlevel;

function privateKey(secretKey: Uint8Array) {
  if (secretKey.length !== KEY_LENGTH) throw new Error("bad secret key size");
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, secretKey]),
    format: "der",
    type: "pkcs8",
  });
}

function publicKey(rawPublicKey: Uint8Array) {
  if (rawPublicKey.length !== KEY_LENGTH) throw new Error("bad public key size");
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, rawPublicKey]),
    format: "der",
    type: "spki",
  });
}

// Any scalar works: X25519 clamps it to a multiple of 8, which zeroes every low-order point.
const PROBE_KEY = privateKey(new Uint8Array(KEY_LENGTH).fill(1));

/**
 * False for a key box() would throw on: wrong size, or low order (the shared secret would be all
 * zeros, a key anyone can compute; tweetnacl used it silently, OpenSSL refuses).
 */
export function isUsablePublicKey(rawPublicKey: Uint8Array): boolean {
  try {
    diffieHellman({ privateKey: PROBE_KEY, publicKey: publicKey(rawPublicKey) });
    return true;
  } catch {
    return false;
  }
}

/** nacl.box.before: HSalsa20 over the X25519 shared secret. Throws on a low-order public key. */
export function sharedKey(theirPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array {
  const shared = diffieHellman({
    privateKey: privateKey(mySecretKey),
    publicKey: publicKey(theirPublicKey),
  });
  const key = new Uint8Array(KEY_LENGTH);
  crypto_core_hsalsa20(key, ZERO_NONCE, shared, SIGMA);
  return key;
}

export function box(
  message: Uint8Array,
  nonce: Uint8Array,
  theirPublicKey: Uint8Array,
  mySecretKey: Uint8Array,
): Uint8Array {
  return nacl.box.after(message, nonce, sharedKey(theirPublicKey, mySecretKey));
}

export function boxOpen(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  theirPublicKey: Uint8Array,
  mySecretKey: Uint8Array,
): Uint8Array | null {
  return nacl.box.open.after(ciphertext, nonce, sharedKey(theirPublicKey, mySecretKey));
}

export function keyPairFromSecretKey(secretKey: Uint8Array): BoxKeyPair {
  const spki = createPublicKey(privateKey(secretKey)).export({ format: "der", type: "spki" });
  return {
    publicKey: new Uint8Array(spki.subarray(SPKI_PREFIX.length)),
    secretKey: new Uint8Array(secretKey),
  };
}

/** Same as nacl.box.keyPair: 32 random bytes, clamped by X25519 itself. */
export function keyPair(): BoxKeyPair {
  return keyPairFromSecretKey(nacl.randomBytes(KEY_LENGTH));
}
