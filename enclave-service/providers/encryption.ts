import nacl from "tweetnacl";

export function encrypt(
  messageBase64Url: string,
  recipientEncryptionPublicKeyBase64Url: string,
): { nonce: string; encrypted: string; publicKey: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ephemeralKeyPair = nacl.box.keyPair();

  const encrypted = nacl.box(
    Buffer.from(messageBase64Url, "base64url"),
    nonce,
    Buffer.from(recipientEncryptionPublicKeyBase64Url, "base64url"),
    ephemeralKeyPair.secretKey,
  );

  if (encrypted === null)
    throw Error(
      `Couldn't encrypt the provided message. ${JSON.stringify(
        {
          nonce: Buffer.from(nonce).toString("base64"),
          recipient: recipientEncryptionPublicKeyBase64Url,
        },
        null,
        2,
      )}`,
    );

  return {
    nonce: Buffer.from(nonce).toString("base64url"),
    encrypted: Buffer.from(encrypted).toString("base64url"),
    publicKey: Buffer.from(ephemeralKeyPair.publicKey).toString("base64url"),
  };
}

export function decrypt(
  messageBase64Url: string,
  nonceBase64Url: string,
  senderEncryptionPublicKeyBase64Url: string,
  sessionEncryptionPrivateKey: Uint8Array,
): string {
  const decrypted = nacl.box.open(
    Buffer.from(messageBase64Url, "base64url"),
    Buffer.from(nonceBase64Url, "base64url"),
    Buffer.from(senderEncryptionPublicKeyBase64Url, "base64url"),
    sessionEncryptionPrivateKey,
  );

  if (decrypted === null) {
    throw Error(
      `Couldn't decrypt the provided message. ${JSON.stringify(
        {
          nonce: nonceBase64Url,
          sender: senderEncryptionPublicKeyBase64Url,
        },
        null,
        2,
      )}`,
    );
  }

  return Buffer.from(decrypted).toString("base64url");
}
