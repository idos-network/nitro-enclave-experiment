import tweetnacl, { type BoxKeyPair } from "tweetnacl";

export async function getEncryptionKeyPair(
  encryptedKeyB64: string,
  nonceB64: string,
  sessionClientPublicKey: Uint8Array,
  sessionServerPrivateKey: Uint8Array,
): Promise<BoxKeyPair | null> {
  const secretKey = tweetnacl.box.open(
    Buffer.from(encryptedKeyB64, "base64url"),
    Buffer.from(nonceB64, "base64url"),
    sessionClientPublicKey,
    sessionServerPrivateKey,
  );

  if (!secretKey) {
    return null;
  }

  return tweetnacl.box.keyPair.fromSecretKey(secretKey);
}
