import sodium from "sodium-native";
import type { BoxKeyPair } from "tweetnacl";

// nacl.box on libsodium's native crypto_box. tweetnacl's pure-JS X25519 cost ~1 ms per call and
// over half the enclave's CPU under load. Same construction and wire format as nacl.box
// (tests/box.test.ts checks clients on tweetnacl still interoperate byte for byte).

const KEY_LENGTH = sodium.crypto_box_PUBLICKEYBYTES;
const MAC_LENGTH = sodium.crypto_box_MACBYTES;

// @types/sodium-native wants Buffers; these are zero-copy views both ways, so callers keep
// tweetnacl's plain Uint8Array in and out.
const buf = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const plain = (bytes: Buffer) => new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function assertKeySize(key: Uint8Array, kind: "public" | "secret") {
  if (key.length !== KEY_LENGTH) throw new Error(`bad ${kind} key size`);
}

// Any scalar works: X25519 clamps it to a multiple of 8, which zeroes every low-order point.
const PROBE_SECRET_KEY = Buffer.alloc(KEY_LENGTH, 1);

/**
 * False for a key box() would throw on: wrong size, or low order (the shared secret would be all
 * zeros, a key anyone can compute; tweetnacl used it silently, libsodium refuses).
 */
export function isUsablePublicKey(publicKey: Uint8Array): boolean {
  if (publicKey.length !== KEY_LENGTH) return false;
  try {
    sodium.crypto_scalarmult(Buffer.alloc(KEY_LENGTH), PROBE_SECRET_KEY, buf(publicKey));
    return true;
  } catch {
    return false;
  }
}

/** nacl.box: MAC followed by ciphertext. Throws on a low-order public key. */
export function box(
  message: Uint8Array,
  nonce: Uint8Array,
  theirPublicKey: Uint8Array,
  mySecretKey: Uint8Array,
): Uint8Array {
  assertKeySize(theirPublicKey, "public");
  assertKeySize(mySecretKey, "secret");
  const ciphertext = Buffer.alloc(message.length + MAC_LENGTH);
  sodium.crypto_box_easy(
    ciphertext,
    buf(message),
    buf(nonce),
    buf(theirPublicKey),
    buf(mySecretKey),
  );
  return plain(ciphertext);
}

/** nacl.box.open: null when the MAC doesn't verify. Throws on a low-order public key. */
export function boxOpen(
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  theirPublicKey: Uint8Array,
  mySecretKey: Uint8Array,
): Uint8Array | null {
  assertKeySize(theirPublicKey, "public");
  assertKeySize(mySecretKey, "secret");
  if (ciphertext.length < MAC_LENGTH) return null;
  const message = Buffer.alloc(ciphertext.length - MAC_LENGTH);
  const opened = sodium.crypto_box_open_easy(
    message,
    buf(ciphertext),
    buf(nonce),
    buf(theirPublicKey),
    buf(mySecretKey),
  );
  return opened ? plain(message) : null;
}

export function keyPairFromSecretKey(secretKey: Uint8Array): BoxKeyPair {
  assertKeySize(secretKey, "secret");
  const publicKey = Buffer.alloc(KEY_LENGTH);
  sodium.crypto_scalarmult_base(publicKey, buf(secretKey));
  return { publicKey: plain(publicKey), secretKey: new Uint8Array(secretKey) };
}

export function keyPair(): BoxKeyPair {
  const publicKey = Buffer.alloc(KEY_LENGTH);
  const secretKey = Buffer.alloc(KEY_LENGTH);
  sodium.crypto_box_keypair(publicKey, secretKey);
  return { publicKey: plain(publicKey), secretKey: plain(secretKey) };
}
