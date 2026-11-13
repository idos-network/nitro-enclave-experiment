import type { BoxKeyPair } from "tweetnacl";
import { boxOpen, keyPairFromSecretKey } from "./box.ts";

export function getEncryptionKeyPair(
  encryptedKeyB64: string,
  nonceB64: string,
  sessionClientPublicKey: Uint8Array,
  sessionServerPrivateKey: Uint8Array,
): BoxKeyPair | null {
  const secretKey = boxOpen(
    Buffer.from(encryptedKeyB64, "base64url"),
    Buffer.from(nonceB64, "base64url"),
    sessionClientPublicKey,
    sessionServerPrivateKey,
  );

  if (!secretKey) {
    return null;
  }

  return keyPairFromSecretKey(secretKey);
}
